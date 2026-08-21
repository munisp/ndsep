#!/usr/bin/env python3
"""Test-only end-to-end acknowledgment-loss and recovery suite.

This suite starts real local HTTP provider servers. It is not a live TigerBeetle
or Mojaloop acceptance test and must never be enabled in production.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import threading
import unittest
import uuid
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

SECRET = b"test-only-financial-callback-secret"


@dataclass
class ProviderState:
    states: dict[str, str] = field(default_factory=dict)
    drop_next_response: bool = False
    request_count: dict[str, int] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)


class ProviderHandler(BaseHTTPRequestHandler):
    provider = ""
    state: ProviderState

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _json(self, status: int, body: dict[str, object]) -> None:
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/transfers":
            self._json(404, {"error": "not_found"})
            return
        size = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(size))
        reference = str(body["reference"])
        with self.state.lock:
            self.state.request_count[reference] = self.state.request_count.get(reference, 0) + 1
            current = self.state.states.get(reference)
            if current in {"committed", "aborted"}:
                result = {"state": current, "reference": reference, "duplicate": True}
            else:
                self.state.states[reference] = "committed"
                result = {"state": "committed", "reference": reference, "duplicate": False}
            drop = self.state.drop_next_response
            self.state.drop_next_response = False
        if drop:
            self.close_connection = True
            return
        self._json(200, result)

    def do_GET(self) -> None:  # noqa: N802
        prefix = "/transfers/"
        if not self.path.startswith(prefix):
            self._json(404, {"error": "not_found"})
            return
        reference = self.path[len(prefix) :]
        with self.state.lock:
            state = self.state.states.get(reference)
        if state is None:
            self._json(404, {"state": "not_found", "reference": reference})
        else:
            self._json(200, {"state": state, "reference": reference})


class ProviderServer:
    def __init__(self, provider: str):
        self.state = ProviderState()
        handler = type(f"{provider}Handler", (ProviderHandler,), {})
        handler.provider = provider
        handler.state = self.state
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


def request_json(method: str, url: str, body: dict[str, object] | None = None) -> dict[str, object]:
    data = json.dumps(body).encode() if body is not None else None
    request = Request(url, data=data, method=method, headers={"content-type": "application/json"})
    try:
        with urlopen(request, timeout=2) as response:
            return json.loads(response.read())
    except HTTPError as error:
        return json.loads(error.read())


@dataclass
class OutboxRow:
    reference: str
    actor: str
    key: str
    fingerprint: str
    state: str = "pending"
    observations: list[tuple[str, str]] = field(default_factory=list)
    callback_events: set[str] = field(default_factory=set)


class SimulatedFinancialService:
    """Minimal executable model of the production outbox invariants."""

    def __init__(self, tigerbeetle: ProviderServer, mojaloop: ProviderServer):
        self.tb = tigerbeetle
        self.mojaloop = mojaloop
        self.rows: dict[tuple[str, str], OutboxRow] = {}
        self.lock = threading.Lock()

    def create_intent(self, actor: str, key: str, reference: str, amount: int) -> tuple[str, bool]:
        fingerprint = hashlib.sha256(f"NIP:{amount}".encode()).hexdigest()
        with self.lock:
            existing = self.rows.get((actor, key))
            if existing:
                if existing.fingerprint != fingerprint:
                    raise ValueError("idempotency fingerprint conflict")
                return existing.reference, True
            self.rows[(actor, key)] = OutboxRow(reference, actor, key, fingerprint)
            return reference, False

    def dispatch(self, row: OutboxRow) -> None:
        if row.state not in {"pending", "dispatched"}:
            return
        try:
            request_json("POST", f"{self.tb.url}/transfers", {"reference": row.reference})
            request_json("POST", f"{self.mojaloop.url}/transfers", {"reference": row.reference})
            row.state = "dispatched"
        except (OSError, TimeoutError, ConnectionError, ValueError):
            row.state = "reconciliation_required"

    def reconcile(self, row: OutboxRow) -> None:
        tb = request_json("GET", f"{self.tb.url}/transfers/{row.reference}").get("state", "not_found")
        ml = request_json("GET", f"{self.mojaloop.url}/transfers/{row.reference}").get("state", "not_found")
        row.observations.extend([("tigerbeetle", str(tb)), ("mojaloop", str(ml))])
        if tb == "not_found" and ml == "not_found":
            row.state = "pending"
        elif tb == "committed" and ml == "not_found":
            request_json("POST", f"{self.mojaloop.url}/transfers", {"reference": row.reference})
            row.state = "dispatched"
        elif tb == "pending" and ml == "not_found":
            row.state = "dead_letter"
        elif {tb, ml} == {"committed", "aborted"}:
            row.state = "dead_letter"
        elif "not_found" not in {tb, ml}:
            row.state = "dispatched"
        else:
            row.state = "dead_letter"

    def callback(self, row: OutboxRow, event_id: str, state: str, signature: str) -> None:
        raw = json.dumps({"reference": row.reference, "state": state, "event_id": event_id}, separators=(",", ":")).encode()
        expected = hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise PermissionError("invalid callback signature")
        if event_id in row.callback_events:
            return
        row.callback_events.add(event_id)
        if state == "COMMITTED":
            row.state = "settled"
        elif state == "ABORTED":
            row.state = "failed"


def signed_callback(reference: str, event_id: str, state: str) -> str:
    raw = json.dumps({"reference": reference, "state": state, "event_id": event_id}, separators=(",", ":")).encode()
    return hmac.new(SECRET, raw, hashlib.sha256).hexdigest()


class AcknowledgmentLossE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tb = ProviderServer("tigerbeetle")
        cls.ml = ProviderServer("mojaloop")
        cls.tb.start()
        cls.ml.start()
        cls.service = SimulatedFinancialService(cls.tb, cls.ml)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tb.stop()
        cls.ml.stop()

    def row(self, suffix: str) -> OutboxRow:
        reference = f"E2E-{suffix}-{uuid.uuid4().hex[:8]}"
        key = str(uuid.uuid4())
        self.service.create_intent("test-actor", key, reference, 12500)
        return self.service.rows[("test-actor", key)]

    def test_ack_loss_quarantines_then_reconciles_and_recovers(self) -> None:
        row = self.row("ACKLOSS")
        self.tb.state.drop_next_response = True
        self.service.dispatch(row)
        self.assertEqual(row.state, "reconciliation_required")
        self.service.reconcile(row)
        self.assertEqual(row.state, "dispatched")
        self.assertEqual(self.tb.state.request_count[row.reference], 1)
        self.assertEqual(self.ml.state.request_count[row.reference], 1)
        sig = signed_callback(row.reference, "evt-1", "COMMITTED")
        self.service.callback(row, "evt-1", "COMMITTED", sig)
        self.assertEqual(row.state, "settled")
        self.service.callback(row, "evt-1", "COMMITTED", sig)
        self.assertEqual(len(row.callback_events), 1)

    def test_pending_ledger_is_manual_review(self) -> None:
        row = self.row("PENDING")
        self.tb.state.states[row.reference] = "pending"
        self.service.reconcile(row)
        self.assertEqual(row.state, "dead_letter")
        self.assertEqual(self.ml.state.request_count.get(row.reference, 0), 0)

    def test_provider_conflict_is_manual_review(self) -> None:
        row = self.row("CONFLICT")
        self.tb.state.states[row.reference] = "committed"
        self.ml.state.states[row.reference] = "aborted"
        self.service.reconcile(row)
        self.assertEqual(row.state, "dead_letter")

    def test_both_not_found_is_safe_to_requeue(self) -> None:
        row = self.row("ABSENT")
        row.state = "reconciliation_required"
        self.service.reconcile(row)
        self.assertEqual(row.state, "pending")

    def test_duplicate_idempotency_and_conflict(self) -> None:
        actor, key, reference = "actor-duplicate", str(uuid.uuid4()), "E2E-DUP"
        self.assertEqual(self.service.create_intent(actor, key, reference, 12500), (reference, False))
        self.assertEqual(self.service.create_intent(actor, key, "E2E-DUP-RETRY", 12500), (reference, True))
        with self.assertRaises(ValueError):
            self.service.create_intent(actor, key, "E2E-DUP-CHANGED", 12501)

    def test_concurrent_duplicate_attempts_create_one_row(self) -> None:
        actor, key = "actor-concurrent", str(uuid.uuid4())
        results: list[tuple[str, bool]] = []
        errors: list[Exception] = []
        barrier = threading.Barrier(8)

        def attempt(index: int) -> None:
            try:
                barrier.wait()
                results.append(self.service.create_intent(actor, key, f"E2E-CONCURRENT-{index}", 12500))
            except Exception as exc:  # pragma: no cover - failure surfaced below
                errors.append(exc)

        threads = [threading.Thread(target=attempt, args=(i,)) for i in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertFalse(errors)
        self.assertEqual(sum(1 for _, duplicate in results if not duplicate), 1)
        self.assertEqual(sum(1 for _, duplicate in results if duplicate), 7)
        self.assertEqual(len([row_key for row_key in self.service.rows if row_key == (actor, key)]), 1)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(AcknowledgmentLossE2E)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
