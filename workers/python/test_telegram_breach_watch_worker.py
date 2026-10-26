#!/usr/bin/env python3
"""
Pytest suite for telegram_breach_watch_worker (round 13, P0.1).

Covers: defensive feed-post normalization (schema drift), PII redaction
(emails / Nigerian MSISDN / 11-digit NIN masked with keyed HMAC — raw values
never survive), the breach-signal classifier (keyword rules + entity matcher,
ambiguous-post ollama confirmation with fail-closed fallback), and the
breach-lag detector (72h NDPA window). No live OSIRIS / ollama / DB required.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import telegram_breach_watch_worker as w  # noqa: E402

REGISTRY = [
    {"id": 11, "name": "Example Bank Ltd"},
    {"id": 22, "name": "Lagos Health HMO", "aliases": ["LH HMO"]},
]

NOW = datetime(2026, 4, 10, 12, 0, 0, tzinfo=timezone.utc)


# ─── normalize_post (schema drift tolerance) ─────────────────────────────────

def test_normalize_post_happy_path():
    p = w.normalize_post({
        "id": "123", "channel": "nigeria_cyber_news", "text": "hello",
        "ts": "2026-04-01T10:00:00Z",
        "geo": {"lat": 6.45, "lng": 3.39, "place": "Lagos"},
        "url": "https://t.me/s/nigeria_cyber_news/123",
    })
    assert p["id"] == "123"
    assert p["geo"] == {"lat": 6.45, "lng": 3.39, "place": "Lagos"}


def test_normalize_post_tolerates_missing_geo_and_url():
    p = w.normalize_post({"id": 42, "text": "hi", "channel": "chan"})
    assert p is not None
    assert p["geo"] is None
    assert p["url"] == "https://t.me/s/chan/42"  # provenance URL synthesized


def test_normalize_post_drops_unusable():
    assert w.normalize_post(None) is None
    assert w.normalize_post({"channel": "c"}) is None          # no id
    assert w.normalize_post({"id": "1"}) is None               # no text
    assert w.normalize_post("not-a-dict") is None


def test_normalize_post_geo_partial_is_null():
    p = w.normalize_post({"id": "1", "text": "x", "geo": {"lat": 6.4}})
    assert p["geo"] is None


# ─── redact_pii (raw PII never survives) ─────────────────────────────────────

def test_redact_email():
    out = w.redact_pii("contact john.doe@examplebank.com for the dump")
    assert "john.doe@examplebank.com" not in out
    assert "[email:" in out


def test_redact_nigerian_msisdn():
    for num in ("08031234567", "+234 803 123 4567", "2348031234567"):
        out = w.redact_pii(f"call {num} now")
        assert num not in out
        assert "[phone:" in out


def test_redact_nin_11_digits():
    out = w.redact_pii("NIN 12345678901 exposed")
    assert "12345678901" not in out
    assert "[nin:" in out


def test_redact_is_deterministic_and_keyed():
    a = w.redact_pii("mail a@b.com")
    b = w.redact_pii("mail a@b.com")
    assert a == b  # same keyed HMAC mask


def test_redact_preserves_non_pii():
    out = w.redact_pii("Example Bank suffered a data breach in Lagos")
    assert "Example Bank" in out and "data breach" in out


# ─── classifier ──────────────────────────────────────────────────────────────

def test_keyword_rules_catch_breach_terms():
    for text in ("data breach confirmed", "ransomware gang posted the database dump",
                 "50,000 customer records leaked online", "hackers claim unauthorized access"):
        r = w.keyword_breach_score(text)
        assert r["is_breach"], text


def test_keyword_rules_pass_benign():
    r = w.keyword_breach_score("Example Bank opens new branch in Abuja")
    assert not r["is_breach"]


def test_classify_breach_plus_entity_is_signal():
    post = {"text": "BREAKING: data breach at Example Bank, 50000 records leaked"}
    r = w.classify_post(post, REGISTRY)
    assert r["is_signal"] is True
    assert r["severity"] == "critical"
    assert r["method"] == "keyword"
    assert r["entities"][0]["organization_id"] == 11


def test_classify_alias_match():
    post = {"text": "LH HMO hacked, patient data on dark web sale"}
    r = w.classify_post(post, REGISTRY)
    assert r["is_signal"] is True
    assert any(e["organization_id"] == 22 for e in r["entities"])


def test_classify_benign_post_not_signal():
    post = {"text": "Example Bank launches a new savings product"}
    r = w.classify_post(post, REGISTRY)
    assert r["is_signal"] is False


def test_classify_ambiguous_fails_closed_when_ollama_unreachable(monkeypatch):
    # Breach keywords but no entity mention; ollama unconfigured -> rules verdict stands.
    monkeypatch.setattr(w, "OLLAMA_URL", "")
    post = {"text": "major data breach hits unnamed Nigerian fintech"}
    r = w.classify_post(post, REGISTRY)
    assert r["ambiguous"] is True
    assert r["method"] == "keyword"          # fail-closed: rules only
    assert r["is_signal"] is True            # keywords alone still surface
    assert r["severity"] == "high"           # derated from critical


def test_classify_entity_only_not_signal_without_llm(monkeypatch):
    monkeypatch.setattr(w, "OLLAMA_URL", "")
    post = {"text": "Example Bank quarterly results published"}
    r = w.classify_post(post, REGISTRY)
    assert r["ambiguous"] is True
    assert r["is_signal"] is False


def test_classify_ollama_confirmation_used_when_available(monkeypatch):
    monkeypatch.setattr(w, "ollama_confirm", lambda text: True)
    post = {"text": "Example Bank trending this morning"}
    r = w.classify_post(post, REGISTRY)
    assert r["method"] == "ollama"
    assert r["is_signal"] is True
    assert r["severity"] == "medium"  # upgraded from info


def test_ollama_confirm_fail_closed_on_unreachable(monkeypatch):
    import requests as _rq
    monkeypatch.setattr(w, "OLLAMA_URL", "http://127.0.0.1:9")
    monkeypatch.setattr(_rq, "post", lambda *a, **k: (_ for _ in ()).throw(ConnectionError("down")))
    assert w.ollama_confirm("anything") is None


# ─── breach-lag detector (72h NDPA window) ───────────────────────────────────

def _ts(dt):
    return dt.isoformat()


def test_lag_overdue_when_no_self_report():
    post_ts = NOW - timedelta(hours=100)  # > 72h old
    lag = w.detect_breach_lag(post_ts, [], now=NOW)
    assert lag is not None
    assert lag["signal_type"] == "breach_notification_overdue"
    deadline = datetime.fromisoformat(lag["notification_deadline"])
    assert deadline == post_ts + timedelta(hours=72)


def test_lag_not_overdue_within_window():
    post_ts = NOW - timedelta(hours=24)  # window still open
    assert w.detect_breach_lag(post_ts, [], now=NOW) is None


def test_lag_suppressed_by_self_report_within_window():
    post_ts = NOW - timedelta(hours=100)
    incidents = [{"created_at": _ts(post_ts + timedelta(hours=48)),
                  "detected_at": None, "ndpc_notified_at": None}]
    assert w.detect_breach_lag(post_ts, incidents, now=NOW) is None


def test_lag_suppressed_by_prior_self_report():
    post_ts = NOW - timedelta(hours=100)
    incidents = [{"created_at": _ts(post_ts - timedelta(hours=10)),
                  "detected_at": None, "ndpc_notified_at": None}]
    assert w.detect_breach_lag(post_ts, incidents, now=NOW) is None


def test_lag_fires_when_report_outside_window():
    post_ts = NOW - timedelta(hours=200)
    incidents = [{"created_at": _ts(post_ts + timedelta(hours=100)),  # > 72h after
                  "detected_at": None, "ndpc_notified_at": None}]
    assert w.detect_breach_lag(post_ts, incidents, now=NOW) is not None


def test_lag_ignores_unparseable_post_ts():
    assert w.detect_breach_lag(None, [], now=NOW) is None
