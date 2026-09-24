"""Pytest suite for policy_monitor_worker pure logic — no network, no DB.
LLM calls are monkeypatched; UNCONFIGURED retry semantics are asserted.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import policy_monitor_worker as pmw  # noqa: E402


POLICY_V1_HTML = """<html><head><title>Privacy Notice</title>
<script>var tracker = "noise-that-must-be-stripped";</script>
<style>.a{color:red}</style></head>
<body><h1>Privacy Notice</h1>
<p>We collect your name and email to provide banking services.</p>
<p>We retain your data for 5 years after account closure.</p>
<p>You may request deletion of your data at any time.</p>
</body></html>"""

POLICY_V2_MINOR_HTML = POLICY_V1_HTML.replace("5 years", "five (5) years")

POLICY_V2_ADVERSE_HTML = """<html><body><h1>Privacy Notice</h1>
<p>We collect your name and email to provide banking services.</p>
<p>We retain your data indefinitely.</p>
<p>We may sell your personal data to third-party partners and data broker networks.</p>
<p>We may transfer your data abroad at our sole discretion without notice.</p>
</body></html>"""


# ── text normalisation ────────────────────────────────────────────────────────
class TestNormalize:
    def test_strips_scripts_and_styles(self):
        text = pmw.normalize_policy_text(POLICY_V1_HTML)
        assert "noise-that-must-be-stripped" not in text
        assert "color:red" not in text
        assert "We collect your name and email" in text

    def test_script_churn_does_not_change_hash(self):
        a = POLICY_V1_HTML.replace('var tracker = "noise-that-must-be-stripped";', 'var tracker = "v2-different-js";')
        assert pmw.content_hash(pmw.normalize_policy_text(a)) == \
            pmw.content_hash(pmw.normalize_policy_text(POLICY_V1_HTML))

    def test_plain_text_input_passthrough(self):
        text = pmw.normalize_policy_text("Just plain text, no tags.")
        assert "Just plain text" in text

    def test_hash_is_sha256_hex(self):
        h = pmw.content_hash("abc")
        assert len(h) == 64 and all(c in "0123456789abcdef" for c in h)


# ── heuristic classification ──────────────────────────────────────────────────
class TestHeuristicClassify:
    def test_identical_is_none(self):
        out = pmw.heuristic_classify("same text", "same text")
        assert out["classification"] == "none"
        assert out["ratio"] == 0.0

    def test_small_edit_is_minor(self):
        old = pmw.normalize_policy_text(POLICY_V1_HTML)
        new = pmw.normalize_policy_text(POLICY_V2_MINOR_HTML)
        out = pmw.heuristic_classify(old, new)
        assert out["classification"] == "minor"

    def test_adverse_keywords_material_adverse(self):
        old = pmw.normalize_policy_text(POLICY_V1_HTML)
        new = pmw.normalize_policy_text(POLICY_V2_ADVERSE_HTML)
        out = pmw.heuristic_classify(old, new)
        assert out["classification"] == "material_adverse"
        assert "sell your" in out["keyword_delta"]["adverse_added"]

    def test_rights_removed_material_adverse(self):
        old = "You may request deletion of your data at any time. We store it safely."
        new = "We store your data."
        out = pmw.heuristic_classify(old, new)
        assert out["classification"] == "material_adverse"
        assert "you may request deletion" in out["keyword_delta"]["beneficial_removed"]

    def test_rights_added_material_beneficial(self):
        old = "We store your data."
        new = "We store your data. You may request deletion and may withdraw consent at any time."
        out = pmw.heuristic_classify(old, new)
        assert out["classification"] == "material_beneficial"


# ── LLM response parsing ──────────────────────────────────────────────────────
class TestParseLlmClassification:
    @pytest.mark.parametrize("text,expected", [
        ('{"classification": "material_adverse", "summary": "rights reduced"}', "material_adverse"),
        ('{"classification": "minor"}', "minor"),
        ('The change is material adverse because...', "material_adverse"),
        ('classification: minor wording tweaks', "minor"),
        ('{"classification": "bogus"}', None),
        ('', None),
        (None, None),
    ])
    def test_parse(self, text, expected):
        assert pmw.parse_llm_classification(text) == expected


# ── LLM client: explicit UNCONFIGURED path (no network — monkeypatched) ──────
class TestLlmClient:
    def test_unreachable_returns_error_tuple(self, monkeypatch):
        def boom(*a, **k):
            raise ConnectionError("refused")
        monkeypatch.setattr(pmw.requests, "post", boom)
        result, error = pmw.llm_semantic_diff("old", "new")
        assert result is None
        assert "unreachable" in error

    def test_non_200_returns_error(self, monkeypatch):
        class Resp:
            status_code = 500
            text = "internal error"
        monkeypatch.setattr(pmw.requests, "post", lambda *a, **k: Resp())
        result, error = pmw.llm_semantic_diff("old", "new")
        assert result is None and "HTTP 500" in error

    def test_unparseable_llm_output_returns_error(self, monkeypatch):
        class Resp:
            status_code = 200
            def json(self):
                return {"response": "I cannot classify this.", "model": "mistral"}
        monkeypatch.setattr(pmw.requests, "post", lambda *a, **k: Resp())
        result, error = pmw.llm_semantic_diff("old", "new")
        assert result is None and "recognisable" in error

    def test_valid_llm_output(self, monkeypatch):
        class Resp:
            status_code = 200
            def json(self):
                return {"response": '{"classification": "material_adverse", "summary": "x"}',
                        "model": "qwen2.5"}
        monkeypatch.setattr(pmw.requests, "post", lambda *a, **k: Resp())
        result, error = pmw.llm_semantic_diff("old", "new")
        assert error is None
        assert result["classification"] == "material_adverse"
        assert result["model"] == "qwen2.5"


# ── retry backoff ─────────────────────────────────────────────────────────────
class TestRetry:
    def test_backoff_grows_and_caps(self):
        first = int(pmw._next_retry(0).split()[0])
        later = int(pmw._next_retry(5).split()[0])
        capped = int(pmw._next_retry(50).split()[0])
        assert later > first
        assert capped == 24 * 60  # 24h cap


# ── /health (no network: explicit UNCONFIGURED paths) ────────────────────────
class TestHealth:
    def test_health_unconfigured_without_db_url(self, monkeypatch):
        monkeypatch.setattr(pmw, "DB_URL", "")
        payload = pmw.health_payload()
        assert payload["status"] == "UNCONFIGURED"
        assert payload["database"]["configured"] is False

    def test_health_reports_llm_unreachable_separately(self, monkeypatch):
        monkeypatch.setattr(pmw, "DB_URL", "postgresql://invalid:1/db")
        monkeypatch.setattr(pmw, "db_health", lambda: {
            "configured": True, "status": "ok", "enabled_policies": 0, "diff_queue_depth": 0})
        monkeypatch.setattr(pmw, "llm_worker_health", lambda: {
            "configured": True, "status": "unreachable", "detail": "refused"})
        payload = pmw.health_payload()
        # LLM outage degrades but does not take the worker down; diffs queue.
        assert payload["status"] == "degraded_llm"
        assert payload["llm_worker"]["status"] == "unreachable"

    def test_llm_health_unreachable(self, monkeypatch):
        def boom(*a, **k):
            raise ConnectionError("refused")
        monkeypatch.setattr(pmw.requests, "get", boom)
        health = pmw.llm_worker_health()
        assert health["status"] == "unreachable"
        assert health["configured"] is True
