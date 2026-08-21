/**
 * Phase 21 Tests
 * ==============
 * Covers:
 *  1. SectorComplianceDetail page — SECTOR_META completeness
 *  2. WebSocket sector_compliance_update event type in useNdsepSocket
 *  3. PdfExportCenter — print stub replaced with window.print()
 *  4. App.tsx — sector-compliance/:sector route registered
 *  5. Sector entity seed script — seed-sector-entities.mjs exists
 *  6. Sector monitor worker files
 *  7. Makefile targets
 *  8. Smoke test script
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const CLIENT = path.join(ROOT, "client/src");

describe("SectorComplianceDetail page", () => {
  const detailPath = path.join(CLIENT, "pages/SectorComplianceDetail.tsx");
  it("file exists", () => { expect(fs.existsSync(detailPath)).toBe(true); });
  it("contains SECTOR_META constant", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    expect(c).toContain("SECTOR_META");
  });
  it("has all 5 sector keys", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    for (const s of ["fintech", "healthcare", "energy", "insurance", "telecom"]) {
      expect(c).toContain(`${s}:`);
    }
  });
  it("uses wouter useParams", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    expect(c).toContain("useParams");
  });
  it("queries all 5 sector tRPC endpoints", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    expect(c).toContain("trpc.fintech.listCompanies.useQuery");
    expect(c).toContain("trpc.healthcare.listFacilities.useQuery");
    expect(c).toContain("trpc.energy.listCompanies.useQuery");
    expect(c).toContain("trpc.insurance.listCompanies.useQuery");
    expect(c).toContain("trpc.telecom.listOperators.useQuery");
  });
  it("shows compliance score per sector", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    expect(c).toContain("fintech: 87");
    expect(c).toContain("healthcare: 92");
  });
  it("has pagination controls", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    expect(c).toContain("setPage");
    expect(c).toContain("Prev");
    expect(c).toContain("Next");
  });
  it("has remediation checklist", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    expect(c).toContain("Remediation Checklist");
  });
  it("has back button to /sector-compliance", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    expect(c).toContain("/sector-compliance");
    expect(c).toContain("ArrowLeft");
  });
  it("shows worker health status badge", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    expect(c).toContain("workerStatus");
    expect(c).toContain("Live Monitor");
  });
  it("uses DashboardLayout wrapper", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    expect(c).toContain("DashboardLayout");
  });
  it("has entity table with search input", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    expect(c).toContain("Search entities");
    expect(c).toContain("TableBody");
  });
  it("handles empty entity state gracefully", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    expect(c).toContain("No entities found");
  });
  it("has compliance badge", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    expect(c).toContain("Compliant");
    expect(c).toContain("Non-Compliant");
  });
  it("SECTOR_META has regulators for each sector", () => {
    const c = fs.readFileSync(detailPath, "utf-8");
    expect(c).toContain("CBN");
    expect(c).toContain("NHIA");
    expect(c).toContain("NERC");
    expect(c).toContain("NAICOM");
    expect(c).toContain("NCC");
  });
});

describe("useNdsepSocket sector_compliance_update event", () => {
  const hookPath = path.join(CLIENT, "hooks/useNdsepSocket.ts");
  it("hook file exists", () => { expect(fs.existsSync(hookPath)).toBe(true); });
  it("defines sector_compliance_update event type", () => {
    const c = fs.readFileSync(hookPath, "utf-8");
    expect(c).toContain("sector_compliance_update");
  });
  it("has SectorComplianceUpdate interface", () => {
    const c = fs.readFileSync(hookPath, "utf-8");
    expect(c).toContain("SectorComplianceUpdate");
  });
  it("returns recentSectorUpdates", () => {
    const c = fs.readFileSync(hookPath, "utf-8");
    expect(c).toContain("recentSectorUpdates");
  });
  it("handles sector_compliance_update in onEvent", () => {
    const c = fs.readFileSync(hookPath, "utf-8");
    expect(c).toContain("setSectorUpdates");
  });
});

describe("SectorComplianceDashboard WebSocket wiring", () => {
  const dashPath = path.join(CLIENT, "pages/SectorComplianceDashboard.tsx");
  it("imports useNdsepSocket", () => {
    const c = fs.readFileSync(dashPath, "utf-8");
    expect(c).toContain("useNdsepSocket");
  });
  it("uses connected status for live indicator", () => {
    const c = fs.readFileSync(dashPath, "utf-8");
    expect(c).toContain("connected");
  });
  it("shows Live Updates badge when connected", () => {
    const c = fs.readFileSync(dashPath, "utf-8");
    expect(c).toContain("Live Updates");
  });
});

describe("PdfExportCenter print preview", () => {
  const pdfPath = path.join(CLIENT, "pages/PdfExportCenter.tsx");
  it("file exists", () => { expect(fs.existsSync(pdfPath)).toBe(true); });
  it("does NOT contain Print preview coming soon stub", () => {
    const c = fs.readFileSync(pdfPath, "utf-8");
    expect(c).not.toContain("Print preview coming soon");
  });
  it("uses window.print() for print preview", () => {
    const c = fs.readFileSync(pdfPath, "utf-8");
    expect(c).toContain("window.print");
  });
});

describe("App.tsx sector-compliance routes", () => {
  const appPath = path.join(CLIENT, "App.tsx");
  it("imports SectorComplianceDetail", () => {
    const c = fs.readFileSync(appPath, "utf-8");
    expect(c).toContain("SectorComplianceDetail");
  });
  it("registers /sector-compliance/:sector route", () => {
    const c = fs.readFileSync(appPath, "utf-8");
    expect(c).toContain("/sector-compliance/:sector");
  });
  it("registers /sector-compliance route for dashboard", () => {
    const c = fs.readFileSync(appPath, "utf-8");
    expect(c).toContain("/sector-compliance");
    expect(c).toContain("SectorComplianceDashboard");
  });
});

describe("seed-sector-entities.mjs", () => {
  const seedPath = path.join(ROOT, "scripts/seed-sector-entities.mjs");
  it("seed script file exists", () => { expect(fs.existsSync(seedPath)).toBe(true); });
  it("seeds fintech_companies", () => {
    const c = fs.readFileSync(seedPath, "utf-8");
    expect(c).toContain("fintech_companies");
  });
  it("seeds energy_companies", () => {
    const c = fs.readFileSync(seedPath, "utf-8");
    expect(c).toContain("energy_companies");
  });
  it("seeds insurance_companies", () => {
    const c = fs.readFileSync(seedPath, "utf-8");
    expect(c).toContain("insurance_companies");
  });
  it("seeds telecom_operators", () => {
    const c = fs.readFileSync(seedPath, "utf-8");
    expect(c).toContain("telecom_operators");
  });
  it("uses ON CONFLICT for idempotency", () => {
    const c = fs.readFileSync(seedPath, "utf-8");
    expect(c).toContain("ON CONFLICT");
  });
});

describe("Sector monitor worker files", () => {
  const workerDir = path.join(ROOT, "workers/python");
  for (const [file, keyword] of [
    ["fintech_monitor.py", "CBN"],
    ["healthcare_monitor.py", "NHIA"],
    ["energy_monitor.py", "NERC"],
    ["insurance_monitor.py", "NAICOM"],
    ["telecom_monitor.py", "NCC"],
  ]) {
    it(`${file} exists and has ${keyword}`, () => {
      const p = path.join(workerDir, file);
      expect(fs.existsSync(p)).toBe(true);
      const c = fs.readFileSync(p, "utf-8");
      expect(c).toContain(keyword);
    });
  }
});

describe("Makefile", () => {
  const makefilePath = path.join(ROOT, "Makefile");
  it("Makefile exists", () => { expect(fs.existsSync(makefilePath)).toBe(true); });
  it("has seed-db target", () => {
    const c = fs.readFileSync(makefilePath, "utf-8");
    expect(c).toContain("seed-db");
  });
  it("has smoke-test target", () => {
    const c = fs.readFileSync(makefilePath, "utf-8");
    expect(c).toContain("smoke-test");
  });
  it("has docker-build target", () => {
    const c = fs.readFileSync(makefilePath, "utf-8");
    expect(c).toContain("docker-build");
  });
  it("has k8s-apply target", () => {
    const c = fs.readFileSync(makefilePath, "utf-8");
    expect(c).toContain("k8s-apply");
  });
  it("has ci target", () => {
    const c = fs.readFileSync(makefilePath, "utf-8");
    expect(c).toContain("ci:");
  });
});

describe("smoke-test.mjs", () => {
  const smokePath = path.join(ROOT, "scripts/smoke-test.mjs");
  it("smoke test script exists", () => { expect(fs.existsSync(smokePath)).toBe(true); });
  it("tests /api/health endpoint", () => {
    const c = fs.readFileSync(smokePath, "utf-8");
    expect(c).toContain("/api/health");
  });
  it("tests /api/workers/status endpoint", () => {
    const c = fs.readFileSync(smokePath, "utf-8");
    expect(c).toContain("/api/workers/status");
  });
  it("checks sector monitor workers", () => {
    const c = fs.readFileSync(smokePath, "utf-8");
    expect(c).toContain("monitor");
  });
});
