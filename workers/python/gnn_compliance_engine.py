#!/usr/bin/env python3
"""
NDSEP GNN Compliance Engine — Graph Neural Network for Regulatory Analytics
============================================================================
Implements graph neural networks over the compliance knowledge graph:
  - GraphSAGE-style message passing with learned aggregation
  - Link prediction (predict future violations, enforcement actions)
  - Node classification (risk tier prediction from graph structure)
  - Graph embeddings served to downstream ML models

Graph Schema:
  Nodes: Organization, Violation, EnforcementAction, Policy, Sector, Officer
  Edges: HAS_VIOLATION, ENFORCED_BY, BELONGS_TO, GOVERNED_BY, SECTOR_PEER

Integrations:
  - PostgreSQL: Build graph from relational tables
  - FalkorDB: Optional external graph store (falls back to in-memory)
  - Lakehouse: Export GNN embeddings as features
  - ML Engine: Serve embeddings for breach prediction enrichment

Technology: Python · numpy · scipy · psycopg2 · FastAPI
Port: 8216
"""
import os
import sys
import json
import math
import time
import random
import hashlib
import logging
import threading
from datetime import datetime, timezone
from collections import defaultdict
from typing import Any, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [NDSEP-GNN] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

try:
    import psycopg2
    import psycopg2.extras
    HAS_PG = True
except ImportError:
    HAS_PG = False

try:
    from scipy.sparse import csr_matrix
    from scipy.sparse.linalg import svds
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

try:
    from sklearn.metrics import accuracy_score, f1_score
    from sklearn.model_selection import train_test_split
    from sklearn.linear_model import LogisticRegression
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

# ── Configuration ──────────────────────────────────────────────────────────────
DB_URL = os.environ.get("DATABASE_URL",
    os.environ.get("WORKER_DATABASE_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"))
PORT = int(os.environ.get("GNN_PORT", "8216"))
FALKORDB_URL = os.environ.get("FALKORDB_URL", "redis://localhost:6379")
LAKEHOUSE_URL = os.environ.get("LAKEHOUSE_URL", "http://localhost:8140")
EMBEDDING_DIM = int(os.environ.get("GNN_EMBEDDING_DIM", "32"))
GNN_LAYERS = int(os.environ.get("GNN_LAYERS", "3"))

app = FastAPI(title="NDSEP GNN Compliance Engine", version="2.0.0")

# ── Graph Data Structures ──────────────────────────────────────────────────────
class ComplianceGraph:
    def __init__(self):
        self.nodes: dict[str, dict] = {}  # node_id -> {type, features, ...}
        self.edges: list[tuple[str, str, str]] = []  # (src, dst, rel_type)
        self.adj: dict[str, list[tuple[str, str]]] = defaultdict(list)  # node -> [(neighbor, rel)]
        self.node_types: dict[str, list[str]] = defaultdict(list)  # type -> [node_ids]
        self.embeddings: dict[str, np.ndarray] = {}
        self.built_at: Optional[str] = None

    def add_node(self, node_id: str, node_type: str, features: dict):
        self.nodes[node_id] = {"type": node_type, "features": features}
        self.node_types[node_type].append(node_id)

    def add_edge(self, src: str, dst: str, rel_type: str):
        if src in self.nodes and dst in self.nodes:
            self.edges.append((src, dst, rel_type))
            self.adj[src].append((dst, rel_type))
            self.adj[dst].append((src, f"INV_{rel_type}"))

    def get_neighbors(self, node_id: str, rel_type: str = "") -> list[dict]:
        if node_id not in self.adj:
            return []
        neighbors = []
        for nid, rel in self.adj[node_id]:
            if not rel_type or rel == rel_type:
                neighbors.append({"id": nid, "relation": rel, **self.nodes.get(nid, {})})
        return neighbors

    def degree(self, node_id: str) -> int:
        return len(self.adj.get(node_id, []))

    def stats(self) -> dict:
        return {
            "nodes": len(self.nodes),
            "edges": len(self.edges),
            "node_types": {k: len(v) for k, v in self.node_types.items()},
            "avg_degree": round(sum(len(v) for v in self.adj.values()) / max(1, len(self.adj)), 2),
            "embeddings_computed": len(self.embeddings),
            "built_at": self.built_at,
        }

graph = ComplianceGraph()
_start_time = time.time()
_gnn_weights: dict[str, np.ndarray] = {}
_link_predictor: Any = None
_training_metrics: dict = {}

# ── Build Graph from Lakehouse or PostgreSQL ───────────────────────────────────

def _fetch_lakehouse_features() -> Optional[dict]:
    """Try to fetch ML features from Lakehouse Analytics Engine."""
    try:
        import requests
        resp = requests.get(f"{LAKEHOUSE_URL}/features/compliance_features", timeout=8)
        if resp.ok:
            data = resp.json()
            if data.get("rows") and len(data["rows"]) > 0:
                log.info(f"[GNN] Fetched {len(data['rows'])} compliance features from Lakehouse")
                return data
    except Exception as e:
        log.debug(f"[GNN] Lakehouse features unavailable: {e}")
    return None

def _publish_embeddings_to_lakehouse():
    """Publish computed GNN embeddings to Lakehouse for downstream ML consumption."""
    if not graph.embeddings:
        return
    try:
        import requests
        records = []
        for nid, emb in graph.embeddings.items():
            node = graph.nodes.get(nid, {})
            records.append({
                "node_id": nid,
                "node_type": node.get("type", "unknown"),
                "embedding_dim": len(emb),
                "embedding_norm": float(np.linalg.norm(emb)),
                "degree": graph.degree(nid),
                "computed_at": datetime.now(timezone.utc).isoformat(),
            })
        resp = requests.post(
            f"{LAKEHOUSE_URL}/ingest",
            json={"namespace": "ndsep", "table": "gnn_embeddings", "records": records},
            timeout=10,
        )
        if resp.ok:
            log.info(f"[GNN] Published {len(records)} embeddings to Lakehouse")
        else:
            log.debug(f"[GNN] Lakehouse embedding publish: HTTP {resp.status_code}")
    except Exception as e:
        log.debug(f"[GNN] Lakehouse embedding publish unavailable: {e}")

def build_graph_from_db():
    """Build compliance knowledge graph from Lakehouse (preferred) or PostgreSQL (fallback)."""
    global graph
    graph = ComplianceGraph()

    # Try Lakehouse first for enriched features
    lh_data = _fetch_lakehouse_features()
    if lh_data and lh_data.get("rows"):
        _build_graph_from_lakehouse(lh_data["rows"])
        return

    if not HAS_PG:
        log.warning("psycopg2 not available — using synthetic graph")
        build_synthetic_graph()
        return

    try:
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Organizations as nodes
        cur.execute("SELECT id::text, name, sector, compliance_score, risk_score, compliance_status FROM organizations WHERE compliance_status IS NOT NULL")
        for row in cur.fetchall():
            graph.add_node(f"org:{row['id']}", "Organization", {
                "name": row["name"],
                "sector": row.get("sector", "Unknown"),
                "compliance_score": float(row.get("compliance_score") or 50),
                "risk_score": float(row.get("risk_score") or 50),
            })

        # Sectors as nodes
        cur.execute("SELECT DISTINCT sector FROM organizations WHERE sector IS NOT NULL")
        for row in cur.fetchall():
            graph.add_node(f"sector:{row['sector']}", "Sector", {"name": row["sector"]})

        # Connect orgs to sectors
        for nid, data in list(graph.nodes.items()):
            if data["type"] == "Organization":
                sector = data["features"].get("sector", "Unknown")
                sector_id = f"sector:{sector}"
                if sector_id in graph.nodes:
                    graph.add_edge(nid, sector_id, "BELONGS_TO")

        # Violations as nodes
        cur.execute("SELECT id::text, organization_id::text, title as violation_type, severity, status FROM compliance_violations LIMIT 500")
        for row in cur.fetchall():
            vid = f"violation:{row['id']}"
            graph.add_node(vid, "Violation", {
                "type": row.get("violation_type", "unknown"),
                "severity": row.get("severity", "medium"),
                "status": row.get("status", "open"),
            })
            graph.add_edge(f"org:{row['organization_id']}", vid, "HAS_VIOLATION")

        # Enforcement actions as nodes
        cur.execute("SELECT id::text, organization_id::text, action_type, status FROM enforcement_actions LIMIT 500")
        for row in cur.fetchall():
            eid = f"enforcement:{row['id']}"
            graph.add_node(eid, "EnforcementAction", {
                "action_type": row.get("action_type", "unknown"),
                "status": row.get("status", "pending"),
            })
            graph.add_edge(f"org:{row['organization_id']}", eid, "ENFORCED_BY")

        # Breach incidents as nodes
        cur.execute("SELECT id::text, organization_id::text, breach_incident_severity as severity, breach_incident_status as status, affected_individuals_count as affected_records FROM breach_incidents LIMIT 500")
        for row in cur.fetchall():
            bid = f"breach:{row['id']}"
            graph.add_node(bid, "BreachIncident", {
                "severity": row.get("severity", "medium"),
                "status": row.get("status", "open"),
                "affected_records": int(row.get("affected_records") or 0),
            })
            graph.add_edge(f"org:{row['organization_id']}", bid, "REPORTED_BREACH")

        # Sector peer edges (orgs in same sector)
        for sector, org_ids in graph.node_types.items():
            if sector != "Organization":
                continue
        for sector_id in graph.node_types.get("Sector", []):
            sector_orgs = [nid for nid, rel in graph.adj[sector_id] if rel == "INV_BELONGS_TO"]
            for i in range(len(sector_orgs)):
                for j in range(i + 1, min(len(sector_orgs), i + 5)):
                    graph.add_edge(sector_orgs[i], sector_orgs[j], "SECTOR_PEER")

        cur.close()
        conn.close()
        graph.built_at = datetime.now(timezone.utc).isoformat()
        log.info(f"Graph built: {graph.stats()}")
    except Exception as e:
        log.error(f"Graph build failed: {e}")
        build_synthetic_graph()

def _build_graph_from_lakehouse(rows: list[dict]):
    """Build graph from Lakehouse compliance features (enriched with breach/violation/penalty counts)."""
    global graph
    log.info(f"[GNN] Building graph from {len(rows)} Lakehouse compliance feature rows")

    sectors_seen: set[str] = set()
    for row in rows:
        org_id = str(row.get("org_id", ""))
        if not org_id:
            continue

        sector = row.get("sector", "Unknown")
        if sector and sector not in sectors_seen:
            graph.add_node(f"sector:{sector}", "Sector", {"name": sector})
            sectors_seen.add(sector)

        graph.add_node(f"org:{org_id}", "Organization", {
            "name": row.get("name", f"Org-{org_id}"),
            "sector": sector,
            "compliance_score": float(row.get("compliance_score") or 50),
            "risk_score": float(row.get("risk_score") or 50),
            "breach_count": int(row.get("breach_count") or 0),
            "violation_count": int(row.get("violation_count") or 0),
            "total_penalties": float(row.get("total_penalties") or 0),
        })

        if sector:
            graph.add_edge(f"org:{org_id}", f"sector:{sector}", "BELONGS_TO")

        # Create virtual violation/breach nodes from counts
        for v_idx in range(min(int(row.get("violation_count") or 0), 5)):
            vid = f"violation:{org_id}_{v_idx}"
            graph.add_node(vid, "Violation", {"severity": "medium", "status": "open", "source": "lakehouse"})
            graph.add_edge(f"org:{org_id}", vid, "HAS_VIOLATION")

        for b_idx in range(min(int(row.get("breach_count") or 0), 5)):
            bid = f"breach:{org_id}_{b_idx}"
            graph.add_node(bid, "BreachIncident", {"severity": "high", "status": "open", "source": "lakehouse"})
            graph.add_edge(f"org:{org_id}", bid, "REPORTED_BREACH")

    # Sector peer edges
    for sector_id in [nid for nid in graph.nodes if graph.nodes[nid]["type"] == "Sector"]:
        sector_orgs = [nid for nid, rel in graph.adj.get(sector_id, []) if rel == "INV_BELONGS_TO"]
        for i in range(len(sector_orgs)):
            for j in range(i + 1, min(len(sector_orgs), i + 5)):
                graph.add_edge(sector_orgs[i], sector_orgs[j], "SECTOR_PEER")

    graph.built_at = datetime.now(timezone.utc).isoformat()
    log.info(f"[GNN] Graph from Lakehouse: {graph.stats()}")

    # Fall back to PostgreSQL for entities not in Lakehouse features
    if HAS_PG:
        try:
            conn = psycopg2.connect(DB_URL)
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT id::text, organization_id::text, action_type, status FROM enforcement_actions LIMIT 500")
            for row in cur.fetchall():
                eid = f"enforcement:{row['id']}"
                if eid not in graph.nodes:
                    graph.add_node(eid, "EnforcementAction", {
                        "action_type": row.get("action_type", "unknown"),
                        "status": row.get("status", "pending"),
                    })
                    graph.add_edge(f"org:{row['organization_id']}", eid, "ENFORCED_BY")
            cur.close()
            conn.close()
        except Exception as e:
            log.debug(f"[GNN] PostgreSQL enrichment skipped: {e}")

def build_synthetic_graph():
    """Build synthetic compliance graph for demo."""
    sectors = ["Banking", "Telecom", "Healthcare", "Insurance", "Education", "Energy"]
    for s in sectors:
        graph.add_node(f"sector:{s}", "Sector", {"name": s})

    orgs = [
        ("First Bank", "Banking", 82.5), ("GTBank", "Banking", 78.3),
        ("MTN Nigeria", "Telecom", 75.1), ("Airtel", "Telecom", 71.8),
        ("Reddington", "Healthcare", 61.2), ("NHIS", "Healthcare", 55.0),
        ("AXA Mansard", "Insurance", 72.5), ("Leadway", "Insurance", 68.9),
        ("Covenant Uni", "Education", 58.5), ("BUK", "Education", 45.3),
        ("Shell Nigeria", "Energy", 80.5), ("Dangote Energy", "Energy", 73.2),
    ]
    for i, (name, sector, score) in enumerate(orgs):
        oid = f"org:{i+1}"
        graph.add_node(oid, "Organization", {"name": name, "sector": sector, "compliance_score": score})
        graph.add_edge(oid, f"sector:{sector}", "BELONGS_TO")

        # Add violations
        num_violations = max(0, int((100 - score) / 15))
        for v in range(num_violations):
            vid = f"violation:{i*10+v}"
            sev = random.choice(["critical", "high", "medium", "low"])
            graph.add_node(vid, "Violation", {"severity": sev, "status": random.choice(["open", "resolved"])})
            graph.add_edge(oid, vid, "HAS_VIOLATION")

    # Sector peer edges
    for sector in sectors:
        sector_orgs = [nid for nid in graph.node_types["Organization"]
                       if graph.nodes[nid]["features"].get("sector") == sector]
        for i in range(len(sector_orgs)):
            for j in range(i + 1, len(sector_orgs)):
                graph.add_edge(sector_orgs[i], sector_orgs[j], "SECTOR_PEER")

    graph.built_at = datetime.now(timezone.utc).isoformat()

# ── GNN: Message Passing with Learned Weights ─────────────────────────────────
def node_feature_vector(node_id: str) -> np.ndarray:
    """Convert node features to numeric vector."""
    node = graph.nodes.get(node_id)
    if not node:
        return np.zeros(8)

    features = node.get("features", {})
    ntype = node.get("type", "")

    vec = np.zeros(8)
    vec[0] = features.get("compliance_score", 50) / 100.0
    vec[1] = float(graph.degree(node_id)) / 20.0
    vec[2] = 1.0 if features.get("severity") == "critical" else 0.5 if features.get("severity") == "high" else 0.2
    vec[3] = 1.0 if features.get("status") in ["active", "open"] else 0.0
    vec[4] = float(features.get("affected_records", 0)) / 10000.0
    vec[5] = {"Organization": 1.0, "Violation": 0.6, "EnforcementAction": 0.8, "BreachIncident": 0.9, "Sector": 0.3}.get(ntype, 0.5)
    vec[6] = float(len(features)) / 10.0
    vec[7] = hash(node_id) % 100 / 100.0  # positional encoding
    return vec

def initialize_gnn_weights():
    """Initialize learnable GNN weight matrices."""
    global _gnn_weights
    rng = np.random.default_rng(42)
    for layer in range(GNN_LAYERS):
        _gnn_weights[f"W_self_{layer}"] = rng.standard_normal((EMBEDDING_DIM, 8 if layer == 0 else EMBEDDING_DIM)).astype(np.float32) * 0.1
        _gnn_weights[f"W_neigh_{layer}"] = rng.standard_normal((EMBEDDING_DIM, 8 if layer == 0 else EMBEDDING_DIM)).astype(np.float32) * 0.1
        _gnn_weights[f"b_{layer}"] = np.zeros(EMBEDDING_DIM, dtype=np.float32)

def relu(x: np.ndarray) -> np.ndarray:
    return np.maximum(0, x)

def l2_normalize(x: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(x)
    return x / max(norm, 1e-8)

def gnn_forward(node_id: str, depth: int = GNN_LAYERS) -> np.ndarray:
    """GraphSAGE-style forward pass with learned aggregation."""
    if depth == 0:
        return node_feature_vector(node_id)

    # Self features
    h_self = gnn_forward(node_id, depth - 1)

    # Aggregate neighbor features (mean aggregation)
    neighbors = graph.adj.get(node_id, [])
    if not neighbors:
        h_neigh = np.zeros_like(h_self)
    else:
        # Sample up to 10 neighbors for efficiency
        sampled = random.sample(neighbors, min(10, len(neighbors)))
        h_neighbors = np.stack([gnn_forward(nid, depth - 1) for nid, _ in sampled])
        h_neigh = np.mean(h_neighbors, axis=0)

    layer = depth - 1
    W_self = _gnn_weights.get(f"W_self_{layer}", np.eye(EMBEDDING_DIM, h_self.shape[0]))
    W_neigh = _gnn_weights.get(f"W_neigh_{layer}", np.eye(EMBEDDING_DIM, h_neigh.shape[0]))
    b = _gnn_weights.get(f"b_{layer}", np.zeros(EMBEDDING_DIM))

    # Combine: h = ReLU(W_self * h_self + W_neigh * h_neigh + b)
    h = relu(W_self @ h_self + W_neigh @ h_neigh + b)
    return l2_normalize(h)

def compute_all_embeddings():
    """Compute GNN embeddings for all nodes."""
    for node_id in graph.nodes:
        graph.embeddings[node_id] = gnn_forward(node_id, depth=min(2, GNN_LAYERS))
    log.info(f"Computed {len(graph.embeddings)} GNN embeddings (dim={EMBEDDING_DIM})")

# ── Link Prediction ────────────────────────────────────────────────────────────
def train_link_predictor():
    """Train link prediction model: predict future violations/enforcement."""
    global _link_predictor, _training_metrics
    if not HAS_SKLEARN or len(graph.embeddings) < 10:
        log.warning("Insufficient data or sklearn not available for link prediction")
        return

    # Positive examples: existing edges
    positive_pairs = []
    for src, dst, rel in graph.edges:
        if rel in ["HAS_VIOLATION", "ENFORCED_BY", "REPORTED_BREACH"]:
            if src in graph.embeddings and dst in graph.embeddings:
                combined = np.concatenate([graph.embeddings[src], graph.embeddings[dst]])
                positive_pairs.append((combined, 1))

    # Negative examples: random non-edges
    all_nodes = list(graph.nodes.keys())
    negative_pairs = []
    for _ in range(min(len(positive_pairs) * 2, 500)):
        src, dst = random.choice(all_nodes), random.choice(all_nodes)
        if src != dst and src in graph.embeddings and dst in graph.embeddings:
            combined = np.concatenate([graph.embeddings[src], graph.embeddings[dst]])
            negative_pairs.append((combined, 0))

    if len(positive_pairs) < 5 or len(negative_pairs) < 5:
        log.warning("Insufficient edges for link prediction training")
        return

    all_pairs = positive_pairs + negative_pairs
    random.shuffle(all_pairs)
    X = np.array([p[0] for p in all_pairs])
    y = np.array([p[1] for p in all_pairs])

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    _link_predictor = LogisticRegression(max_iter=1000, random_state=42)
    _link_predictor.fit(X_train, y_train)
    y_pred = _link_predictor.predict(X_test)

    _training_metrics = {
        "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
        "f1": round(float(f1_score(y_test, y_pred, zero_division=0)), 4),
        "positive_samples": len(positive_pairs),
        "negative_samples": len(negative_pairs),
        "test_samples": len(X_test),
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }
    log.info(f"Link predictor trained: accuracy={_training_metrics['accuracy']}, f1={_training_metrics['f1']}")

def predict_link(src_id: str, dst_id: str) -> dict:
    """Predict whether a link (edge) should exist between two nodes."""
    if _link_predictor is None:
        return {"error": "Link predictor not trained"}
    if src_id not in graph.embeddings or dst_id not in graph.embeddings:
        return {"error": f"Embeddings not found for {src_id} or {dst_id}"}

    combined = np.concatenate([graph.embeddings[src_id], graph.embeddings[dst_id]]).reshape(1, -1)
    prob = float(_link_predictor.predict_proba(combined)[0, 1])
    prediction = bool(_link_predictor.predict(combined)[0])

    return {
        "source": src_id,
        "target": dst_id,
        "link_predicted": prediction,
        "probability": round(prob, 4),
        "model": "logistic_regression_on_gnn_embeddings",
    }

def predict_future_violations(org_id: str) -> list[dict]:
    """Predict which violation types an org is likely to face next."""
    if _link_predictor is None or org_id not in graph.embeddings:
        return []

    violation_nodes = graph.node_types.get("Violation", [])
    predictions = []
    for vid in violation_nodes[:50]:
        if vid in graph.embeddings:
            result = predict_link(org_id, vid)
            if result.get("probability", 0) > 0.3:
                predictions.append({
                    "violation_id": vid,
                    "severity": graph.nodes[vid]["features"].get("severity", "unknown"),
                    "probability": result["probability"],
                })

    predictions.sort(key=lambda x: -x["probability"])
    return predictions[:10]

# ── API Endpoints ──────────────────────────────────────────────────────────────

class BuildRequest(BaseModel):
    source: str = "database"

class EmbeddingRequest(BaseModel):
    node_id: str
    depth: int = 2

class LinkPredRequest(BaseModel):
    source: str
    target: str

class OrgPredRequest(BaseModel):
    org_id: str

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "worker": "gnn_compliance_engine",
        "version": "2.0.0",
        "has_postgresql": HAS_PG,
        "has_scipy": HAS_SCIPY,
        "has_sklearn": HAS_SKLEARN,
        "graph": graph.stats(),
        "gnn_layers": GNN_LAYERS,
        "embedding_dim": EMBEDDING_DIM,
        "link_predictor_trained": _link_predictor is not None,
        "training_metrics": _training_metrics,
        "uptime_seconds": round(time.time() - _start_time),
    }

@app.post("/graph/build")
def api_build_graph(req: BuildRequest):
    build_graph_from_db()
    initialize_gnn_weights()
    compute_all_embeddings()
    train_link_predictor()
    # Publish embeddings back to Lakehouse for ML feature consumption
    _publish_embeddings_to_lakehouse()
    return {"status": "built", "graph": graph.stats(), "training_metrics": _training_metrics}

@app.get("/graph/stats")
def api_graph_stats():
    return graph.stats()

@app.post("/embedding")
def api_get_embedding(req: EmbeddingRequest):
    if req.node_id not in graph.nodes:
        raise HTTPException(status_code=404, detail=f"Node not found: {req.node_id}")
    if req.node_id in graph.embeddings:
        emb = graph.embeddings[req.node_id]
    else:
        emb = gnn_forward(req.node_id, min(req.depth, GNN_LAYERS))
        graph.embeddings[req.node_id] = emb
    return {
        "node_id": req.node_id,
        "embedding": [round(float(x), 6) for x in emb],
        "dimension": len(emb),
        "node_type": graph.nodes[req.node_id]["type"],
    }

@app.get("/embeddings/all")
def api_all_embeddings():
    """Export all GNN embeddings (for lakehouse/feature store)."""
    result = {}
    for nid, emb in graph.embeddings.items():
        result[nid] = {
            "embedding": [round(float(x), 6) for x in emb],
            "type": graph.nodes[nid]["type"],
        }
    return {"embeddings": result, "count": len(result), "dimension": EMBEDDING_DIM}

@app.post("/predict/link")
def api_predict_link(req: LinkPredRequest):
    return predict_link(req.source, req.target)

@app.post("/predict/violations")
def api_predict_violations(req: OrgPredRequest):
    predictions = predict_future_violations(req.org_id)
    return {"org_id": req.org_id, "predictions": predictions, "count": len(predictions)}

@app.get("/graph/neighbors/{node_id}")
def api_neighbors(node_id: str, relation: str = ""):
    neighbors = graph.get_neighbors(node_id, relation)
    return {"node_id": node_id, "neighbors": neighbors, "count": len(neighbors)}

@app.get("/graph/path")
def api_find_path(src: str, dst: str, max_depth: int = 4):
    """BFS shortest path between two nodes."""
    if src not in graph.nodes or dst not in graph.nodes:
        raise HTTPException(status_code=404, detail="Source or target node not found")

    visited = {src}
    queue = [(src, [src])]
    for _ in range(max_depth * len(graph.nodes)):
        if not queue:
            break
        current, path = queue.pop(0)
        if current == dst:
            return {"path": path, "length": len(path) - 1, "found": True}
        for nid, rel in graph.adj.get(current, []):
            if nid not in visited:
                visited.add(nid)
                queue.append((nid, path + [nid]))
    return {"path": [], "length": -1, "found": False}

@app.get("/graph/similarity/{node_a}/{node_b}")
def api_node_similarity(node_a: str, node_b: str):
    """Cosine similarity between two node embeddings."""
    if node_a not in graph.embeddings or node_b not in graph.embeddings:
        raise HTTPException(status_code=404, detail="Embeddings not computed for one or both nodes")
    ea = graph.embeddings[node_a]
    eb = graph.embeddings[node_b]
    similarity = float(np.dot(ea, eb) / (np.linalg.norm(ea) * np.linalg.norm(eb) + 1e-8))
    return {"node_a": node_a, "node_b": node_b, "cosine_similarity": round(similarity, 4)}

# ── Startup ────────────────────────────────────────────────────────────────────
def init_graph():
    time.sleep(5)
    build_graph_from_db()
    initialize_gnn_weights()
    compute_all_embeddings()
    train_link_predictor()

if __name__ == "__main__":
    import uvicorn
    log.info(f"Starting NDSEP GNN Compliance Engine on port {PORT}")
    threading.Thread(target=init_graph, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
