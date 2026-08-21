import { describe, expect, it } from "vitest";
import { buildAuditCsv, buildAuditReportHtml } from "../lib/security-audit-export-format";

describe("security audit investigation export", () => { const integrity = { valid: false, totalEvents: 1, hmacStatus: "invalid", firstInvalidEventId: "evt-1", reason: "Broken HMAC" }; const events = [{ eventId: "evt-1", type: "siem_correlation_opened", actor: "admin", occurredAt: "2026-08-20T00:00:00.000Z", payload: { destinationHost: "siem.example.test" } }]; it("includes integrity evidence in CSV and escapes report content", () => { expect(buildAuditCsv(events, integrity)).toContain('"evt-1"'); expect(buildAuditReportHtml(events, integrity)).toContain("Chain status: INVALID"); }); });
