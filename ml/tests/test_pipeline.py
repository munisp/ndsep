"""Fast end-to-end pipeline test for the NDSEP ML stack.

Generates a TINY synthetic dataset (200 transactions / 60 orgs), trains
each model for 2 epochs, asserts weights save/load and that inference
returns probabilities in [0, 1]. Runs in well under a minute on CPU.

    pytest ml/tests/test_pipeline.py -v
"""

from __future__ import annotations

import importlib
import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))  # repo root on path

from ml.data.generate_synthetic import (CREDIT_FEATURES, FRAUD_FEATURES,
                                        NODE_FEATURE_DIM, generate)


@pytest.fixture(scope="module")
def tiny_data(tmp_path_factory):
    data_dir = str(tmp_path_factory.mktemp("data"))
    weights_dir = str(tmp_path_factory.mktemp("weights"))
    # isolate the lakehouse too, so tests never touch the repo's snapshots
    # (must be set before ml.training.* is imported)
    os.environ["ML_LAKEHOUSE_ROOT"] = str(tmp_path_factory.mktemp("lakehouse"))
    manifest = generate(data_dir, n_transactions=200, n_orgs=60, seed=123,
                        fraud_rate=0.05)  # elevated rate so tiny data has positives
    return {"data_dir": data_dir, "weights_dir": weights_dir,
            "manifest": manifest}


def test_generator_outputs(tiny_data):
    m = tiny_data["manifest"]
    assert m["n_transactions"] == 200
    for name in ["organizations", "transactions", "credit_features",
                 "graph_nodes", "graph_edges", "graph_labels"]:
        assert os.path.exists(m["files"][name]), name


def test_train_fraud_2_epochs(tiny_data):
    from ml.training.train import train_fraud
    r = train_fraud(data_dir=tiny_data["data_dir"],
                    weights_dir=tiny_data["weights_dir"], epochs=2)
    _assert_run(r, tiny_data, "fraud")


def test_train_credit_2_epochs(tiny_data):
    from ml.training.train import train_credit
    r = train_credit(data_dir=tiny_data["data_dir"],
                     weights_dir=tiny_data["weights_dir"], epochs=2)
    _assert_run(r, tiny_data, "credit")


def test_train_gnn_2_epochs(tiny_data):
    from ml.training.train import train_gnn
    r = train_gnn(data_dir=tiny_data["data_dir"],
                  weights_dir=tiny_data["weights_dir"], epochs=2)
    _assert_run(r, tiny_data, "gnn")


def _assert_run(r, tiny_data, name):
    assert 0.0 <= r["accuracy"] <= 1.0
    assert 0.0 <= r["roc_auc"] <= 1.0 or np.isnan(r["roc_auc"])
    wpath = os.path.join(tiny_data["weights_dir"], f"{name}_net.pt")
    assert os.path.exists(wpath) and os.path.getsize(wpath) > 1000
    assert os.path.exists(os.path.join(
        tiny_data["weights_dir"], f"{name}_net_metrics.json"))
    assert os.path.exists(os.path.join(
        tiny_data["weights_dir"], f"{name}_net_feature_stats.json"))


def test_weights_load_and_inference(tiny_data):
    wd = tiny_data["weights_dir"]
    import ml.inference as inference

    r = inference.score_transaction({f: 0.5 for f in FRAUD_FEATURES},
                                    weights_dir=wd)
    assert 0.0 <= r["probability"] <= 1.0
    assert r["model_version"]

    c = inference.score_credit({f: 1.0 for f in CREDIT_FEATURES},
                               weights_dir=wd)
    assert 0.0 <= c["probability"] <= 1.0

    node = {f"f{i}": 0.0 for i in range(NODE_FEATURE_DIM)}
    node["f0"] = 1.0
    g = inference.score_graph_node(node, [node, node], weights_dir=wd)
    assert 0.0 <= g["probability"] <= 1.0


def test_save_load_roundtrip(tiny_data):
    wd = tiny_data["weights_dir"]
    import torch
    from ml.models.fraud_net import FraudNet
    model = FraudNet.load(os.path.join(wd, "fraud_net.pt"))
    x = torch.randn(4, len(FRAUD_FEATURES))
    model.eval()
    with torch.no_grad():
        p1 = torch.sigmoid(model(x))
    model2 = FraudNet.load(os.path.join(wd, "fraud_net.pt"))
    with torch.no_grad():
        p2 = torch.sigmoid(model2(x))
    assert torch.allclose(p1, p2)
    assert ((p1 >= 0) & (p1 <= 1)).all()


def test_drift_check_runs(tiny_data):
    import pandas as pd
    from ml.monitoring.drift import (drift_report, load_feature_stats)
    wd = tiny_data["weights_dir"]
    stats = load_feature_stats(os.path.join(wd, "fraud_net_feature_stats.json"))
    tx = pd.read_parquet(os.path.join(tiny_data["data_dir"],
                                      "transactions.parquet")) \
        if os.path.exists(os.path.join(tiny_data["data_dir"],
                                       "transactions.parquet")) \
        else pd.read_csv(os.path.join(tiny_data["data_dir"],
                                      "transactions.csv"))
    rep = drift_report(stats, tx)
    assert "drift_detected" in rep and rep["n_features"] > 0


def test_registry_file(tiny_data):
    from ml.registry import list_runs
    runs = list_runs(os.path.join(tiny_data["weights_dir"], "registry.json"))
    assert len(runs) >= 3
    assert {r["model"] for r in runs} >= {"fraud", "credit", "gnn"}
