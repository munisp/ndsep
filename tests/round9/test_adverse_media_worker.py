"""
pytest suite for workers/python/adverse_media_worker.py — pure logic only
(no network, no DB; worker module is imported without running main()).
"""
import importlib.util
import os
import sys

import pytest

WORKER_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "workers", "python", "adverse_media_worker.py"
)
spec = importlib.util.spec_from_file_location("adverse_media_worker", WORKER_PATH)
amw = importlib.util.module_from_spec(spec)
sys.modules["adverse_media_worker"] = amw
spec.loader.exec_module(amw)


# ─── URL normalisation / dedupe ──────────────────────────────────────────────

def test_normalize_url_strips_tracking_and_case():
    assert amw.normalize_url("HTTPS://Example.COM/news/1/?utm_source=x&a=1#frag") == \
        "https://example.com/news/1?a=1"


def test_normalize_url_invalid():
    assert amw.normalize_url("not a url") == ""
    assert amw.normalize_url("") == ""


def test_url_hash_stable_across_tracking_noise():
    assert amw.url_hash("https://a.com/x?utm_source=a") == amw.url_hash("https://a.com/x?gclid=b")


def test_url_hash_fallback_anchor():
    assert amw.url_hash(None, "Some Title", "2026-01-01") == amw.url_hash(None, "some title", "2026-01-01")
    assert amw.url_hash("https://a.com/1") != amw.url_hash("https://a.com/2")


# ─── Keyword classifier ─────────────────────────────────────────────────────

def test_keyword_classify_breach():
    r = amw.keyword_classify("Major data breach: personal data exposed")
    assert r["label"] == "data_breach"
    assert r["severity"] == "critical"
    assert r["method"] == "keyword"


def test_keyword_classify_sanction():
    r = amw.keyword_classify("Regulator issues fine after enforcement action")
    assert r["severity"] == "high"


def test_keyword_classify_default_info():
    r = amw.keyword_classify("Company announces new product")
    assert r["label"] == "other"
    assert r["severity"] == "info"


def test_triage_falls_back_to_keyword_when_ollama_unconfigured(monkeypatch):
    monkeypatch.setattr(amw, "OLLAMA_URL", "")
    r = amw.triage("ransomware data breach")
    assert r["method"] == "keyword"


# ─── Entity matching ─────────────────────────────────────────────────────────

REGISTRY = [
    {"id": 1, "name": "Zenith Bank Plc"},
    {"id": 2, "name": "Globacom Limited", "aliases": ["Glo"]},
    {"id": 3, "name": "Dangote Cement"},
]


def test_match_exact():
    m = amw.match_organizations("Zenith Bank fined over breach", REGISTRY)
    assert m[0]["organization_id"] == 1
    assert m[0]["match_method"] == "exact"
    assert m[0]["confidence"] == 1.0


def test_match_alias():
    m = amw.match_organizations("Glo subscribers hit by lawsuit", REGISTRY)
    hit = [x for x in m if x["organization_id"] == 2]
    assert hit and hit[0]["match_method"] == "alias" and hit[0]["confidence"] == 0.9


def test_match_fuzzy():
    m = amw.match_organizations("Dangote Cemnt faces sanction", REGISTRY)
    hit = [x for x in m if x["organization_id"] == 3]
    assert hit and hit[0]["match_method"] == "fuzzy" and hit[0]["confidence"] >= 0.6


def test_match_unrelated_returns_empty():
    assert amw.match_organizations("The weather is nice today", REGISTRY) == []


def test_name_similarity_ignores_legal_suffixes():
    assert amw.name_similarity("Acme Ltd", "ACME Limited") == 1.0
    assert amw.name_similarity("Zenith Bank", "Globus Telecom") < 0.3


# ─── Feed parsing ────────────────────────────────────────────────────────────

RSS = b"""<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Bank fined</title><link>https://news.example/1</link>
    <description>Regulator fines bank</description><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate></item>
  <item><title>Breach at telco</title><link>https://news.example/2</link>
    <description>Data breach</description></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>Order published</title><link href="https://news.example/3"/>
    <summary>Final order</summary><updated>2026-06-01T10:00:00Z</updated></entry>
</feed>"""


def test_parse_feed_rss():
    items = amw.parse_feed(RSS)
    assert len(items) == 2
    assert items[0]["title"] == "Bank fined"
    assert items[0]["url"] == "https://news.example/1"


def test_parse_feed_atom():
    items = amw.parse_feed(ATOM)
    assert items == [{"title": "Order published", "url": "https://news.example/3",
                      "summary": "Final order", "published_at": "2026-06-01T10:00:00Z"}]


# ─── Auth fail-closed ────────────────────────────────────────────────────────

def test_auth_fails_closed_outside_dev_without_token(monkeypatch):
    monkeypatch.setattr(amw, "WORKER_AUTH_TOKEN", "")
    monkeypatch.setattr(amw, "ENVIRONMENT", "production")
    assert amw.check_auth("anything") is False


def test_auth_dev_allows_when_no_token(monkeypatch):
    monkeypatch.setattr(amw, "WORKER_AUTH_TOKEN", "")
    monkeypatch.setattr(amw, "ENVIRONMENT", "development")
    assert amw.check_auth(None) is True


def test_auth_requires_exact_token(monkeypatch):
    monkeypatch.setattr(amw, "WORKER_AUTH_TOKEN", "secret")
    monkeypatch.setattr(amw, "ENVIRONMENT", "production")
    assert amw.check_auth("secret") is True
    assert amw.check_auth("wrong") is False
    assert amw.check_auth(None) is False


# ─── Retention ───────────────────────────────────────────────────────────────

def test_retention_expiry():
    from datetime import datetime, timezone
    out = amw.retention_expiry(datetime(2026, 1, 1, tzinfo=timezone.utc), 30)
    assert out.startswith("2026-01-31")
