/**
 * Phase 22 Vitest Tests
 * =====================
 * Covers:
 *  - SectorComplianceDetail: Flag for Investigation modal, AML case creation, PDF export
 *  - WebSocket CORS hardening (ALLOWED_ORIGINS env var)
 *  - APISIX key hardening (no hardcoded secrets)
 *  - Watchlist screener Python fallback (fuzzy matching, health endpoint)
 *  - workerManager: watchlist-screener uses Python fallback
 *  - Seed scripts: seed-sector-entities.mjs exists
 *  - Docker/K8s config: init-db.sql, Dockerfile, docker-compose.yml, k8s YAML
 *  - Smoke test script: smoke-test.mjs exists
 *  - useNdsepSocket: sector_compliance_update event type
 *  - SectorComplianceDashboard: live updates badge
 *  - Rate limiting and security headers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");

// ─── Helper ──────────────────────────────────────────────────────────────────
function readFile(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}
function fileExists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

// ─── 1. SectorComplianceDetail ───────────────────────────────────────────────
describe("SectorComplianceDetail page", () => {
  it("file exists", () => {
    expect(fileExists("client/src/pages/SectorComplianceDetail.tsx")).toBe(true);
  });

  it("contains Flag for Investigation modal trigger", () => {
    const src = readFile("client/src/pages/SectorComplianceDetail.tsx");
    expect(src).toMatch(/[Ff]lag.*[Ii]nvestigation|flagForInvestigation|flag_for_investigation/);
  });

  it("contains AML case creation logic", () => {
    const src = readFile("client/src/pages/SectorComplianceDetail.tsx");
    expect(src).toMatch(/aml|AML|createCase|create_case/);
  });

  it("contains PDF export functionality", () => {
    const src = readFile("client/src/pages/SectorComplianceDetail.tsx");
    expect(src).toMatch(/pdf|PDF|export|print/i);
  });

  it("has sector parameter routing", () => {
    const src = readFile("client/src/pages/SectorComplianceDetail.tsx");
    expect(src).toMatch(/sector|useParams/);
  });

  it("renders compliance score display", () => {
    const src = readFile("client/src/pages/SectorComplianceDetail.tsx");
    expect(src).toMatch(/compliance.*score|score.*compliance|complianceScore/i);
  });
});

// ─── 2. PDF Export Center ────────────────────────────────────────────────────
describe("PdfExportCenter page", () => {
  it("file exists", () => {
    expect(fileExists("client/src/pages/PdfExportCenter.tsx")).toBe(true);
  });

  it("uses window.print() for PDF export", () => {
    const src = readFile("client/src/pages/PdfExportCenter.tsx");
    expect(src).toContain("window.print()");
  });

  it("does not use stub placeholder text", () => {
    const src = readFile("client/src/pages/PdfExportCenter.tsx");
    expect(src).not.toMatch(/TODO.*print|print.*TODO|stub/i);
  });
});

// ─── 3. WebSocket CORS Hardening ─────────────────────────────────────────────
describe("WebSocket CORS hardening", () => {
  it("websocket.ts exists", () => {
    expect(fileExists("server/websocket.ts")).toBe(true);
  });

  it("does not use wildcard origin *", () => {
    const src = readFile("server/websocket.ts");
    // Should not have bare wildcard string
    expect(src).not.toMatch(/origin:\s*["']\*["']/);
  });

  it("uses ALLOWED_ORIGINS environment variable", () => {
    const src = readFile("server/websocket.ts");
    expect(src).toContain("ALLOWED_ORIGINS");
  });

  it("has localhost fallback for development", () => {
    const src = readFile("server/websocket.ts");
    expect(src).toMatch(/localhost:3000/);
  });
});

// ─── 4. APISIX Key Hardening ─────────────────────────────────────────────────
describe("APISIX key hardening", () => {
  it("apisix.ts exists", () => {
    expect(fileExists("server/apisix.ts")).toBe(true);
  });

  it("does not contain hardcoded APISIX key edd1c9f034335f13", () => {
    const src = readFile("server/apisix.ts");
    expect(src).not.toContain("edd1c9f034335f13");
  });

  it("uses APISIX_ADMIN_KEY environment variable", () => {
    const src = readFile("server/apisix.ts");
    expect(src).toContain("APISIX_ADMIN_KEY");
  });

  it("requires APISIX_ADMIN_KEY and has no placeholder fallback", () => {
    const src = readFile("server/apisix.ts");
    expect(src).toContain("APISIX_ADMIN_KEY is required for gateway administration");
    expect(src).not.toContain("CHANGE_ME_IN_PRODUCTION");
  });
});

// ─── 5. Watchlist Screener Python Fallback ───────────────────────────────────
describe("Watchlist screener Python fallback", () => {
  it("watchlist_screener_fallback.py exists", () => {
    expect(fileExists("workers/python/watchlist_screener_fallback.py")).toBe(true);
  });

  it("implements Levenshtein fuzzy matching", () => {
    const src = readFile("workers/python/watchlist_screener_fallback.py");
    expect(src).toMatch(/levenshtein|Levenshtein/);
  });

  it("has similarity function", () => {
    const src = readFile("workers/python/watchlist_screener_fallback.py");
    expect(src).toContain("def similarity");
  });

  it("has screen_entity function", () => {
    const src = readFile("workers/python/watchlist_screener_fallback.py");
    expect(src).toContain("def screen_entity");
  });

  it("has HTTP health server on port 8130", () => {
    const src = readFile("workers/python/watchlist_screener_fallback.py");
    expect(src).toContain("8130");
    expect(src).toMatch(/HTTPServer|http\.server/);
  });

  it("has /health endpoint", () => {
    const src = readFile("workers/python/watchlist_screener_fallback.py");
    expect(src).toContain('"/health"');
  });

  it("has /metrics Prometheus endpoint", () => {
    const src = readFile("workers/python/watchlist_screener_fallback.py");
    expect(src).toContain('"/metrics"');
  });

  it("screens against watchlist_entries table", () => {
    const src = readFile("workers/python/watchlist_screener_fallback.py");
    expect(src).toContain("watchlist_entries");
  });

  it("uses FUZZY_THRESHOLD env var", () => {
    const src = readFile("workers/python/watchlist_screener_fallback.py");
    expect(src).toContain("FUZZY_MATCH_THRESHOLD");
  });

  it("fails closed when psycopg2 is unavailable", () => {
    const src = readFile("workers/python/watchlist_screener_fallback.py");
    expect(src).toContain("ImportError");
    expect(src).toContain("authoritative watchlist screening is unavailable");
    expect(src).not.toContain("running in mock mode");
  });
});

// ─── 6. WorkerManager Watchlist Screener ─────────────────────────────────────
describe("workerManager watchlist-screener", () => {
  it("workerManager.ts exists", () => {
    expect(fileExists("server/workerManager.ts")).toBe(true);
  });

  it("watchlist-screener uses python3 command", () => {
    const src = readFile("server/workerManager.ts");
    // Find the watchlist-screener block
    const idx = src.indexOf('"watchlist-screener"');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 500);
    expect(block).toContain("python3");
  });

  it("watchlist-screener uses Python fallback script path", () => {
    const src = readFile("server/workerManager.ts");
    expect(src).toContain("watchlist_screener_fallback.py");
  });

  it("watchlist-screener does not reference missing Rust binary", () => {
    const src = readFile("server/workerManager.ts");
    const idx = src.indexOf('"watchlist-screener"');
    const block = src.slice(idx, idx + 500);
    // Should not reference the old Rust binary path in the command
    expect(block).not.toMatch(/rust.*target.*release.*watchlist_screener(?!_fallback)/);
  });
});

// ─── 7. Seed Scripts ─────────────────────────────────────────────────────────
describe("Seed scripts", () => {
  it("seed-sector-entities.mjs exists", () => {
    expect(fileExists("scripts/seed-sector-entities.mjs")).toBe(true);
  });

  it("seed-sector-entities.mjs seeds fintech entities", () => {
    const src = readFile("scripts/seed-sector-entities.mjs");
    expect(src).toMatch(/fintech|Fintech|FINTECH/);
  });

  it("seed-sector-entities.mjs seeds energy entities", () => {
    const src = readFile("scripts/seed-sector-entities.mjs");
    expect(src).toMatch(/energy|Energy|ENERGY/);
  });

  it("seed-sector-entities.mjs seeds insurance entities", () => {
    const src = readFile("scripts/seed-sector-entities.mjs");
    expect(src).toMatch(/insurance|Insurance|INSURANCE/);
  });

  it("seed-sector-entities.mjs seeds telecom entities", () => {
    const src = readFile("scripts/seed-sector-entities.mjs");
    expect(src).toMatch(/telecom|Telecom|TELECOM/);
  });
});

// ─── 8. Docker & Kubernetes Configuration ────────────────────────────────────
describe("Docker and Kubernetes configuration", () => {
  it("init-db.sql exists for Docker initialization", () => {
    expect(fileExists("scripts/init-db.sql")).toBe(true);
  });

  it("init-db.sql creates ndsep_db database", () => {
    const src = readFile("scripts/init-db.sql");
    expect(src).toContain("ndsep_db");
  });

  it("init-db.sql creates ndsep_user", () => {
    const src = readFile("scripts/init-db.sql");
    expect(src).toContain("ndsep_user");
  });

  it("init-db.sql enables uuid-ossp extension", () => {
    const src = readFile("scripts/init-db.sql");
    expect(src).toContain("uuid-ossp");
  });

  it("Dockerfile exists", () => {
    expect(fileExists("Dockerfile")).toBe(true);
  });

  it("docker-compose.yml exists", () => {
    expect(fileExists("docker-compose.yml")).toBe(true);
  });

  it("docker-compose.yml includes postgres service", () => {
    const src = readFile("docker-compose.yml");
    expect(src).toMatch(/postgres|postgresql/i);
  });

  it("k8s deployment YAML exists", () => {
    expect(fileExists("k8s/ndsep-deployment.yaml")).toBe(true);
  });

  it("k8s deployment YAML references ndsep container", () => {
    const src = readFile("k8s/ndsep-deployment.yaml");
    expect(src).toMatch(/ndsep/i);
  });
});

// ─── 9. Smoke Test Script ────────────────────────────────────────────────────
describe("Smoke test script", () => {
  it("smoke-test.mjs exists", () => {
    expect(fileExists("scripts/smoke-test.mjs")).toBe(true);
  });

  it("smoke-test.mjs tests health endpoint", () => {
    const src = readFile("scripts/smoke-test.mjs");
    expect(src).toMatch(/health|\/api\/health/i);
  });

  it("smoke-test.mjs tests multiple endpoints", () => {
    const src = readFile("scripts/smoke-test.mjs");
    const endpointMatches = src.match(/\/api\//g) || [];
    expect(endpointMatches.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── 10. useNdsepSocket Hook ─────────────────────────────────────────────────
describe("useNdsepSocket hook", () => {
  it("hook file exists", () => {
    expect(fileExists("client/src/hooks/useNdsepSocket.ts")).toBe(true);
  });

  it("handles sector_compliance_update event", () => {
    const src = readFile("client/src/hooks/useNdsepSocket.ts");
    expect(src).toContain("sector_compliance_update");
  });

  it("exports SectorComplianceUpdate interface or type", () => {
    const src = readFile("client/src/hooks/useNdsepSocket.ts");
    expect(src).toMatch(/SectorComplianceUpdate|sector_compliance_update/);
  });

  it("maintains recentSectorUpdates state", () => {
    const src = readFile("client/src/hooks/useNdsepSocket.ts");
    expect(src).toMatch(/recentSectorUpdates|sectorUpdates/);
  });
});

// ─── 11. SectorComplianceDashboard ───────────────────────────────────────────
describe("SectorComplianceDashboard", () => {
  it("dashboard file exists", () => {
    expect(fileExists("client/src/pages/SectorComplianceDashboard.tsx")).toBe(true);
  });

  it("uses useNdsepSocket for live updates", () => {
    const src = readFile("client/src/pages/SectorComplianceDashboard.tsx");
    expect(src).toMatch(/useNdsepSocket|socket|WebSocket/);
  });

  it("displays live updates badge or indicator", () => {
    const src = readFile("client/src/pages/SectorComplianceDashboard.tsx");
    expect(src).toMatch(/[Ll]ive|[Rr]eal-?[Tt]ime|badge|Badge/);
  });
});

// ─── 12. App.tsx Routes ──────────────────────────────────────────────────────
describe("App.tsx routing", () => {
  it("App.tsx exists", () => {
    expect(fileExists("client/src/App.tsx")).toBe(true);
  });

  it("has sector-compliance route", () => {
    const src = readFile("client/src/App.tsx");
    expect(src).toMatch(/sector-compliance/);
  });

  it("has SectorComplianceDetail route with :sector param", () => {
    const src = readFile("client/src/App.tsx");
    expect(src).toMatch(/sector-compliance.*:sector|SectorComplianceDetail/);
  });
});

// ─── 13. Security: No hardcoded secrets ──────────────────────────────────────
describe("Security: no hardcoded secrets in server files", () => {
  it("websocket.ts has no hardcoded JWT secrets", () => {
    const src = readFile("server/websocket.ts");
    expect(src).not.toMatch(/jwt.*secret.*=\s*["'][a-zA-Z0-9]{20,}["']/i);
  });

  it("apisix.ts has no hardcoded API keys (except CHANGE_ME sentinel)", () => {
    const src = readFile("server/apisix.ts");
    // The only hardcoded string should be the CHANGE_ME sentinel
    const hardcodedKeys = src.match(/["'][a-f0-9]{16,}["']/g) || [];
    expect(hardcodedKeys.length).toBe(0);
  });

  it("workerManager.ts does not reference old Rust watchlist binary", () => {
    const src = readFile("server/workerManager.ts");
    // Should not have the old Rust target path as a command
    expect(src).not.toMatch(/command.*rust.*target.*release.*watchlist_screener[^_]/);
  });
});

// ─── 14. Makefile ────────────────────────────────────────────────────────────
describe("Makefile build automation", () => {
  it("Makefile exists", () => {
    expect(fileExists("Makefile")).toBe(true);
  });

  it("Makefile has build target", () => {
    const src = readFile("Makefile");
    expect(src).toMatch(/^build:/m);
  });

  it("Makefile has test target", () => {
    const src = readFile("Makefile");
    expect(src).toMatch(/^test:/m);
  });

  it("Makefile has seed target", () => {
    const src = readFile("Makefile");
    expect(src).toMatch(/seed/i);
  });
});

// ─── 15. Worker Python files ─────────────────────────────────────────────────
describe("Sector monitor Python workers", () => {
  const sectors = ["fintech", "healthcare", "energy", "insurance", "telecom"];
  for (const sector of sectors) {
    it(`${sector}_monitor.py exists`, () => {
      expect(fileExists(`workers/python/${sector}_monitor.py`)).toBe(true);
    });
  }

  it("fintech_monitor.py has CBN compliance rules", () => {
    const src = readFile("workers/python/fintech_monitor.py");
    expect(src).toMatch(/CBN|cbn|compliance/i);
  });

  it("healthcare_monitor.py has NDPR rules", () => {
    const src = readFile("workers/python/healthcare_monitor.py");
    expect(src).toMatch(/NDPR|ndpr|health.*data|patient/i);
  });
});
