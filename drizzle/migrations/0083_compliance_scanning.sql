-- Migration 0083: Regulator-side web/app compliance scanning (NDPA 2023
-- ss. 25, 26, 28 — consent conditions, privacy-by-design audits; NDPC
-- Guidance Notice on cookie/consent banners).
--
-- Tables backing workers/python/scan_crawler_worker.py and
-- server/routers/complianceScanning.ts:
--
--   tracker_signatures  reference data: ~50 known third-party tracker
--                       domains / script URL patterns / inline-script
--                       markers / cookie-name patterns used by the crawler
--                       to attribute observed trackers. Seeded below; can
--                       be extended at runtime (configurable reference
--                       data, not code).
--   scan_targets        registry of controller web properties to scan.
--                       Auto-seeded from registered controllers and/or
--                       added manually by officers.
--   scan_runs           one row per scan execution (manual, scheduled or
--                       cron-style interval). The worker claims rows whose
--                       scheduled_at has passed.
--   scan_artifacts      evidence captures: SHA-256 hashes of pages,
--                       scripts and response headers per run. Sealed into
--                       the anti-wipe evidence vault + hash-chained audit
--                       ledger via complianceScanning.attestArtifact.
--   scan_findings       detected issues (pre-consent trackers, missing
--                       consent banner, dark patterns, cookies set before
--                       consent) with severity + lifecycle status.
--   scan_suppressions   allow-list / false-positive suppression workflow.
--                       Dual control: approver must differ from requester
--                       (enforced at storage layer).
--
-- Idempotent: safe to run repeatedly.

-- ─── Tracker signature reference data ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracker_signatures (
  id                  BIGSERIAL PRIMARY KEY,
  tracker_name        TEXT NOT NULL UNIQUE,        -- e.g. 'google-analytics'
  vendor              TEXT,                        -- e.g. 'Google LLC'
  category            TEXT NOT NULL DEFAULT 'analytics'
                      CHECK (category IN
                        ('analytics', 'advertising', 'social', 'tag_manager',
                         'session_replay', 'fingerprinting', 'ab_testing',
                         'consent_management', 'cdn', 'other')),
  domain_pattern      TEXT,                        -- substring/regex matched against request host
  script_url_pattern  TEXT,                        -- regex matched against full script/iframe URL
  inline_pattern      TEXT,                        -- regex matched against inline script bodies
  cookie_name_pattern TEXT,                        -- regex matched against Set-Cookie names
  default_severity    TEXT NOT NULL DEFAULT 'medium'
                      CHECK (default_severity IN ('critical', 'high', 'medium', 'low', 'info')),
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracker_signatures_active
  ON tracker_signatures (active) WHERE active = TRUE;

-- ~50 known trackers (domain_pattern is matched case-insensitively as a
-- substring of the request host unless it starts/ends with '/' (regex)).
INSERT INTO tracker_signatures
  (tracker_name, vendor, category, domain_pattern, script_url_pattern, inline_pattern, cookie_name_pattern, default_severity, notes)
VALUES
  ('google-analytics',        'Google',      'analytics',      'google-analytics.com', 'googletagmanager\.com/gtag/js|google-analytics\.com/(analytics|ga)\.js', 'gtag\(|ga\(''create''', '^_(ga|gid|gat)(_|\b)|^__utm[abcevzt]', 'high',   'GA4 / Universal Analytics'),
  ('google-tag-manager',      'Google',      'tag_manager',    'googletagmanager.com', 'googletagmanager\.com/gtm\.js', 'dataLayer', '^_gcl_', 'medium', 'Loads arbitrary third-party tags'),
  ('google-ads',              'Google',      'advertising',    'googleadservices.com', 'googleadservices\.com|googlesyndication\.com', 'google_conversion', '^_gcl_(aw|dc|gb)', 'high', 'Ads conversion tracking'),
  ('doubleclick',             'Google',      'advertising',    'doubleclick.net',      'doubleclick\.net|securepubads\.g\.doubleclick\.net', 'adserver\.doubleclick', '^IDE$|^test_cookie$', 'high', 'Ad exchange / retargeting'),
  ('google-syndication',      'Google',      'advertising',    'googlesyndication.com','googlesyndication\.com/pagead', NULL, '^__gads|^__gpi', 'high', 'AdSense'),
  ('facebook-pixel',          'Meta',        'advertising',    'connect.facebook.net', 'connect\.facebook\.net/.*/fbevents\.js', 'fbq\(', '^_fbp$|^_fbc$|^fr$', 'critical', 'Meta pixel — cross-site profiling'),
  ('facebook-sdk',            'Meta',        'social',         'facebook.net',         'connect\.facebook\.net/.*/sdk\.js', 'FB\.init', NULL, 'high', 'Social plugin tracking'),
  ('tiktok-pixel',            'TikTok',      'advertising',    'analytics.tiktok.com', 'analytics\.tiktok\.com/.*/pixel\.js', 'ttq\.', '^_ttp$|^tt_sessionid', 'high', NULL),
  ('twitter-pixel',           'X Corp',      'advertising',    'static.ads-twitter.com','static\.ads-twitter\.com/uwt\.js', 'twq\(', '^personalization_id$|^muc_ads$', 'high', NULL),
  ('linkedin-insight',        'LinkedIn',    'advertising',    'snap.licdn.com',       'snap\.licdn\.com/li\.lms-analytics/insight\.min\.js', '_linkedin_partner_id', '^li_fat_id$|^lidc$|^bcookie$', 'high', NULL),
  ('bing-uet',                'Microsoft',   'advertising',    'bat.bing.com',         'bat\.bing\.com/bat\.js', 'uetq', '^_uet(sid|vid)$|^MUID', 'high', 'Universal Event Tracking'),
  ('clarity',                 'Microsoft',   'session_replay', 'clarity.ms',           'clarity\.ms/tag/', 'clarity\(', '^_clck$|^_clsk$|^CLID$', 'high', 'Session recording / heatmaps'),
  ('hotjar',                  'Hotjar',      'session_replay', 'hotjar.com',           'static\.hotjar\.com/c/hotjar-', 'hj\(', '^_hj(Session|id|TLDTest|IncludedIn)', 'high', 'Session recording'),
  ('fullstory',               'FullStory',   'session_replay', 'fullstory.com',        'edge\.fullstory\.com/s/fs\.js', 'FS\(', '^fs_uid', 'high', 'Session recording'),
  ('mouseflow',               'Mouseflow',   'session_replay', 'mouseflow.com',        'cdn\.mouseflow\.com/projects/', 'mouseflow', '^mf_', 'high', NULL),
  ('crazy-egg',               'Crazy Egg',   'session_replay', 'crazyegg.com',         'script\.crazyegg\.com/pages/scripts/', NULL, '^_ceg?\.', 'medium', NULL),
  ('mixpanel',                'Mixpanel',    'analytics',      'mixpanel.com',         'cdn\.mxpnl\.com/libs/mixpanel', 'mixpanel\.init', '^mp_[a-f0-9]+_mixpanel', 'medium', NULL),
  ('amplitude',               'Amplitude',   'analytics',      'amplitude.com',        'cdn\.amplitude\.com/libs/amplitude', 'amplitude\.getInstance', '^amp_[a-f0-9]', 'medium', NULL),
  ('segment',                 'Twilio',      'tag_manager',    'segment.com',          'cdn\.segment\.com/analytics\.js', 'analytics\.load', '^ajs_(anonymous_id|user_id)', 'medium', 'CDP — fans data out to many vendors'),
  ('heap',                    'Heap',        'analytics',      'heapanalytics.com',    'cdn\.heapanalytics\.com/js/heap-', 'heap\.load', '^_hp2_(id|ses)', 'medium', 'Autocapture analytics'),
  ('matomo-cloud',            'Matomo',      'analytics',      'matomo.cloud',         'matomo\.(cloud|js)|piwik\.js', '_paq\.push', '^_pk_(id|ses)', 'low', 'Privacy-friendlier; still needs consent pre-banner'),
  ('adobe-analytics',         'Adobe',       'analytics',      'omtrdc.net',           'omtrdc\.net|assets\.adobedtm\.com', 's_code|AppMeasurement', '^s_(cc|sq|vi|fid)$|^AMCV_', 'high', NULL),
  ('adobe-target',            'Adobe',       'ab_testing',     'tt.omtrdc.net',        'tt\.omtrdc\.net|at\.js', 'adobe\.target', '^mbox', 'medium', NULL),
  ('optimizely',              'Optimizely',  'ab_testing',     'optimizely.com',       'cdn\.optimizely\.com/js/', 'optimizely', '^optimizely(EndUserId|Buckets|Segments)', 'medium', 'Runs experiments pre-consent if ungated'),
  ('vwo',                     'Wingify',     'ab_testing',     'visualwebsiteoptimizer.com', 'dev\.visualwebsiteoptimizer\.com', 'vwo_', '^_vwo', 'medium', NULL),
  ('criteo',                  'Criteo',      'advertising',    'criteo.com',           '(static|sslwidget)\.criteo\.net', 'criteo_q', '^uid$|^optout$', 'high', 'Retargeting'),
  ('taboola',                 'Taboola',     'advertising',    'taboola.com',          'cdn\.taboola\.com/libtrc', '_tfa', '^t_gid$', 'high', 'Content recommendation / tracking'),
  ('outbrain',                'Outbrain',    'advertising',    'outbrain.com',         'widgets\.outbrain\.com/outbrain\.js', 'OB\_', '^obuid', 'high', NULL),
  ('pinterest-tag',           'Pinterest',   'advertising',    'ct.pinterest.com',     's\.pinimg\.com/ct/core\.js', 'pintrk\(', '^_pinterest_ct', 'high', NULL),
  ('snapchat-pixel',          'Snap',        'advertising',    'sc-static.net',        'sc-static\.net/scevent\.min\.js', 'snaptr\(', '^_scid', 'high', NULL),
  ('reddit-pixel',            'Reddit',      'advertising',    'alb.reddit.com',       'alb\.reddit\.com/snoo\.js', 'rdt\(', '^_rdt_', 'medium', NULL),
  ('quora-pixel',             'Quora',       'advertising',    'q.quora.com',          'a\.quora\.com/qevents\.js', 'qp\(', NULL, 'medium', NULL),
  ('yandex-metrica',          'Yandex',      'analytics',      'mc.yandex.ru',         'mc\.yandex\.ru/metrika/(tag|watch)\.js', 'ym\(', '^_ym_(uid|d|isad)', 'high', 'Session replay (webvisor) capable'),
  ('baidu-analytics',         'Baidu',       'analytics',      'hm.baidu.com',         'hm\.baidu\.com/hm\.js', '_hmt', '^Hm_lvt|^Hm_lpvt', 'medium', NULL),
  ('appsflyer',               'AppsFlyer',   'advertising',    'appsflyer.com',        'onelink\.me|app\.appsflyer\.com', 'AF\(', NULL, 'medium', 'Mobile attribution deep links'),
  ('adjust',                  'Adjust',      'advertising',    'adjust.com',           'app\.adjust\.com|adjust\.io', 'Adjust\.initSdk', NULL, 'medium', 'Mobile attribution'),
  ('branch',                  'Branch',      'advertising',    'branch.io',            'cdn\.branch\.io/branch', 'branch\.init', NULL, 'medium', 'Deep-link attribution'),
  ('kochava',                 'Kochava',     'advertising',    'kochava.com',          'control\.kochava\.com', NULL, NULL, 'medium', NULL),
  ('datadome',                'DataDome',    'fingerprinting', 'datadome.co',          'js\.datadome\.co/tags\.js', 'datadome', '^datadome$', 'medium', 'Bot mgmt; device fingerprinting'),
  ('fingerprintjs',           'Fingerprint', 'fingerprinting', 'fpjs.io',              'cdn\.fpjs\.(io|pro)|fpnpmcdn\.net', 'FingerprintJS', '^_vid', 'critical', 'Explicit device fingerprinting'),
  ('imperva-incapsula',       'Imperva',     'fingerprinting', 'incapdns.net',         '_Incapsula_Resource', 'incap_ses', '^(incap_ses|visid_incap)', 'low', 'WAF; fingerprinting-adjacent'),
  ('perimeterx',              'HUMAN',       'fingerprinting', 'px-cdn.net',           'px-cdn\.net|px-cloud\.net', '_pxAppId', '^_px[0-9a-z]*$', 'medium', 'Bot defense; fingerprinting'),
  ('recaptcha',               'Google',      'fingerprinting', 'google.com/recaptcha', 'google\.com/recaptcha/(api|enterprise)\.js', 'grecaptcha', NULL, 'low', 'Phones home to Google when rendered'),
  ('akamai-bm',               'Akamai',      'fingerprinting', 'akamaized.net',        'akam/\d+/pixel_', 'bmak', '^ak_bmsc$|^bm_sv$', 'low', NULL),
  ('new-relic',               'New Relic',   'analytics',      'nr-data.net',          'js-agent\.newrelic\.com/nr-', 'newrelic', NULL, 'low', 'RUM beacons; usually exempt-able'),
  ('sentry-performance',      'Sentry',      'analytics',      'sentry.io',            'browser\.sentry-cdn\.com', 'Sentry\.init', NULL, 'low', 'Error/perf telemetry; check DSN region'),
  ('intercom',                'Intercom',    'social',         'intercom.io',          'widget\.intercom\.io/widget/', 'Intercom\(', '^intercom-(id|session)', 'medium', 'Chat widget sets tracking cookies'),
  ('zendesk',                 'Zendesk',     'social',         'zdassets.com',         'static\.zdassets\.com/ekr/snippet\.js', 'zE\(', '__zlcmid', 'medium', 'Chat widget'),
  ('hubspot',                 'HubSpot',     'advertising',    'hs-analytics.net',     'js\.(hs-analytics|hs-scripts)\.net|hs-scripts\.com', '_hsq', '^hubspotutk$|^__hs', 'high', 'Marketing automation tracking'),
  ('marketo',                 'Adobe',       'advertising',    'marketo.net',          'munchkin\.marketo\.net/munchkin\.js', 'Munchkin\.init', '^_mkto_trk', 'high', 'Lead tracking'),
  ('pardot',                  'Salesforce',  'advertising',    'pardot.com',           'pi\.pardot\.com/pd\.js', 'piAId', '^visitor_id', 'high', NULL),
  ('salesforce-dmp',          'Salesforce',  'advertising',    'krxd.net',             'cdn\.krxd\.net/controltag', 'Krux', '^_kuid_', 'critical', 'Data management platform / broker'),
  ('rubicon',                 'Magnite',     'advertising',    'rubiconproject.com',   'fastlane\.rubiconproject\.com', 'rubicon', '^khaos$|^audit$', 'high', 'Ad exchange'),
  ('pubmatic',                'PubMatic',    'advertising',    'pubmatic.com',         'ads\.pubmatic\.com/AdServer', 'pubmatic', '^KRTBCOOKIE_|^PUBMDCID', 'high', 'Ad exchange'),
  ('amazon-adsystem',         'Amazon',      'advertising',    'amazon-adsystem.com',  'amazon-adsystem\.com/aax2/apstag\.js', 'apstag', '^ad-id$|^ad-privacy$', 'high', NULL),
  ('index-exchange',          'Index Exchange', 'advertising', 'casalemedia.com',      'js-sec\.indexww\.com', 'casale', '^CMPRO$|^CMPS$', 'high', NULL),
  ('openx',                   'OpenX',       'advertising',    'openx.net',            'ox-d\..*\.openx\.net', 'OX_', '^i$', 'high', NULL),
  ('quantcast',               'Quantcast',   'advertising',    'quantserve.com',       'edge\.quantserve\.com/quant\.js', '_qevents', '^__qca$|^d$|^mc$', 'high', NULL),
  ('scorecardresearch',       'Comscore',    'analytics',      'scorecardresearch.com','sb\.scorecardresearch\.com/beacon\.js', 'COMSCORE', '^UIDR?$', 'medium', NULL),
  ('nielsen',                 'Nielsen',     'analytics',      'nielsen.com',          'secure-gl\.imrworldwide\.com', 'nol_t', NULL, 'medium', 'Panel measurement'),
  ('chartbeat',               'Chartbeat',   'analytics',      'chartbeat.com',        'static\.chartbeat\.com/js/chartbeat', '_sf_async_config', '^_cb', 'medium', NULL),
  ('parsely',                 'Parse.ly',    'analytics',      'parsely.com',          'cdn\.parsely\.com/keys/', 'PARSELY', '^_parsely_visitor', 'medium', NULL)
ON CONFLICT (tracker_name) DO NOTHING;

-- ─── Scan targets ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_targets (
  id                  BIGSERIAL PRIMARY KEY,
  organization_id     INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  controller_name     TEXT NOT NULL,
  base_url            TEXT NOT NULL UNIQUE,        -- https://example.ng (scheme required)
  source              TEXT NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('auto_seed', 'manual')),
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  scan_interval_hours INTEGER NOT NULL DEFAULT 168, -- cron-style: weekly default
  crawl_paths         JSONB NOT NULL DEFAULT '[]',  -- extra paths beyond '/'
  max_pages           INTEGER NOT NULL DEFAULT 5 CHECK (max_pages BETWEEN 1 AND 50),
  notes               TEXT,
  last_scanned_at     TIMESTAMPTZ,
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_targets_org
  ON scan_targets (organization_id);
CREATE INDEX IF NOT EXISTS idx_scan_targets_enabled
  ON scan_targets (enabled) WHERE enabled = TRUE;

-- ─── Scan runs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_runs (
  id               BIGSERIAL PRIMARY KEY,
  target_id        BIGINT NOT NULL REFERENCES scan_targets(id) ON DELETE CASCADE,
  trigger_type     TEXT NOT NULL DEFAULT 'manual'
                   CHECK (trigger_type IN ('manual', 'scheduled', 'cron')),
  status           TEXT NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'running', 'completed', 'failed', 'cancelled')),
  scheduled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  pages_scanned    INTEGER NOT NULL DEFAULT 0,
  trackers_detected INTEGER NOT NULL DEFAULT 0,
  findings_count   INTEGER NOT NULL DEFAULT 0,
  error            TEXT,
  run_metadata     JSONB NOT NULL DEFAULT '{}',
  created_by       TEXT,                          -- officer ref for manual runs; NULL for cron
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_runs_target
  ON scan_runs (target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_runs_due
  ON scan_runs (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_scan_runs_status
  ON scan_runs (status, created_at DESC);

-- ─── Evidence artifacts (hash-sealed via antiwipe vault + ledger) ────────────
CREATE TABLE IF NOT EXISTS scan_artifacts (
  id            BIGSERIAL PRIMARY KEY,
  run_id        BIGINT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  target_id     BIGINT NOT NULL REFERENCES scan_targets(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL
                CHECK (artifact_type IN ('page_html', 'script', 'headers', 'cookie_report', 'screenshot')),
  url           TEXT NOT NULL,
  sha256        CHAR(64) NOT NULL,               -- content address; worker-computed
  size_bytes    BIGINT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata      JSONB NOT NULL DEFAULT '{}',
  attested      BOOLEAN NOT NULL DEFAULT FALSE,   -- set by attestArtifact (vault + hash chain)
  attested_by   TEXT,
  attested_at   TIMESTAMPTZ,
  ledger_seq    BIGINT,                           -- audit_ledger.seq of the attestation entry
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, artifact_type, sha256)
);

CREATE INDEX IF NOT EXISTS idx_scan_artifacts_run
  ON scan_artifacts (run_id);
CREATE INDEX IF NOT EXISTS idx_scan_artifacts_unattested
  ON scan_artifacts (attested) WHERE attested = FALSE;

-- ─── Findings ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_findings (
  id                   BIGSERIAL PRIMARY KEY,
  run_id               BIGINT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  target_id            BIGINT NOT NULL REFERENCES scan_targets(id) ON DELETE CASCADE,
  finding_type         TEXT NOT NULL
                       CHECK (finding_type IN
                         ('pre_consent_tracker', 'missing_consent_banner',
                          'cookie_before_consent',
                          'dark_pattern_preticked', 'dark_pattern_asymmetric_choice',
                          'dark_pattern_forced_account',
                          'tracker_detected', 'fetch_error')),
  severity             TEXT NOT NULL DEFAULT 'medium'
                       CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  url                  TEXT NOT NULL,
  tracker_name         TEXT,                     -- set for tracker findings
  evidence             JSONB NOT NULL DEFAULT '{}', -- hashes, matched signature, snippet refs
  status               TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'acknowledged', 'suppressed',
                                         'referred', 'resolved', 'dismissed')),
  suppression_id       BIGINT,
  enforcement_action_id INTEGER REFERENCES enforcement_actions(id) ON DELETE SET NULL,
  detected_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at          TIMESTAMPTZ,
  resolved_by          TEXT,
  resolution_notes     TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_findings_target
  ON scan_findings (target_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_findings_status
  ON scan_findings (status, severity);
CREATE INDEX IF NOT EXISTS idx_scan_findings_run
  ON scan_findings (run_id);

-- ─── Suppression / allow-list workflow (dual control) ────────────────────────
CREATE TABLE IF NOT EXISTS scan_suppressions (
  id           BIGSERIAL PRIMARY KEY,
  scope        TEXT NOT NULL DEFAULT 'finding_type'
               CHECK (scope IN ('finding_type', 'tracker', 'target', 'finding')),
  finding_type TEXT,                              -- scope='finding_type'
  tracker_name TEXT,                              -- scope='tracker'
  target_id    BIGINT REFERENCES scan_targets(id) ON DELETE CASCADE,
  finding_id   BIGINT REFERENCES scan_findings(id) ON DELETE CASCADE,
  reason       TEXT NOT NULL,                     -- min-length enforced by router
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'revoked')),
  requested_by TEXT NOT NULL,
  approved_by  TEXT,                              -- dual control: must differ from requester
  approved_at  TIMESTAMPTZ,
  rejection_reason TEXT,
  expires_at   TIMESTAMPTZ,                       -- optional time-boxed allow-list entry
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- maker-checker invariant at the storage layer:
  CONSTRAINT scan_suppressions_no_self_approval
    CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

CREATE INDEX IF NOT EXISTS idx_scan_suppressions_status
  ON scan_suppressions (status) WHERE status = 'pending';
