/**
 * infraPostureScan service unit tests (round 13, W3).
 *
 * No database, no network: ../../db getPool is a SQL-dispatching stub and
 * ../../osiris/scannerClient is fully mocked (same pattern as
 * server/routers/__tests__/decisionFeedback.test.ts).
 *
 * Covers:
 *  - mapPostureSeverity severity mapping (KEV/CVSS≥9 → critical; admin/DB
 *    ports or expired cert → high; else medium/low);
 *  - normalizePostureSignal 0..1 normalization + cap;
 *  - scanTargetPosture fail-closed path (scanner unavailable → bookkeeping
 *    row with scanner_available=false, NO scan_findings insert);
 *  - scanTargetPosture ok path finding insertion shape (finding_type
 *    'infra_posture', severity, evidence jsonb incl. scanner_key_present);
 *  - postureSignalForOrg normalization from grouped SQL rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockScanHost = vi.fn();
const mockCveForProduct = vi.fn();
const mockKevFeed = vi.fn();
const mockScannerKeyPresent = vi.fn();

vi.mock("../../db", () => ({
  getPool: () => ({ query: mockQuery }),
  getSharedPool: () => ({ query: mockQuery }),
}));

vi.mock("../../encryptionMiddleware", () => ({
  autoDecryptRows: (_q: string, rows: unknown[]) => rows,
}));

vi.mock("../../osiris/scannerClient", () => ({
  scanHost: (...args: unknown[]) => mockScanHost(...args),
  cveForProduct: (...args: unknown[]) => mockCveForProduct(...args),
  kevFeed: (...args: unknown[]) => mockKevFeed(...args),
  scannerKeyPresent: () => mockScannerKeyPresent(),
}));

import {
  mapPostureSeverity,
  normalizePostureSignal,
  buildPostureEvidence,
  postureFindingTriggered,
  scanTargetPosture,
  postureSignalForOrg,
  INFRA_POSTURE_CAP,
} from "../infraPostureScan";
import type { HostScanResult } from "../../osiris/scannerClient";

const TARGET = { id: 11, base_url: "https://controller.example.ng", controller_name: "Example Bank", organization_id: 7 };

function okScan(overrides: Partial<HostScanResult> = {}): HostScanResult {
  return {
    host: "controller.example.ng",
    status: "ok",
    scannerKeyPresent: true,
    ports: [
      { port: 443, protocol: "tcp", state: "open", service: "https" },
      { port: 22, protocol: "tcp", state: "open", service: "ssh", product: "OpenSSH", version: "8.9" },
    ],
    ssl: { present: true, valid: true, expired: false, daysRemaining: 120, issuer: "Let's Encrypt" },
    scannedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function installQueryStub() {
  mockQuery.mockImplementation(async (sql: string, _params: unknown[] = []) => {
    if (/UPDATE scan_findings/i.test(sql)) return { rows: [] }; // no dedupe hit
    if (/INSERT INTO scan_runs/i.test(sql)) return { rows: [{ id: 501 }] };
    if (/INSERT INTO scan_findings/i.test(sql)) return { rows: [{ id: 901 }] };
    if (/INSERT INTO infra_posture_runs/i.test(sql)) return { rows: [{ id: 77 }] };
    if (/FROM scan_findings sf/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockScanHost.mockReset();
  mockCveForProduct.mockReset();
  mockKevFeed.mockReset();
  mockScannerKeyPresent.mockReset();
  installQueryStub();
  mockKevFeed.mockResolvedValue([]);
  mockCveForProduct.mockResolvedValue([]);
});

describe("mapPostureSeverity", () => {
  const base = { kevListed: false, maxCvss: null, exposedSensitivePorts: [] as number[], certExpired: false, otherExposure: false };

  it("KEV-listed CVE → critical", () => {
    expect(mapPostureSeverity({ ...base, kevListed: true })).toBe("critical");
  });
  it("CVSS ≥ 9 → critical", () => {
    expect(mapPostureSeverity({ ...base, maxCvss: 9.1 })).toBe("critical");
    expect(mapPostureSeverity({ ...base, maxCvss: 9.0 })).toBe("critical");
  });
  it("exposed admin port (22) → high", () => {
    expect(mapPostureSeverity({ ...base, exposedSensitivePorts: [22] })).toBe("high");
  });
  it("exposed db port (5432) → high", () => {
    expect(mapPostureSeverity({ ...base, exposedSensitivePorts: [5432] })).toBe("high");
  });
  it("expired certificate → high", () => {
    expect(mapPostureSeverity({ ...base, certExpired: true })).toBe("high");
  });
  it("CVSS 7–8.9 without higher triggers → medium", () => {
    expect(mapPostureSeverity({ ...base, maxCvss: 7.5 })).toBe("medium");
  });
  it("other exposure (unexpected open port) → medium", () => {
    expect(mapPostureSeverity({ ...base, otherExposure: true })).toBe("medium");
  });
  it("clean posture → low", () => {
    expect(mapPostureSeverity(base)).toBe("low");
  });
});

describe("normalizePostureSignal", () => {
  it("is 0 for empty/negative input", () => {
    expect(normalizePostureSignal(0)).toBe(0);
    expect(normalizePostureSignal(-3)).toBe(0);
    expect(normalizePostureSignal(Number.NaN)).toBe(0);
  });
  it("scales linearly up to the cap", () => {
    expect(normalizePostureSignal(INFRA_POSTURE_CAP / 2)).toBe(0.5);
    expect(normalizePostureSignal(3)).toBeCloseTo(3 / INFRA_POSTURE_CAP);
  });
  it("saturates at 1", () => {
    expect(normalizePostureSignal(INFRA_POSTURE_CAP)).toBe(1);
    expect(normalizePostureSignal(INFRA_POSTURE_CAP * 5)).toBe(1);
  });
});

describe("scanTargetPosture — fail-closed", () => {
  it("records scanner unavailability and writes NO findings", async () => {
    mockScannerKeyPresent.mockReturnValue(false);
    mockScanHost.mockResolvedValue({
      host: "controller.example.ng", status: "unavailable", scannerKeyPresent: false,
      reason: "scanner key not configured (OSIRIS_SCANNER_KEY)", ports: [], ssl: null,
      scannedAt: "2026-05-01T00:00:00.000Z",
    });

    const out = await scanTargetPosture(TARGET, { createdBy: "officer-a" });

    expect(out.scannerAvailable).toBe(false);
    expect(out.scannerKeyPresent).toBe(false);
    expect(out.findingsCount).toBe(0);
    expect(out.findingId).toBeNull();

    const runInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO infra_posture_runs/i.test(String(sql)));
    expect(runInsert).toBeDefined();
    expect(runInsert![1][2]).toBe(false); // scanner_key_present param
    expect(String(runInsert![1][4])).toMatch(/scanner key not configured/); // error param

    // Fail-closed: never fabricate posture findings or scan runs.
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO scan_findings/i.test(String(sql)))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO scan_runs/i.test(String(sql)))).toBe(false);
    // CVE/KEV lookups are never attempted without a scan result.
    expect(mockCveForProduct).not.toHaveBeenCalled();
    expect(mockKevFeed).not.toHaveBeenCalled();
  });

  it("rejects invalid base_url with a bookkeeping row only", async () => {
    mockScannerKeyPresent.mockReturnValue(true);
    const out = await scanTargetPosture({ ...TARGET, base_url: "not-a-url" });
    expect(out.error).toBe("invalid base_url");
    expect(mockScanHost).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO infra_posture_runs/i.test(String(sql)))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO scan_findings/i.test(String(sql)))).toBe(false);
  });
});

describe("scanTargetPosture — finding insertion shape", () => {
  it("inserts a critical infra_posture finding for a KEV-listed CVE on an admin port", async () => {
    mockScannerKeyPresent.mockReturnValue(true);
    mockScanHost.mockResolvedValue(okScan());
    mockCveForProduct.mockResolvedValue([
      { cveId: "CVE-2024-3094", description: "xz backdoor", severity: "CRITICAL", cvssScore: 10, references: [], query: "OpenSSH" },
    ]);
    mockKevFeed.mockResolvedValue([{ id: "CVE-2024-3094", name: "xz" }]);

    const out = await scanTargetPosture(TARGET, { createdBy: "officer-a" });

    expect(out.scannerAvailable).toBe(true);
    expect(out.severity).toBe("critical"); // KEV-listed + CVSS 10
    expect(out.findingsCount).toBe(1);
    expect(out.findingId).toBe(901);
    expect(out.scanRunId).toBe(501);

    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO scan_findings/i.test(String(sql)));
    expect(insert).toBeDefined();
    const [sql, params] = insert as [string, unknown[]];
    expect(sql).toContain("'infra_posture'");
    expect(params[0]).toBe(501); // run_id
    expect(params[1]).toBe(TARGET.id); // target_id
    expect(params[2]).toBe("critical"); // severity
    expect(params[3]).toBe(TARGET.base_url); // url
    const evidence = JSON.parse(String(params[4]));
    expect(evidence.scanner).toBe("osiris-recon");
    expect(evidence.scanner_key_present).toBe(true);
    expect(evidence.exposed_sensitive_ports).toContain(22);
    expect(evidence.matched_cves[0].cve_id).toBe("CVE-2024-3094");
    expect(evidence.matched_cves[0].kev_listed).toBe(true);
    expect(evidence.kev_listed_count).toBe(1);
    expect(String(params[5])).toMatch(/^[0-9a-f]{64}$/); // evidence_hash

    // Bookkeeping row links the scan_runs row.
    const runInsert = mockQuery.mock.calls.find(([s]) => /INSERT INTO infra_posture_runs/i.test(String(s)));
    expect(runInsert).toBeDefined();
    expect(runInsert![1][1]).toBe(501); // scan_run_id
    expect(runInsert![1][3]).toBe(true); // scanner_available
  });

  it("does not insert a finding for a clean web-only posture", async () => {
    mockScannerKeyPresent.mockReturnValue(true);
    mockScanHost.mockResolvedValue(okScan({
      ports: [{ port: 443, protocol: "tcp", state: "open", service: "https" }],
    }));
    const out = await scanTargetPosture(TARGET);
    expect(out.severity).toBe("low");
    expect(out.findingsCount).toBe(0);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO scan_findings/i.test(String(sql)))).toBe(false);
  });
});

describe("postureSignalForOrg — risk-signal normalization", () => {
  async function withWeighted(w: number | null): Promise<number> {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/FROM scan_findings sf/i.test(sql)) return { rows: w == null ? [] : [{ org_id: 7, w }] };
      return { rows: [] };
    });
    return postureSignalForOrg(7);
  }

  it("returns 0 when the org has no open posture findings", async () => {
    expect(await withWeighted(null)).toBe(0);
  });
  it("normalizes severity-weighted findings against the cap", async () => {
    expect(await withWeighted(6)).toBeCloseTo(0.5);
  });
  it("saturates at 1", async () => {
    expect(await withWeighted(48)).toBe(1);
  });
  it("returns 0 (fail-closed) when the source tables are unreadable", async () => {
    mockQuery.mockRejectedValue(new Error("relation does not exist"));
    expect(await postureSignalForOrg(7)).toBe(0);
  });
});

describe("buildPostureEvidence / postureFindingTriggered", () => {
  it("captures ports, CVEs, cert issues and the scanner-key flag", () => {
    const scan = okScan({ ssl: { present: true, valid: false, expired: true, daysRemaining: -3, issuer: "Expired CA" } });
    const ev = buildPostureEvidence({
      host: "controller.example.ng", scan, scannerKey: true,
      matchedCves: [{ cveId: "CVE-2024-0001", cvssScore: 8.1, references: [], query: "OpenSSH", kevListed: false }],
    });
    expect(evidenceOk(ev)).toBe(true);
    expect(postureFindingTriggered(ev)).toBe(true);
  });
});

function evidenceOk(ev: ReturnType<typeof buildPostureEvidence>): boolean {
  return (
    ev.scanner_key_present === true &&
    ev.exposed_sensitive_ports.includes(22) &&
    ev.cert_issues.includes("certificate expired") &&
    ev.matched_cves.length === 1
  );
}
