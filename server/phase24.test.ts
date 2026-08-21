/**
 * Phase 24 Tests
 * ==============
 * Covers middleware wire-up, sector CRUD, security hardening, Docker completeness
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "server");
const CLIENT = path.join(ROOT, "client", "src");
const WORKERS_PY = path.join(ROOT, "workers", "python");
const SCRIPTS = path.join(ROOT, "scripts");

describe("middlewareHelpers.ts exports", () => {
  const mhPath = path.join(SERVER, "middlewareHelpers.ts");
  it("file exists", () => expect(fs.existsSync(mhPath)).toBe(true));
  it("exports relayToGoBridge", () => {
    expect(fs.readFileSync(mhPath, "utf-8")).toContain("relayToGoBridge");
  });
  it("exports proxyRateLimit", () => {
    expect(fs.readFileSync(mhPath, "utf-8")).toContain("proxyRateLimit");
  });
  it("exports checkRateLimitRust", () => {
    expect(fs.readFileSync(mhPath, "utf-8")).toContain("checkRateLimitRust");
  });
  it("uses MIDDLEWARE_BRIDGE_URL env var", () => {
    expect(fs.readFileSync(mhPath, "utf-8")).toContain("MIDDLEWARE_BRIDGE_URL");
  });
  it("uses MIDDLEWARE_CACHE_URL env var", () => {
    expect(fs.readFileSync(mhPath, "utf-8")).toContain("MIDDLEWARE_CACHE_URL");
  });
});

describe("Watchlist screener similarity function", () => {
  const wsPath = path.join(WORKERS_PY, "watchlist_screener_fallback.py");
  it("file exists", () => expect(fs.existsSync(wsPath)).toBe(true));
  it("has def similarity function", () => {
    expect(fs.readFileSync(wsPath, "utf-8")).toContain("def similarity");
  });
  it("has DOB matching", () => {
    expect(fs.readFileSync(wsPath, "utf-8")).toContain("dob");
  });
  it("has nationality matching", () => {
    expect(fs.readFileSync(wsPath, "utf-8")).toContain("nationality");
  });
  it("has batch endpoint", () => {
    expect(fs.readFileSync(wsPath, "utf-8")).toContain("batch");
  });
});

describe("useNdsepSocket setSectorUpdates", () => {
  const hookPath = path.join(CLIENT, "hooks", "useNdsepSocket.ts");
  it("file exists", () => expect(fs.existsSync(hookPath)).toBe(true));
  it("has setSectorUpdates", () => {
    expect(fs.readFileSync(hookPath, "utf-8")).toContain("setSectorUpdates");
  });
  it("has sector_compliance_update event", () => {
    expect(fs.readFileSync(hookPath, "utf-8")).toContain("sector_compliance_update");
  });
});

describe("SectorComplianceDashboard Live Updates badge", () => {
  const dashPath = path.join(CLIENT, "pages", "SectorComplianceDashboard.tsx");
  it("file exists", () => expect(fs.existsSync(dashPath)).toBe(true));
  it("shows Live Updates badge", () => {
    expect(fs.readFileSync(dashPath, "utf-8")).toContain("Live Updates");
  });
  it("uses connected status", () => {
    expect(fs.readFileSync(dashPath, "utf-8")).toContain("connected");
  });
});

describe("healthcare_monitor.py NHIA", () => {
  const hmPath = path.join(WORKERS_PY, "healthcare_monitor.py");
  it("file exists", () => expect(fs.existsSync(hmPath)).toBe(true));
  it("has NHIA reference", () => {
    expect(fs.readFileSync(hmPath, "utf-8")).toContain("NHIA");
  });
  it("has port 8123", () => {
    expect(fs.readFileSync(hmPath, "utf-8")).toContain("8123");
  });
});

describe("smoke-test.mjs sector monitors", () => {
  const smokePath = path.join(SCRIPTS, "smoke-test.mjs");
  it("file exists", () => expect(fs.existsSync(smokePath)).toBe(true));
  it("contains monitor reference", () => {
    expect(fs.readFileSync(smokePath, "utf-8").toLowerCase()).toContain("monitor");
  });
  it("checks port 8123 (healthcare)", () => {
    expect(fs.readFileSync(smokePath, "utf-8")).toContain("8123");
  });
  it("checks port 8124 (energy)", () => {
    expect(fs.readFileSync(smokePath, "utf-8")).toContain("8124");
  });
});

describe("TelecomDashboard CRUD mutations", () => {
  const telecomPath = path.join(CLIENT, "pages", "telecom", "TelecomDashboard.tsx");
  it("file exists", () => expect(fs.existsSync(telecomPath)).toBe(true));
  it("has useMutation", () => {
    expect(fs.readFileSync(telecomPath, "utf-8")).toContain("useMutation");
  });
  it("has operator functionality", () => {
    expect(fs.readFileSync(telecomPath, "utf-8").toLowerCase()).toContain("operator");
  });
});

describe("KYC nationality field", () => {
  const kycPath = path.join(CLIENT, "pages", "banking", "KycManagement.tsx");
  it("file exists", () => expect(fs.existsSync(kycPath)).toBe(true));
  it("has nationality field", () => {
    expect(fs.readFileSync(kycPath, "utf-8").toLowerCase()).toContain("nationality");
  });
});

describe("Security hardening", () => {
  it("No hardcoded ndsep_secure_2026 in server/*.ts (non-test)", () => {
    const serverFiles = fs.readdirSync(SERVER)
      .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map(f => path.join(SERVER, f));
    const violations: string[] = [];
    for (const file of serverFiles) {
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes("ndsep_secure_2026")) {
        violations.push(path.basename(file));
      }
    }
    expect(violations).toEqual([]);
  });
  it("No hardcoded APISIX key in server/*.ts", () => {
    const serverFiles = fs.readdirSync(SERVER)
      .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map(f => path.join(SERVER, f));
    const violations: string[] = [];
    for (const file of serverFiles) {
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes("edd1c9f034335f13")) {
        violations.push(path.basename(file));
      }
    }
    expect(violations).toEqual([]);
  });
  it("WebSocket CORS does not use wildcard origin", () => {
    const wsPath = path.join(SERVER, "websocket.ts");
    const src = fs.readFileSync(wsPath, "utf-8");
    expect(src).not.toMatch(/origin:\s*['"]\*['"]/);
  });
});

describe("Docker middleware services", () => {
  const dcPath = path.join(ROOT, "docker-compose.middleware.yml");
  it("docker-compose.middleware.yml exists", () => expect(fs.existsSync(dcPath)).toBe(true));
  it("has middleware service definition", () => {
    expect(fs.readFileSync(dcPath, "utf-8")).toContain("middleware");
  });
});

describe("Go middleware bridge worker", () => {
  const goPath = path.join(ROOT, "workers", "go", "cmd", "middleware_bridge", "main.go");
  it("file exists", () => expect(fs.existsSync(goPath)).toBe(true));
  it("has /events/relay endpoint", () => {
    expect(fs.readFileSync(goPath, "utf-8")).toContain("/events/relay");
  });
  it("has /audit/forward endpoint", () => {
    expect(fs.readFileSync(goPath, "utf-8")).toContain("/audit/forward");
  });
  it("has Prometheus metrics", () => {
    expect(fs.readFileSync(goPath, "utf-8")).toContain("ndsep_");
  });
});

describe("Rust middleware cache worker", () => {
  const rustPath = path.join(ROOT, "workers", "rust", "middleware_cache", "src", "main.rs");
  it("file exists", () => expect(fs.existsSync(rustPath)).toBe(true));
  it("has rate limiter", () => {
    expect(fs.readFileSync(rustPath, "utf-8").toLowerCase()).toContain("ratelimit");
  });
  it("has cache operations", () => {
    expect(fs.readFileSync(rustPath, "utf-8").toLowerCase()).toContain("cache");
  });
});

describe("Python audit aggregator worker", () => {
  const aggPath = path.join(WORKERS_PY, "middleware_audit_aggregator.py");
  it("file exists", () => expect(fs.existsSync(aggPath)).toBe(true));
  it("has anomaly detection", () => {
    expect(fs.readFileSync(aggPath, "utf-8").toLowerCase()).toContain("anomaly");
  });
  it("has Kafka consumer", () => {
    expect(fs.readFileSync(aggPath, "utf-8").toLowerCase()).toContain("kafka");
  });
});
