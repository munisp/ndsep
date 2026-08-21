#!/usr/bin/env python3
"""
NDSEP Ray ML/DL/GNN Engine — Real PyTorch Models with Ray Distributed Training
================================================================================
Production-grade ML engine with real trained weights, proper backpropagation,
and Ray-based distributed training/serving.

Models (all PyTorch, all CPU-native):
  1. GraphSAGE GNN       — 3-layer message passing with LEARNED weights (BCELoss + Adam)
  2. LSTM Forecaster      — PyTorch nn.LSTM for time-series violation prediction
  3. XGBoost Classifier   — Gradient-boosted trees for breach risk (kept from sklearn)
  4. Autoencoder Anomaly  — PyTorch autoencoder for unsupervised anomaly detection

Integrations:
  - Lakehouse: DuckDB reads Parquet → feature engineering → model training
  - Ray Train: Distributed training with checkpointing
  - Ray Serve: Model inference endpoints with batching
  - PostgreSQL: Primary data source for graph construction and features
  - SHAP: TreeExplainer for XGBoost, gradient-based for PyTorch models

Technology: Python · PyTorch · Ray · DuckDB · XGBoost · SHAP · FastAPI
Port: 8250
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
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional
from collections import defaultdict

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [NDSEP-RayML] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

# ── PyTorch ────────────────────────────────────────────────────────────────────
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.optim import Adam, SGD
from torch.optim.lr_scheduler import ReduceLROnPlateau

# ── Ray ────────────────────────────────────────────────────────────────────────
try:
    import ray
    HAS_RAY = True
except ImportError:
    HAS_RAY = False

# ── sklearn / XGBoost / SHAP ──────────────────────────────────────────────────
try:
    from sklearn.ensemble import RandomForestClassifier, IsolationForest
    from sklearn.model_selection import cross_val_score, train_test_split
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import accuracy_score, f1_score, roc_auc_score, precision_score, recall_score
    import joblib
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

try:
    import xgboost as xgb
    HAS_XGB = True
except ImportError:
    HAS_XGB = False

try:
    import shap
    HAS_SHAP = True
except ImportError:
    HAS_SHAP = False

try:
    import psycopg2
    import psycopg2.extras
    HAS_PG = True
except ImportError:
    HAS_PG = False

try:
    import duckdb
    HAS_DUCKDB = True
except ImportError:
    HAS_DUCKDB = False

# ── Configuration ──────────────────────────────────────────────────────────────
_raw_db_url = os.environ.get("DATABASE_URL",
    os.environ.get("WORKER_DATABASE_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"))
DB_URL = re.sub(r'(\?sslmode=[^&?]*)+', '?sslmode=disable', _raw_db_url)

PORT = int(os.environ.get("RAY_ML_PORT", "8250"))
MODEL_DIR = Path(os.environ.get("ML_MODEL_PATH", "./workers/python/models"))
LAKEHOUSE_DIR = Path(os.environ.get("LAKEHOUSE_DIR", "./workers/python/lakehouse_data"))
PARQUET_DIR = LAKEHOUSE_DIR / "parquet"

MODEL_DIR.mkdir(parents=True, exist_ok=True)
PARQUET_DIR.mkdir(parents=True, exist_ok=True)

DEVICE = torch.device("cpu")
EMBEDDING_DIM = 32
GNN_LAYERS = 3
LSTM_HIDDEN = 64
LSTM_SEQ_LEN = 6
AUTOENCODER_LATENT = 16

app = FastAPI(title="NDSEP Ray ML/DL/GNN Engine", version="4.0.0")

# ── Experiment Tracker ─────────────────────────────────────────────────────────
class ExperimentTracker:
    """Lightweight MLOps experiment tracker."""
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir / "experiments"
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.experiments: list[dict] = []

    def log_experiment(self, model_name: str, metrics: dict, params: dict, artifact_path: str = ""):
        exp = {
            "id": hashlib.md5(f"{model_name}-{time.time()}".encode()).hexdigest()[:12],
            "model": model_name,
            "metrics": metrics,
            "params": params,
            "artifact_path": artifact_path,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self.experiments.append(exp)
        # Persist to disk
        exp_file = self.base_dir / f"{exp['id']}.json"
        exp_file.write_text(json.dumps(exp, indent=2))
        log.info(f"Experiment {exp['id']}: {model_name} — {metrics}")
        return exp

    def get_best(self, model_name: str, metric: str = "accuracy") -> Optional[dict]:
        relevant = [e for e in self.experiments if e["model"] == model_name]
        if not relevant:
            return None
        return max(relevant, key=lambda e: e["metrics"].get(metric, 0))

    def list_experiments(self) -> list[dict]:
        return self.experiments

tracker = ExperimentTracker(MODEL_DIR)

# ── Model Registry ─────────────────────────────────────────────────────────────
class ModelRegistry:
    """Production model registry with versioning."""
    def __init__(self):
        self.models: dict[str, dict] = {}

    def register(self, name: str, model: Any, version: str, metrics: dict,
                 model_type: str = "pytorch", artifact_path: str = ""):
        self.models[name] = {
            "model": model,
            "version": version,
            "metrics": metrics,
            "model_type": model_type,
            "artifact_path": artifact_path,
            "registered_at": datetime.now(timezone.utc).isoformat(),
            "status": "active",
        }

    def get(self, name: str) -> Optional[dict]:
        return self.models.get(name)

    def list_models(self) -> dict:
        return {k: {kk: vv for kk, vv in v.items() if kk != "model"}
                for k, v in self.models.items()}

registry = ModelRegistry()

# ══════════════════════════════════════════════════════════════════════════════
# LAYER 1: REAL PyTorch GraphSAGE GNN
# ══════════════════════════════════════════════════════════════════════════════

class GraphSAGELayer(nn.Module):
    """Single GraphSAGE convolution layer with learnable aggregation."""
    def __init__(self, self_dim: int, neigh_dim: int, out_dim: int):
        super().__init__()
        self.W_self = nn.Linear(self_dim, out_dim, bias=False)
        self.W_neigh = nn.Linear(neigh_dim, out_dim, bias=False)
        self.bias = nn.Parameter(torch.zeros(out_dim))
        nn.init.xavier_uniform_(self.W_self.weight)
        nn.init.xavier_uniform_(self.W_neigh.weight)

    def forward(self, h_self: torch.Tensor, h_neigh: torch.Tensor) -> torch.Tensor:
        out = self.W_self(h_self) + self.W_neigh(h_neigh) + self.bias
        return F.relu(out)


class GraphSAGENet(nn.Module):
    """Multi-layer GraphSAGE network with learned weights."""
    def __init__(self, input_dim: int, hidden_dim: int, output_dim: int, num_layers: int = 3):
        super().__init__()
        self.layers = nn.ModuleList()
        self.input_dim = input_dim
        self_dims = [input_dim] + [hidden_dim] * (num_layers - 1) + [output_dim]
        for i in range(num_layers):
            self.layers.append(GraphSAGELayer(self_dims[i], input_dim, self_dims[i + 1]))
        self.num_layers = num_layers

    def forward(self, h_self: torch.Tensor, h_neighbors_list: list[torch.Tensor]) -> torch.Tensor:
        """Forward pass: h_self is (batch, in_dim), h_neighbors_list is per-layer neighbor aggregates."""
        h = h_self
        for i, layer in enumerate(self.layers):
            h_neigh = h_neighbors_list[i] if i < len(h_neighbors_list) else torch.zeros_like(h)
            h = layer(h, h_neigh)
            if i < self.num_layers - 1:
                h = F.dropout(h, p=0.2, training=self.training)
        return F.normalize(h, p=2, dim=-1)


class LinkPredictor(nn.Module):
    """MLP for link prediction on GNN embeddings."""
    def __init__(self, embed_dim: int):
        super().__init__()
        self.fc1 = nn.Linear(embed_dim * 2, 64)
        self.fc2 = nn.Linear(64, 32)
        self.fc3 = nn.Linear(32, 1)
        self.dropout = nn.Dropout(0.3)

    def forward(self, src_emb: torch.Tensor, dst_emb: torch.Tensor) -> torch.Tensor:
        combined = torch.cat([src_emb, dst_emb], dim=-1)
        h = F.relu(self.fc1(combined))
        h = self.dropout(h)
        h = F.relu(self.fc2(h))
        h = self.dropout(h)
        return torch.sigmoid(self.fc3(h)).squeeze(-1)


class ComplianceGraphData:
    """In-memory compliance graph with PyTorch tensor support."""
    def __init__(self):
        self.nodes: dict[str, dict] = {}
        self.edges: list[tuple[str, str, str]] = []
        self.adj: dict[str, list[tuple[str, str]]] = defaultdict(list)
        self.node_types: dict[str, list[str]] = defaultdict(list)
        self.node_features: dict[str, torch.Tensor] = {}
        self.embeddings: dict[str, np.ndarray] = {}
        self.built_at: Optional[str] = None

    def add_node(self, nid: str, ntype: str, features: dict):
        self.nodes[nid] = {"type": ntype, "features": features}
        self.node_types[ntype].append(nid)

    def add_edge(self, src: str, dst: str, rel: str):
        if src in self.nodes and dst in self.nodes:
            self.edges.append((src, dst, rel))
            self.adj[src].append((dst, rel))
            self.adj[dst].append((src, f"INV_{rel}"))

    def node_to_tensor(self, nid: str) -> torch.Tensor:
        if nid in self.node_features:
            return self.node_features[nid]
        node = self.nodes.get(nid, {})
        feats = node.get("features", {})
        ntype = node.get("type", "")
        vec = torch.zeros(8, dtype=torch.float32)
        vec[0] = feats.get("compliance_score", 50) / 100.0
        vec[1] = float(len(self.adj.get(nid, []))) / 20.0
        vec[2] = 1.0 if feats.get("severity") == "critical" else 0.5 if feats.get("severity") == "high" else 0.2
        vec[3] = 1.0 if feats.get("status") in ["active", "open"] else 0.0
        vec[4] = float(feats.get("affected_records", 0)) / 10000.0
        vec[5] = {"Organization": 1.0, "Violation": 0.6, "EnforcementAction": 0.8,
                  "BreachIncident": 0.9, "Sector": 0.3}.get(ntype, 0.5)
        vec[6] = float(len(feats)) / 10.0
        vec[7] = float(hash(nid) % 100) / 100.0
        self.node_features[nid] = vec
        return vec

    def get_neighbor_aggregate(self, nid: str, max_neighbors: int = 10) -> torch.Tensor:
        neighbors = self.adj.get(nid, [])
        if not neighbors:
            return torch.zeros(8, dtype=torch.float32)
        sampled = random.sample(neighbors, min(max_neighbors, len(neighbors)))
        tensors = torch.stack([self.node_to_tensor(n) for n, _ in sampled])
        return tensors.mean(dim=0)

    def stats(self) -> dict:
        return {
            "nodes": len(self.nodes),
            "edges": len(self.edges),
            "node_types": {k: len(v) for k, v in self.node_types.items()},
            "avg_degree": round(sum(len(v) for v in self.adj.values()) / max(1, len(self.adj)), 2),
            "embeddings_computed": len(self.embeddings),
            "built_at": self.built_at,
        }


# Global GNN state
_graph = ComplianceGraphData()
_gnn_model: Optional[GraphSAGENet] = None
_link_predictor_model: Optional[LinkPredictor] = None
_gnn_metrics: dict = {}

def build_graph_from_db():
    """Build compliance graph from PostgreSQL."""
    global _graph
    _graph = ComplianceGraphData()

    if not HAS_PG:
        log.warning("psycopg2 not available — building synthetic graph")
        build_synthetic_graph()
        return

    try:
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute("SELECT id::text, name, sector, compliance_score, risk_score, compliance_status FROM organizations WHERE compliance_status IS NOT NULL")
        for row in cur.fetchall():
            _graph.add_node(f"org:{row['id']}", "Organization", {
                "name": row["name"], "sector": row.get("sector", "Unknown"),
                "compliance_score": float(row.get("compliance_score") or 50),
                "risk_score": float(row.get("risk_score") or 50),
            })

        cur.execute("SELECT DISTINCT sector FROM organizations WHERE sector IS NOT NULL")
        for row in cur.fetchall():
            _graph.add_node(f"sector:{row['sector']}", "Sector", {"name": row["sector"]})

        for nid, data in list(_graph.nodes.items()):
            if data["type"] == "Organization":
                sector = data["features"].get("sector", "Unknown")
                sid = f"sector:{sector}"
                if sid in _graph.nodes:
                    _graph.add_edge(nid, sid, "BELONGS_TO")

        cur.execute("SELECT id::text, organization_id::text, title as violation_type, severity, status FROM compliance_violations LIMIT 500")
        for row in cur.fetchall():
            vid = f"violation:{row['id']}"
            _graph.add_node(vid, "Violation", {
                "type": row.get("violation_type", "unknown"),
                "severity": row.get("severity", "medium"),
                "status": row.get("status", "open"),
            })
            _graph.add_edge(f"org:{row['organization_id']}", vid, "HAS_VIOLATION")

        cur.execute("SELECT id::text, organization_id::text, action_type, status FROM enforcement_actions LIMIT 500")
        for row in cur.fetchall():
            eid = f"enforcement:{row['id']}"
            _graph.add_node(eid, "EnforcementAction", {
                "action_type": row.get("action_type", "unknown"),
                "status": row.get("status", "pending"),
            })
            _graph.add_edge(f"org:{row['organization_id']}", eid, "ENFORCED_BY")

        cur.execute("SELECT id::text, organization_id::text, breach_incident_severity as severity, breach_incident_status as status, affected_individuals_count as affected_records FROM breach_incidents LIMIT 500")
        for row in cur.fetchall():
            bid = f"breach:{row['id']}"
            _graph.add_node(bid, "BreachIncident", {
                "severity": row.get("severity", "medium"),
                "status": row.get("status", "open"),
                "affected_records": int(row.get("affected_records") or 0),
            })
            _graph.add_edge(f"org:{row['organization_id']}", bid, "REPORTED_BREACH")

        # Sector peer edges
        for sector_id in _graph.node_types.get("Sector", []):
            sector_orgs = [nid for nid, rel in _graph.adj[sector_id] if rel == "INV_BELONGS_TO"]
            for i in range(len(sector_orgs)):
                for j in range(i + 1, min(len(sector_orgs), i + 5)):
                    _graph.add_edge(sector_orgs[i], sector_orgs[j], "SECTOR_PEER")

        cur.close()
        conn.close()
        _graph.built_at = datetime.now(timezone.utc).isoformat()
        log.info(f"Graph built from DB: {_graph.stats()}")
    except Exception as e:
        log.error(f"Graph build from DB failed: {e}")
        build_synthetic_graph()


def build_synthetic_graph():
    """Fallback synthetic graph."""
    sectors = ["Banking", "Telecom", "Healthcare", "Insurance", "Education", "Energy"]
    for s in sectors:
        _graph.add_node(f"sector:{s}", "Sector", {"name": s})
    orgs = [
        ("First Bank", "Banking", 82.5), ("GTBank", "Banking", 78.3),
        ("MTN Nigeria", "Telecom", 75.1), ("Airtel", "Telecom", 71.8),
        ("Reddington", "Healthcare", 61.2), ("NHIS", "Healthcare", 55.0),
        ("AXA Mansard", "Insurance", 72.5), ("Leadway", "Insurance", 68.9),
        ("Covenant Uni", "Education", 58.5), ("BUK", "Education", 45.3),
        ("Shell Nigeria", "Energy", 80.5), ("Dangote", "Energy", 73.2),
    ]
    for i, (name, sector, score) in enumerate(orgs):
        oid = f"org:{i+1}"
        _graph.add_node(oid, "Organization", {"name": name, "sector": sector, "compliance_score": score})
        _graph.add_edge(oid, f"sector:{sector}", "BELONGS_TO")
        num_v = max(0, int((100 - score) / 15))
        for v in range(num_v):
            vid = f"violation:{i*10+v}"
            _graph.add_node(vid, "Violation", {"severity": random.choice(["critical", "high", "medium"]), "status": "open"})
            _graph.add_edge(oid, vid, "HAS_VIOLATION")
    _graph.built_at = datetime.now(timezone.utc).isoformat()


def train_gnn() -> dict:
    """Train GraphSAGE GNN with real backpropagation and learned weights."""
    global _gnn_model, _link_predictor_model, _gnn_metrics

    if len(_graph.nodes) < 10:
        return {"status": "insufficient_data", "nodes": len(_graph.nodes)}

    input_dim = 8
    _gnn_model = GraphSAGENet(input_dim, EMBEDDING_DIM, EMBEDDING_DIM, GNN_LAYERS).to(DEVICE)
    _link_predictor_model = LinkPredictor(EMBEDDING_DIM).to(DEVICE)

    optimizer = Adam(list(_gnn_model.parameters()) + list(_link_predictor_model.parameters()),
                     lr=0.01, weight_decay=1e-5)
    scheduler = ReduceLROnPlateau(optimizer, mode='min', patience=5, factor=0.5)
    criterion = nn.BCELoss()

    # Build training data: positive edges + negative samples
    positive_edges = [(s, d) for s, d, r in _graph.edges
                      if r in ("HAS_VIOLATION", "ENFORCED_BY", "REPORTED_BREACH", "BELONGS_TO")]
    all_node_ids = list(_graph.nodes.keys())

    if len(positive_edges) < 5:
        return {"status": "insufficient_edges", "edges": len(positive_edges)}

    # Split edges: 80% train, 20% test
    random.shuffle(positive_edges)
    split = max(1, int(len(positive_edges) * 0.8))
    train_pos = positive_edges[:split]
    test_pos = positive_edges[split:]

    # Generate negative samples
    edge_set = set((s, d) for s, d, _ in _graph.edges)
    train_neg = []
    for _ in range(len(train_pos)):
        while True:
            s, d = random.choice(all_node_ids), random.choice(all_node_ids)
            if s != d and (s, d) not in edge_set:
                train_neg.append((s, d))
                break

    test_neg = []
    for _ in range(len(test_pos)):
        while True:
            s, d = random.choice(all_node_ids), random.choice(all_node_ids)
            if s != d and (s, d) not in edge_set:
                test_neg.append((s, d))
                break

    log.info(f"GNN training: {len(train_pos)} pos + {len(train_neg)} neg train, "
             f"{len(test_pos)} pos + {len(test_neg)} neg test")

    # Training loop
    num_epochs = 100
    best_loss = float('inf')
    best_epoch = 0
    patience = 15
    patience_counter = 0
    losses = []

    _gnn_model.train()
    _link_predictor_model.train()

    for epoch in range(num_epochs):
        optimizer.zero_grad()

        # Forward pass for training edges
        all_train = [(s, d, 1.0) for s, d in train_pos] + [(s, d, 0.0) for s, d in train_neg]
        random.shuffle(all_train)

        # Batch forward
        src_features = []
        dst_features = []
        src_neighbors = [[] for _ in range(GNN_LAYERS)]
        dst_neighbors = [[] for _ in range(GNN_LAYERS)]
        labels = []

        for s, d, label in all_train:
            src_features.append(_graph.node_to_tensor(s))
            dst_features.append(_graph.node_to_tensor(d))
            for layer in range(GNN_LAYERS):
                src_neighbors[layer].append(_graph.get_neighbor_aggregate(s))
                dst_neighbors[layer].append(_graph.get_neighbor_aggregate(d))
            labels.append(label)

        src_feat_batch = torch.stack(src_features).to(DEVICE)
        dst_feat_batch = torch.stack(dst_features).to(DEVICE)
        src_neigh_batches = [torch.stack(sn).to(DEVICE) for sn in src_neighbors]
        dst_neigh_batches = [torch.stack(dn).to(DEVICE) for dn in dst_neighbors]
        label_batch = torch.tensor(labels, dtype=torch.float32).to(DEVICE)

        # GNN forward
        src_emb = _gnn_model(src_feat_batch, src_neigh_batches)
        dst_emb = _gnn_model(dst_feat_batch, dst_neigh_batches)

        # Link prediction
        pred = _link_predictor_model(src_emb, dst_emb)
        loss = criterion(pred, label_batch)

        # Backward pass
        loss.backward()
        torch.nn.utils.clip_grad_norm_(
            list(_gnn_model.parameters()) + list(_link_predictor_model.parameters()),
            max_norm=1.0
        )
        optimizer.step()
        scheduler.step(loss.item())

        losses.append(loss.item())

        if loss.item() < best_loss:
            best_loss = loss.item()
            best_epoch = epoch
            patience_counter = 0
        else:
            patience_counter += 1

        if patience_counter >= patience:
            log.info(f"GNN early stopping at epoch {epoch}, best_loss={best_loss:.4f}")
            break

        if epoch % 20 == 0:
            log.info(f"GNN epoch {epoch}: loss={loss.item():.4f}, lr={optimizer.param_groups[0]['lr']:.6f}")

    # Evaluation on test set
    _gnn_model.eval()
    _link_predictor_model.eval()
    with torch.no_grad():
        test_all = [(s, d, 1.0) for s, d in test_pos] + [(s, d, 0.0) for s, d in test_neg]
        src_f = torch.stack([_graph.node_to_tensor(s) for s, d, l in test_all]).to(DEVICE)
        dst_f = torch.stack([_graph.node_to_tensor(d) for s, d, l in test_all]).to(DEVICE)
        src_n = [torch.stack([_graph.get_neighbor_aggregate(s) for s, d, l in test_all]).to(DEVICE)] * GNN_LAYERS
        dst_n = [torch.stack([_graph.get_neighbor_aggregate(d) for s, d, l in test_all]).to(DEVICE)] * GNN_LAYERS
        y_true = torch.tensor([l for s, d, l in test_all]).to(DEVICE)

        src_e = _gnn_model(src_f, src_n)
        dst_e = _gnn_model(dst_f, dst_n)
        y_pred_prob = _link_predictor_model(src_e, dst_e)
        y_pred = (y_pred_prob > 0.5).float()

        test_loss = criterion(y_pred_prob, y_true).item()
        test_acc = (y_pred == y_true).float().mean().item()
        test_f1 = f1_score(y_true.numpy(), y_pred.numpy(), zero_division=0) if HAS_SKLEARN else 0.0

    # Compute embeddings for all nodes
    with torch.no_grad():
        for nid in _graph.nodes:
            feat = _graph.node_to_tensor(nid).unsqueeze(0).to(DEVICE)
            neigh = [_graph.get_neighbor_aggregate(nid).unsqueeze(0).to(DEVICE)] * GNN_LAYERS
            emb = _gnn_model(feat, neigh).squeeze(0).cpu().numpy()
            _graph.embeddings[nid] = emb

    # Save model weights
    version = hashlib.md5(f"gnn-{time.time()}".encode()).hexdigest()[:8]
    gnn_path = MODEL_DIR / f"graphsage_{version}.pt"
    lp_path = MODEL_DIR / f"link_predictor_{version}.pt"
    torch.save(_gnn_model.state_dict(), gnn_path)
    torch.save(_link_predictor_model.state_dict(), lp_path)

    # Count parameters
    gnn_params = sum(p.numel() for p in _gnn_model.parameters())
    lp_params = sum(p.numel() for p in _link_predictor_model.parameters())

    _gnn_metrics = {
        "algorithm": "GraphSAGE (PyTorch)",
        "framework": "pytorch",
        "gnn_layers": GNN_LAYERS,
        "embedding_dim": EMBEDDING_DIM,
        "gnn_parameters": gnn_params,
        "link_predictor_parameters": lp_params,
        "total_parameters": gnn_params + lp_params,
        "training_epochs": min(epoch + 1, num_epochs),
        "best_epoch": best_epoch,
        "train_loss_final": round(losses[-1], 4),
        "train_loss_best": round(best_loss, 4),
        "test_loss": round(test_loss, 4),
        "test_accuracy": round(test_acc, 4),
        "test_f1": round(test_f1, 4),
        "graph_nodes": len(_graph.nodes),
        "graph_edges": len(_graph.edges),
        "embeddings_computed": len(_graph.embeddings),
        "loss_history_sample": [round(l, 4) for l in losses[::max(1, len(losses)//10)]],
        "version": version,
        "gnn_weights_path": str(gnn_path),
        "link_predictor_path": str(lp_path),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "has_backprop": True,
        "has_learned_weights": True,
    }

    registry.register("graphsage_gnn", _gnn_model, version, _gnn_metrics,
                      model_type="pytorch", artifact_path=str(gnn_path))
    registry.register("link_predictor", _link_predictor_model, version,
                      {"test_accuracy": round(test_acc, 4), "test_f1": round(test_f1, 4)},
                      model_type="pytorch", artifact_path=str(lp_path))

    tracker.log_experiment("graphsage_gnn", _gnn_metrics, {
        "layers": GNN_LAYERS, "embed_dim": EMBEDDING_DIM, "lr": 0.01, "epochs": num_epochs,
    }, str(gnn_path))

    log.info(f"GNN trained: {gnn_params + lp_params} params, test_acc={test_acc:.4f}, "
             f"test_f1={test_f1:.4f}, {len(_graph.embeddings)} embeddings")
    return _gnn_metrics


# ══════════════════════════════════════════════════════════════════════════════
# LAYER 2: REAL PyTorch LSTM for Time-Series Violation Forecasting
# ══════════════════════════════════════════════════════════════════════════════

class ViolationLSTM(nn.Module):
    """LSTM network for violation count time-series forecasting."""
    def __init__(self, input_dim: int, hidden_dim: int = 64, num_layers: int = 2, dropout: float = 0.2):
        super().__init__()
        self.lstm = nn.LSTM(input_dim, hidden_dim, num_layers=num_layers,
                           dropout=dropout if num_layers > 1 else 0,
                           batch_first=True)
        self.fc1 = nn.Linear(hidden_dim, 32)
        self.fc2 = nn.Linear(32, 1)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        lstm_out, _ = self.lstm(x)
        last_hidden = lstm_out[:, -1, :]
        h = F.relu(self.fc1(last_hidden))
        h = self.dropout(h)
        return self.fc2(h).squeeze(-1)


_lstm_model: Optional[ViolationLSTM] = None
_lstm_scaler: Optional[StandardScaler] = None
_lstm_metrics: dict = {}

def extract_violation_timeseries() -> tuple:
    """Extract monthly violation counts from PostgreSQL."""
    if not HAS_PG:
        return np.array([]), np.array([])
    try:
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT DATE_TRUNC('month', detected_at) as month,
                   COUNT(*) as violation_count,
                   COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
                   COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_count,
                   COALESCE(AVG(CASE WHEN resolved_at IS NOT NULL
                       THEN EXTRACT(EPOCH FROM (resolved_at - detected_at))/86400.0 END), 0) as avg_resolve_days
            FROM compliance_violations
            WHERE detected_at IS NOT NULL
            GROUP BY DATE_TRUNC('month', detected_at)
            ORDER BY month
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()

        if len(rows) < 3:
            return np.array([]), np.array([])

        features = np.array([[float(r["violation_count"]), float(r["critical_count"]),
                              float(r["high_count"]), float(r["avg_resolve_days"])] for r in rows], dtype=np.float32)
        targets = np.array([float(r["violation_count"]) for r in rows], dtype=np.float32)
        return features, targets
    except Exception as e:
        log.error(f"Timeseries extraction failed: {e}")
        return np.array([]), np.array([])


def train_lstm() -> dict:
    """Train PyTorch LSTM for violation time-series forecasting."""
    global _lstm_model, _lstm_scaler, _lstm_metrics

    features, targets = extract_violation_timeseries()
    if len(features) < LSTM_SEQ_LEN + 2:
        # Generate synthetic time-series if insufficient real data
        log.warning("Insufficient time-series data — generating synthetic training data")
        np.random.seed(42)
        months = 36
        base = 5 + np.cumsum(np.random.randn(months) * 0.5)
        base = np.maximum(0, base)
        features = np.column_stack([
            base,
            base * 0.2 + np.random.randn(months) * 0.5,
            base * 0.3 + np.random.randn(months) * 0.5,
            np.random.rand(months) * 10 + 5,
        ]).astype(np.float32)
        targets = base.astype(np.float32)

    input_dim = features.shape[1]
    _lstm_scaler = StandardScaler() if HAS_SKLEARN else None
    if _lstm_scaler:
        features = _lstm_scaler.fit_transform(features)

    # Create sequences
    X_seq, y_seq = [], []
    for i in range(LSTM_SEQ_LEN, len(features)):
        X_seq.append(features[i - LSTM_SEQ_LEN:i])
        y_seq.append(targets[i])

    X = torch.tensor(np.array(X_seq), dtype=torch.float32)
    y = torch.tensor(np.array(y_seq), dtype=torch.float32)

    # Train/test split
    split = max(1, int(len(X) * 0.8))
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]

    _lstm_model = ViolationLSTM(input_dim, LSTM_HIDDEN, num_layers=2, dropout=0.2).to(DEVICE)

    # Warm-start: load last checkpoint if available
    lstm_ckpt = MODEL_DIR / "lstm_violation_latest.pt"
    warm_started = False
    if lstm_ckpt.exists():
        try:
            state = torch.load(lstm_ckpt, map_location=DEVICE, weights_only=True)
            _lstm_model.load_state_dict(state)
            warm_started = True
            log.info("LSTM warm-started from checkpoint")
        except Exception as e:
            log.warning(f"LSTM warm-start failed (training from scratch): {e}")

    optimizer = Adam(_lstm_model.parameters(), lr=0.0005 if warm_started else 0.001, weight_decay=1e-5)
    scheduler = ReduceLROnPlateau(optimizer, mode='min', patience=10, factor=0.5)
    criterion = nn.MSELoss()

    # Training loop (fewer epochs if warm-started)
    num_epochs = 80 if warm_started else 200
    best_loss = float('inf')
    best_epoch = 0
    losses = []

    _lstm_model.train()
    for epoch in range(num_epochs):
        optimizer.zero_grad()
        pred = _lstm_model(X_train.to(DEVICE))
        loss = criterion(pred, y_train.to(DEVICE))
        loss.backward()
        torch.nn.utils.clip_grad_norm_(_lstm_model.parameters(), max_norm=1.0)
        optimizer.step()
        scheduler.step(loss.item())
        losses.append(loss.item())

        if loss.item() < best_loss:
            best_loss = loss.item()
            best_epoch = epoch

        if epoch % 50 == 0:
            log.info(f"LSTM epoch {epoch}: loss={loss.item():.4f}")

    # Evaluate
    _lstm_model.eval()
    with torch.no_grad():
        test_pred = _lstm_model(X_test.to(DEVICE)) if len(X_test) > 0 else torch.tensor([])
        test_loss = criterion(test_pred, y_test.to(DEVICE)).item() if len(X_test) > 0 else 0
        test_mae = float(torch.mean(torch.abs(test_pred - y_test.to(DEVICE))).item()) if len(X_test) > 0 else 0

        # Forecast next 6 months
        forecasts = []
        last_seq = X[-1:].to(DEVICE)
        for i in range(6):
            pred_val = _lstm_model(last_seq).item()
            forecasts.append({"month_ahead": i + 1, "predicted_violations": max(0, round(pred_val))})
            # Shift sequence
            new_step = torch.zeros(1, 1, input_dim).to(DEVICE)
            new_step[0, 0, 0] = pred_val
            last_seq = torch.cat([last_seq[:, 1:, :], new_step], dim=1)

    # Save model
    version = hashlib.md5(f"lstm-{time.time()}".encode()).hexdigest()[:8]
    lstm_path = MODEL_DIR / f"lstm_violation_{version}.pt"
    torch.save(_lstm_model.state_dict(), lstm_path)
    torch.save(_lstm_model.state_dict(), MODEL_DIR / "lstm_violation_latest.pt")
    if _lstm_scaler:
        joblib.dump(_lstm_scaler, MODEL_DIR / f"lstm_scaler_{version}.joblib")

    lstm_params = sum(p.numel() for p in _lstm_model.parameters())

    _lstm_metrics = {
        "algorithm": "LSTM (PyTorch nn.LSTM)",
        "framework": "pytorch",
        "hidden_dim": LSTM_HIDDEN,
        "num_layers": 2,
        "sequence_length": LSTM_SEQ_LEN,
        "parameters": lstm_params,
        "training_epochs": num_epochs,
        "best_epoch": best_epoch,
        "train_loss_final": round(losses[-1], 4),
        "train_loss_best": round(best_loss, 4),
        "test_mse": round(test_loss, 4),
        "test_mae": round(test_mae, 4),
        "test_rmse": round(math.sqrt(max(0, test_loss)), 4),
        "forecasts": forecasts,
        "loss_history_sample": [round(l, 4) for l in losses[::max(1, len(losses)//10)]],
        "version": version,
        "weights_path": str(lstm_path),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "has_backprop": True,
        "has_learned_weights": True,
        "warm_started": warm_started,
    }

    registry.register("lstm_violation", _lstm_model, version, _lstm_metrics,
                      model_type="pytorch", artifact_path=str(lstm_path))
    tracker.log_experiment("lstm_violation", _lstm_metrics, {
        "hidden_dim": LSTM_HIDDEN, "num_layers": 2,
        "lr": 0.0005 if warm_started else 0.001, "epochs": num_epochs, "warm_start": warm_started,
    }, str(lstm_path))

    log.info(f"LSTM trained: {lstm_params} params, test_mse={test_loss:.4f}, test_mae={test_mae:.4f}")
    return _lstm_metrics


# ══════════════════════════════════════════════════════════════════════════════
# LAYER 3: PyTorch Autoencoder for Anomaly Detection (replaces broken IsolationForest)
# ══════════════════════════════════════════════════════════════════════════════

class ComplianceAutoencoder(nn.Module):
    """Autoencoder for unsupervised anomaly detection."""
    def __init__(self, input_dim: int, latent_dim: int = 16):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, 32),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, latent_dim),
            nn.ReLU(),
        )
        self.decoder = nn.Sequential(
            nn.Linear(latent_dim, 32),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, input_dim),
        )

    def forward(self, x: torch.Tensor) -> tuple:
        latent = self.encoder(x)
        reconstructed = self.decoder(latent)
        return reconstructed, latent


_autoencoder: Optional[ComplianceAutoencoder] = None
_ae_scaler: Optional[StandardScaler] = None
_ae_threshold: float = 0.0
_ae_metrics: dict = {}

def train_autoencoder() -> dict:
    """Train autoencoder for anomaly detection with real backpropagation."""
    global _autoencoder, _ae_scaler, _ae_threshold, _ae_metrics

    X, y, org_ids, feature_names = extract_features_from_db()
    if len(X) < 10:
        return {"status": "insufficient_data", "samples": len(X)}

    input_dim = X.shape[1]
    _ae_scaler = StandardScaler()
    X_scaled = _ae_scaler.fit_transform(X)

    X_tensor = torch.tensor(X_scaled, dtype=torch.float32).to(DEVICE)

    # 80/20 split
    split = max(1, int(len(X_tensor) * 0.8))
    X_train = X_tensor[:split]
    X_test = X_tensor[split:]

    _autoencoder = ComplianceAutoencoder(input_dim, AUTOENCODER_LATENT).to(DEVICE)

    # Warm-start: load last checkpoint if available
    ae_ckpt = MODEL_DIR / "autoencoder_anomaly_latest.pt"
    ae_warm_started = False
    if ae_ckpt.exists():
        try:
            state = torch.load(ae_ckpt, map_location=DEVICE, weights_only=True)
            _autoencoder.load_state_dict(state)
            ae_warm_started = True
            log.info("Autoencoder warm-started from checkpoint")
        except Exception as e:
            log.warning(f"Autoencoder warm-start failed (training from scratch): {e}")

    optimizer = Adam(_autoencoder.parameters(), lr=0.0005 if ae_warm_started else 0.001, weight_decay=1e-5)
    criterion = nn.MSELoss()

    # Training (fewer epochs if warm-started)
    num_epochs = 60 if ae_warm_started else 150
    best_loss = float('inf')
    losses = []

    _autoencoder.train()
    for epoch in range(num_epochs):
        optimizer.zero_grad()
        reconstructed, latent = _autoencoder(X_train)
        loss = criterion(reconstructed, X_train)
        loss.backward()
        optimizer.step()
        losses.append(loss.item())

        if loss.item() < best_loss:
            best_loss = loss.item()

        if epoch % 30 == 0:
            log.info(f"Autoencoder epoch {epoch}: loss={loss.item():.6f}")

    # Compute reconstruction errors for threshold
    _autoencoder.eval()
    with torch.no_grad():
        recon_train, _ = _autoencoder(X_train)
        train_errors = torch.mean((recon_train - X_train) ** 2, dim=1).numpy()
        _ae_threshold = float(np.percentile(train_errors, 95))

        if len(X_test) > 0:
            recon_test, _ = _autoencoder(X_test)
            test_errors = torch.mean((recon_test - X_test) ** 2, dim=1).numpy()
            test_loss = float(np.mean(test_errors))
        else:
            test_loss = 0

    # Save model
    version = hashlib.md5(f"ae-{time.time()}".encode()).hexdigest()[:8]
    ae_path = MODEL_DIR / f"autoencoder_{version}.pt"
    torch.save(_autoencoder.state_dict(), ae_path)
    torch.save(_autoencoder.state_dict(), MODEL_DIR / "autoencoder_anomaly_latest.pt")
    joblib.dump(_ae_scaler, MODEL_DIR / f"autoencoder_scaler_{version}.joblib")

    ae_params = sum(p.numel() for p in _autoencoder.parameters())

    _ae_metrics = {
        "algorithm": "Autoencoder (PyTorch)",
        "framework": "pytorch",
        "latent_dim": AUTOENCODER_LATENT,
        "parameters": ae_params,
        "training_epochs": num_epochs,
        "train_loss_final": round(losses[-1], 6),
        "train_loss_best": round(best_loss, 6),
        "test_reconstruction_error": round(test_loss, 6),
        "anomaly_threshold": round(_ae_threshold, 6),
        "training_samples": len(X_train),
        "test_samples": len(X_test),
        "version": version,
        "weights_path": str(ae_path),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "has_backprop": True,
        "has_learned_weights": True,
        "warm_started": ae_warm_started,
    }

    registry.register("autoencoder_anomaly", _autoencoder, version, _ae_metrics,
                      model_type="pytorch", artifact_path=str(ae_path))
    tracker.log_experiment("autoencoder_anomaly", _ae_metrics, {
        "latent_dim": AUTOENCODER_LATENT, "lr": 0.0005 if ae_warm_started else 0.001,
        "epochs": num_epochs, "warm_start": ae_warm_started,
    }, str(ae_path))

    log.info(f"Autoencoder trained: {ae_params} params, threshold={_ae_threshold:.6f}")
    return _ae_metrics


# ══════════════════════════════════════════════════════════════════════════════
# LAYER 4: XGBoost with SHAP (kept as-is, it was already real)
# ══════════════════════════════════════════════════════════════════════════════

_xgb_model = None
_xgb_scaler = None
_xgb_explainer = None
_xgb_metrics: dict = {}
FEATURE_COLUMNS = [
    "compliance_score", "violation_count", "critical_violations", "high_violations",
    "enforcement_count", "total_fines", "days_active", "breach_count",
    "sector_encoded", "staff_proxy", "has_dpo"
]

def extract_features_from_db() -> tuple:
    """Extract ML features from PostgreSQL."""
    if not HAS_PG:
        return np.array([]), np.array([]), [], FEATURE_COLUMNS
    try:
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT o.id::text as org_id, o.name, o.sector,
                   COALESCE(o.compliance_score, 50) as compliance_score,
                   COALESCE(o.risk_score, 50) as risk_level,
                   COALESCE(v.violation_count, 0) as violation_count,
                   COALESCE(v.critical_violations, 0) as critical_violations,
                   COALESCE(v.high_violations, 0) as high_violations,
                   COALESCE(ea.enforcement_count, 0) as enforcement_count,
                   COALESCE(fp.total_fines, 0) as total_fines,
                   GREATEST(1, EXTRACT(DAYS FROM (NOW() - o.created_at)))::int as days_active,
                   COALESCE(bi.breach_count, 0) as breach_count,
                   CASE WHEN o.compliance_score < 70 THEN 1 ELSE 0 END as at_risk
            FROM organizations o
            LEFT JOIN (SELECT organization_id, COUNT(*) as violation_count,
                              COUNT(CASE WHEN severity='critical' THEN 1 END) as critical_violations,
                              COUNT(CASE WHEN severity='high' THEN 1 END) as high_violations
                       FROM compliance_violations GROUP BY organization_id) v ON v.organization_id = o.id
            LEFT JOIN (SELECT organization_id, COUNT(*) as enforcement_count
                       FROM enforcement_actions GROUP BY organization_id) ea ON ea.organization_id = o.id
            LEFT JOIN (SELECT organization_id, COALESCE(SUM(amount), 0) as total_fines
                       FROM financial_penalties GROUP BY organization_id) fp ON fp.organization_id = o.id
            LEFT JOIN (SELECT organization_id, COUNT(*) as breach_count
                       FROM breach_incidents GROUP BY organization_id) bi ON bi.organization_id = o.id
            WHERE o.compliance_status IS NOT NULL ORDER BY o.id
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()

        if not rows:
            return np.array([]), np.array([]), [], FEATURE_COLUMNS

        sectors = sorted(set(r["sector"] for r in rows if r.get("sector")))
        sector_map = {s: i for i, s in enumerate(sectors)}

        org_ids = [r["org_id"] for r in rows]
        X, y_list = [], []
        for r in rows:
            X.append([
                float(r["compliance_score"]), float(r["violation_count"]),
                float(r["critical_violations"]), float(r["high_violations"]),
                float(r["enforcement_count"]), float(r["total_fines"]),
                float(r["days_active"]), float(r["breach_count"]),
                float(sector_map.get(r.get("sector", "Other"), 0)),
                float(r["enforcement_count"] * 2 + r["violation_count"]),
                1.0 if r.get("compliance_score", 0) > 75 else 0.0,
            ])
            y_list.append(int(r["at_risk"]))

        return np.array(X, dtype=np.float32), np.array(y_list), org_ids, FEATURE_COLUMNS
    except Exception as e:
        log.error(f"Feature extraction failed: {e}")
        return np.array([]), np.array([]), [], FEATURE_COLUMNS


def train_xgboost() -> dict:
    """Train XGBoost breach predictor with SHAP."""
    global _xgb_model, _xgb_scaler, _xgb_explainer, _xgb_metrics

    X, y, org_ids, feature_names = extract_features_from_db()
    if len(X) < 10:
        return {"status": "insufficient_data", "samples": len(X)}

    _xgb_scaler = StandardScaler()
    X_scaled = _xgb_scaler.fit_transform(X)
    X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.2, random_state=42)

    if HAS_XGB:
        _xgb_model = xgb.XGBClassifier(
            n_estimators=200, max_depth=5, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8, reg_alpha=0.1, reg_lambda=1.0,
            eval_metric="logloss", random_state=42,
        )
    else:
        from sklearn.ensemble import GradientBoostingClassifier
        _xgb_model = GradientBoostingClassifier(n_estimators=200, max_depth=5,
                                                 learning_rate=0.05, random_state=42)

    _xgb_model.fit(X_train, y_train)
    y_pred = _xgb_model.predict(X_test)
    y_prob = _xgb_model.predict_proba(X_test)

    metrics = {
        "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
        "f1": round(float(f1_score(y_test, y_pred, zero_division=0)), 4),
        "precision": round(float(precision_score(y_test, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_test, y_pred, zero_division=0)), 4),
        "training_samples": len(X_train),
        "test_samples": len(X_test),
        "algorithm": "XGBoost" if HAS_XGB else "GradientBoosting",
    }

    if len(set(y_test)) > 1 and y_prob.shape[1] > 1:
        metrics["roc_auc"] = round(float(roc_auc_score(y_test, y_prob[:, 1])), 4)

    cv_scores = cross_val_score(_xgb_model, X_scaled, y, cv=min(5, max(2, len(X)//5)))
    metrics["cv_accuracy"] = round(float(np.mean(cv_scores)), 4)
    metrics["cv_std"] = round(float(np.std(cv_scores)), 4)

    if hasattr(_xgb_model, 'feature_importances_'):
        metrics["feature_importance"] = dict(sorted(
            zip(feature_names, [round(float(x), 4) for x in _xgb_model.feature_importances_]),
            key=lambda x: -x[1]))

    if HAS_SHAP:
        try:
            _xgb_explainer = shap.TreeExplainer(_xgb_model)
            sv = _xgb_explainer.shap_values(X_test[:min(50, len(X_test))])
            metrics["shap_available"] = True
            if isinstance(sv, list):
                mean_abs = np.mean(np.abs(sv[1] if len(sv) > 1 else sv[0]), axis=0)
            else:
                mean_abs = np.mean(np.abs(sv), axis=0)
            metrics["shap_importance"] = dict(zip(feature_names, [round(float(x), 4) for x in mean_abs]))
        except Exception as e:
            log.warning(f"SHAP failed: {e}")
            metrics["shap_available"] = False

    version = hashlib.md5(f"xgb-{time.time()}".encode()).hexdigest()[:8]
    model_path = MODEL_DIR / f"xgboost_breach_{version}.joblib"
    scaler_path = MODEL_DIR / f"xgboost_scaler_{version}.joblib"
    joblib.dump(_xgb_model, model_path)
    joblib.dump(_xgb_scaler, scaler_path)

    _xgb_metrics = {**metrics, "version": version, "trained_at": datetime.now(timezone.utc).isoformat(),
                    "has_backprop": False, "has_learned_weights": True}

    registry.register("xgboost_breach", _xgb_model, version, _xgb_metrics,
                      model_type="xgboost", artifact_path=str(model_path))
    tracker.log_experiment("xgboost_breach", _xgb_metrics, {
        "n_estimators": 200, "max_depth": 5, "lr": 0.05
    }, str(model_path))

    # Set drift baseline from training data
    drift_monitor.set_baseline(X, feature_names)

    log.info(f"XGBoost trained: accuracy={metrics['accuracy']}, cv={metrics['cv_accuracy']}")
    return _xgb_metrics


# ══════════════════════════════════════════════════════════════════════════════
# LAYER 5: Lakehouse Integration (DuckDB + Parquet)
# ══════════════════════════════════════════════════════════════════════════════

def lakehouse_etl() -> dict:
    """Extract data from PostgreSQL → Parquet via DuckDB for ML feature engineering."""
    if not HAS_DUCKDB or not HAS_PG:
        return {"status": "dependencies_missing", "has_duckdb": HAS_DUCKDB, "has_pg": HAS_PG}

    results = {}
    tables = {
        "organizations": "SELECT id, name, sector, compliance_score, risk_score, compliance_status, created_at FROM organizations",
        "breach_incidents": "SELECT id, organization_id, breach_incident_severity, breach_incident_status, affected_individuals_count, created_at FROM breach_incidents",
        "enforcement_actions": "SELECT id, organization_id, action_type, status, created_at FROM enforcement_actions",
        "compliance_violations": "SELECT id, organization_id, title, severity, status, detected_at FROM compliance_violations",
        "financial_penalties": "SELECT id, organization_id, amount, payment_status, created_at FROM financial_penalties",
        "security_alerts": "SELECT id, organization_id, alert_type, severity, is_resolved, created_at FROM security_alerts",
        "audit_logs": "SELECT id, action, resource_type, created_at FROM audit_logs LIMIT 1000",
    }

    pg_dsn = re.sub(r'\?.*$', '', DB_URL)
    total_rows = 0

    for table, query in tables.items():
        try:
            conn = psycopg2.connect(DB_URL)
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(query)
            rows = cur.fetchall()
            cur.close()
            conn.close()

            if rows:
                import pyarrow as pa
                import pyarrow.parquet as pq
                # Convert to PyArrow table
                columns = {k: [str(r.get(k, "")) for r in rows] for k in rows[0].keys()}
                table_pa = pa.table(columns)
                pq_path = PARQUET_DIR / f"{table}.parquet"
                pq.write_table(table_pa, str(pq_path))
                results[table] = {"rows": len(rows), "status": "written", "path": str(pq_path)}
                total_rows += len(rows)
            else:
                results[table] = {"rows": 0, "status": "empty"}
        except Exception as e:
            results[table] = {"status": "error", "error": str(e)}

    return {
        "status": "completed",
        "tables": results,
        "total_rows": total_rows,
        "parquet_dir": str(PARQUET_DIR),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def lakehouse_features() -> dict:
    """Read features from Lakehouse Parquet files via DuckDB."""
    if not HAS_DUCKDB:
        return {"status": "duckdb_not_available"}

    org_path = PARQUET_DIR / "organizations.parquet"
    if not org_path.exists():
        return {"status": "parquet_not_found", "hint": "Run /lakehouse/etl first"}

    try:
        db = duckdb.connect()
        result = db.execute(f"""
            SELECT * FROM read_parquet('{org_path}')
            ORDER BY CAST(id AS INTEGER)
        """).fetchall()
        columns = [desc[0] for desc in db.description]
        db.close()

        rows = [dict(zip(columns, row)) for row in result]
        return {"rows": rows, "count": len(rows), "source": "lakehouse_parquet"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def lakehouse_materialized_views() -> dict:
    """Materialized views via DuckDB over Parquet."""
    if not HAS_DUCKDB:
        return {"status": "duckdb_not_available"}

    org_path = PARQUET_DIR / "organizations.parquet"
    if not org_path.exists():
        return {"status": "parquet_not_found"}

    try:
        db = duckdb.connect()
        result = db.execute(f"""
            SELECT sector, COUNT(*) as org_count,
                   ROUND(AVG(CAST(compliance_score AS DOUBLE)), 2) as avg_compliance,
                   ROUND(AVG(CAST(risk_score AS DOUBLE)), 2) as avg_risk
            FROM read_parquet('{org_path}')
            WHERE sector IS NOT NULL AND sector != ''
            GROUP BY sector ORDER BY org_count DESC
        """).fetchall()
        columns = [desc[0] for desc in db.description]
        db.close()

        rows = [dict(zip(columns, row)) for row in result]
        return {"sectors": rows, "count": len(rows), "source": "lakehouse_duckdb"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


# ══════════════════════════════════════════════════════════════════════════════
# LAYER 6: Ray Distributed Training and Serving
# ══════════════════════════════════════════════════════════════════════════════

_ray_initialized = False

def init_ray():
    """Initialize Ray runtime."""
    global _ray_initialized
    if not HAS_RAY:
        log.warning("Ray not installed")
        return False
    if _ray_initialized:
        return True
    try:
        if not ray.is_initialized():
            ray.init(
                num_cpus=2,
                ignore_reinit_error=True,
                logging_level=logging.WARNING,
                _temp_dir="/tmp/ray_ndsep",
            )
        _ray_initialized = True
        log.info("Ray initialized")
        return True
    except Exception as e:
        log.error(f"Ray init failed: {e}")
        return False


def ray_train_all() -> dict:
    """Train all models using Ray for distributed execution."""
    if not init_ray():
        return train_all_local()

    try:
        @ray.remote
        def train_gnn_remote():
            return train_gnn()

        @ray.remote
        def train_lstm_remote():
            return train_lstm()

        @ray.remote
        def train_ae_remote():
            return train_autoencoder()

        @ray.remote
        def train_xgb_remote():
            return train_xgboost()

        # Submit all training jobs in parallel via Ray
        futures = [
            train_gnn_remote.remote(),
            train_lstm_remote.remote(),
            train_ae_remote.remote(),
            train_xgb_remote.remote(),
        ]

        results = ray.get(futures, timeout=300)
        return {
            "status": "completed",
            "backend": "ray_distributed",
            "models": {
                "graphsage_gnn": results[0],
                "lstm_violation": results[1],
                "autoencoder_anomaly": results[2],
                "xgboost_breach": results[3],
            },
            "ray_cluster": {"cpus": ray.cluster_resources().get("CPU", 0)},
        }
    except Exception as e:
        log.warning(f"Ray training failed, falling back to local: {e}")
        return train_all_local()


def train_all_local() -> dict:
    """Train all models locally (fallback if Ray unavailable)."""
    t0 = time.time()
    results = {}

    # Sequential training
    log.info("Training XGBoost...")
    results["xgboost_breach"] = train_xgboost()

    log.info("Training Autoencoder...")
    results["autoencoder_anomaly"] = train_autoencoder()

    log.info("Training LSTM...")
    results["lstm_violation"] = train_lstm()

    log.info("Training GNN...")
    build_graph_from_db()
    results["graphsage_gnn"] = train_gnn()

    duration = time.time() - t0
    return {
        "status": "completed",
        "backend": "local_sequential",
        "duration_seconds": round(duration, 2),
        "models": results,
    }


# ══════════════════════════════════════════════════════════════════════════════
# LAYER 7: CONTINUOUS TRAINING PIPELINE
# ══════════════════════════════════════════════════════════════════════════════
# - Data drift detection (KS-test + PSI)
# - Scheduled auto-retraining (background thread)
# - Incremental/warm-start learning (PyTorch checkpoint resume)
# - Prediction feedback loop (store predictions → use as labels)
# - Champion/challenger model promotion
# - Lakehouse auto-sync before retraining
# - Retraining event log with before/after metrics
# ══════════════════════════════════════════════════════════════════════════════

from scipy import stats as scipy_stats

# ── Configuration ──────────────────────────────────────────────────────────────
RETRAIN_INTERVAL_SECONDS = int(os.environ.get("RETRAIN_INTERVAL", "21600"))  # 6 hours
DRIFT_CHECK_INTERVAL = int(os.environ.get("DRIFT_CHECK_INTERVAL", "3600"))  # 1 hour
DRIFT_THRESHOLD_KS = float(os.environ.get("DRIFT_THRESHOLD_KS", "0.15"))  # KS test p-value
DRIFT_THRESHOLD_PSI = float(os.environ.get("DRIFT_THRESHOLD_PSI", "0.2"))  # PSI threshold
CHAMPION_IMPROVEMENT_THRESHOLD = float(os.environ.get("CHAMPION_THRESHOLD", "0.01"))  # 1%

# ── Data Drift Monitor ────────────────────────────────────────────────────────

class DataDriftMonitor:
    """Monitors feature distribution drift using KS-test and PSI."""

    def __init__(self):
        self.baseline_stats: dict[str, dict] = {}
        self.drift_history: list[dict] = []
        self.last_check: Optional[float] = None
        self._baseline_data: Optional[np.ndarray] = None

    def set_baseline(self, X: np.ndarray, feature_names: list[str]):
        """Record baseline feature distributions from training data."""
        if X.size == 0:
            return
        self._baseline_data = X.copy()
        for i, name in enumerate(feature_names):
            col = X[:, i]
            self.baseline_stats[name] = {
                "mean": float(np.mean(col)),
                "std": float(np.std(col)),
                "min": float(np.min(col)),
                "max": float(np.max(col)),
                "median": float(np.median(col)),
                "q25": float(np.percentile(col, 25)),
                "q75": float(np.percentile(col, 75)),
                "n_samples": len(col),
                "histogram": np.histogram(col, bins=10)[0].tolist(),
                "bin_edges": np.histogram(col, bins=10)[1].tolist(),
            }
        log.info(f"Drift baseline set: {len(feature_names)} features, {len(X)} samples")

    def _compute_psi(self, baseline: np.ndarray, current: np.ndarray, bins: int = 10) -> float:
        """Population Stability Index (PSI) between two distributions."""
        if len(baseline) < 2 or len(current) < 2:
            return 0.0
        mn = min(baseline.min(), current.min())
        mx = max(baseline.max(), current.max())
        if mn == mx:
            return 0.0
        edges = np.linspace(mn, mx, bins + 1)
        base_hist = np.histogram(baseline, bins=edges)[0].astype(float) + 1e-6
        curr_hist = np.histogram(current, bins=edges)[0].astype(float) + 1e-6
        base_pct = base_hist / base_hist.sum()
        curr_pct = curr_hist / curr_hist.sum()
        psi = float(np.sum((curr_pct - base_pct) * np.log(curr_pct / base_pct)))
        return psi

    def check_drift(self, X_current: np.ndarray, feature_names: list[str]) -> dict:
        """Check for data drift between baseline and current data."""
        if self._baseline_data is None or X_current.size == 0:
            return {"drifted": False, "reason": "no_baseline"}

        self.last_check = time.time()
        drift_results = {}
        drifted_features = []

        for i, name in enumerate(feature_names):
            if i >= self._baseline_data.shape[1] or i >= X_current.shape[1]:
                continue
            baseline_col = self._baseline_data[:, i]
            current_col = X_current[:, i]

            # KS test
            ks_stat, ks_pvalue = scipy_stats.ks_2samp(baseline_col, current_col)
            # PSI
            psi = self._compute_psi(baseline_col, current_col)

            drift_results[name] = {
                "ks_statistic": round(float(ks_stat), 4),
                "ks_pvalue": round(float(ks_pvalue), 4),
                "psi": round(psi, 4),
                "ks_drifted": bool(ks_pvalue < DRIFT_THRESHOLD_KS),
                "psi_drifted": bool(psi > DRIFT_THRESHOLD_PSI),
                "baseline_mean": round(float(np.mean(baseline_col)), 4),
                "current_mean": round(float(np.mean(current_col)), 4),
                "mean_shift": round(float(np.mean(current_col) - np.mean(baseline_col)), 4),
            }
            if ks_pvalue < DRIFT_THRESHOLD_KS or psi > DRIFT_THRESHOLD_PSI:
                drifted_features.append(name)

        overall_drifted = len(drifted_features) > 0
        result = {
            "drifted": overall_drifted,
            "drifted_features": drifted_features,
            "total_features": len(feature_names),
            "drift_count": len(drifted_features),
            "drift_percentage": round(len(drifted_features) / max(len(feature_names), 1) * 100, 1),
            "feature_drift": drift_results,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "thresholds": {"ks": DRIFT_THRESHOLD_KS, "psi": DRIFT_THRESHOLD_PSI},
        }

        self.drift_history.append({
            "timestamp": result["checked_at"],
            "drifted": overall_drifted,
            "drifted_features": drifted_features,
            "drift_count": len(drifted_features),
        })
        # Keep last 100 checks
        if len(self.drift_history) > 100:
            self.drift_history = self.drift_history[-100:]

        if overall_drifted:
            log.warning(f"Data drift detected in {len(drifted_features)} features: {drifted_features}")

        return result


drift_monitor = DataDriftMonitor()


# ── Prediction Feedback Loop ──────────────────────────────────────────────────

class PredictionFeedbackStore:
    """Stores predictions and actual outcomes for retraining feedback."""

    def __init__(self, base_dir: Path):
        self.store_dir = base_dir / "feedback"
        self.store_dir.mkdir(parents=True, exist_ok=True)
        self.predictions: list[dict] = []
        self.feedback: list[dict] = []
        self._load_existing()

    def _load_existing(self):
        """Load existing feedback from disk."""
        feedback_file = self.store_dir / "feedback_log.jsonl"
        if feedback_file.exists():
            try:
                for line in feedback_file.read_text().strip().split("\n"):
                    if line:
                        self.feedback.append(json.loads(line))
            except Exception:
                pass
        predictions_file = self.store_dir / "predictions_log.jsonl"
        if predictions_file.exists():
            try:
                for line in predictions_file.read_text().strip().split("\n"):
                    if line:
                        self.predictions.append(json.loads(line))
            except Exception:
                pass

    def log_prediction(self, model: str, features: dict, prediction: dict):
        """Log a prediction for later feedback matching."""
        entry = {
            "id": hashlib.md5(f"{model}-{time.time()}-{json.dumps(features, sort_keys=True)}".encode()).hexdigest()[:12],
            "model": model,
            "features": features,
            "prediction": prediction,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "feedback_received": False,
        }
        self.predictions.append(entry)
        # Append to disk (JSONL)
        with open(self.store_dir / "predictions_log.jsonl", "a") as f:
            f.write(json.dumps(entry) + "\n")
        # Keep last 10000 predictions in memory
        if len(self.predictions) > 10000:
            self.predictions = self.predictions[-10000:]
        return entry["id"]

    def add_feedback(self, prediction_id: str, actual_outcome: dict):
        """Add actual outcome for a previous prediction."""
        entry = {
            "prediction_id": prediction_id,
            "actual_outcome": actual_outcome,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self.feedback.append(entry)
        with open(self.store_dir / "feedback_log.jsonl", "a") as f:
            f.write(json.dumps(entry) + "\n")
        # Mark prediction as having feedback
        for pred in reversed(self.predictions):
            if pred["id"] == prediction_id:
                pred["feedback_received"] = True
                break
        return entry

    def get_feedback_pairs(self, model: str, limit: int = 1000) -> list[dict]:
        """Get prediction-feedback pairs for retraining."""
        feedback_map = {f["prediction_id"]: f for f in self.feedback}
        pairs = []
        for pred in self.predictions:
            if pred["model"] == model and pred["id"] in feedback_map:
                pairs.append({
                    "features": pred["features"],
                    "predicted": pred["prediction"],
                    "actual": feedback_map[pred["id"]]["actual_outcome"],
                    "timestamp": pred["timestamp"],
                })
        return pairs[-limit:]

    def stats(self) -> dict:
        total_predictions = len(self.predictions)
        total_feedback = len(self.feedback)
        models = {}
        for p in self.predictions:
            m = p["model"]
            if m not in models:
                models[m] = {"predictions": 0, "with_feedback": 0}
            models[m]["predictions"] += 1
            if p.get("feedback_received"):
                models[m]["with_feedback"] += 1
        return {
            "total_predictions": total_predictions,
            "total_feedback": total_feedback,
            "feedback_rate": round(total_feedback / max(total_predictions, 1) * 100, 1),
            "models": models,
        }


feedback_store = PredictionFeedbackStore(MODEL_DIR)


# ── Champion/Challenger Model Promotion ───────────────────────────────────────

class ChampionChallenger:
    """Manages model versioning with champion/challenger promotion."""

    def __init__(self):
        self.champions: dict[str, dict] = {}
        self.promotion_history: list[dict] = []

    def set_champion(self, model_name: str, version: str, metrics: dict):
        """Register the current champion model."""
        self.champions[model_name] = {
            "version": version,
            "metrics": metrics,
            "promoted_at": datetime.now(timezone.utc).isoformat(),
        }

    def evaluate_challenger(self, model_name: str, challenger_version: str,
                           challenger_metrics: dict, primary_metric: str = "accuracy") -> dict:
        """Compare challenger against champion. Promote if better."""
        champion = self.champions.get(model_name)
        if champion is None:
            # No champion — auto-promote
            self.set_champion(model_name, challenger_version, challenger_metrics)
            event = {
                "model": model_name,
                "action": "auto_promoted",
                "challenger_version": challenger_version,
                "reason": "no_existing_champion",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            self.promotion_history.append(event)
            return event

        champion_score = champion["metrics"].get(primary_metric, 0)
        challenger_score = challenger_metrics.get(primary_metric, 0)
        improvement = challenger_score - champion_score

        if improvement >= CHAMPION_IMPROVEMENT_THRESHOLD:
            old_version = champion["version"]
            self.set_champion(model_name, challenger_version, challenger_metrics)
            event = {
                "model": model_name,
                "action": "promoted",
                "old_champion": old_version,
                "new_champion": challenger_version,
                "old_score": round(champion_score, 4),
                "new_score": round(challenger_score, 4),
                "improvement": round(improvement, 4),
                "metric": primary_metric,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            self.promotion_history.append(event)
            log.info(f"Champion promoted: {model_name} v{old_version}→v{challenger_version} "
                     f"({primary_metric}: {champion_score:.4f}→{challenger_score:.4f})")
            return event
        else:
            event = {
                "model": model_name,
                "action": "rejected",
                "champion_version": champion["version"],
                "challenger_version": challenger_version,
                "champion_score": round(champion_score, 4),
                "challenger_score": round(challenger_score, 4),
                "improvement": round(improvement, 4),
                "threshold": CHAMPION_IMPROVEMENT_THRESHOLD,
                "metric": primary_metric,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            self.promotion_history.append(event)
            log.info(f"Challenger rejected: {model_name} v{challenger_version} "
                     f"({primary_metric}: {challenger_score:.4f} vs champion {champion_score:.4f})")
            return event

    def get_champion(self, model_name: str) -> Optional[dict]:
        return self.champions.get(model_name)

    def list_champions(self) -> dict:
        return dict(self.champions)

    def get_history(self) -> list[dict]:
        return self.promotion_history


champion_challenger = ChampionChallenger()


# ── Retraining Event Log ──────────────────────────────────────────────────────

class RetrainingEventLog:
    """Tracks all retraining events with before/after metrics."""

    def __init__(self, base_dir: Path):
        self.log_dir = base_dir / "retraining_events"
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.events: list[dict] = []

    def log_event(self, trigger: str, models_retrained: list[str],
                  before_metrics: dict, after_metrics: dict,
                  duration_seconds: float, drift_info: Optional[dict] = None) -> dict:
        event = {
            "id": hashlib.md5(f"retrain-{time.time()}".encode()).hexdigest()[:12],
            "trigger": trigger,
            "models_retrained": models_retrained,
            "before_metrics": before_metrics,
            "after_metrics": after_metrics,
            "duration_seconds": round(duration_seconds, 2),
            "drift_info": drift_info,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self.events.append(event)
        # Persist to disk
        event_file = self.log_dir / f"{event['id']}.json"
        event_file.write_text(json.dumps(event, indent=2))
        log.info(f"Retraining event {event['id']}: trigger={trigger}, "
                 f"models={models_retrained}, duration={duration_seconds:.1f}s")
        return event

    def list_events(self, limit: int = 50) -> list[dict]:
        return self.events[-limit:]

    def stats(self) -> dict:
        if not self.events:
            return {"total_events": 0, "triggers": {}}
        triggers: dict[str, int] = {}
        for e in self.events:
            t = e["trigger"]
            triggers[t] = triggers.get(t, 0) + 1
        return {
            "total_events": len(self.events),
            "triggers": triggers,
            "last_retrain": self.events[-1]["timestamp"] if self.events else None,
            "avg_duration": round(sum(e["duration_seconds"] for e in self.events) / len(self.events), 2),
        }


retrain_log = RetrainingEventLog(MODEL_DIR)


# ── Continuous Training Orchestrator ──────────────────────────────────────────

class ContinuousTrainingOrchestrator:
    """Orchestrates the full continuous training pipeline."""

    def __init__(self):
        self.running = False
        self._thread: Optional[threading.Thread] = None
        self.last_train_time: Optional[float] = None
        self.last_drift_check: Optional[float] = None
        self.retrain_count = 0
        self.config = {
            "retrain_interval": RETRAIN_INTERVAL_SECONDS,
            "drift_check_interval": DRIFT_CHECK_INTERVAL,
            "drift_threshold_ks": DRIFT_THRESHOLD_KS,
            "drift_threshold_psi": DRIFT_THRESHOLD_PSI,
            "champion_threshold": CHAMPION_IMPROVEMENT_THRESHOLD,
            "auto_lakehouse_sync": True,
            "warm_start_pytorch": True,
        }

    def _collect_current_metrics(self) -> dict:
        """Collect current model metrics for before/after comparison."""
        metrics = {}
        if _xgb_metrics:
            metrics["xgboost_breach"] = {
                "accuracy": _xgb_metrics.get("accuracy", 0),
                "cv_accuracy": _xgb_metrics.get("cv_accuracy", 0),
            }
        if _ae_metrics:
            metrics["autoencoder_anomaly"] = {
                "train_loss_final": _ae_metrics.get("train_loss_final", 0),
            }
        if _lstm_metrics:
            metrics["lstm_violation"] = {
                "test_mae": _lstm_metrics.get("test_mae", 0),
                "test_mse": _lstm_metrics.get("test_mse", 0),
            }
        if _gnn_metrics:
            metrics["graphsage_gnn"] = {
                "test_accuracy": _gnn_metrics.get("test_accuracy", 0),
                "test_loss": _gnn_metrics.get("test_loss", 0),
            }
        return metrics

    def _run_retrain_cycle(self, trigger: str, drift_info: Optional[dict] = None):
        """Execute a full retraining cycle with champion/challenger."""
        log.info(f"Starting retrain cycle (trigger={trigger})...")
        before_metrics = self._collect_current_metrics()
        t0 = time.time()

        # Step 1: Lakehouse sync (refresh Parquet from DB)
        if self.config["auto_lakehouse_sync"]:
            try:
                lakehouse_etl()
                log.info("Lakehouse ETL sync completed before retraining")
            except Exception as e:
                log.warning(f"Lakehouse sync failed (non-fatal): {e}")

        # Step 2: Extract latest features and set drift baseline
        X, y, org_ids, feature_names = extract_features_from_db()
        if X.size > 0:
            drift_monitor.set_baseline(X, feature_names)

        # Step 3: Train all models
        train_result = train_all_local()

        # Step 4: Champion/Challenger evaluation for each model
        promotion_results = {}
        if train_result.get("status") == "completed":
            model_results = train_result.get("models", {})

            # XGBoost
            if "xgboost_breach" in model_results:
                xgb_result = model_results["xgboost_breach"]
                promotion_results["xgboost_breach"] = champion_challenger.evaluate_challenger(
                    "xgboost_breach",
                    xgb_result.get("version", "unknown"),
                    xgb_result,
                    primary_metric="accuracy",
                )

            # Autoencoder — use negative loss as metric (lower loss = better)
            if "autoencoder_anomaly" in model_results:
                ae_result = model_results["autoencoder_anomaly"]
                ae_eval_metrics = dict(ae_result)
                ae_eval_metrics["accuracy"] = 1.0 - min(ae_result.get("train_loss_final", 1.0), 1.0)
                promotion_results["autoencoder_anomaly"] = champion_challenger.evaluate_challenger(
                    "autoencoder_anomaly",
                    ae_result.get("version", "unknown"),
                    ae_eval_metrics,
                    primary_metric="accuracy",
                )

            # LSTM — use negative MAE as metric (lower MAE = better)
            if "lstm_violation" in model_results:
                lstm_result = model_results["lstm_violation"]
                lstm_eval_metrics = dict(lstm_result)
                lstm_eval_metrics["accuracy"] = max(0, 1.0 - lstm_result.get("test_mae", 1.0))
                promotion_results["lstm_violation"] = champion_challenger.evaluate_challenger(
                    "lstm_violation",
                    lstm_result.get("version", "unknown"),
                    lstm_eval_metrics,
                    primary_metric="accuracy",
                )

            # GNN
            if "graphsage_gnn" in model_results:
                gnn_result = model_results["graphsage_gnn"]
                gnn_eval_metrics = dict(gnn_result)
                gnn_eval_metrics["accuracy"] = gnn_result.get("test_accuracy", 0)
                promotion_results["graphsage_gnn"] = champion_challenger.evaluate_challenger(
                    "graphsage_gnn",
                    gnn_result.get("version", "unknown"),
                    gnn_eval_metrics,
                    primary_metric="accuracy",
                )

        duration = time.time() - t0
        after_metrics = self._collect_current_metrics()

        # Step 5: Log the retraining event
        retrain_log.log_event(
            trigger=trigger,
            models_retrained=list(train_result.get("models", {}).keys()),
            before_metrics=before_metrics,
            after_metrics=after_metrics,
            duration_seconds=duration,
            drift_info=drift_info,
        )

        self.last_train_time = time.time()
        self.retrain_count += 1

        return {
            "trigger": trigger,
            "training": train_result,
            "promotions": promotion_results,
            "before_metrics": before_metrics,
            "after_metrics": after_metrics,
            "duration_seconds": round(duration, 2),
        }

    def _background_loop(self):
        """Background thread for scheduled drift checks and retraining."""
        log.info(f"Continuous training started: retrain every {self.config['retrain_interval']}s, "
                 f"drift check every {self.config['drift_check_interval']}s")
        while self.running:
            try:
                now = time.time()

                # Drift check
                if (self.last_drift_check is None or
                        now - self.last_drift_check >= self.config["drift_check_interval"]):
                    X, y, org_ids, feature_names = extract_features_from_db()
                    if X.size > 0 and drift_monitor._baseline_data is not None:
                        drift_result = drift_monitor.check_drift(X, feature_names)
                        self.last_drift_check = now
                        if drift_result.get("drifted"):
                            log.warning(f"Drift detected — triggering retraining")
                            self._run_retrain_cycle("drift_detected", drift_info=drift_result)
                            continue

                # Scheduled retrain
                if (self.last_train_time is None or
                        now - self.last_train_time >= self.config["retrain_interval"]):
                    self._run_retrain_cycle("scheduled")

            except Exception as e:
                log.error(f"Continuous training error: {e}")

            # Sleep in small increments so we can stop quickly
            for _ in range(60):
                if not self.running:
                    break
                time.sleep(1)

        log.info("Continuous training stopped")

    def start(self):
        """Start the continuous training background thread."""
        if self.running:
            return {"status": "already_running"}
        self.running = True
        self._thread = threading.Thread(target=self._background_loop, daemon=True, name="continuous-trainer")
        self._thread.start()
        return {"status": "started", "config": self.config}

    def stop(self):
        """Stop the continuous training background thread."""
        if not self.running:
            return {"status": "not_running"}
        self.running = False
        if self._thread:
            self._thread.join(timeout=5)
        return {"status": "stopped"}

    def trigger_retrain(self, reason: str = "manual") -> dict:
        """Manually trigger a retrain cycle."""
        return self._run_retrain_cycle(reason)

    def status(self) -> dict:
        return {
            "running": self.running,
            "config": self.config,
            "last_train_time": datetime.fromtimestamp(self.last_train_time, tz=timezone.utc).isoformat()
                if self.last_train_time else None,
            "last_drift_check": datetime.fromtimestamp(self.last_drift_check, tz=timezone.utc).isoformat()
                if self.last_drift_check else None,
            "retrain_count": self.retrain_count,
            "drift_monitor": {
                "has_baseline": drift_monitor._baseline_data is not None,
                "baseline_samples": len(drift_monitor._baseline_data) if drift_monitor._baseline_data is not None else 0,
                "drift_checks": len(drift_monitor.drift_history),
                "last_check": drift_monitor.drift_history[-1] if drift_monitor.drift_history else None,
            },
            "feedback": feedback_store.stats(),
            "champions": champion_challenger.list_champions(),
            "retrain_events": retrain_log.stats(),
        }

    def update_config(self, **kwargs) -> dict:
        """Update continuous training configuration."""
        for k, v in kwargs.items():
            if k in self.config:
                self.config[k] = v
        return self.config


continuous_trainer = ContinuousTrainingOrchestrator()


# ══════════════════════════════════════════════════════════════════════════════
# API ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

class TrainRequest(BaseModel):
    models: list[str] = ["all"]
    use_ray: bool = True

class PredictRequest(BaseModel):
    org_features: dict = {}

class LinkPredictRequest(BaseModel):
    source: str
    target: str

class BuildGraphRequest(BaseModel):
    source: str = "database"


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "worker": "ray_ml_engine",
        "version": "5.0.0",
        "has_pytorch": True,
        "pytorch_version": torch.__version__,
        "has_ray": HAS_RAY,
        "ray_version": ray.__version__ if HAS_RAY else None,
        "ray_initialized": _ray_initialized,
        "has_sklearn": HAS_SKLEARN,
        "has_xgboost": HAS_XGB,
        "has_shap": HAS_SHAP,
        "has_duckdb": HAS_DUCKDB,
        "has_postgresql": HAS_PG,
        "has_scipy": True,
        "device": str(DEVICE),
        "models_registered": list(registry.list_models().keys()),
        "experiments": len(tracker.experiments),
        "graph_nodes": len(_graph.nodes),
        "graph_embeddings": len(_graph.embeddings),
        "continuous_training": {
            "running": continuous_trainer.running,
            "retrain_count": continuous_trainer.retrain_count,
            "drift_baseline_set": drift_monitor._baseline_data is not None,
            "feedback_predictions": len(feedback_store.predictions),
            "champions": len(champion_challenger.champions),
            "retrain_events": len(retrain_log.events),
        },
    }


@app.post("/train")
def api_train(req: TrainRequest):
    """Train all or specific models."""
    if "all" in req.models:
        if req.use_ray:
            return ray_train_all()
        return train_all_local()

    results = {}
    if "gnn" in req.models or "graphsage" in req.models:
        build_graph_from_db()
        results["graphsage_gnn"] = train_gnn()
    if "lstm" in req.models:
        results["lstm_violation"] = train_lstm()
    if "autoencoder" in req.models or "anomaly" in req.models:
        results["autoencoder_anomaly"] = train_autoencoder()
    if "xgboost" in req.models or "breach" in req.models:
        results["xgboost_breach"] = train_xgboost()
    return {"models": results}


@app.post("/graph/build")
def api_build_graph(req: BuildGraphRequest):
    """Build compliance graph and train GNN."""
    if req.source == "database":
        build_graph_from_db()
    else:
        build_synthetic_graph()

    gnn_result = train_gnn()
    return {
        "graph": _graph.stats(),
        "training_metrics": gnn_result,
    }


@app.post("/predict/breach")
def api_predict_breach(req: PredictRequest):
    """Predict breach risk using XGBoost + SHAP."""
    if _xgb_model is None or _xgb_scaler is None:
        raise HTTPException(400, "XGBoost not trained. Call /train first.")

    features = np.zeros((1, len(FEATURE_COLUMNS)), dtype=np.float32)
    for i, name in enumerate(FEATURE_COLUMNS):
        features[0, i] = float(req.org_features.get(name, 0))

    features_scaled = _xgb_scaler.transform(features)
    prob = _xgb_model.predict_proba(features_scaled)[0]
    prediction = int(_xgb_model.predict(features_scaled)[0])

    result = {
        "at_risk": bool(prediction),
        "probability": round(float(prob[1]) if len(prob) > 1 else float(prob[0]), 4),
        "model": "xgboost_breach",
        "model_version": _xgb_metrics.get("version", "unknown"),
    }

    if _xgb_explainer:
        try:
            sv = _xgb_explainer.shap_values(features_scaled)
            shap_vals = sv[1][0] if isinstance(sv, list) and len(sv) > 1 else (sv[0][0] if isinstance(sv, list) else sv[0])
            result["shap_values"] = dict(zip(FEATURE_COLUMNS, [round(float(x), 4) for x in shap_vals]))
        except Exception:
            pass

    # Log prediction for feedback loop
    feedback_store.log_prediction("xgboost_breach", req.org_features, result)

    return result


@app.post("/predict/anomaly")
def api_detect_anomaly(req: PredictRequest):
    """Detect anomalies using trained autoencoder."""
    if _autoencoder is None or _ae_scaler is None:
        raise HTTPException(400, "Autoencoder not trained. Call /train first.")

    features = np.zeros((1, len(FEATURE_COLUMNS)), dtype=np.float32)
    for i, name in enumerate(FEATURE_COLUMNS):
        features[0, i] = float(req.org_features.get(name, 0))

    features_scaled = _ae_scaler.transform(features)
    feat_tensor = torch.tensor(features_scaled, dtype=torch.float32).to(DEVICE)

    _autoencoder.eval()
    with torch.no_grad():
        reconstructed, latent = _autoencoder(feat_tensor)
        reconstruction_error = float(torch.mean((reconstructed - feat_tensor) ** 2).item())
        is_anomaly = reconstruction_error > _ae_threshold

    result = {
        "is_anomaly": is_anomaly,
        "anomaly_score": round(reconstruction_error, 6),
        "threshold": round(_ae_threshold, 6),
        "latent_representation": latent.squeeze(0).tolist(),
        "model": "autoencoder_anomaly",
        "model_version": _ae_metrics.get("version", "unknown"),
    }
    feedback_store.log_prediction("autoencoder_anomaly", req.org_features, result)
    return result


@app.post("/predict/violations")
def api_predict_violations():
    """Forecast violations using LSTM."""
    if _lstm_model is None:
        raise HTTPException(400, "LSTM not trained. Call /train first.")
    return {
        "model": "lstm_violation",
        "forecasts": _lstm_metrics.get("forecasts", []),
        "model_version": _lstm_metrics.get("version", "unknown"),
        "test_mse": _lstm_metrics.get("test_mse"),
        "test_mae": _lstm_metrics.get("test_mae"),
    }


@app.post("/predict/link")
def api_predict_link(req: LinkPredictRequest):
    """Predict link between two graph nodes."""
    if _gnn_model is None or _link_predictor_model is None:
        raise HTTPException(400, "GNN not trained. Call /graph/build first.")

    if req.source not in _graph.embeddings or req.target not in _graph.embeddings:
        raise HTTPException(404, f"Node embeddings not found for {req.source} or {req.target}")

    src_emb = torch.tensor(_graph.embeddings[req.source], dtype=torch.float32).unsqueeze(0).to(DEVICE)
    dst_emb = torch.tensor(_graph.embeddings[req.target], dtype=torch.float32).unsqueeze(0).to(DEVICE)

    _link_predictor_model.eval()
    with torch.no_grad():
        prob = float(_link_predictor_model(src_emb, dst_emb).item())

    return {
        "source": req.source,
        "target": req.target,
        "link_predicted": prob > 0.5,
        "probability": round(prob, 4),
        "model": "graphsage_link_predictor",
    }


@app.get("/embeddings/all")
def api_embeddings():
    """Export all GNN embeddings."""
    return {
        "embeddings": {nid: emb.tolist() for nid, emb in _graph.embeddings.items()},
        "count": len(_graph.embeddings),
        "embedding_dim": EMBEDDING_DIM,
        "model": "graphsage_gnn",
    }


@app.get("/models")
def api_list_models():
    """List all registered models."""
    return registry.list_models()


@app.get("/experiments")
def api_experiments():
    """List all experiments."""
    return {"experiments": tracker.list_experiments()}


@app.post("/lakehouse/etl")
def api_lakehouse_etl():
    """Run Lakehouse ETL pipeline."""
    return lakehouse_etl()


@app.get("/lakehouse/features")
def api_lakehouse_features():
    """Get features from Lakehouse."""
    return lakehouse_features()


@app.get("/lakehouse/views")
def api_lakehouse_views():
    """Get materialized views from Lakehouse."""
    return lakehouse_materialized_views()


@app.get("/ray/status")
def api_ray_status():
    """Get Ray cluster status."""
    if not HAS_RAY:
        return {"status": "ray_not_installed"}
    if not _ray_initialized:
        return {"status": "not_initialized"}
    try:
        return {
            "status": "running",
            "cluster_resources": ray.cluster_resources(),
            "available_resources": ray.available_resources(),
            "nodes": len(ray.nodes()),
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.get("/pipeline/status")
def api_pipeline_status():
    """Full ML pipeline status."""
    models = registry.list_models()
    return {
        "models": models,
        "total_models": len(models),
        "total_experiments": len(tracker.experiments),
        "graph": _graph.stats(),
        "ray_initialized": _ray_initialized,
        "pytorch_version": torch.__version__,
        "device": str(DEVICE),
        "lakehouse": {
            "parquet_dir": str(PARQUET_DIR),
            "has_duckdb": HAS_DUCKDB,
            "parquet_files": len(list(PARQUET_DIR.glob("*.parquet"))),
        },
        "continuous_training": continuous_trainer.status(),
    }


# ══════════════════════════════════════════════════════════════════════════════
# CONTINUOUS TRAINING API ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

class FeedbackRequest(BaseModel):
    prediction_id: str
    actual_outcome: dict

class ContinuousTrainConfigRequest(BaseModel):
    retrain_interval: Optional[int] = None
    drift_check_interval: Optional[int] = None
    drift_threshold_ks: Optional[float] = None
    drift_threshold_psi: Optional[float] = None
    champion_threshold: Optional[float] = None
    auto_lakehouse_sync: Optional[bool] = None
    warm_start_pytorch: Optional[bool] = None


@app.post("/continuous/start")
def api_continuous_start():
    """Start continuous training pipeline."""
    return continuous_trainer.start()


@app.post("/continuous/stop")
def api_continuous_stop():
    """Stop continuous training pipeline."""
    return continuous_trainer.stop()


@app.get("/continuous/status")
def api_continuous_status():
    """Get continuous training pipeline status."""
    return continuous_trainer.status()


@app.post("/continuous/trigger")
def api_continuous_trigger():
    """Manually trigger a retraining cycle."""
    return continuous_trainer.trigger_retrain("manual_api")


@app.post("/continuous/config")
def api_continuous_config(req: ContinuousTrainConfigRequest):
    """Update continuous training configuration."""
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    return continuous_trainer.update_config(**updates)


@app.get("/drift/report")
def api_drift_report():
    """Get latest drift detection report."""
    X, y, org_ids, feature_names = extract_features_from_db()
    if X.size == 0:
        return {"error": "no_data", "message": "No features to check drift against"}
    if drift_monitor._baseline_data is None:
        drift_monitor.set_baseline(X, feature_names)
        return {"status": "baseline_set", "samples": len(X), "features": len(feature_names)}
    return drift_monitor.check_drift(X, feature_names)


@app.get("/drift/history")
def api_drift_history():
    """Get drift check history."""
    return {
        "history": drift_monitor.drift_history,
        "total_checks": len(drift_monitor.drift_history),
        "baseline_set": drift_monitor._baseline_data is not None,
    }


@app.post("/feedback/ingest")
def api_feedback_ingest(req: FeedbackRequest):
    """Ingest actual outcome feedback for a previous prediction."""
    entry = feedback_store.add_feedback(req.prediction_id, req.actual_outcome)
    return {"status": "ingested", "feedback": entry}


@app.get("/feedback/stats")
def api_feedback_stats():
    """Get prediction feedback statistics."""
    return feedback_store.stats()


@app.get("/feedback/pairs/{model_name}")
def api_feedback_pairs(model_name: str):
    """Get feedback pairs for a model (for retraining)."""
    pairs = feedback_store.get_feedback_pairs(model_name)
    return {"model": model_name, "pairs": pairs, "count": len(pairs)}


@app.get("/champion/info")
def api_champion_info():
    """Get current champion models."""
    return {
        "champions": champion_challenger.list_champions(),
        "promotion_history": champion_challenger.get_history(),
    }


@app.get("/champion/{model_name}")
def api_champion_model(model_name: str):
    """Get champion info for a specific model."""
    champion = champion_challenger.get_champion(model_name)
    if not champion:
        raise HTTPException(404, f"No champion registered for {model_name}")
    return champion


@app.get("/retrain/events")
def api_retrain_events():
    """Get retraining event history."""
    return {
        "events": retrain_log.list_events(),
        "stats": retrain_log.stats(),
    }


@app.get("/retrain/status")
def api_retrain_status():
    """Get current retraining status."""
    return {
        "continuous_running": continuous_trainer.running,
        "last_train_time": datetime.fromtimestamp(continuous_trainer.last_train_time, tz=timezone.utc).isoformat()
            if continuous_trainer.last_train_time else None,
        "retrain_count": continuous_trainer.retrain_count,
        "next_scheduled": datetime.fromtimestamp(
            continuous_trainer.last_train_time + continuous_trainer.config["retrain_interval"],
            tz=timezone.utc
        ).isoformat() if continuous_trainer.last_train_time else None,
        "config": continuous_trainer.config,
        "event_stats": retrain_log.stats(),
    }


# ── Graceful Shutdown ─────────────────────────────────────────────────────────
import signal as _signal
import atexit

_shutdown_requested = False

def _graceful_shutdown(signum, frame):
    global _shutdown_requested
    sig_name = _signal.Signals(signum).name
    log.info(f"[Shutdown] Received {sig_name} — shutting down gracefully")
    _shutdown_requested = True
    # Stop continuous training if running
    if continuous_trainer.running:
        continuous_trainer.stop()
        log.info("[Shutdown] Continuous training stopped")
    # Save all model weights before exit
    try:
        for name, model in [("gnn", gnn_model), ("lstm", lstm_model), ("autoencoder", ae_model)]:
            if model is not None and hasattr(model, "state_dict"):
                path = MODEL_DIR / f"{name}_final.pt"
                torch.save(model.state_dict(), path)
                log.info(f"[Shutdown] Saved {name} weights to {path}")
    except Exception as e:
        log.warning(f"[Shutdown] Error saving models: {e}")
    log.info("[Shutdown] Graceful shutdown complete")

_signal.signal(_signal.SIGTERM, _graceful_shutdown)
_signal.signal(_signal.SIGINT, _graceful_shutdown)

@atexit.register
def _cleanup():
    if continuous_trainer.running:
        continuous_trainer.stop()

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    log.info(f"Starting NDSEP Ray ML/DL/GNN Engine on port {PORT}")
    log.info(f"  PyTorch={torch.__version__}, Ray={HAS_RAY}, sklearn={HAS_SKLEARN}, "
             f"XGBoost={HAS_XGB}, SHAP={HAS_SHAP}, DuckDB={HAS_DUCKDB}, PostgreSQL={HAS_PG}")
    log.info(f"  Device={DEVICE}, Models dir={MODEL_DIR}")
    log.info(f"  Continuous Training: interval={RETRAIN_INTERVAL_SECONDS}s, "
             f"drift_ks={DRIFT_THRESHOLD_KS}, drift_psi={DRIFT_THRESHOLD_PSI}")

    # Initialize Ray
    if HAS_RAY:
        init_ray()

    # Auto-start continuous training if enabled
    if os.environ.get("CONTINUOUS_TRAINING_ENABLED", "false").lower() == "true":
        continuous_trainer.start()
        log.info("Continuous training auto-started")

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
