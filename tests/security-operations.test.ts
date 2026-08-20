import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listSecurityAuditEvents, recordSiemCorrelationOpen } from "../server/securityOperations";
import { getWafBlockTrend } from "../server/securityTelemetry";

const temporaryPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "idlr-security-ops-")), "events.json");
const previousPath = process.env.SECURITY_OPERATIONS_AUDIT_PATH;
const previousKey = process.env.SECURITY_AUDIT_HMAC_KEY;
const previousUrl = process.env.WAF_TELEMETRY_URL;
const previousToken = process.env.WAF_TELEMETRY_BEARER_TOKEN;

afterEach(() => { if (previousPath === undefined) delete process.env.SECURITY_OPERATIONS_AUDIT_PATH; else process.env.SECURITY_OPERATIONS_AUDIT_PATH = previousPath; if (previousKey === undefined) delete process.env.SECURITY_AUDIT_HMAC_KEY; else process.env.SECURITY_AUDIT_HMAC_KEY = previousKey; if (previousUrl === undefined) delete process.env.WAF_TELEMETRY_URL; else process.env.WAF_TELEMETRY_URL = previousUrl; if (previousToken === undefined) delete process.env.WAF_TELEMETRY_BEARER_TOKEN; else process.env.WAF_TELEMETRY_BEARER_TOKEN = previousToken; fs.rmSync(temporaryPath, { force: true }); });

describe("security operations", () => {
  it("records a HMAC-signed SIEM pivot without recording a destination query", () => {
    process.env.SECURITY_OPERATIONS_AUDIT_PATH = temporaryPath; process.env.SECURITY_AUDIT_HMAC_KEY = "test-signing-key";
    const result = recordSiemCorrelationOpen({ actor: "admin-1", auditEventId: "550e8400-e29b-41d4-a716-446655440000", destinationHost: "siem.example.test" });
    const event = listSecurityAuditEvents(10)[0]!;
    expect(result.signed).toBe(true); expect(event.payload.destinationHost).toBe("siem.example.test"); expect(event.hmac).toMatch(/^[a-f0-9]{64}$/);
  });
  it("reports unavailable rather than fabricating WAF history without telemetry configuration", async () => {
    delete process.env.WAF_TELEMETRY_URL; delete process.env.WAF_TELEMETRY_BEARER_TOKEN;
    const trend = await getWafBlockTrend(); expect(trend.source).toBe("unavailable"); expect(trend.points).toEqual([]);
  });
});
