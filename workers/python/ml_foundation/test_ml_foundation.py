#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from synthetic_data import GenerationConfig, write_lakehouse
from train import train_all


class MlFoundationEndToEndTest(unittest.TestCase):
    def test_synthetic_train_sign_and_cpu_infer(self) -> None:
        with tempfile.TemporaryDirectory(prefix="ndsep-ml-foundation-") as temporary:
            root = Path(temporary)
            lakehouse = root / "lakehouse"
            models = root / "models"
            key_path = root / "candidate-key.pem"
            private_key = Ed25519PrivateKey.generate()
            key_path.write_bytes(private_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            ))
            generated = write_lakehouse(lakehouse, GenerationConfig(seed=11, events=600, tenants=4, days=60))
            self.assertEqual(generated["classification"], "synthetic_only")
            self.assertEqual(generated["event_count"], 600)
            self.assertGreater(generated["edge_count"], 0)
            trained = train_all(lakehouse, Path(generated["manifest_path"]), models, key_path, 11)
            self.assertEqual(trained["status"], "candidate_trained")
            self.assertTrue((models / "event_risk_mlp.pt").is_file())
            self.assertTrue((models / "organization_graphsage.pt").is_file())
            manifest = json.loads((models / "model-manifest.json").read_text())
            self.assertEqual(manifest["status"], "candidate_only")
            self.assertEqual(manifest["classification"], "synthetic_training_only")
            self.assertEqual(len(manifest["models"]), 2)
            self.assertTrue(all(entry["sha256"] for entry in manifest["models"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
