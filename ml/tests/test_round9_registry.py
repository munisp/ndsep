"""Round-9: registry atomic locked writes (flock + tmp + os.replace)."""
import concurrent.futures, json, os, tempfile
from ml.registry import register_run, list_runs

def test_atomic_concurrent_writes():
    with tempfile.TemporaryDirectory() as td:
        reg = os.path.join(td, "registry.json")
        def one(i):
            register_run("fraud", {"accuracy": 0.9 + i * 1e-4}, f"/tmp/w{i}.pt",
                         registry_path=reg)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            list(ex.map(one, range(24)))
        # Every write landed and the file is valid JSON (no NUL corruption).
        raw = open(reg, "rb").read()
        assert b"\x00" not in raw
        runs = json.loads(raw)
        assert len(runs) == 24
        assert len(list_runs(reg)) == 24
