"""Unit tests for the Neo4j graph integration (ml/graph/*).

The official neo4j driver is monkeypatched with a fake in-memory driver
that records every Cypher call, so tests verify Cypher shapes, batching,
idempotent MERGE usage, frame round-trips and the python analytics
(community detection, collusion rings) without a live Neo4j server.

    pytest ml/tests/test_neo4j_graph.py -v
"""

from __future__ import annotations

import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))  # repo root on path

from ml.graph import neo4j_store
from ml.graph.neo4j_store import (FEATURE_DIM, Neo4jGraphStore,
                                  Neo4jStoreError, edge_records,
                                  find_collusion_rings, label_propagation,
                                  node_records)


# --------------------------------------------------------------------------- #
# Fake neo4j driver
# --------------------------------------------------------------------------- #
class FakeResult:
    def __init__(self, records):
        self._records = records

    def __iter__(self):
        return iter(self._records)


class FakeSession:
    def __init__(self, driver):
        self.driver = driver

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def run(self, cypher, **params):
        self.driver.calls.append((cypher, params))
        return FakeResult(self.driver.respond(cypher, params))

    def execute_write(self, fn):
        return fn(self)  # the fake session doubles as the transaction


class FakeDriver:
    """Records (cypher, params) calls; `responder(cypher, params)` supplies
    read results and may raise to simulate failures (e.g. missing GDS)."""

    def __init__(self, responder=None):
        self.calls: list[tuple[str, dict]] = []
        self.responder = responder or (lambda _c, _p: [])
        self.closed = False

    def respond(self, cypher, params):
        return self.responder(cypher, params)

    def verify_connectivity(self):
        return True

    def session(self):
        return FakeSession(self)

    def close(self):
        self.closed = True


@pytest.fixture
def fake_driver(monkeypatch):
    driver = FakeDriver()
    monkeypatch.setattr(neo4j_store.GraphDatabase, "driver",
                        lambda *a, **k: driver)
    return driver


def make_nodes(n: int, node_type: str = "organization",
               ref_prefix: str = "ORG") -> pd.DataFrame:
    rows = {"node_id": list(range(n)),
            "ref_id": [f"{ref_prefix}-{i:05d}" for i in range(n)],
            "node_type": [node_type] * n}
    for j in range(FEATURE_DIM):
        rows[f"f{j}"] = [float(j) * 0.1] * n
    return pd.DataFrame(rows)


def make_edges(pairs, edge_type="HAS_VIOLATION"):
    return [{"src": s, "dst": d, "edge_type": t}
            for (s, d, t) in
            [(s, d, edge_type) for s, d in pairs]]


def write_calls(driver: FakeDriver, needle: str) -> list[tuple[str, dict]]:
    return [(c, p) for c, p in driver.calls if needle in c]


# --------------------------------------------------------------------------- #
# Driver absence / connection management
# --------------------------------------------------------------------------- #
def test_missing_driver_raises_meaningful_error(monkeypatch):
    monkeypatch.setattr(neo4j_store, "HAS_NEO4J", False)
    with pytest.raises(Neo4jStoreError, match="pip install neo4j"):
        Neo4jGraphStore()


def test_context_manager_connects_and_closes(fake_driver):
    with Neo4jGraphStore() as store:
        assert store._driver is fake_driver
        # schema constraints created on connect (one per node label)
        assert len(write_calls(fake_driver, "CREATE CONSTRAINT")) == 5
    assert fake_driver.closed


def test_unconnected_store_raises(fake_driver):
    store = Neo4jGraphStore()
    with pytest.raises(Neo4jStoreError, match="Not connected"):
        store.fetch_graph()


# --------------------------------------------------------------------------- #
# push_graph: Cypher shape + batching + idempotency
# --------------------------------------------------------------------------- #
def test_push_graph_batched_unwind_merge(fake_driver):
    nodes = make_nodes(2500)
    edges = make_edges([(i, i + 1) for i in range(1499)])
    labels = [{"node_id": i, "org_id": f"ORG-{i:05d}", "high_risk": i % 2,
               "risk_latent": float(i)} for i in range(10)]

    with Neo4jGraphStore(batch_size=1000) as store:
        summary = store.push_graph(nodes, edges, labels=labels)

    assert summary["nodes_merged"] == 2500
    assert summary["edges_merged"] == 1499
    assert summary["labels_merged"] == 10

    node_calls = write_calls(fake_driver, "MERGE (n:Organization")
    assert len(node_calls) == 3                      # 2500 / 1000 -> 3 batches
    assert [len(p["rows"]) for _c, p in node_calls] == [1000, 1000, 500]
    cypher = node_calls[0][0]
    assert "UNWIND $rows AS row" in cypher
    assert "{node_id: row.node_id}" in cypher        # MERGE key = node_id

    edge_calls = write_calls(fake_driver, "MERGE (a)-[r:HAS_VIOLATION]->(b)")
    assert len(edge_calls) == 2
    assert "UNWIND $rows AS row" in edge_calls[0][0]

    label_calls = write_calls(fake_driver, "SET n.org_id = row.org_id")
    assert len(label_calls) == 1
    assert "MATCH (n:Organization {node_id: row.node_id})" in \
        label_calls[0][0]


def test_push_graph_groups_nodes_by_label(fake_driver):
    nodes = pd.concat([
        make_nodes(3, "organization", "ORG"),
        make_nodes(2, "violation", "VIO").assign(node_id=[3, 4]),
    ], ignore_index=True)
    with Neo4jGraphStore() as store:
        summary = store.push_graph(nodes, [])
    assert summary["node_labels"] == {"Organization": 3, "Violation": 2}
    assert len(write_calls(fake_driver, "MERGE (n:Violation")) == 1


def test_push_graph_rejects_unknown_node_type(fake_driver):
    nodes = make_nodes(2).assign(node_type="hacker")
    with Neo4jGraphStore() as store:
        with pytest.raises(ValueError, match="Unknown node_type"):
            store.push_graph(nodes, [])


def test_edge_records_rejects_unknown_type():
    with pytest.raises(ValueError, match="Unknown edge_type"):
        edge_records([{"src": 1, "dst": 2, "edge_type": "PWNED"}])


def test_node_records_from_dicts_roundtrip():
    recs = node_records([{"node_id": 7, "ref_id": "ORG-7",
                          "node_type": "organization",
                          "f0": 1.0, "f1": 2.0}])
    assert recs[0]["features"] == [1.0, 2.0]
    assert recs[0]["node_id"] == 7


# --------------------------------------------------------------------------- #
# fetch_graph: rebuilds the training frames
# --------------------------------------------------------------------------- #
def test_fetch_graph_returns_training_frames(monkeypatch):
    def responder(cypher, _params):
        if "MATCH (n)" in cypher:
            return [
                {"node_id": 0, "ref_id": "ORG-00000",
                 "node_type": "organization",
                 "features": [0.1] * FEATURE_DIM,
                 "labels": ["Organization"], "org_id": "ORG-00000",
                 "high_risk": 1, "risk_latent": 3.5},
                {"node_id": 1, "ref_id": "VIO-000000",
                 "node_type": "violation",
                 "features": [0.2] * FEATURE_DIM,
                 "labels": ["Violation"], "org_id": None,
                 "high_risk": None, "risk_latent": None},
            ]
        if "MATCH (a)-[r]->(b)" in cypher:
            return [{"src": 0, "dst": 1, "edge_type": "HAS_VIOLATION"}]
        return []

    monkeypatch.setattr(neo4j_store.GraphDatabase, "driver",
                        lambda *a, **k: FakeDriver(responder))
    with Neo4jGraphStore() as store:
        nodes, edges, labels = store.fetch_graph()

    assert list(nodes["node_id"]) == [0, 1]
    assert [f"f{i}" for i in range(FEATURE_DIM)] \
        == [c for c in nodes.columns if c.startswith("f")]
    assert nodes.loc[0, "f0"] == pytest.approx(0.1)
    assert edges.iloc[0].to_dict() == {"src": 0, "dst": 1,
                                       "edge_type": "HAS_VIOLATION"}
    assert labels.to_dict("records") == [
        {"org_id": "ORG-00000", "node_id": 0, "high_risk": 1,
         "risk_latent": 3.5}]


# --------------------------------------------------------------------------- #
# neighbors / shortest_path Cypher shapes
# --------------------------------------------------------------------------- #
def test_neighbors_cypher_and_type_filter(fake_driver):
    with Neo4jGraphStore() as store:
        store.neighbors(5)
        store.neighbors(5, edge_type="has_violation", limit=10)
        with pytest.raises(ValueError, match="Unknown edge_type"):
            store.neighbors(5, edge_type="DROP DATABASE")

    cyphers = [c for c, _p in fake_driver.calls if "MATCH (n {node_id:" in c]
    assert cyphers[0].count("[r]-(m)") == 1
    assert "[r:HAS_VIOLATION]-(m)" in cyphers[1]     # normalised to upper
    assert fake_driver.calls[-1][1]["id"] == 5      # parameterised, not fmt


def test_shortest_path_found_and_missing(monkeypatch):
    def responder(cypher, params):
        if "shortestPath" in cypher:
            if params["a"] == 1:
                return [{"path": [1, 9, 4], "hops": 2}]
            return []
        return []

    monkeypatch.setattr(neo4j_store.GraphDatabase, "driver",
                        lambda *a, **k: FakeDriver(responder))
    with Neo4jGraphStore() as store:
        assert store.shortest_path(1, 4) == {"found": True,
                                             "path": [1, 9, 4], "hops": 2}
        miss = store.shortest_path(2, 4)
        assert miss["found"] is False and miss["path"] == []


# --------------------------------------------------------------------------- #
# Communities: GDS failure -> deterministic python label propagation
# --------------------------------------------------------------------------- #
def test_detect_communities_python_fallback(monkeypatch):
    edges = [(0, 1), (1, 2), (0, 2), (3, 4), (4, 5), (3, 5)]

    def responder(cypher, _params):
        if "gds.labelPropagation" in cypher:
            raise RuntimeError("There is no procedure with the name "
                               "`gds.labelPropagation.stream`")
        if "MATCH (a)-[r]->(b)" in cypher:
            return [{"src": s, "dst": d} for s, d in edges]
        return []

    monkeypatch.setattr(neo4j_store.GraphDatabase, "driver",
                        lambda *a, **k: FakeDriver(responder))
    with Neo4jGraphStore() as store:
        result = store.detect_communities()

    assert result["algorithm"] == "python.label_propagation"
    assert result["n_communities"] == 2
    comm = result["communities"]
    assert comm[0] == comm[1] == comm[2]
    assert comm[3] == comm[4] == comm[5]
    assert comm[0] != comm[3]


def test_label_propagation_pure():
    # two disjoint triangles + one isolated node
    assignment = label_propagation(7, [(0, 1), (1, 2), (0, 2),
                                       (3, 4), (4, 5), (3, 5)])
    assert len(set(assignment.values())) == 3       # 2 triangles + isolate
    assert assignment[0] == assignment[1] == assignment[2]
    assert assignment[3] == assignment[4] == assignment[5]


# --------------------------------------------------------------------------- #
# Collusion rings (pure python post-processing)
# --------------------------------------------------------------------------- #
def test_find_collusion_rings():
    pairs = []
    # dense officer-sharing clique among orgs 0..3
    for a in range(4):
        for b in range(a + 1, 4):
            pairs.append({"a": a, "b": b, "officer_links": 1,
                          "direct_links": 0})
    # weak direct-only link -> below min_weight
    pairs.append({"a": 4, "b": 5, "officer_links": 0, "direct_links": 1})
    # strong but only a pair -> below min_size
    pairs.append({"a": 6, "b": 7, "officer_links": 1, "direct_links": 0})

    rings = find_collusion_rings(pairs, min_size=3, min_weight=2.0,
                                 enforced_orgs={1, 2})
    assert len(rings) == 1
    ring = rings[0]
    assert ring["members"] == [0, 1, 2, 3]
    assert ring["size"] == 4
    assert ring["internal_edges"] == 6
    assert ring["density"] == pytest.approx(1.0)
    assert ring["enforcement_hits"] == 2
    assert ring["shared_officer_links"] == 12       # 6 pairs x 2 endpoints


def test_find_collusion_rings_empty_when_weak():
    pairs = [{"a": 0, "b": 1, "officer_links": 0, "direct_links": 1},
             {"a": 1, "b": 2, "officer_links": 0, "direct_links": 1}]
    assert find_collusion_rings(pairs, min_size=3, min_weight=2.0) == []


def test_collusion_rings_cypher_uses_org_signals(monkeypatch):
    captured = []

    def responder(cypher, _params):
        captured.append(cypher)
        if "EMPLOYS" in cypher:
            return [{"a": 0, "b": 1, "officer_links": 2}]
        if "TRANSACTS_WITH" in cypher:
            return [{"a": 0, "b": 1, "direct_links": 1},
                    {"a": 1, "b": 2, "direct_links": 2}]
        if "ENFORCED_BY" in cypher:
            return [{"node_id": 1}]
        return []

    monkeypatch.setattr(neo4j_store.GraphDatabase, "driver",
                        lambda *a, **k: FakeDriver(responder))
    with Neo4jGraphStore() as store:
        result = store.collusion_rings(min_size=2)

    joined = "\n".join(captured)
    assert "MATCH (a:Organization)-[:EMPLOYS]->(oa:Officer)" in joined
    assert "TRANSACTS_WITH|:SECTOR_PEER" in joined
    assert result["n_rings"] == 1
    ring = result["rings"][0]
    assert ring["members"] == [0, 1, 2]
    assert ring["enforcement_hits"] == 1


# --------------------------------------------------------------------------- #
# graph_source fallback chain
# --------------------------------------------------------------------------- #
def test_graph_source_synthetic_fallback(monkeypatch, tmp_path):
    from ml.graph import graph_source

    def boom(**_kw):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(graph_source, "_from_neo4j", boom)
    nodes, edges, labels, src = graph_source.load_training_graph(
        lakehouse_root=str(tmp_path), n_orgs=40, seed=7)
    assert src.startswith("synthetic:")
    assert {"node_id", "ref_id", "node_type"} <= set(nodes.columns)
    assert {"src", "dst", "edge_type"} <= set(edges.columns)
    assert {"org_id", "node_id", "high_risk"} <= set(labels.columns)
    assert len(labels) == 40


def test_graph_source_lakehouse_snapshot(tmp_path):
    from ml.graph import graph_source
    from ml.training import lakehouse

    nodes, edges, labels, _ = graph_source._from_synthetic(n_orgs=40, seed=3)
    root = str(tmp_path)
    lakehouse.save_snapshot(nodes, "graph_nodes", root=root)
    lakehouse.save_snapshot(edges, "graph_edges", root=root)
    lakehouse.save_snapshot(labels, "graph_labels", root=root)

    n2, e2, l2, src = graph_source.load_training_graph(
        source="lakehouse", lakehouse_root=root)
    assert src.startswith("lakehouse:")
    assert len(n2) == len(nodes) and len(e2) == len(edges)
    assert len(l2) == len(labels)


def test_graph_source_neo4j_first(monkeypatch):
    from ml.graph import graph_source

    nodes = make_nodes(5)
    edges = pd.DataFrame([{"src": 0, "dst": 1,
                           "edge_type": "HAS_VIOLATION"}])
    labels = pd.DataFrame([{"org_id": "ORG-00000", "node_id": 0,
                            "high_risk": 1, "risk_latent": 2.0}])
    monkeypatch.setattr(neo4j_store, "fetch_graph",
                        lambda **kw: (nodes, edges, labels))
    n2, _e2, _l2, src = graph_source.load_training_graph()
    assert src.startswith("neo4j:")
    assert len(n2) == 5


def test_graph_source_invalid_name():
    from ml.graph import graph_source
    with pytest.raises(ValueError, match="Unknown graph source"):
        graph_source.load_training_graph(source="cassandra")


def test_graph_source_env_override(monkeypatch, tmp_path):
    from ml.graph import graph_source
    monkeypatch.setenv("NDSEP_GRAPH_SOURCE", "synthetic")
    _n, _e, _l, src = graph_source.load_training_graph(
        lakehouse_root=str(tmp_path), n_orgs=20)
    assert src.startswith("synthetic:")


# --------------------------------------------------------------------------- #
# sync CLI
# --------------------------------------------------------------------------- #
def test_sync_dry_run(tmp_path, capsys):
    from ml.graph import sync_to_neo4j
    rc = sync_to_neo4j.main(["--source", "synthetic", "--n-orgs", "20",
                             "--dry-run"])
    assert rc == 0
    assert '"dry_run": true' in capsys.readouterr().out


def test_sync_pushes_through_store(monkeypatch, capsys):
    from ml.graph import sync_to_neo4j
    pushed = {}

    class FakeStore:
        def __init__(self, batch_size=1000):
            pushed["batch_size"] = batch_size

        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def push_graph(self, nodes, edges, labels=None):
            pushed["nodes"] = len(nodes)
            pushed["edges"] = len(edges)
            pushed["labels"] = 0 if labels is None else len(labels)
            return {"nodes_merged": pushed["nodes"],
                    "edges_merged": pushed["edges"],
                    "labels_merged": pushed["labels"],
                    "node_labels": {}, "edge_types": {}}

    monkeypatch.setattr(sync_to_neo4j, "Neo4jGraphStore", FakeStore)
    rc = sync_to_neo4j.main(["--source", "synthetic", "--n-orgs", "20",
                             "--batch-size", "250"])
    assert rc == 0
    assert pushed["batch_size"] == 250
    assert pushed["nodes"] > 20          # orgs + violations + officers
    assert pushed["labels"] == 20
    assert '"pushed": true' in capsys.readouterr().out
