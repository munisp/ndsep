"""Pytest suite for scan_crawler_worker heuristics — fixture HTML only,
no network, no database (psycopg2 is lazily imported and never touched).
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import scan_crawler_worker as scw  # noqa: E402


# ── Fixture tracker signatures (mirrors migration 0083 seed shape) ───────────
SIGNATURES = [
    {"tracker_name": "google-analytics", "vendor": "Google", "category": "analytics",
     "domain_pattern": "google-analytics.com",
     "script_url_pattern": r"googletagmanager\.com/gtag/js|google-analytics\.com/(analytics|ga)\.js",
     "inline_pattern": r"gtag\(", "cookie_name_pattern": r"^_(ga|gid|gat)(_|\b)",
     "default_severity": "high"},
    {"tracker_name": "facebook-pixel", "vendor": "Meta", "category": "advertising",
     "domain_pattern": "connect.facebook.net",
     "script_url_pattern": r"connect\.facebook\.net/.*/fbevents\.js",
     "inline_pattern": r"fbq\(", "cookie_name_pattern": r"^(_fbp|_fbc|fr)$",
     "default_severity": "critical"},
    {"tracker_name": "hotjar", "vendor": "Hotjar", "category": "session_replay",
     "domain_pattern": "hotjar.com",
     "script_url_pattern": r"static\.hotjar\.com/c/hotjar-",
     "inline_pattern": None, "cookie_name_pattern": r"^_hj",
     "default_severity": "high"},
]

BASE = "https://example.ng/"

HTML_PRE_CONSENT = """<!DOCTYPE html><html><head>
<title>Example Bank</title>
<script src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
<script>gtag('config', 'G-XXXX');</script>
<script src="https://connect.facebook.net/en_US/fbevents.js"></script>
</head><body><h1>Welcome</h1></body></html>"""

HTML_GATED_WITH_BANNER = """<!DOCTYPE html><html><head>
<script type="text/plain" data-cookieconsent="statistics"
        src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
</head><body>
<div id="cookie-consent-banner" class="cookie-banner">
  <p>We use cookies to improve your experience.</p>
  <button>Accept all</button>
  <button>Reject non-essential</button>
</div></body></html>"""

HTML_DARK_PATTERNS = """<!DOCTYPE html><html><head><title>Shop</title></head><body>
<div id="cookie-banner">
  <p>This website uses cookies.</p>
  <button class="btn-primary">Accept all</button>
  <a href="/privacy" style="display:none">Reject all</a>
</div>
<form action="/signup" method="post">
  <label for="newsletter">Send me marketing offers from partners</label>
  <input type="checkbox" id="newsletter" name="marketing_optin" checked>
  <label for="thirdparty">Share my data with third-party advertisers</label>
  <input type="checkbox" id="thirdparty" name="third_party_sharing" checked>
  <input type="checkbox" id="terms" name="terms">
</form>
<p>Create an account to continue browsing products.</p>
</body></html>"""

HTML_NO_BANNER_NO_TRACKERS = """<!DOCTYPE html><html><head>
<title>Plain</title><script src="/static/app.js"></script>
</head><body><h1>Hello</h1></body></html>"""


# ── parse_page ────────────────────────────────────────────────────────────────
class TestParsePage:
    def test_collects_scripts(self):
        page = scw.parse_page(HTML_PRE_CONSENT)
        srcs = [s["src"] for s in page.scripts if s["src"]]
        assert "https://www.googletagmanager.com/gtag/js?id=G-XXXX" in srcs
        assert "https://connect.facebook.net/en_US/fbevents.js" in srcs

    def test_collects_inline_script(self):
        page = scw.parse_page(HTML_PRE_CONSENT)
        inlines = [s["inline"] for s in page.scripts if s["inline"]]
        assert any("gtag('config'" in i for i in inlines)

    def test_collects_checked_checkboxes_with_labels(self):
        page = scw.parse_page(HTML_DARK_PATTERNS)
        checked = [c for c in page.checkboxes if c["checked"]]
        assert {c["name"] for c in checked} == {"marketing_optin", "third_party_sharing"}
        nl = next(c for c in page.checkboxes if c["id"] == "newsletter")
        assert "marketing offers" in nl["label"]

    def test_collects_clickables_and_hidden_style(self):
        page = scw.parse_page(HTML_DARK_PATTERNS)
        accept = [c for c in page.clickables if c["text"] == "Accept all"]
        reject = [c for c in page.clickables if "Reject" in c["text"]]
        assert accept and reject
        assert reject[0]["hidden"] is True
        assert accept[0]["hidden"] is False


# ── tracker detection ─────────────────────────────────────────────────────────
class TestDetectTrackers:
    def test_pre_consent_trackers_flagged(self):
        page = scw.parse_page(HTML_PRE_CONSENT)
        trackers = scw.detect_trackers(page, BASE, SIGNATURES)
        names = {t["tracker_name"] for t in trackers}
        assert {"google-analytics", "facebook-pixel"} <= names
        assert all(not t["gated"] for t in trackers)
        fb = next(t for t in trackers if t["tracker_name"] == "facebook-pixel")
        assert fb["severity"] == "critical"

    def test_cmp_gated_script_not_pre_consent(self):
        page = scw.parse_page(HTML_GATED_WITH_BANNER)
        trackers = scw.detect_trackers(page, BASE, SIGNATURES)
        ga = [t for t in trackers if t["tracker_name"] == "google-analytics"]
        assert ga and all(t["gated"] for t in ga)

    def test_first_party_script_not_flagged(self):
        page = scw.parse_page(HTML_NO_BANNER_NO_TRACKERS)
        assert scw.detect_trackers(page, BASE, SIGNATURES) == []

    def test_inline_pattern_match(self):
        html = '<html><head><script>window.fbq = function(){}; fbq("init","123");</script></head></html>'
        page = scw.parse_page(html)
        trackers = scw.detect_trackers(page, BASE, SIGNATURES)
        assert any(t["tracker_name"] == "facebook-pixel" and t["kind"] == "inline_script" for t in trackers)

    def test_third_party_1x1_pixel_heuristic(self):
        html = '<html><body><img src="https://track.unknown-adnet.example/p.gif" width="1" height="1"></body></html>'
        page = scw.parse_page(html)
        trackers = scw.detect_trackers(page, BASE, SIGNATURES)
        assert any(t["tracker_name"] == "unknown-1x1-pixel" for t in trackers)


# ── consent banner detection ──────────────────────────────────────────────────
class TestConsentBanner:
    @pytest.mark.parametrize("html,expected", [
        (HTML_GATED_WITH_BANNER, True),
        (HTML_PRE_CONSENT, False),
        (HTML_NO_BANNER_NO_TRACKERS, False),
        ('<div id="onetrust-banner-sdk">x</div>', True),
        ('<p>We use cookies to personalise content.</p>', True),
        ('<p>Welcome to our site.</p>', False),
    ])
    def test_banner_presence(self, html, expected):
        page = scw.parse_page(html)
        assert scw.detect_consent_banner(html, page)["present"] is expected


# ── dark patterns ─────────────────────────────────────────────────────────────
class TestDarkPatterns:
    def test_preticked_marketing_checkboxes(self):
        page = scw.parse_page(HTML_DARK_PATTERNS)
        findings = scw.detect_dark_patterns(HTML_DARK_PATTERNS, page)
        preticked = [f for f in findings if f["finding_type"] == "dark_pattern_preticked"]
        assert len(preticked) == 2
        assert all(f["severity"] == "high" for f in preticked)

    def test_unchecked_checkbox_not_flagged(self):
        page = scw.parse_page(HTML_DARK_PATTERNS)
        findings = scw.detect_dark_patterns(HTML_DARK_PATTERNS, page)
        preticked = [f for f in findings if f["finding_type"] == "dark_pattern_preticked"]
        assert all("terms" not in str(f["element"]) for f in preticked)

    def test_asymmetric_choice_hidden_reject(self):
        page = scw.parse_page(HTML_DARK_PATTERNS)
        findings = scw.detect_dark_patterns(HTML_DARK_PATTERNS, page)
        asym = [f for f in findings if f["finding_type"] == "dark_pattern_asymmetric_choice"]
        assert len(asym) == 1
        assert "hidden" in asym[0]["detail"]

    def test_symmetric_choice_not_flagged(self):
        page = scw.parse_page(HTML_GATED_WITH_BANNER)
        findings = scw.detect_dark_patterns(HTML_GATED_WITH_BANNER, page)
        assert not [f for f in findings if f["finding_type"] == "dark_pattern_asymmetric_choice"]

    def test_forced_account_wall(self):
        page = scw.parse_page(HTML_DARK_PATTERNS)
        findings = scw.detect_dark_patterns(HTML_DARK_PATTERNS, page)
        assert any(f["finding_type"] == "dark_pattern_forced_account" for f in findings)

    def test_clean_page_has_no_dark_patterns(self):
        page = scw.parse_page(HTML_NO_BANNER_NO_TRACKERS)
        assert scw.detect_dark_patterns(HTML_NO_BANNER_NO_TRACKERS, page) == []


# ── cookie analysis ───────────────────────────────────────────────────────────
class TestCookieAnalysis:
    def test_tracking_cookie_flagged_non_essential(self):
        cookies = scw.analyze_cookies(
            ["_ga=GA1.2.123; Max-Age=63072000; Path=/; SameSite=Lax"], SIGNATURES)
        assert len(cookies) == 1
        assert cookies[0]["essential"] is False
        assert cookies[0]["tracker_name"] == "google-analytics"
        # raw cookie value must never be stored — only a digest
        assert "123" not in str(cookies[0])
        assert cookies[0]["value_sha256"]

    def test_session_cookie_essential(self):
        cookies = scw.analyze_cookies(["PHPSESSID=abc; Path=/; HttpOnly"], SIGNATURES)
        assert cookies[0]["essential"] is True

    def test_unknown_long_lived_cookie_non_essential(self):
        cookies = scw.analyze_cookies(
            ["mystery=xyz; Expires=Wed, 01 Jan 2031 00:00:00 GMT"], SIGNATURES)
        assert cookies[0]["essential"] is False

    def test_unknown_session_cookie_treated_essential_low_risk(self):
        cookies = scw.analyze_cookies(["cart_token=tok; Path=/"], SIGNATURES)
        assert cookies[0]["essential"] is True

    def test_short_lived_unknown_cookie_essential(self):
        cookies = scw.analyze_cookies(["lb=node1; Max-Age=3600"], SIGNATURES)
        assert cookies[0]["essential"] is True


# ── suppression matching (pure logic) ─────────────────────────────────────────
class TestSuppressions:
    SUPP = [
        {"id": 7, "scope": "finding_type", "finding_type": "tracker_detected", "tracker_name": None, "target_id": None},
        {"id": 9, "scope": "tracker", "finding_type": None, "tracker_name": "matomo-cloud", "target_id": 3},
    ]

    def test_finding_type_scope(self):
        f = {"finding_type": "tracker_detected", "tracker_name": "hotjar"}
        assert scw.is_suppressed(f, target_id=1, suppressions=self.SUPP) == 7

    def test_tracker_scope_target_limited(self):
        f = {"finding_type": "pre_consent_tracker", "tracker_name": "matomo-cloud"}
        assert scw.is_suppressed(f, target_id=3, suppressions=self.SUPP) == 9
        assert scw.is_suppressed(f, target_id=4, suppressions=self.SUPP) is None


# ── /health (no network: explicit UNCONFIGURED path) ─────────────────────────
class TestHealth:
    def test_health_unconfigured_without_db_url(self, monkeypatch):
        monkeypatch.setattr(scw, "DB_URL", "")
        payload = scw.health_payload()
        assert payload["status"] == "UNCONFIGURED"
        assert payload["database"]["configured"] is False

    def test_health_degraded_when_db_unreachable(self, monkeypatch):
        monkeypatch.setattr(scw, "DB_URL", "postgresql://invalid:1/db")
        monkeypatch.setattr(scw, "_connect", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
        payload = scw.health_payload()
        assert payload["status"] == "degraded"
        assert payload["database"]["status"] == "unreachable"


# ── pattern matching edge cases ───────────────────────────────────────────────
class TestMatchPattern:
    def test_regex(self):
        assert scw.match_pattern(r"^_(ga|gid)", "_ga") is True
        assert scw.match_pattern(r"^_(ga|gid)", "x_ga") is False

    def test_invalid_regex_falls_back_to_substring(self):
        assert scw.match_pattern("goog[", "x-goog[-y") is True
        assert scw.match_pattern("goog[", "nothing") is False

    def test_case_insensitive_substring(self):
        assert scw.match_pattern("Google-Analytics.com", "www.google-analytics.com") is True

    def test_none_pattern(self):
        assert scw.match_pattern(None, "anything") is False
