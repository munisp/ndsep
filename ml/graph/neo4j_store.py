"""Real Neo4j client for the NDSEP compliance graph.

Uses the official ``neo4j`` Python driver (``pip install neo4j``). When the
driver is not installed every entry point raises :class:`Neo4jStoreError`
with an actionable message, and :data:`HAS_NEO4J` is ``False`` so callers
can fall back (see ``ml.graph.graph_source``).

Connection configuration (env or constructor kwargs):
    NEO4J_URI       bolt URI          (default bolt://localhost:7687)
    NEO4J_USER      username          (default neo4j)
    NEO4J_PASSWORD  password          (default ndsep-neo4j-dev — dev only)

Graph model (mirrors ml/data/generate_synthetic.py):
    Node labels      Organization, Violation, EnforcementAction, Officer,
                     Sector — keyed by the integer ``node_id`` property the
                     GNN training frames use, with ``ref_id`` (e.g. ORG-00042),
                     ``node_type`` and a float ``features`` vector (f0..f19).
                     Organizations may also carry ``high_risk`` /
                     ``risk_latent`` label properties.
    Relationships    HAS_VIOLATION, ENFORCED_BY, SECTOR_PEER,
                     TRANSACTS_WITH, EMPLOYS (typed, directed).

All writes are idempotent (MERGE on node_id / (src, dst, type)) and batched
via ``UNWIND`` inside write transactions. Community / ring analytics try
GDS first and fall back to deterministic pure-Python implementations,
because neo4j-community ships without the GDS plugin.
"""

from __future__ import annotations

import logging
import os
from collections import Counter, deque
from typing import Any, Iterable, Optional

import pandas as pd

log = logging.getLogger(__name__)

try:
    from neo4j import GraphDatabase
    HAS_NEO4J = True
except ImportError:  # driver optional — callers must check HAS_NEO4J
    GraphDatabase = None
    HAS_NEO4J = False

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "ndsep-neo4j-dev")

# node_type (as in graph_nodes.node_type) -> Neo4j label. Whitelist: labels
# are interpolated into Cypher and must never come from untrusted input.
NODE_TYPE_TO_LABEL = {
    "organization": "Organization",
    "violation": "Violation",
    "enforcement_action": "EnforcementAction",
    "officer": "Officer",
    "sector": "Sector",
}
LABEL_TO_NODE_TYPE = {v: k for k, v in NODE_TYPE_TO_LABEL.items()}

# Relationship-type whitelist (same injection argument as labels).
EDGE_TYPES = ("HAS_VIOLATION", "ENFORCED_BY", "SECTOR_PEER",
              "TRANSACTS_WITH", "EMPLOYS")

FEATURE_DIM = 20
DEFAULT_BATCH_SIZE = 1000


class Neo4jStoreError(RuntimeError):
    """Raised for driver absence, connection failure or Cypher errors."""


# --------------------------------------------------------------------------- #
# Record normalisation (accept DataFrames or list-of-dicts)
# --------------------------------------------------------------------------- #
def _feature_cols(df: pd.DataFrame) -> list[str]:
    return sorted((c for c in df.columns
                   if c.startswith("f") and c[1:].isdigit()),
                  key=lambda c: int(c[1:]))


def node_records(nodes: Any) -> list[dict]:
    """Normalise nodes to [{node_id, ref_id, node_type, features, props}]."""
    if isinstance(nodes, pd.DataFrame):
        fcols = _feature_cols(nodes)
        recs = []
        for row in nodes.to_dict("records"):
            feats = [float(row[c]) for c in fcols] if fcols \
                else [float(x) for x in row.get("features", [])]
            props = {k: v for k, v in row.items()
                     if k not in ("node_id", "ref_id", "node_type", "features")
                     and not (k.startswith("f") and k[1:].isdigit())
                     and pd.notna(v)}
            recs.append({"node_id": int(row["node_id"]),
                         "ref_id": str(row.get("ref_id", row["node_id"])),
                         "node_type": str(row["node_type"]),
                         "features": feats, "props": props})
        return recs
    out = []
    for row in nodes:
        row = dict(row)
        feats = row.pop("features", None)
        if feats is None:
            fkeys = sorted((k for k in row
                            if k.startswith("f") and k[1:].isdigit()),
                           key=lambda k: int(k[1:]))
            feats = [float(row.pop(k)) for k in fkeys]
        node_id = int(row.pop("node_id"))
        out.append({"node_id": node_id,
                    "ref_id": str(row.pop("ref_id", node_id)),
                    "node_type": str(row.pop("node_type")),
                    "features": [float(x) for x in feats],
                    "props": {k: v for k, v in row.items()
                              if v is not None and k not in ("high_risk",
                                                             "risk_latent")}})
    return out


def edge_records(edges: Any) -> list[dict]:
    """Normalise edges to [{src, dst, edge_type}]."""
    rows = edges.to_dict("records") if isinstance(edges, pd.DataFrame) \
        else list(edges)
    out = []
    for row in rows:
        etype = str(row["edge_type"]).upper()
        if etype not in EDGE_TYPES:
            raise ValueError(
                f"Unknown edge_type {etype!r}; allowed: {EDGE_TYPES}")
        out.append({"src": int(row["src"]), "dst": int(row["dst"]),
                    "edge_type": etype})
    return out


def label_records(labels: Any) -> list[dict]:
    """Normalise graph_labels rows for MERGE onto Organization nodes."""
    rows = labels.to_dict("records") if isinstance(labels, pd.DataFrame) \
        else list(labels)
    return [{"node_id": int(r["node_id"]),
             "org_id": str(r.get("org_id", r["node_id"])),
             "high_risk": int(r["high_risk"]),
             "risk_latent": float(r.get("risk_latent", 0.0))}
           for r in rows]


def _records_to_frames(nodes_raw: list[dict], edges_raw: list[dict]):
    """Rebuild the (nodes_df, edges_df, labels_df) training frames."""
    node_rows, label_rows = [], []
    for r in nodes_raw:
        feats = list(r.get("features") or [])
        feats = (feats + [0.0] * FEATURE_DIM)[:FEATURE_DIM]
        row = {"node_id": int(r["node_id"]),
               "ref_id": r.get("ref_id", str(r["node_id"])),
               "node_type": r.get("node_type") or LABEL_TO_NODE_TYPE.get(
                   (r.get("labels") or [""])[0], "organization")}
        row.update({f"f{i}": float(feats[i]) for i in range(FEATURE_DIM)})
        node_rows.append(row)
        if r.get("high_risk") is not None:
            label_rows.append({"org_id": r.get("org_id", row["ref_id"]),
                               "node_id": int(r["node_id"]),
                               "high_risk": int(r["high_risk"]),
                               "risk_latent": float(r.get("risk_latent", 0.0))})
    edge_rows = [{"src": int(e["src"]), "dst": int(e["dst"]),
                  "edge_type": e["edge_type"]} for e in edges_raw]
    nodes_df = pd.DataFrame(node_rows).sort_values("node_id") \
        .reset_index(drop=True) if node_rows else pd.DataFrame(
            columns=["node_id", "ref_id", "node_type"]
            + [f"f{i}" for i in range(FEATURE_DIM)])
    edges_df = pd.DataFrame(edge_rows, columns=["src", "dst", "edge_type"])
    labels_df = pd.DataFrame(
        label_rows, columns=["org_id", "node_id", "high_risk", "risk_latent"])
    return nodes_df, edges_df, labels_df


# --------------------------------------------------------------------------- #
# Pure-Python analytics (used as GDS fallbacks and directly unit-tested)
# --------------------------------------------------------------------------- #
def label_propagation(n_nodes: int, edges: Iterable[tuple[int, int]],
                      max_iter: int = 100) -> dict[int, int]:
    """Deterministic label-propagation community detection.

    Undirected, asynchronous updates with smallest-label tie-break.
    Returns {node_id: community_id} with communities renumbered 0..k-1.
    """
    adj: list[list[int]] = [[] for _ in range(n_nodes)]
    for s, d in edges:
        s, d = int(s), int(d)
        if 0 <= s < n_nodes and 0 <= d < n_nodes and s != d:
            adj[s].append(d)
            adj[d].append(s)
    labels = list(range(n_nodes))
    for _ in range(max_iter):
        changed = False
        for v in range(n_nodes):
            if not adj[v]:
                continue
            counts = Counter(labels[u] for u in adj[v])
            best = max(counts.values())
            new = min(l for l, c in counts.items() if c == best)
            if new != labels[v]:
                labels[v] = new
                changed = True
        if not changed:
            break
    remap: dict[int, int] = {}
    out: dict[int, int] = {}
    for v in range(n_nodes):
        if labels[v] not in remap:
            remap[labels[v]] = len(remap)
        out[v] = remap[labels[v]]
    return out


def find_collusion_rings(pairs: Iterable[dict],
                         min_size: int = 3,
                         min_weight: float = 2.0,
                         officer_link_weight: float = 2.0,
                         enforced_orgs: Optional[set[int]] = None
                         ) -> list[dict]:
    """Detect tightly connected organisation clusters from pair signals.

    ``pairs`` rows: {a, b, officer_links, direct_links} where officer_links
    counts cross-org officer↔officer links (shared-officer signal) and
    direct_links counts org↔org TRANSACTS_WITH / SECTOR_PEER edges.
    weight = officer_link_weight * officer_links + direct_links; pairs below
    ``min_weight`` are dropped. Connected components of the surviving
    weighted org graph with >= ``min_size`` members are returned as rings.
    """
    adj: dict[int, dict[int, float]] = {}
    officer_totals: Counter[int] = Counter()
    for p in pairs:
        a, b = int(p["a"]), int(p["b"])
        if a == b:
            continue
        w = (officer_link_weight * float(p.get("officer_links", 0))
             + float(p.get("direct_links", 0)))
        if w < min_weight:
            continue
        adj.setdefault(a, {})[b] = max(adj.get(a, {}).get(b, 0.0), w)
        adj.setdefault(b, {})[a] = max(adj.get(b, {}).get(a, 0.0), w)
        officer_totals[a] += int(p.get("officer_links", 0))
        officer_totals[b] += int(p.get("officer_links", 0))

    seen: set[int] = set()
    rings: list[dict] = []
    for start in sorted(adj):
        if start in seen:
            continue
        comp, queue = [], deque([start])
        seen.add(start)
        while queue:
            v = queue.popleft()
            comp.append(v)
            for u in adj[v]:
                if u not in seen:
                    seen.add(u)
                    queue.append(u)
        if len(comp) < min_size:
            continue
        cs = set(comp)
        internal = sum(1 for v in comp for u in adj[v] if u in cs) // 2
        density = 2.0 * internal / (len(comp) * (len(comp) - 1))
        hits = len(cs & enforced_orgs) if enforced_orgs else 0
        score = round(len(comp) * density + 0.5 * hits, 4)
        rings.append({
            "ring_id": len(rings),
            "members": sorted(comp),
            "size": len(comp),
            "internal_edges": internal,
            "density": round(density, 4),
            "shared_officer_links": int(sum(officer_totals[o] for o in comp)),
            "enforcement_hits": hits,
            "score": score,
        })
    rings.sort(key=lambda r: (-r["score"], r["members"]))
    for i, r in enumerate(rings):
        r["ring_id"] = i
    return rings


# --------------------------------------------------------------------------- #
# Store
# --------------------------------------------------------------------------- #
class Neo4jGraphStore:
    """Connection-managed Neo4j client. Use as a context manager."""

    def __init__(self, uri: str = NEO4J_URI, user: str = NEO4J_USER,
                 password: str = NEO4J_PASSWORD,
                 batch_size: int = DEFAULT_BATCH_SIZE):
        if not HAS_NEO4J:
            raise Neo4jStoreError(
                "The 'neo4j' Python driver is not installed. "
                "Install it with: pip install neo4j")
        self.uri, self.user, self.password = uri, user, password
        self.batch_size = int(batch_size)
        self._driver = None

    # -- connection lifecycle --------------------------------------------- #
    def connect(self) -> "Neo4jGraphStore":
        try:
            self._driver = GraphDatabase.driver(
                self.uri, auth=(self.user, self.password))
            self._driver.verify_connectivity()
        except Exception as exc:
            self._driver = None
            raise Neo4jStoreError(
                f"Cannot connect to Neo4j at {self.uri} as {self.user}: "
                f"{exc}") from exc
        self.ensure_schema()
        return self

    def close(self) -> None:
        if self._driver is not None:
            self._driver.close()
            self._driver = None

    def __enter__(self) -> "Neo4jGraphStore":
        return self.connect()

    def __exit__(self, *_exc) -> None:
        self.close()

    def _require_driver(self):
        if self._driver is None:
            raise Neo4jStoreError(
                "Not connected — use 'with Neo4jGraphStore(...) as s' or "
                "call connect() first")
        return self._driver

    def _run(self, cypher: str, **params) -> list[dict]:
        driver = self._require_driver()
        try:
            with driver.session() as session:
                result = session.run(cypher, **params)
                return [dict(r) for r in result]
        except Neo4jStoreError:
            raise
        except Exception as exc:
            raise Neo4jStoreError(f"Cypher failed: {exc}\n{cypher}") from exc

    def _run_write(self, cypher: str, **params) -> None:
        driver = self._require_driver()
        try:
            with driver.session() as session:
                session.execute_write(lambda tx: tx.run(cypher, **params))
        except Exception as exc:
            raise Neo4jStoreError(f"Cypher write failed: {exc}") from exc

    # -- schema ------------------------------------------------------------ #
    def ensure_schema(self) -> None:
        for label in NODE_TYPE_TO_LABEL.values():
            self._run_write(
                f"CREATE CONSTRAINT ndsep_{label.lower()}_node_id "
                f"IF NOT EXISTS FOR (n:{label}) REQUIRE n.node_id IS UNIQUE")

    # -- writes ------------------------------------------------------------ #
    def push_graph(self, nodes: Any, edges: Any,
                   labels: Any = None) -> dict:
        """Idempotently MERGE the compliance graph into Neo4j.

        Accepts DataFrames or list-of-dicts in the shapes produced by
        ml/data/generate_synthetic.py (graph_nodes / graph_edges /
        graph_labels). Returns a summary dict.
        """
        nrecs = node_records(nodes)
        erecs = edge_records(edges)
        lrecs = label_records(labels) if labels is not None else []

        by_label: dict[str, list[dict]] = {}
        for r in nrecs:
            label = NODE_TYPE_TO_LABEL.get(r["node_type"])
            if label is None:
                raise ValueError(
                    f"Unknown node_type {r['node_type']!r}; "
                    f"allowed: {sorted(NODE_TYPE_TO_LABEL)}")
            by_label.setdefault(label, []).append(r)
        for label, rows in by_label.items():
            cypher = (
                "UNWIND $rows AS row "
                f"MERGE (n:{label} {{node_id: row.node_id}}) "
                "SET n.ref_id = row.ref_id, n.node_type = row.node_type, "
                "n.features = row.features, n += row.props")
            for i in range(0, len(rows), self.batch_size):
                self._run_write(cypher, rows=rows[i:i + self.batch_size])

        by_type: dict[str, list[dict]] = {}
        for r in erecs:
            by_type.setdefault(r["edge_type"], []).append(r)
        for etype, rows in by_type.items():
            cypher = (
                "UNWIND $rows AS row "
                "MATCH (a {node_id: row.src}), (b {node_id: row.dst}) "
                f"MERGE (a)-[r:{etype}]->(b)")
            for i in range(0, len(rows), self.batch_size):
                self._run_write(cypher, rows=rows[i:i + self.batch_size])

        if lrecs:
            cypher = (
                "UNWIND $rows AS row "
                "MATCH (n:Organization {node_id: row.node_id}) "
                "SET n.org_id = row.org_id, n.high_risk = row.high_risk, "
                "n.risk_latent = row.risk_latent")
            for i in range(0, len(lrecs), self.batch_size):
                self._run_write(cypher, rows=lrecs[i:i + self.batch_size])

        summary = {"nodes_merged": len(nrecs), "edges_merged": len(erecs),
                   "labels_merged": len(lrecs),
                   "node_labels": {k: len(v) for k, v in by_label.items()},
                   "edge_types": {k: len(v) for k, v in by_type.items()}}
        log.info("push_graph: %s", summary)
        return summary

    # -- reads ------------------------------------------------------------- #
    def fetch_graph(self):
        """Pull the full graph back as (nodes_df, edges_df, labels_df)."""
        node_rows = self._run(
            "MATCH (n) WHERE n.node_id IS NOT NULL "
            "RETURN n.node_id AS node_id, n.ref_id AS ref_id, "
            "n.node_type AS node_type, n.features AS features, "
            "labels(n) AS labels, n.org_id AS org_id, "
            "n.high_risk AS high_risk, n.risk_latent AS risk_latent "
            "ORDER BY n.node_id")
        edge_rows = self._run(
            "MATCH (a)-[r]->(b) "
            "WHERE a.node_id IS NOT NULL AND b.node_id IS NOT NULL "
            "RETURN a.node_id AS src, b.node_id AS dst, "
            "type(r) AS edge_type")
        return _records_to_frames(node_rows, edge_rows)

    def neighbors(self, node_id: int, edge_type: Optional[str] = None,
                  limit: int = 100) -> list[dict]:
        if edge_type is not None:
            edge_type = edge_type.upper()
            if edge_type not in EDGE_TYPES:
                raise ValueError(
                    f"Unknown edge_type {edge_type!r}; allowed: {EDGE_TYPES}")
            cypher = (
                f"MATCH (n {{node_id: $id}})-[r:{edge_type}]-(m) "
                "RETURN m.node_id AS node_id, m.ref_id AS ref_id, "
                "m.node_type AS node_type, type(r) AS rel LIMIT $limit")
        else:
            cypher = (
                "MATCH (n {node_id: $id})-[r]-(m) "
                "RETURN m.node_id AS node_id, m.ref_id AS ref_id, "
                "m.node_type AS node_type, type(r) AS rel LIMIT $limit")
        return self._run(cypher, id=int(node_id), limit=int(limit))

    def shortest_path(self, a: int, b: int, max_depth: int = 15) -> dict:
        rows = self._run(
            f"MATCH p = shortestPath((a {{node_id: $a}})"
            f"-[*..{int(max_depth)}]-(b {{node_id: $b}})) "
            "RETURN [n IN nodes(p) | n.node_id] AS path, length(p) AS hops",
            a=int(a), b=int(b))
        if not rows:
            return {"found": False, "path": [], "hops": None}
        return {"found": True, "path": rows[0]["path"],
                "hops": rows[0]["hops"]}

    # -- analytics --------------------------------------------------------- #
    def _edge_pairs(self) -> list[tuple[int, int]]:
        rows = self._run(
            "MATCH (a)-[r]->(b) "
            "WHERE a.node_id IS NOT NULL AND b.node_id IS NOT NULL "
            "RETURN a.node_id AS src, b.node_id AS dst")
        return [(int(r["src"]), int(r["dst"])) for r in rows]

    def detect_communities(self, max_iter: int = 100) -> dict:
        """Community detection: GDS label propagation when the plugin is
        installed, otherwise deterministic pure-Python label propagation
        over the fetched edge list (neo4j-community has no GDS)."""
        try:
            rows = self._run(
                "CALL gds.labelPropagation.stream({"
                "  nodeQuery: 'MATCH (n) WHERE n.node_id IS NOT NULL "
                "RETURN id(n) AS id',"
                "  relationshipQuery: 'MATCH (a)-[r]->(b) WHERE "
                "a.node_id IS NOT NULL AND b.node_id IS NOT NULL "
                "RETURN id(a) AS source, id(b) AS target'}) "
                "YIELD nodeId, communityId "
                "RETURN gds.util.asNode(nodeId).node_id AS node_id, "
                "communityId AS community")
            if rows:
                assignment = {int(r["node_id"]): int(r["community"])
                              for r in rows}
                return {"algorithm": "gds.labelPropagation",
                        "n_communities": len(set(assignment.values())),
                        "communities": assignment}
        except Neo4jStoreError as exc:
            log.info("GDS unavailable (%s) — using python label propagation",
                     exc)
        pairs = self._edge_pairs()
        n = (max((max(s, d) for s, d in pairs), default=-1) + 1)
        assignment = label_propagation(n, pairs, max_iter=max_iter)
        return {"algorithm": "python.label_propagation",
                "n_communities": len(set(assignment.values())),
                "communities": assignment}

    def collusion_rings(self, min_size: int = 3,
                        min_weight: float = 2.0) -> dict:
        """Tightly connected org clusters sharing officer / enforcement
        patterns. Cypher pulls the pair signals; python post-processes."""
        officer_pairs = self._run(
            "MATCH (a:Organization)-[:EMPLOYS]->(oa:Officer)"
            "-[:SECTOR_PEER]-(ob:Officer)<-[:EMPLOYS]-(b:Organization) "
            "WHERE a.node_id < b.node_id "
            "RETURN a.node_id AS a, b.node_id AS b, "
            "count(DISTINCT oa) AS officer_links")
        direct_pairs = self._run(
            "MATCH (a:Organization)-[r:TRANSACTS_WITH|:SECTOR_PEER]-"
            "(b:Organization) "
            "WHERE a.node_id < b.node_id "
            "RETURN a.node_id AS a, b.node_id AS b, count(r) AS direct_links")
        enforced = self._run(
            "MATCH (:EnforcementAction)-[:ENFORCED_BY]->(o:Organization) "
            "RETURN DISTINCT o.node_id AS node_id")

        pairs: dict[tuple[int, int], dict] = {}

        def _row(a, b):
            key = (min(a, b), max(a, b))
            return pairs.setdefault(
                key, {"a": key[0], "b": key[1],
                      "officer_links": 0, "direct_links": 0})

        for r in officer_pairs:
            _row(int(r["a"]), int(r["b"]))["officer_links"] += \
                int(r["officer_links"])
        for r in direct_pairs:
            _row(int(r["a"]), int(r["b"]))["direct_links"] += \
                int(r["direct_links"])

        rings = find_collusion_rings(
            pairs.values(), min_size=min_size, min_weight=min_weight,
            enforced_orgs={int(r["node_id"]) for r in enforced})
        return {"algorithm": "weighted_components",
                "n_rings": len(rings), "rings": rings}


# --------------------------------------------------------------------------- #
# Module-level convenience wrappers (short-lived connections from env config)
# --------------------------------------------------------------------------- #
def push_graph(nodes: Any, edges: Any, labels: Any = None, **conn) -> dict:
    with Neo4jGraphStore(**conn) as store:
        return store.push_graph(nodes, edges, labels=labels)


def fetch_graph(**conn):
    with Neo4jGraphStore(**conn) as store:
        return store.fetch_graph()


def neighbors(node_id: int, **conn) -> list[dict]:
    with Neo4jGraphStore(**conn) as store:
        return store.neighbors(node_id)


def shortest_path(a: int, b: int, **conn) -> dict:
    with Neo4jGraphStore(**conn) as store:
        return store.shortest_path(a, b)


def detect_communities(**conn) -> dict:
    with Neo4jGraphStore(**conn) as store:
        return store.detect_communities()


def collusion_rings(min_size: int = 3, **conn) -> dict:
    with Neo4jGraphStore(**conn) as store:
        return store.collusion_rings(min_size=min_size)
