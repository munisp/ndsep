-- Migration 0148: infrastructure risk watch (round 13, W6 / P2.8 + P2.9).
--
-- Two early-warning surfaces driven by OSIRIS physical-world feeds
-- (server/osiris/disasterClient.ts, server/osiris/maritimeClient.ts) and
-- assessed by server/services/infrastructureRiskWatch.ts:
--
--   availability_risk_events   disaster-driven availability risk for the
--                              data-center locations declared on hosting
--                              declarations (migration 0094). One row per
--                              (declaration, declared location, hazard
--                              event) triangulation that breaches a
--                              proximity threshold:
--                                earthquake  M>=4.5 within 100 km
--                                fire        FIRMS hotspot within 50 km
--                                severe_weather EONET event within 150 km
--                              Status machine: open -> acknowledged ->
--                              closed. UNIQUE(...) makes repeat sweeps
--                              idempotent (re-assessment refreshes
--                              distance_km/assessed_at, never duplicates).
--
--   cable_landing_points       reference seed of Nigerian submarine-cable
--                              landing stations. Coordinates are
--                              APPROXIMATE, derived from public sources;
--                              provenance is stamped 'public-approx-2026-10'
--                              and every row carries the note
--                              'approximate — public sources'. They are
--                              watch anchors, not engineering survey data.
--
--   cable_watch_alerts         maritime early-warning: a vessel observed
--                              within 2 km of a cable landing point AND
--                              either travelling < 1 knot or reporting a
--                              stationary nav status (anchored/moored).
--                              Signal copy: "possible anchoring/trawling
--                              risk near cable landing — physical-layer
--                              resilience". This is an EARLY-WARNING signal
--                              only, never an accusation. One row per
--                              (cable point, vessel) — repeat sightings
--                              update last_seen_at.
--
-- Idempotent: IF NOT EXISTS / ON CONFLICT guards throughout.
-- PostgreSQL only (uuid default gen_random_uuid(), core since PG13).

-- ─── 1. Cable landing reference points ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS cable_landing_points (
  id            BIGSERIAL PRIMARY KEY,
  cable_system  TEXT NOT NULL,               -- 'MainOne', 'Glo-1', 'WACS', 'ACE', '2Africa', 'SAT-3'
  name          TEXT NOT NULL,               -- landing-station descriptor
  city          TEXT,
  country       TEXT NOT NULL DEFAULT 'NG',  -- ISO-3166 alpha-2
  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,
  provenance    TEXT NOT NULL,               -- e.g. 'public-approx-2026-10'
  note          TEXT,                        -- 'approximate — public sources'
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cable_system, name)
);

-- Seed: six Nigerian submarine-cable landing points.
-- Lekki/Alpha Beach (Lagos) hosts MainOne, Glo-1, WACS, ACE and 2Africa;
-- SAT-3 lands at Bonny Island. Coordinates are approximate, compiled from
-- public sources (telegeography-style public maps / press reports), NOT
-- survey data — provenance 'public-approx-2026-10'.
INSERT INTO cable_landing_points
  (cable_system, name, city, country, latitude, longitude, provenance, note)
VALUES
  ('MainOne', 'MainOne Cable Landing Station', 'Lekki, Lagos', 'NG', 6.4410, 3.4730, 'public-approx-2026-10', 'approximate — public sources'),
  ('Glo-1',   'Glo-1 Landing Station',         'Alpha Beach, Lagos', 'NG', 6.4300, 3.4400, 'public-approx-2026-10', 'approximate — public sources'),
  ('WACS',    'WACS Landing Station',          'Lekki, Lagos', 'NG', 6.4400, 3.4700, 'public-approx-2026-10', 'approximate — public sources'),
  ('ACE',     'ACE Landing Station',           'Lekki, Lagos', 'NG', 6.4415, 3.4725, 'public-approx-2026-10', 'approximate — public sources'),
  ('2Africa', '2Africa Landing Station',       'Lekki, Lagos', 'NG', 6.4405, 3.4735, 'public-approx-2026-10', 'approximate — public sources'),
  ('SAT-3',   'SAT-3 Landing Station',         'Bonny Island', 'NG', 4.4520, 7.1680, 'public-approx-2026-10', 'approximate — public sources')
ON CONFLICT (cable_system, name) DO NOTHING;

-- ─── 2. Disaster-driven availability risk events ────────────────────────────
CREATE TABLE IF NOT EXISTS availability_risk_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id  BIGINT NOT NULL REFERENCES hosting_declarations(id) ON DELETE CASCADE,
  location_name   TEXT NOT NULL,             -- declared location descriptor (dc name / city)
  latitude        DOUBLE PRECISION NOT NULL, -- derived coordinates of the declared location
  longitude       DOUBLE PRECISION NOT NULL,
  event_type      TEXT NOT NULL
                  CHECK (event_type IN ('earthquake', 'fire', 'severe_weather')),
  event_ref       TEXT NOT NULL,             -- OSIRIS/USGS/FIRMS/EONET event id
  magnitude       NUMERIC,                   -- earthquake magnitude; NULL for fire/weather
  severity        TEXT,                      -- free-text severity hint (e.g. FRP band, EONET category)
  distance_km     NUMERIC NOT NULL,
  assessed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'acknowledged', 'closed')),
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMPTZ,
  UNIQUE (declaration_id, location_name, event_type, event_ref)
);

CREATE INDEX IF NOT EXISTS idx_availability_risk_events_status
  ON availability_risk_events (status, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_availability_risk_events_declaration
  ON availability_risk_events (declaration_id, assessed_at DESC);

-- ─── 3. Cable-landing maritime watch alerts ─────────────────────────────────
CREATE TABLE IF NOT EXISTS cable_watch_alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cable_point_id   BIGINT NOT NULL REFERENCES cable_landing_points(id) ON DELETE CASCADE,
  cable_point_name TEXT NOT NULL,            -- denormalised for alert display
  cable_system     TEXT NOT NULL,
  vessel_mmsi      TEXT NOT NULL,
  vessel_name      TEXT,
  latitude         DOUBLE PRECISION NOT NULL, -- vessel position at first sighting
  longitude        DOUBLE PRECISION NOT NULL,
  speed_knots      NUMERIC,
  vessel_status    TEXT,                     -- raw nav status at sighting
  distance_km      NUMERIC NOT NULL,         -- closest observed distance to the point
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  status           TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'acknowledged', 'closed')),
  acknowledged_by  TEXT,
  acknowledged_at  TIMESTAMPTZ,
  UNIQUE (cable_point_id, vessel_mmsi)
);

CREATE INDEX IF NOT EXISTS idx_cable_watch_alerts_status
  ON cable_watch_alerts (status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_cable_watch_alerts_point
  ON cable_watch_alerts (cable_point_id, last_seen_at DESC);
