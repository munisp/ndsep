#!/usr/bin/env python3
"""
NDSEP Neo4j Graph Service — compliance graph API over Neo4j
============================================================
FastAPI worker exposing the NDSEP compliance knowledge graph stored in
Neo4j (see ml/graph/neo4j_store.py):

  GET  /health                service + backend status
  POST /graph/push            MERGE nodes/edges/labels into Neo4j
  GET  /graph/fetch           full graph in the GNN training-frame shape
  GET  /graph/neighbors       1-hop neighbourhood of a node
  GET  /graph/path            shortest path between two nodes
  GET  /graph/communities     community detection (GDS or python fallback)
  GET  /graph/rings           collusion-ring detection

Fallback chain: when Neo4j is unreachable the service rebuilds the graph
from PostgreSQL (DATABASE_URL / WORKER_DATABASE_URL: organizations,
compliance_violations, enforcement_actions) into memory and serves the
read endpoints from it. Every response carries
  source: "neo4j" | "postgres" | "unavailable"
so callers can tell exactly which backend answered.

Config (env):
  NEO4J_SERVICE_PORT   listen port            (default 8220)
  NEO4J_URI            bolt URI               (default bolt://localhost:7687)
  NEO4J_USER           Neo4j user             (default neo4j)
  NEO4J_PASSWORD       Neo4j password         (default ndsep-neo4j-dev)
  DATABASE_URL / WORKER_DATABASE_URL          Postgres fallback DSN

Technology: Python · FastAPI · neo4j driver · psycopg2
Port: 8220
"""
import os
import sys
import time
import logging
from collections import deque
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [NDSEP-NEO4J] %(levelname)s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

# repo root on path so `ml.graph` is importable when run from workers/python
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))

try:
    from ml.graph import neo4j_store
    from ml.graph.neo4j_store import (Neo4jGraphStore, Neo4jStoreError,
                                      find_collusion_rings,
                                      label_propagation)
    HAS_NEO4J = neo4j_store.HAS_NEO4J
except Exception as _e:  # pragma: no cover - environment dependent
    log.warning("ml.graph.neo4j_store unavailable: %s", _e)
    Neo4jGraphStore = None
    Neo4jStoreError = RuntimeError
    HAS_NEO4J = False

try:
    import psycopg2
    import psycopg2.extras
    HAS_PG = True
except ImportError:
    HAS_PG = False

DB_URL = os.environ.get(
    "DATABASE_URL",
    os.environ.get("WORKER_DATABASE_URL",
                   "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"))
PORT = int(os.environ.get("NEO4J_SERVICE_PORT", "8220"))

app = FastAPI(title="NDSEP Neo4j Graph Service", version="1.0.0")
STARTED_AT = time.time()


class PushRequest(BaseModel):
    nodes: list[dict]
    edges: list[dict]
    labels: Optional[list[dict]] = None


# --------------------------------------------------------------------------- #
# Neo4j backend
# --------------------------------------------------------------------------- #
def _neo4j_store() -> Optional["Neo4jGraphStore"]:
    """Return a connected store, or None if the driver/server is missing."""
    if not HAS_NEO4J or Neo4jGraphStore is None:
        return None
    try:
        return Neo4jGraphStore().connect()
    except Exception as exc:
        log.warning("Neo4j unavailable (%s) — falling back to Postgres", exc)
        return None


# --------------------------------------------------------------------------- #
# Postgres fallback: in-memory graph built from relational tables
# --------------------------------------------------------------------------- #
class PgGraph:
    """Minimal in-memory graph (string node ids) for fallback reads."""

    def __init__(self):
        self.nodes: dict[str, dict] = {}
        self.adj: dict[str, list[tuple[str, str]]] = {}

    def add_node(self, nid: str, ntype: str, props: dict):
        self.nodes[nid] = {"node_type": ntype, **props}
        self.adj.setdefault(nid, [])

    def add_edge(self, src: str, dst: str, rel: str):
        if src in self.nodes and dst in self.nodes:
            self.adj[src].append((dst, rel))
            self.adj[dst].append((src, rel))


def _load_postgres_graph() -> Optional[PgGraph]:
    if not HAS_PG:
        return None
    g = PgGraph()
    try:
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id::text, name, sector FROM organizations "
                    "LIMIT 10000")
        for row in cur.fetchall():
            g.add_node(f"org:{row['id']}", "Organization",
                       {"name": row.get("name"),
                        "sector": row.get("sector")})
        cur.execute("SELECT id::text, organization_id::text, severity "
                    "FROM compliance_violations LIMIT 10000")
        for row in cur.fetchall():
            vid = f"violation:{row['id']}"
            g.add_node(vid, "Violation", {"severity": row.get("severity")})
            g.add_edge(f"org:{row['organization_id']}", vid, "HAS_VIOLATION")
        cur.execute("SELECT id::text, organization_id::text, action_type "
                    "FROM enforcement_actions LIMIT 10000")
        enf_orgs = set()
        for row in cur.fetchall():
            eid = f"enforcement:{row['id']}"
            g.add_node(eid, "EnforcementAction",
                       {"action_type": row.get("action_type")})
            g.add_edge(eid, f"org:{row['organization_id']}", "ENFORCED_BY")
            enf_orgs.add(f"org:{row['organization_id']}")
        cur.close()
        conn.close()
        # sector peers (same-sector orgs, bounded fan-out)
        by_sector: dict[str, list[str]] = {}
        for nid, n in g.nodes.items():
            if n["node_type"] == "Organization":
                by_sector.setdefault(n.get("sector") or "?", []).append(nid)
        for orgs in by_sector.values():
            for i, a in enumerate(orgs):
                for b in orgs[i + 1:i + 4]:
                    g.add_edge(a, b, "SECTOR_PEER")
        g.enforced_orgs = enf_orgs
        log.info("Postgres fallback graph: %d nodes", len(g.nodes))
        return g
    except Exception as exc:
        log.error("Postgres fallback graph build failed: %s", exc)
        return None


def _pg_neighbors(g: PgGraph, node_id: str, limit: int) -> list[dict]:
    if node_id not in g.nodes:
        raise KeyError(node_id)
    return [{"node_id": nid, "node_type": g.nodes[nid]["node_type"],
             "rel": rel} for nid, rel in g.adj[node_id][:limit]]


def _pg_path(g: PgGraph, a: str, b: str) -> dict:
    if a not in g.nodes or b not in g.nodes:
        return {"found": False, "path": [], "hops": None}
    prev, queue = {a: None}, deque([a])
    while queue:
        v = queue.popleft()
        if v == b:
            break
        for u, _ in g.adj[v]:
            if u not in prev:
                prev[u] = v
                queue.append(u)
    if b not in prev:
        return {"found": False, "path": [], "hops": None}
    path = [b]
    while prev[path[-1]] is not None:
        path.append(prev[path[-1]])
    path.reverse()
    return {"found": True, "path": path, "hops": len(path) - 1}


def _pg_int_projection(g: PgGraph):
    """Map string ids -> contiguous ints for the pure-python analytics."""
    ids = sorted(g.nodes)
    idx = {nid: i for i, nid in enumerate(ids)}
    edges = [(idx[a], idx[b]) for a, outs in g.adj.items() for b, _ in outs]
    return ids, idx, edges


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@app.get("/health")
def health():
    store = _neo4j_store()
    neo4j_ok = store is not None
    if store is not None:
        store.close()
    source = "neo4j" if neo4j_ok else ("postgres" if HAS_PG else "unavailable")
    return {"status": "healthy" if neo4j_ok else "degraded",
            "worker": "neo4j-graph-service", "source": source,
            "neo4j": {"driver": HAS_NEO4J, "reachable": neo4j_ok},
            "postgres": {"driver": HAS_PG},
            "uptime_sec": int(time.time() - STARTED_AT)}


@app.post("/graph/push")
def graph_push(req: PushRequest):
    store = _neo4j_store()
    if store is None:
        raise HTTPException(
            503, {"source": "unavailable",
                  "detail": "Neo4j unreachable — push requires the graph "
                            "store (reads can fall back to Postgres)"})
    try:
        summary = store.push_graph(req.nodes, req.edges, labels=req.labels)
        return {"source": "neo4j", **summary}
    except (Neo4jStoreError, ValueError) as exc:
        raise HTTPException(400, {"source": "neo4j", "detail": str(exc)})
    finally:
        store.close()


@app.get("/graph/fetch")
def graph_fetch():
    store = _neo4j_store()
    if store is not None:
        try:
            nodes, edges, labels = store.fetch_graph()
            return {"source": "neo4j",
                    "nodes": nodes.to_dict("records"),
                    "edges": edges.to_dict("records"),
                    "labels": labels.to_dict("records")}
        finally:
            store.close()
    g = _load_postgres_graph()
    if g is None:
        raise HTTPException(503, {"source": "unavailable",
                                  "detail": "Neo4j and Postgres both "
                                            "unreachable"})
    edges = [{"src": a, "dst": b, "edge_type": rel}
             for a, outs in g.adj.items() for b, rel in outs
             if str(a) < str(b)]
    return {"source": "postgres",
            "nodes": [{"node_id": nid, **n} for nid, n in g.nodes.items()],
            "edges": edges, "labels": []}


def _resolve_node_id(store, node_id: str) -> Any:
    """Neo4j nodes key on int node_id; accept int-like strings."""
    try:
        return int(node_id)
    except (TypeError, ValueError):
        raise HTTPException(
            400, {"detail": f"Neo4j node ids are integers; got {node_id!r} "
                            "(in Postgres fallback mode use ids like "
                            "'org:<id>')"})


@app.get("/graph/neighbors")
def graph_neighbors(node_id: str, edge_type: Optional[str] = None,
                    limit: int = 100):
    store = _neo4j_store()
    if store is not None:
        try:
            return {"source": "neo4j", "node_id": node_id,
                    "neighbors": store.neighbors(_resolve_node_id(store,
                                                                  node_id),
                                                 edge_type=edge_type,
                                                 limit=limit)}
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        finally:
            store.close()
    g = _load_postgres_graph()
    if g is None:
        raise HTTPException(503, {"source": "unavailable",
                                  "detail": "Neo4j and Postgres both "
                                            "unreachable"})
    try:
        return {"source": "postgres", "node_id": node_id,
                "neighbors": _pg_neighbors(g, node_id, limit)}
    except KeyError:
        raise HTTPException(404, {"source": "postgres",
                                  "detail": f"node {node_id!r} not found"})


@app.get("/graph/path")
def graph_path(a: str, b: str, max_depth: int = 15):
    store = _neo4j_store()
    if store is not None:
        try:
            return {"source": "neo4j",
                    **store.shortest_path(_resolve_node_id(store, a),
                                          _resolve_node_id(store, b),
                                          max_depth=max_depth)}
        finally:
            store.close()
    g = _load_postgres_graph()
    if g is None:
        raise HTTPException(503, {"source": "unavailable",
                                  "detail": "Neo4j and Postgres both "
                                            "unreachable"})
    return {"source": "postgres", **_pg_path(g, a, b)}


@app.get("/graph/communities")
def graph_communities():
    store = _neo4j_store()
    if store is not None:
        try:
            return {"source": "neo4j", **store.detect_communities()}
        finally:
            store.close()
    g = _load_postgres_graph()
    if g is None:
        raise HTTPException(503, {"source": "unavailable",
                                  "detail": "Neo4j and Postgres both "
                                            "unreachable"})
    ids, _idx, edges = _pg_int_projection(g)
    assignment = label_propagation(len(ids), edges)
    return {"source": "postgres", "algorithm": "python.label_propagation",
            "n_communities": len(set(assignment.values())),
            "communities": {ids[i]: c for i, c in assignment.items()}}


@app.get("/graph/rings")
def graph_rings(min_size: int = 3, min_weight: float = 2.0):
    store = _neo4j_store()
    if store is not None:
        try:
            return {"source": "neo4j",
                    **store.collusion_rings(min_size=min_size,
                                            min_weight=min_weight)}
        finally:
            store.close()
    g = _load_postgres_graph()
    if g is None:
        raise HTTPException(503, {"source": "unavailable",
                                  "detail": "Neo4j and Postgres both "
                                            "unreachable"})
    ids, idx, _edges = _pg_int_projection(g)
    pairs: dict[tuple, dict] = {}
    for a, outs in g.adj.items():
        if g.nodes[a]["node_type"] != "Organization":
            continue
        for b, rel in outs:
            if g.nodes[b]["node_type"] != "Organization" or a >= b:
                continue
            key = (idx[a], idx[b])
            row = pairs.setdefault(key, {"a": key[0], "b": key[1],
                                         "officer_links": 0,
                                         "direct_links": 0})
            row["direct_links"] += 1
    enforced = {idx[o] for o in getattr(g, "enforced_orgs", set())
                if o in idx}
    rings = find_collusion_rings(pairs.values(), min_size=min_size,
                                 min_weight=min_weight,
                                 enforced_orgs=enforced)
    for r in rings:
        r["members"] = [ids[i] for i in r["members"]]
    return {"source": "postgres", "algorithm": "weighted_components",
            "n_rings": len(rings), "rings": rings}


if __name__ == "__main__":
    import uvicorn
    log.info("Starting Neo4j graph service on port %d", PORT)
    uvicorn.run(app, host="0.0.0.0", port=PORT)
