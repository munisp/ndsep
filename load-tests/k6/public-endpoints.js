/* global __ENV */
/**
 * NDSEP k6 — Public endpoints load test
 * Covers the unauthenticated hot paths citizens and external reviewers hit:
 *   - DPO/DPCO registry browse      (dpoMarketplace.listProfiles)
 *   - Sanctions register search     (sanctionsRegister.search / .stats / .detail)
 *   - FOIA request tracking         (foia.track)
 *
 * SLO targets (reads): p50 < 100ms, p95 < 500ms, p99 < 1s — see README.md.
 *
 * Run:
 *   k6 run -e BASE_URL=http://localhost:3000 load-tests/k6/public-endpoints.js
 *
 * NOTE (superjson): the server uses a superjson transformer, so GET query
 * inputs must be wrapped as {"json": {...}} — a bare JSON input is rejected
 * with BAD_REQUEST.
 */
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
const registryLatency = new Trend("registry_latency", true);
const sanctionsLatency = new Trend("sanctions_latency", true);
const foiaLatency = new Trend("foia_track_latency", true);

export const options = {
  scenarios: {
    public_reads: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 20 },
        { duration: "2m", target: 20 },
        { duration: "30s", target: 50 },
        { duration: "2m", target: 50 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    errors: ["rate<0.01"],
    registry_latency: ["p(50)<100", "p(95)<500", "p(99)<1000"],
    sanctions_latency: ["p(50)<100", "p(95)<500", "p(99)<1000"],
    foia_track_latency: ["p(50)<100", "p(95)<500", "p(99)<1000"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// superjson-wrapped tRPC GET query
function trpcQuery(procedure, input, trend) {
  const wrapped = input === undefined ? undefined : { json: input };
  const url = `${BASE_URL}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(wrapped ?? { json: null }))}`;
  const res = http.get(url, { headers: { "Content-Type": "application/json" } });
  if (trend) trend.add(res.timings.duration);
  return res;
}

const SEARCH_TERMS = ["bank", "fintech", "data", "health", "telecom", ""];
const SECTORS = ["fintech", "healthcare", "energy", "insurance", "telecom"];

export default function () {
  group("registry browse", () => {
    const sector = SECTORS[Math.floor(Math.random() * SECTORS.length)];
    const res = trpcQuery("dpoMarketplace.listProfiles", { sector, verifiedOnly: false }, registryLatency);
    if (!check(res, {
      "registry 200": (r) => r.status === 200,
      "registry has result": (r) => r.body && r.body.includes("result"),
    })) {
      errorRate.add(1);
    } else {
      errorRate.add(0);
    }
  });

  group("sanctions register", () => {
    const q = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
    const search = trpcQuery("sanctionsRegister.search", { query: q, page: 1, limit: 20 }, sanctionsLatency);
    if (!check(search, { "sanctions search 200": (r) => r.status === 200 })) {
      errorRate.add(1);
      return;
    }
    errorRate.add(0);

    // Drill into the first published notice when one exists.
    try {
      const body = JSON.parse(search.body);
      const rows = body?.result?.data?.json?.data ?? [];
      if (rows.length > 0) {
        const detail = trpcQuery("sanctionsRegister.detail", { id: rows[0].id }, sanctionsLatency);
        if (!check(detail, { "sanctions detail 200": (r) => r.status === 200 })) errorRate.add(1);
        else errorRate.add(0);
      }
    } catch {
      errorRate.add(1);
    }

    const stats = trpcQuery("sanctionsRegister.stats", undefined, sanctionsLatency);
    if (!check(stats, { "sanctions stats 200": (r) => r.status === 200 })) errorRate.add(1);
    else errorRate.add(0);
  });

  group("foia track", () => {
    // Unknown reference: server responds 404 NOT_FOUND — this still exercises
    // the full query path (DB lookup + email match), which is what we time.
    const ref = `FOIA-LOAD-${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`;
    const res = trpcQuery(
      "foia.track",
      { referenceNumber: ref, requesterEmail: "loadtest@example.com" },
      foiaLatency,
    );
    if (!check(res, {
      "foia track reached (200 or 404)": (r) => r.status === 200 || r.status === 404,
      "foia track not 5xx": (r) => r.status < 500,
    })) {
      errorRate.add(1);
    } else {
      errorRate.add(0);
    }
  });

  sleep(1);
}
