"""Canonical training-graph source for the NDSEP GNN.

``load_training_graph()`` resolves the compliance graph in this order:

    1. Neo4j          — live graph store (ml/graph/neo4j_store.py), when the
                        driver is installed and the store is reachable and
                        non-empty.
    2. Lakehouse      — latest graph_nodes / graph_edges / graph_labels
                        snapshots (ml/training/lakehouse.py load_latest).
    3. Synthetic      — freshly generated in-memory graph
                        (ml/data/generate_synthetic.py), same seed defaults
                        as training.

Returns ``(nodes_df, edges_df, labels_df, source)`` where the frames match
the exact shapes ml/training/train.py's train_gnn() consumes and ``source``
is a provenance string (``neo4j:...`` / ``lakehouse:...`` / ``synthetic:...``).

Force a source with the NDSEP_GRAPH_SOURCE env var or the ``source=``
argument ("neo4j" | "lakehouse" | "synthetic" | "auto").

NOTE for train.py: train_gnn() currently calls get_dataset() directly.
To adopt this canonical source, replace the three get_dataset() calls in
ml/training/train.py::train_gnn with:

    from ml.graph.graph_source import load_training_graph
    nodes, edges, labels, src_n = load_training_graph()

(Kept as documentation only — train.py is owned by another workstream.)
"""

from __future__ import annotations

import logging
import os

import numpy as np

from ml.training import lakehouse

log = logging.getLogger(__name__)

GRAPH_DATASETS = ("graph_nodes", "graph_edges", "graph_labels")


def _from_neo4j(**conn):
    """Fetch from Neo4j; raises on any failure so the caller can fall back."""
    from ml.graph import neo4j_store
    if not neo4j_store.HAS_NEO4J:
        raise RuntimeError("neo4j driver not installed")
    nodes, edges, labels = neo4j_store.fetch_graph(**conn)
    if nodes.empty:
        raise RuntimeError("Neo4j compliance graph is empty "
                           "(run python -m ml.graph.sync_to_neo4j)")
    uri = conn.get("uri", neo4j_store.NEO4J_URI)
    return nodes, edges, labels, f"neo4j:{uri}"


def _from_lakehouse(root: str = lakehouse.DEFAULT_ROOT):
    frames = []
    snap_ids = []
    for ds in GRAPH_DATASETS:
        snaps = lakehouse.list_snapshots(ds, root=root)
        if not snaps:
            raise FileNotFoundError(
                f"No lakehouse snapshot for dataset '{ds}'")
        frames.append(lakehouse.load_latest(ds, root=root))
        snap_ids.append(snaps[-1]["snapshot_id"])
    return (*frames, f"lakehouse:{snap_ids[0]}")


def _from_synthetic(n_orgs: int = 800, seed: int = 42):
    from ml.data.generate_synthetic import (gen_credit, gen_graph,
                                            gen_organizations)
    rng = np.random.default_rng(seed)
    orgs = gen_organizations(rng, n_orgs)
    credit = gen_credit(rng, orgs)
    nodes, edges, labels = gen_graph(rng, orgs, credit)
    return nodes, edges, labels, f"synthetic:n_orgs={n_orgs},seed={seed}"


_RESOLVERS = {"neo4j": _from_neo4j,
              "lakehouse": _from_lakehouse,
              "synthetic": _from_synthetic}


def load_training_graph(source: str | None = None, n_orgs: int = 800,
                        seed: int = 42, lakehouse_root: str | None = None,
                        **neo4j_conn):
    """Resolve the training graph through the Neo4j → lakehouse → synthetic
    fallback chain. See module docstring for the contract."""
    source = (source or os.environ.get("NDSEP_GRAPH_SOURCE", "auto")).lower()
    errors: list[str] = []

    order = list(_RESOLVERS) if source == "auto" else [source]
    if source != "auto" and source not in _RESOLVERS:
        raise ValueError(f"Unknown graph source {source!r}; "
                         f"allowed: auto, {', '.join(_RESOLVERS)}")

    for name in order:
        try:
            if name == "neo4j":
                return _from_neo4j(**neo4j_conn)
            if name == "lakehouse":
                kw = {} if lakehouse_root is None \
                    else {"root": lakehouse_root}
                return _from_lakehouse(**kw)
            return _from_synthetic(n_orgs=n_orgs, seed=seed)
        except Exception as exc:  # fall through to the next source
            errors.append(f"{name}: {exc}")
            log.info("graph source '%s' unavailable (%s)", name, exc)

    raise RuntimeError(
        "No training graph source available — " + "; ".join(errors))
