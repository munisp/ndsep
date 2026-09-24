/**
 * Round-8 compliance scanning / policy monitor — pure-logic reference-data
 * and wiring checks (no DB, no network, no server imports):
 *
 *  - migration 0083 seeds >= 45 unique tracker signatures idempotently;
 *  - migrations 0083/0084 create the required tables with idempotent DDL;
 *  - the crawler worker keeps the required detection passes and port/health
 *    conventions; the policy monitor keeps its material-keyword catalogue
 *    and the explicit UNCONFIGURED retry path.
 *
 * Run: npx vitest run --config tests/round8/vitest.config.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SQL_0083 = readFileSync(join(REPO, "drizzle/migrations/0083_compliance_scanning.sql"), "utf8");
const SQL_0084 = readFileSync(join(REPO, "drizzle/migrations/0084_policy_monitor.sql"), "utf8");
const CRAWLER = readFileSync(join(REPO, "workers/python/scan_crawler_worker.py"), "utf8");
const POLMON = readFileSync(join(REPO, "workers/python/policy_monitor_worker.py"), "utf8");

describe("migration 0083_compliance_scanning", () => {
  it("creates the required tables idempotently", () => {
    for (const table of ["scan_targets", "scan_runs", "scan_findings", "tracker_signatures", "scan_artifacts", "scan_suppressions"]) {
      expect(SQL_0083).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("seeds >= 45 unique tracker signatures with idempotent inserts", () => {
    const seedBlock = SQL_0083.slice(SQL_0083.indexOf("INSERT INTO tracker_signatures"));
    const names = [...seedBlock.matchAll(/^\s*\('([a-z0-9-]+)',\s*'/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(45);
    expect(new Set(names).size).toBe(names.length);
    expect(seedBlock).toContain("ON CONFLICT (tracker_name) DO NOTHING");
  });

  it("covers the mandated detection finding types", () => {
    for (const t of ["pre_consent_tracker", "missing_consent_banner", "cookie_before_consent",
      "dark_pattern_preticked", "dark_pattern_asymmetric_choice", "dark_pattern_forced_account"]) {
      expect(SQL_0083).toContain(t);
    }
  });

  it("enforces suppression dual control at the storage layer", () => {
    expect(SQL_0083).toMatch(/CHECK \(approved_by IS NULL OR approved_by <> requested_by\)/);
  });
});

describe("migration 0084_policy_monitor", () => {
  it("creates the required tables idempotently", () => {
    for (const table of ["monitored_policies", "policy_versions", "policy_reviews"]) {
      expect(SQL_0084).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("keeps an explicit UNCONFIGURED diff status with retry queue", () => {
    expect(SQL_0084).toContain("'UNCONFIGURED'");
    expect(SQL_0084).toContain("next_retry_at");
    expect(SQL_0084).toContain("retry_count");
  });

  it("stores the material_adverse classification used for review-task creation", () => {
    expect(SQL_0084).toContain("'material_adverse'");
  });
});

describe("scan_crawler_worker conventions", () => {
  it("exposes the required detection passes", () => {
    for (const fn of ["def detect_trackers(", "def detect_consent_banner(",
      "def detect_dark_patterns(", "def analyze_cookies(", "def sha256_hex("]) {
      expect(CRAWLER).toContain(fn);
    }
  });

  it("follows the port-env + /health convention", () => {
    expect(CRAWLER).toContain('os.environ.get("SCAN_CRAWLER_PORT"');
    expect(CRAWLER).toContain('"/health"');
    expect(CRAWLER).toContain("def health_payload(");
  });

  it("has an explicit UNCONFIGURED path (no silent mock)", () => {
    expect(CRAWLER).toContain('"UNCONFIGURED"');
    expect(CRAWLER).toContain("no silent fallback");
  });

  it("has no hard dependency on a headless browser", () => {
    expect(CRAWLER).not.toMatch(/^import (playwright|selenium|pyppeteer)/m);
    expect(CRAWLER).not.toMatch(/^from (playwright|selenium|pyppeteer)/m);
  });
});

describe("policy_monitor_worker conventions", () => {
  it("keeps a material-keyword catalogue with adverse and beneficial signals", () => {
    expect(POLMON).toContain("MATERIAL_KEYWORDS");
    expect(POLMON).toContain('"adverse"');
    expect(POLMON).toContain('"beneficial"');
    expect(POLMON).toContain("sell your");
    expect(POLMON).toContain("you may request deletion");
  });

  it("queues UNCONFIGURED diffs for retry instead of dropping them", () => {
    expect(POLMON).toContain("diff_status = 'UNCONFIGURED'");
    expect(POLMON).toContain("def retry_pending_diffs(");
    expect(POLMON).toContain("next_retry_at");
  });

  it("follows the port-env + /health convention", () => {
    expect(POLMON).toContain('os.environ.get("POLICY_MONITOR_PORT"');
    expect(POLMON).toContain('"/health"');
  });

  it("talks to the ollama_llm_worker over HTTP with a health check", () => {
    expect(POLMON).toContain("OLLAMA_WORKER_URL");
    expect(POLMON).toContain("def llm_worker_health(");
    expect(POLMON).toContain('f"{LLM_WORKER_URL}/generate"');
  });
});
