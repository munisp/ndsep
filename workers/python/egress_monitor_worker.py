#!/usr/bin/env python3
"""
NDSEP Egress Monitor Worker — Data Sovereignty / Localisation Enforcement
=========================================================================
Regulatory driver: CBN Circular PSS/DIR/PUB/CIR/001/004 (2026-06-15) — payment
transaction data generated in Nigeria must be stored and managed in Nigeria
by 2027-01-01. This worker provides the OBSERVED half of enforcement (the
hosting declarations are the DECLARED half):

  1. Consumes egress flow records from Kafka topic ``netflow.egress``
     (JSON: src_entity, dst_ip, dst_port, bytes, ts, sni optional) via the
     Kafka REST Proxy (stdlib + requests only — no kafka-python).
  2. Classifies destinations against the admin-editable ``asn_geo_reference``
     table (Nigerian CIDRs => domestic; cloud-region CIDRs => foreign;
     otherwise unknown). REFERENCE DATA ONLY — see migration 0096.
  3. Aggregates per-entity 5-minute rollups into ``egress_flow_rollups``.
  4. Runs a Poisson change-point detector (ported from
     ml/bayesian/models.py::poisson_changepoint, pure-stdlib) over the
     per-window foreign-byte series per entity.
  5. Emits ``residency_violations`` rows when in-scope entities breach
     configurable ``egress_thresholds`` (ratio / bytes) or a change-point
     fires (P(lam2 > lam1) and rate-ratio above configured minimums).

FAIL-LOUD POLICY (hard rule — no silent mocks):
  * KAFKA_REST_PROXY_URL unset        -> exit(2) at startup.
  * SOVEREIGNTY_DB_API_URL (PostgREST) unset -> exit(2) at startup.
  * Broker/DB unreachable after MAX_CONSECUTIVE_FAILURES poll cycles
    -> exit(3) so the supervisor restarts/alerts.

Classification honesty: IP-CIDR longest-prefix match only. ASN reference rows
are informational (no BGP table is consulted); destinations that match no
reference CIDR are "unknown" and count NEITHER as domestic nor foreign —
they are reported in the rollup for analyst review.
"""

import ipaddress
import json
import logging
import math
import os
import random
import sys
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("egress_monitor")

# ─── Configuration (fail loud when absent) ────────────────────────────────────

KAFKA_REST_PROXY_URL = os.environ.get("KAFKA_REST_PROXY_URL", "").rstrip("/")
DB_API_URL = os.environ.get("SOVEREIGNITY_DB_API_URL") or os.environ.get("SOVEREIGNTY_DB_API_URL", "")
DB_API_URL = DB_API_URL.rstrip("/")
KAFKA_TOPIC = os.environ.get("EGRESS_KAFKA_TOPIC", "netflow.egress")
CONSUMER_GROUP = os.environ.get("EGRESS_CONSUMER_GROUP", "egress-monitor")
POLL_MAX_RECORDS = int(os.environ.get("EGRESS_POLL_MAX_RECORDS", "500"))
POLL_TIMEOUT_S = float(os.environ.get("EGRESS_POLL_TIMEOUT_S", "5"))
WINDOW_MINUTES_DEFAULT = 5
SERIES_LEN = int(os.environ.get("EGRESS_SERIES_LEN", "48"))  # windows kept per entity for change-point
REFERENCE_REFRESH_S = float(os.environ.get("EGRESS_REFERENCE_REFRESH_S", "300"))
MAX_CONSECUTIVE_FAILURES = int(os.environ.get("EGRESS_MAX_CONSECUTIVE_FAILURES", "12"))
CHANGEPOINT_RECENCY = 10  # MAP tau must be within the last N windows to alarm
CHANGEPOINT_MIN_WINDOWS = 12  # need at least this much history
POSTERIOR_DRAWS_MAX = int(os.environ.get("EGRESS_POSTERIOR_DRAWS_MAX", "5000"))  # cap posterior sampling cost
# Sustained high share of UNCLASSIFIED egress is itself a residency-visibility
# violation (violation_type 'unknown_classification_share', migration 0107):
UNKNOWN_SHARE_MAX = float(os.environ.get("EGRESS_UNKNOWN_SHARE_MAX", "0.5"))
UNKNOWN_STREAK_WINDOWS = int(os.environ.get("EGRESS_UNKNOWN_STREAK_WINDOWS", "6"))
HEALTH_HOST = os.environ.get("EGRESS_HEALTH_HOST", "127.0.0.1")
HEALTH_PORT = int(os.environ.get("EGRESS_HEALTH_PORT", "8092"))


def normalize_window_minutes(value) -> int:
    """Window minutes MUST divide 60 evenly so windows align on the hour;
    non-divisors would drift and misalign rollups. Falls back loudly."""
    try:
        w = int(value)
    except (TypeError, ValueError):
        w = 0
    if w <= 0 or 60 % w != 0:
        logger.error("window_minutes=%r is not a positive divisor of 60 — using default %d",
                     value, WINDOW_MINUTES_DEFAULT)
        return WINDOW_MINUTES_DEFAULT
    return w


def validate_config() -> None:
    """Fail loudly at startup when broker/DB config is absent (hard rule:
    no silent mock consumption or writes)."""
    if not KAFKA_REST_PROXY_URL:
        logger.critical("FATAL: KAFKA_REST_PROXY_URL is not set — refusing to run "
                        "without a real Kafka REST Proxy endpoint.")
        raise SystemExit(2)
    if not DB_API_URL:
        logger.critical("FATAL: SOVEREIGNTY_DB_API_URL is not set — refusing to run "
                        "without a real PostgREST endpoint for rollups/violations.")
        raise SystemExit(2)

SESSION = requests.Session()
SESSION.headers.update({"Content-Type": "application/json"})

# ─── Poisson change-point (pure-stdlib port of ml/bayesian/models.py) ─────────
#
# Model: y_t ~ Poisson(lam1) for t <= tau, Poisson(lam2) for t > tau.
# Priors: tau ~ DiscreteUniform{1..T-1}, lam_i ~ Gamma(a, b) (b = rate).
# tau posterior is exact over the grid; rate posteriors sampled with a seeded
# RNG (deterministic) exactly like the numpy original.


def _log_marginal_poisson(y, a: float, b: float) -> float:
    """log p(y) with lambda ~ Gamma(a, b) (b = rate) marginalized out."""
    n = len(y)
    s = math.fsum(y)
    return (
        math.lgamma(a + s)
        - math.lgamma(a)
        + a * math.log(b)
        - (a + s) * math.log(b + n)
        - math.fsum(math.lgamma(v + 1) for v in y)
    )


def poisson_changepoint(counts, a: float = 1.0, b: float = 0.2,
                        seed: int = 42, n_rate_draws: int = 20000) -> dict:
    """Single change-point in a Poisson count series.

    Returns tau posterior grid, MAP change-point, P(lam2 > lam1) and rate
    summaries. Raises ValueError for series shorter than 4 periods.
    Posterior draws are capped (POSTERIOR_DRAWS_MAX) to bound CPU per window.
    """
    n_rate_draws = max(200, min(int(n_rate_draws), POSTERIOR_DRAWS_MAX))
    y = [float(v) for v in counts]
    T = len(y)
    if T < 4:
        raise ValueError("need at least 4 periods for a change-point")
    prefix = [0.0]
    for v in y:
        prefix.append(prefix[-1] + v)
    suffix = [0.0] * (T + 1)
    for i in range(T - 1, -1, -1):
        suffix[i] = suffix[i + 1] + y[i]

    taus = list(range(1, T))
    # prefix/suffix sums of lgamma(y+1) — order-independent, so both segment
    # marginals can be built from cumulative sums.
    lg1_prefix = [0.0]
    for v in y:
        lg1_prefix.append(lg1_prefix[-1] + math.lgamma(v + 1))
    lg1_suffix = [0.0] * (T + 1)
    for i in range(T - 1, -1, -1):
        lg1_suffix[i] = lg1_suffix[i + 1] + math.lgamma(y[i] + 1)

    def log_marginal(sum_y, n, sum_lgamma):
        return (
            math.lgamma(a + sum_y)
            - math.lgamma(a)
            + a * math.log(b)
            - (a + sum_y) * math.log(b + n)
            - sum_lgamma
        )

    log_post = []
    for t in taus:
        log_post.append(
            log_marginal(prefix[t], t, lg1_prefix[t])
            + log_marginal(suffix[t], T - t, lg1_suffix[t])
        )
    m = max(log_post)
    post = [math.exp(v - m) for v in log_post]
    total = math.fsum(post)
    post = [v / total for v in post]

    map_tau = taus[max(range(len(post)), key=lambda i: post[i])]
    mean_tau = math.fsum(t * p for t, p in zip(taus, post))

    # Sampled rate posteriors (seeded => deterministic), mirroring the
    # numpy original: draw tau ~ grid posterior, then lam_i | tau, y.
    rng = random.Random(seed)
    cum = []
    acc = 0.0
    for p in post:
        acc += p
        cum.append(acc)

    def draw_tau():
        u = rng.random()
        lo, hi = 0, len(cum) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if cum[mid] < u:
                lo = mid + 1
            else:
                hi = mid
        return taus[lo]

    lam1_mean = 0.0
    lam2_mean = 0.0
    p_gt = 0
    for _ in range(n_rate_draws):
        t = draw_tau()
        s1, n1 = prefix[t], t
        s2, n2 = suffix[t], T - t
        l1 = rng.gammavariate(a + s1, 1.0 / (b + n1))
        l2 = rng.gammavariate(a + s2, 1.0 / (b + n2))
        lam1_mean += l1
        lam2_mean += l2
        if l2 > l1:
            p_gt += 1
    lam1_mean /= n_rate_draws
    lam2_mean /= n_rate_draws

    return {
        "T": T,
        "map_tau": map_tau,
        "mean_tau": mean_tau,
        "tau_posterior": post,
        "p_lam2_gt_lam1": p_gt / n_rate_draws,
        "lam1_mean": lam1_mean,
        "lam2_mean": lam2_mean,
        "rate_ratio": (lam2_mean / lam1_mean) if lam1_mean > 0 else float("inf"),
        "prior": {"rate_gamma_a": a, "rate_gamma_b": b, "tau": "discrete-uniform"},
    }


def foreign_egress_shift(counts, p_min: float, rate_ratio_min: float,
                         recency: int = CHANGEPOINT_RECENCY) -> dict:
    """Detect a RECENT step-UP in a foreign-egress per-window byte series.

    A change-point is only actionable if (a) the posterior strongly prefers
    lam2 > lam1, (b) the step is material (rate ratio above minimum), and
    (c) the MAP change-point is recent — an ancient shift that is already
    baseline must not re-alarm every window.
    """
    res = poisson_changepoint(counts)
    recent = res["map_tau"] >= res["T"] - recency
    detected = (
        res["p_lam2_gt_lam1"] >= p_min
        and res["rate_ratio"] >= rate_ratio_min
        and recent
    )
    return {"detected": detected, "recent": recent, **res}


# ─── Destination classification ───────────────────────────────────────────────

class ReferenceDB:
    """Longest-prefix-match classifier built from asn_geo_reference rows."""

    def __init__(self):
        self.entries = []  # (ip_network, is_nigerian, provider, region, country_code)
        self.loaded_at = 0.0

    def refresh(self):
        resp = SESSION.get(f"{DB_API_URL}/asn_geo_reference", params={"select": "*"}, timeout=15)
        resp.raise_for_status()
        entries = []
        for row in resp.json():
            cidr = row.get("cidr")
            if not cidr:
                continue  # ASN-only rows are informational (no BGP table consulted)
            try:
                net = ipaddress.ip_network(cidr, strict=False)
            except ValueError:
                logger.warning("Skipping invalid reference CIDR %r (id=%s)", cidr, row.get("id"))
                continue
            entries.append((net, bool(row.get("is_nigerian")), row.get("provider"),
                            row.get("region"), row.get("country_code")))
        # longest prefix first
        entries.sort(key=lambda e: e[0].prefixlen, reverse=True)
        self.entries = entries
        self.loaded_at = time.time()
        logger.info("Reference DB loaded: %d CIDR entries", len(entries))

    def classify(self, ip_str: str) -> dict:
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            return {"verdict": "unknown", "reason": "unparseable_ip"}
        if ip.is_private or ip.is_loopback or ip.is_link_local:
            return {"verdict": "domestic", "reason": "private_range"}
        for net, is_ng, provider, region, cc in self.entries:
            if ip.version == net.version and ip in net:
                return {
                    "verdict": "domestic" if is_ng else "foreign",
                    "reason": "reference_match",
                    "cidr": str(net),
                    "provider": provider,
                    "region": region,
                    "country_code": cc,
                }
        return {"verdict": "unknown", "reason": "no_reference_match"}


# ─── Thresholds & entity scope ────────────────────────────────────────────────

def load_thresholds() -> dict:
    resp = SESSION.get(f"{DB_API_URL}/egress_thresholds", params={"select": "*"}, timeout=15)
    resp.raise_for_status()
    global_row = None
    per_entity = {}
    for row in resp.json():
        if row.get("entity_ref") is None:
            global_row = row
        else:
            per_entity[row["entity_ref"]] = row
    if global_row is None:
        # No global row: fall back to the migration-0095 defaults, logged loudly.
        logger.warning("No global egress_thresholds row found — using migration defaults")
        global_row = {
            "max_foreign_ratio": 0.05,
            "max_foreign_bytes_per_window": 104857600,
            "changepoint_probability_min": 0.95,
            "changepoint_min_rate_ratio": 3.0,
            "window_minutes": WINDOW_MINUTES_DEFAULT,
            "in_scope_only": True,
            "enabled": True,
        }
    return {"global": global_row, "per_entity": per_entity}


def threshold_for(thresholds: dict, entity_ref: str) -> dict:
    return thresholds["per_entity"].get(entity_ref) or thresholds["global"]


class ScopeCache:
    """Caches hosting_declarations.in_scope per entity. Unknown entities are
    treated as IN SCOPE (fail toward enforcement) with a loud warning."""

    def __init__(self):
        self.cache = {}
        self.loaded_at = 0.0

    def refresh(self):
        resp = SESSION.get(
            f"{DB_API_URL}/hosting_declarations",
            params={"select": "entity_ref,in_scope", "order": "submitted_at.desc"},
            timeout=15,
        )
        resp.raise_for_status()
        cache = {}
        for row in resp.json():
            cache.setdefault(row["entity_ref"], bool(row.get("in_scope", True)))
        self.cache = cache
        self.loaded_at = time.time()

    def in_scope(self, entity_ref: str) -> bool:
        if entity_ref not in self.cache:
            logger.warning("Entity %s has no hosting declaration — treating as IN SCOPE", entity_ref)
            return True
        return self.cache[entity_ref]


# ─── Violation emission (deduped against open violations) ────────────────────

OPEN_STATUSES = "in.(detected,acknowledged,under_remediation)"


def raise_violation(entity_ref: str, violation_type: str, severity: str, details: dict) -> bool:
    """Insert a residency_violation unless an open one of the same type exists.
    Returns True when a new row was inserted."""
    q = SESSION.get(
        f"{DB_API_URL}/residency_violations",
        params={
            "entity_ref": f"eq.{entity_ref}",
            "violation_type": f"eq.{violation_type}",
            "status": OPEN_STATUSES,
            "select": "id",
            "limit": "1",
        },
        timeout=15,
    )
    q.raise_for_status()
    if q.json():
        logger.debug("Open %s violation already exists for %s — not duplicating",
                     violation_type, entity_ref)
        return False
    resp = SESSION.post(
        f"{DB_API_URL}/residency_violations",
        json={
            "entity_ref": entity_ref,
            "violation_type": violation_type,
            "source": "auto",
            "severity": severity,
            "details": details,
        },
        timeout=15,
    )
    resp.raise_for_status()
    logger.warning("RESIDENCY VIOLATION [%s] entity=%s severity=%s details=%s",
                   violation_type, entity_ref, severity, json.dumps(details)[:400])
    return True


# ─── Kafka REST Proxy consumer ────────────────────────────────────────────────

def create_consumer_instance() -> str:
    name = f"egress-monitor-{uuid.uuid4().hex[:12]}"
    resp = SESSION.post(
        f"{KAFKA_REST_PROXY_URL}/consumers/{CONSUMER_GROUP}",
        json={
            "name": name,
            "format": "json",
            "auto.offset.reset": "earliest",
            "enable.auto.commit": "false",
        },
        timeout=15,
    )
    resp.raise_for_status()
    base_uri = resp.json()["base_uri"]
    sub = SESSION.post(f"{base_uri}/subscription", json={"topics": [KAFKA_TOPIC]}, timeout=15)
    sub.raise_for_status()
    logger.info("Kafka REST consumer instance created: %s (topic=%s)", name, KAFKA_TOPIC)
    return base_uri


def delete_consumer_instance(base_uri: str):
    try:
        SESSION.delete(base_uri, timeout=10)
    except Exception as e:  # best-effort cleanup only
        logger.warning("Consumer instance cleanup failed: %s", e)


def poll_records(base_uri: str):
    resp = SESSION.get(
        f"{base_uri}/records",
        params={"timeout": int(POLL_TIMEOUT_S * 1000), "max_bytes": 5_000_000},
        timeout=POLL_TIMEOUT_S + 10,
    )
    resp.raise_for_status()
    return resp.json()


# ─── Aggregation window machinery ─────────────────────────────────────────────

def window_start_for(ts: datetime, window_minutes: int) -> datetime:
    minute = (ts.minute // window_minutes) * window_minutes
    return ts.replace(minute=minute, second=0, microsecond=0)


class WindowBucket:
    __slots__ = ("total_flows", "total_bytes", "domestic_flows", "domestic_bytes",
                 "foreign_flows", "foreign_bytes", "unknown_flows", "unknown_bytes",
                 "private_flows", "private_bytes", "foreign_dests")

    def __init__(self):
        self.total_flows = 0
        self.total_bytes = 0
        self.domestic_flows = 0
        self.domestic_bytes = 0
        self.foreign_flows = 0
        self.foreign_bytes = 0
        self.unknown_flows = 0
        self.unknown_bytes = 0
        self.private_flows = 0   # dst in RFC1918/loopback/link-local
        self.private_bytes = 0
        self.foreign_dests = defaultdict(lambda: {"bytes": 0, "flows": 0, "classification": {}})

    def add(self, nbytes: int, classification: dict, dst_ip: str, sni: str | None):
        self.total_flows += 1
        self.total_bytes += nbytes
        verdict = classification["verdict"]
        if verdict == "domestic":
            self.domestic_flows += 1
            self.domestic_bytes += nbytes
            if classification.get("reason") == "private_range":
                self.private_flows += 1
                self.private_bytes += nbytes
        elif verdict == "foreign":
            self.foreign_flows += 1
            self.foreign_bytes += nbytes
            key = sni or dst_ip
            d = self.foreign_dests[key]
            d["bytes"] += nbytes
            d["flows"] += 1
            d["classification"] = {
                "cidr": classification.get("cidr"),
                "provider": classification.get("provider"),
                "region": classification.get("region"),
                "country_code": classification.get("country_code"),
            }
        else:
            self.unknown_flows += 1
            self.unknown_bytes += nbytes

    def foreign_ratio(self) -> float:
        # Private/private flows (RFC1918 etc.) are excluded from BOTH sides of
        # the ratio: internal chatter would otherwise inflate the denominator
        # and mask real foreign egress.
        denom = self.foreign_bytes + (self.domestic_bytes - self.private_bytes)
        return (self.foreign_bytes / denom) if denom > 0 else 0.0

    def unknown_share(self) -> float:
        return (self.unknown_bytes / self.total_bytes) if self.total_bytes > 0 else 0.0

    def top_foreign(self, n: int = 10):
        items = sorted(self.foreign_dests.items(), key=lambda kv: kv[1]["bytes"], reverse=True)[:n]
        return [
            {"dst": dst, "bytes": v["bytes"], "flows": v["flows"], **v["classification"]}
            for dst, v in items
        ]


ROLLUP_ADDITIVE_FIELDS = (
    "total_flows", "total_bytes", "domestic_flows", "domestic_bytes",
    "foreign_flows", "foreign_bytes", "unknown_flows", "unknown_bytes",
)


def upsert_rollup(entity_ref: str, ws: datetime, window_minutes: int, bucket: WindowBucket,
                  max_retries: int = 3):
    """ADDITIVE rollup upsert: late/arrived-twice flows must ACCUMULATE into the
    window (bytes = existing + new), never overwrite a partial rollup written by
    an earlier flush. Read-modify-write with retry on conflict."""
    window_end = (ws + timedelta(minutes=window_minutes)).isoformat()
    for attempt in range(1, max_retries + 1):
        q = SESSION.get(
            f"{DB_API_URL}/egress_flow_rollups",
            params={
                "entity_ref": f"eq.{entity_ref}",
                "window_start": f"eq.{ws.isoformat()}",
                "select": ",".join(["id", *ROLLUP_ADDITIVE_FIELDS, "foreign_ratio"]),
            },
            timeout=15,
        )
        q.raise_for_status()
        existing = q.json()
        if not existing:
            payload = {
                "entity_ref": entity_ref,
                "window_start": ws.isoformat(),
                "window_end": window_end,
                **{f: getattr(bucket, f) for f in ROLLUP_ADDITIVE_FIELDS},
                "foreign_ratio": round(bucket.foreign_ratio(), 6),
                "top_foreign_destinations": bucket.top_foreign(),
            }
            resp = SESSION.post(
                f"{DB_API_URL}/egress_flow_rollups",
                json=payload,
                headers={"Prefer": "resolution=merge-duplicates,return=representation"},
                params={"on_conflict": "entity_ref,window_start"},
                timeout=15,
            )
            # 409 => concurrent insert; loop re-reads and adds.
            if resp.status_code == 409 and attempt < max_retries:
                continue
            resp.raise_for_status()
            return
        row = existing[0]
        merged = {f: int(row.get(f) or 0) + getattr(bucket, f) for f in ROLLUP_ADDITIVE_FIELDS}
        denom = merged["foreign_bytes"] + merged["domestic_bytes"]
        payload = {
            **merged,
            "window_end": window_end,
            # Ratio over merged bytes; private flows are not recoverable from
            # the stored row, so the stored domestic bytes (incl. private) are
            # the documented approximation on merge.
            "foreign_ratio": round(merged["foreign_bytes"] / denom, 6) if denom > 0 else 0.0,
            "top_foreign_destinations": bucket.top_foreign(),
        }
        resp = SESSION.patch(
            f"{DB_API_URL}/egress_flow_rollups",
            params={"id": f"eq.{row['id']}"},
            json=payload,
            timeout=15,
        )
        if resp.status_code == 409 and attempt < max_retries:
            continue
        resp.raise_for_status()
        return


# ─── Manual offset commit machinery ───────────────────────────────────────────
# Offsets are committed ONLY after every rollup flush for the cycle succeeded.
# Each consumed record's (partition, offset) is bound to its aggregation window;
# a partition offset becomes commitable once all records at or below it belong
# to flushed windows.

class OffsetTracker:
    def __init__(self):
        # partition -> sorted list of (offset, window_key) awaiting flush
        self.pending: dict[int, list[tuple[int, tuple]]] = defaultdict(list)
        self.consumed_max: dict[int, int] = {}

    def record(self, partition: int, offset: int, window_key: tuple):
        self.pending[partition].append((offset, window_key))
        self.consumed_max[partition] = max(self.consumed_max.get(partition, -1), offset)

    def flush_done(self, window_key: tuple):
        for part in list(self.pending):
            self.pending[part] = [(o, k) for (o, k) in self.pending[part] if k != window_key]

    def commitable(self) -> list[dict]:
        """Next-read offset per partition = smallest still-pending offset, or
        consumed_max + 1 when nothing is pending."""
        out = []
        for part, maxoff in self.consumed_max.items():
            pending = self.pending.get(part) or []
            next_off = min(o for o, _ in pending) if pending else maxoff + 1
            if next_off > 0:
                out.append({"topic": KAFKA_TOPIC, "partition": part, "offset": next_off})
        return out


def commit_offsets(base_uri: str, tracker: OffsetTracker) -> None:
    offsets = tracker.commitable()
    if not offsets:
        return
    resp = SESSION.post(f"{base_uri}/offsets", json={"offsets": offsets}, timeout=15)
    resp.raise_for_status()


# ─── Health endpoint ──────────────────────────────────────────────────────────

HEALTH_STATE = {"last_ok_poll": 0.0, "db_ok": False, "started_at": time.time()}


def start_health_server():
    """Minimal /health: 200 when the poll loop is alive and the DB API answered
    recently, else 503. Never leaks raw dependency errors."""
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/health":
                self.send_response(404)
                self.end_headers()
                return
            alive = (time.time() - HEALTH_STATE["last_ok_poll"]) < max(120.0, POLL_TIMEOUT_S * 12)
            ok = alive and HEALTH_STATE["db_ok"]
            body = json.dumps({
                "status": "ok" if ok else "degraded",
                "poll_alive": alive,
                "db_ok": HEALTH_STATE["db_ok"],
                "uptime_s": int(time.time() - HEALTH_STATE["started_at"]),
            }).encode()
            self.send_response(200 if ok else 503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):  # silence default stderr access log
            pass

    server = HTTPServer((HEALTH_HOST, HEALTH_PORT), Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True, name="egress-health")
    t.start()
    logger.info("Health endpoint listening on http://%s:%d/health", HEALTH_HOST, HEALTH_PORT)


# ─── Main loop ────────────────────────────────────────────────────────────────

def run() -> int:
    validate_config()
    ref = ReferenceDB()
    ref.refresh()
    thresholds = load_thresholds()
    scope = ScopeCache()
    scope.refresh()
    start_health_server()

    base_uri = create_consumer_instance()
    # per (entity, window_start_iso) -> bucket
    buckets: dict[tuple[str, str], WindowBucket] = {}
    # per entity -> deque of (window_start_iso, foreign_bytes)
    series: dict[str, deque] = defaultdict(lambda: deque(maxlen=SERIES_LEN))
    # per entity -> consecutive windows with unknown share above threshold
    unknown_streak: dict[str, int] = defaultdict(int)
    flushed_windows: set[str] = set()
    offsets = OffsetTracker()
    failures = 0

    logger.info("Egress monitor started: proxy=%s db_api=%s topic=%s",
                KAFKA_REST_PROXY_URL, DB_API_URL, KAFKA_TOPIC)

    try:
        while True:
            try:
                if time.time() - ref.loaded_at > REFERENCE_REFRESH_S:
                    ref.refresh()
                    thresholds = load_thresholds()
                    scope.refresh()
                records = poll_records(base_uri)
                failures = 0
                HEALTH_STATE["last_ok_poll"] = time.time()
                HEALTH_STATE["db_ok"] = True
            except requests.RequestException as e:
                failures += 1
                HEALTH_STATE["db_ok"] = False
                logger.error("Poll cycle failed (%d/%d): %s",
                             failures, MAX_CONSECUTIVE_FAILURES, e)
                if failures >= MAX_CONSECUTIVE_FAILURES:
                    logger.critical("Kafka/DB unreachable for %d consecutive cycles — exiting loudly",
                                    failures)
                    return 3
                time.sleep(min(2 ** failures, 60))
                continue

            now_utc = datetime.now(timezone.utc)
            for rec in records:
                value = rec.get("value")
                if not isinstance(value, dict):
                    logger.warning("Skipping non-JSON record at offset %s", rec.get("offset"))
                    continue
                entity = value.get("src_entity")
                dst_ip = value.get("dst_ip")
                nbytes = value.get("bytes")
                if not entity or not dst_ip or not isinstance(nbytes, int) or nbytes < 0:
                    logger.warning("Skipping malformed flow record: %s", json.dumps(value)[:300])
                    continue
                try:
                    ts = datetime.fromisoformat(str(value.get("ts", "")).replace("Z", "+00:00"))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                except ValueError:
                    ts = now_utc
                thr = threshold_for(thresholds, entity)
                wmin = normalize_window_minutes(thr.get("window_minutes") or WINDOW_MINUTES_DEFAULT)
                ws = window_start_for(ts, wmin)
                key = (entity, ws.isoformat())
                bucket = buckets.setdefault(key, WindowBucket())
                classification = ref.classify(dst_ip)
                bucket.add(nbytes, classification, dst_ip, value.get("sni"))
                try:
                    offsets.record(int(rec.get("partition", 0)), int(rec.get("offset", 0)), key)
                except (TypeError, ValueError):
                    pass

            # Flush windows that have fully closed. Offsets are committed only
            # when EVERY flush this cycle succeeded (manual commit semantics).
            flush_ok = True
            for (entity, ws_iso), bucket in list(buckets.items()):
                ws = datetime.fromisoformat(ws_iso)
                thr = threshold_for(thresholds, entity)
                wmin = normalize_window_minutes(thr.get("window_minutes") or WINDOW_MINUTES_DEFAULT)
                if ws + timedelta(minutes=wmin) >= now_utc:
                    continue  # window still open
                if not thr.get("enabled", True):
                    del buckets[(entity, ws_iso)]
                    offsets.flush_done((entity, ws_iso))
                    continue
                try:
                    upsert_rollup(entity, ws, wmin, bucket)
                except Exception as e:
                    flush_ok = False
                    logger.error("Rollup upsert failed for %s@%s (will retry; offsets NOT committed): %s",
                                 entity, ws_iso, e)
                    continue
                del buckets[(entity, ws_iso)]
                offsets.flush_done((entity, ws_iso))
                series[entity].append((ws_iso, bucket.foreign_bytes))

                # Sustained high unknown-classification share is its own
                # violation (migration 0107): we cannot attest residency for
                # traffic we cannot classify.
                share = bucket.unknown_share()
                if share > UNKNOWN_SHARE_MAX:
                    unknown_streak[entity] += 1
                else:
                    unknown_streak[entity] = 0
                if unknown_streak[entity] >= UNKNOWN_STREAK_WINDOWS:
                    raise_violation(entity, "unknown_classification_share", "medium", {
                        "window_start": ws_iso,
                        "unknown_share": round(share, 6),
                        "unknown_share_threshold": UNKNOWN_SHARE_MAX,
                        "consecutive_windows": unknown_streak[entity],
                        "unknown_bytes": bucket.unknown_bytes,
                        "total_bytes": bucket.total_bytes,
                        "legal_basis": "CBN Circular PSS/DIR/PUB/CIR/001/004 — residency cannot be attested for unclassifiable egress; extend asn_geo_reference",
                    })
                    unknown_streak[entity] = 0  # re-arm after raising

                if thr.get("in_scope_only", True) and not scope.in_scope(entity):
                    continue

                # Threshold breach.
                ratio = bucket.foreign_ratio()
                if ratio > float(thr.get("max_foreign_ratio", 0.05)) or (
                    bucket.foreign_bytes > int(thr.get("max_foreign_bytes_per_window", 104857600))
                ):
                    raise_violation(entity, "foreign_egress_threshold", "high", {
                        "window_start": ws_iso,
                        "foreign_ratio": round(ratio, 6),
                        "max_foreign_ratio": thr.get("max_foreign_ratio"),
                        "foreign_bytes": bucket.foreign_bytes,
                        "max_foreign_bytes_per_window": thr.get("max_foreign_bytes_per_window"),
                        "top_foreign_destinations": bucket.top_foreign(),
                        "legal_basis": "CBN Circular PSS/DIR/PUB/CIR/001/004",
                    })

                # Change-point on the foreign-byte window series.
                counts = [fb for _, fb in series[entity]]
                if len(counts) >= CHANGEPOINT_MIN_WINDOWS:
                    # scale to counts-like magnitudes (Poisson model is for
                    # counts; use MiB units to keep rates sane)
                    scaled = [max(0, int(round(c / 1_048_576))) for c in counts]
                    shift = foreign_egress_shift(
                        scaled,
                        p_min=float(thr.get("changepoint_probability_min", 0.95)),
                        rate_ratio_min=float(thr.get("changepoint_min_rate_ratio", 3.0)),
                    )
                    dedup_key = f"{entity}:{shift['map_tau']}:{len(counts)}"
                    if shift["detected"] and dedup_key not in flushed_windows:
                        flushed_windows.add(dedup_key)
                        raise_violation(entity, "egress_changepoint_shift", "medium", {
                            "map_tau": shift["map_tau"],
                            "series_windows": shift["T"],
                            "p_lam2_gt_lam1": round(shift["p_lam2_gt_lam1"], 4),
                            "lam1_mib_per_window": round(shift["lam1_mean"], 2),
                            "lam2_mib_per_window": round(shift["lam2_mean"], 2),
                            "rate_ratio": round(shift["rate_ratio"], 2),
                            "legal_basis": "CBN Circular PSS/DIR/PUB/CIR/001/004",
                        })
            if len(flushed_windows) > 10000:
                flushed_windows.clear()
            if flush_ok:
                try:
                    commit_offsets(base_uri, offsets)
                except requests.RequestException as e:
                    logger.error("Offset commit failed (records will be replayed): %s", e)
    finally:
        delete_consumer_instance(base_uri)


if __name__ == "__main__":
    sys.exit(run())
