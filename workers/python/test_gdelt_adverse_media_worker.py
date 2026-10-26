#!/usr/bin/env python3
"""
Pytest suite for gdelt_adverse_media_worker (round 13, P1.5).

Covers: defensive GDELT/news normalization (schema drift), Nigeria-geolocation
filter (bounding box + country name), the adverse-signal classifier
(NG-geo+entity highest confidence, entity-only medium, keyword-only DROPPED),
PII redaction (emails / Nigerian MSISDN / 11-digit NIN masked with keyed
HMAC — raw values never survive), and source-native-id dedupe hashing.
No live OSIRIS / DB required.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gdelt_adverse_media_worker as w  # noqa: E402

REGISTRY = [
    {"id": 11, "name": "Example Bank Ltd"},
    {"id": 22, "name": "Lagos Health HMO", "aliases": ["LH HMO"]},
]

LAGOS_GEO = {"lat": 6.45, "lng": 3.39}          # inside NG bbox
LONDON_GEO = {"lat": 51.5, "lng": -0.12}        # outside NG bbox


# ─── normalize_event (schema drift tolerance) ────────────────────────────────

def test_normalize_event_happy_path():
    e = w.normalize_event({
        "id": "evt-1", "title": "Bank outage hits Lagos", "url": "https://ex.com/a",
        "source": "Vanguard", "ts": "2026-04-01T10:00:00Z",
        "lat": 6.45, "lng": 3.39, "country": "Nigeria",
        "actors": ["Example Bank"], "tone": -4.2,
    })
    assert e["id"] == "evt-1"
    assert e["lat"] == 6.45 and e["actors"] == ["Example Bank"] and e["tone"] == -4.2


def test_normalize_event_tolerates_missing_geo_and_actors():
    e = w.normalize_event({"id": 42, "title": "headline"})
    assert e is not None
    assert e["lat"] is None and e["lng"] is None and e["actors"] == [] and e["tone"] is None
    assert e["id"] == "42"  # numeric ids coerced to string


def test_normalize_event_drops_unusable():
    assert w.normalize_event(None) is None
    assert w.normalize_event({"title": "no id"}) is None
    assert w.normalize_event({"id": "x"}) is None              # no title
    assert w.normalize_event("not-a-dict") is None


def test_normalize_event_alternative_field_names():
    e = w.normalize_event({"guid": "g-1", "headline": "h", "lon": 3.4, "lat": 6.5})
    assert e is not None and e["id"] == "g-1" and e["lng"] == 3.4


# ─── normalize_headline + native id ──────────────────────────────────────────

def test_normalize_headline_happy_path():
    m = w.normalize_headline({"title": "fraud probe", "url": "https://x", "ts": "t"}, "Channels TV")
    assert m["channel"] == "Channels TV" and m["title"] == "fraud probe"


def test_normalize_headline_drops_unusable():
    assert w.normalize_headline(None, "c") is None
    assert w.normalize_headline({"url": "https://x"}, "c") is None


def test_headline_native_id_is_deterministic_and_distinct():
    a = {"channel": "c", "title": "same", "ts": "t1"}
    b = {"channel": "c", "title": "same", "ts": "t1"}
    c = {"channel": "c", "title": "same", "ts": "t2"}
    assert w.headline_native_id(a) == w.headline_native_id(b)
    assert w.headline_native_id(a) != w.headline_native_id(c)


# ─── Nigeria geolocation filter ──────────────────────────────────────────────

def test_ng_geo_bounding_box():
    assert w.is_nigeria_geo(LAGOS_GEO) is True
    assert w.is_nigeria_geo(LONDON_GEO) is False


def test_ng_geo_country_name_without_coords():
    assert w.is_nigeria_geo({"country": "Nigeria"}) is True
    assert w.is_nigeria_geo({"country": "NG"}) is True
    assert w.is_nigeria_geo({"country": "Ghana"}) is False


def test_ng_geo_missing_everything():
    assert w.is_nigeria_geo({}) is False


# ─── classifier: geo/entity tiers, keyword-only drop ─────────────────────────

def test_geo_plus_entity_is_highest_confidence():
    r = w.classify_item("data breach at Example Bank in Lagos", True, REGISTRY)
    assert r["is_signal"] is True
    assert r["confidence"] == w.CONFIDENCE_GEO_AND_ENTITY
    assert r["confidence_tier"] == "geo+entity"
    assert r["severity"] == "critical"
    assert r["entities"][0]["organization_id"] == 11


def test_entity_match_only_is_medium_confidence():
    r = w.classify_item("Example Bank fined by regulator over fraud", False, REGISTRY)
    assert r["is_signal"] is True
    assert r["confidence"] == w.CONFIDENCE_ENTITY_ONLY
    assert r["confidence_tier"] == "entity"


def test_ng_geo_only_no_entity_still_kept_low():
    r = w.classify_item("major outage disrupts payments across Lagos", True, REGISTRY)
    assert r["is_signal"] is True
    assert r["confidence"] == w.CONFIDENCE_GEO_ONLY
    assert r["confidence_tier"] == "geo"
    assert r["entities"] == []


def test_keyword_only_dropped():
    # Adverse keywords but no NG geo and no entity match -> dropped.
    r = w.classify_item("ransomware gang leaks database of unknown firm", False, REGISTRY)
    assert r["is_signal"] is False
    assert r["confidence_tier"] == "dropped"
    assert r["matched_keywords"]  # keywords fired, but relevance gate dropped it


def test_no_keywords_dropped_even_with_entity():
    r = w.classify_item("Example Bank opens new branch in Abuja", True, REGISTRY)
    assert r["is_signal"] is False


def test_alias_match_counts_as_entity():
    r = w.classify_item("LH HMO hit by ransomware", False, REGISTRY)
    assert r["is_signal"] is True
    assert any(e["organization_id"] == 22 for e in r["entities"])


def test_adverse_keyword_coverage():
    for text in ("data breach confirmed", "nationwide outage", "fraud charges",
                 "sanctions imposed", "lawsuit filed", "regulator intervenes",
                 "record fine issued", "systems hacked"):
        assert w.keyword_adverse_score(text)["is_adverse"], text


# ─── redact_pii (raw PII never survives) ─────────────────────────────────────

def test_redact_email():
    out = w.redact_pii("contact john.doe@examplebank.com for details")
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


def test_redact_is_deterministic_and_preserves_non_pii():
    assert w.redact_pii("mail a@b.com") == w.redact_pii("mail a@b.com")
    out = w.redact_pii("Example Bank suffered a data breach in Lagos")
    assert "Example Bank" in out and "data breach" in out


# ─── dedupe hashing (source-native id) ───────────────────────────────────────

def test_item_hash_scoped_by_source_and_id():
    a = w.item_hash("osiris_gdelt", "evt-1")
    assert a == w.item_hash("osiris_gdelt", "evt-1")
    assert a != w.item_hash("osiris_news", "evt-1")     # source-scoped
    assert a != w.item_hash("osiris_gdelt", "evt-2")    # id-scoped
    assert len(a) == 64
