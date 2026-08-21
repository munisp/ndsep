import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listSecurityAuditEvents, recordSiemCorrelationOpen, verifySecurityAuditChain } from "../server/securityOperations";
import { keycloakAdminStatus, revokeKeycloakSession } from "../server/keycloakAdmin";
import { getWafBlockTrend } from "../server/securityTelemetry";

const temporaryPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "idlr-security-ops-")), "events.json");
const previousPath = process.env.SECURITY_OPERATIONS_AUDIT_PATH;
const previousKey = process.env.SECURITY_AUDIT_HMAC_KEY;
const previousUrl = process.env.WAF_TELEMETRY_URL;
const previousToken = process.env.WAF_TELEMETRY_BEARER_TOKEN;
const previousAdminBaseUrl = process.env.KEYCLOAK_ADMIN_BASE_URL;
const previousAdminRealm = process.env.KEYCLOAK_ADMIN_REALM;
const previousAdminClientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID;
const previousAdminClientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
const previousAdminHosts = process.env.KEYCLOAK_ADMIN_ALLOWED_HOSTS;

afterEach(() => { if (previousPath === undefined) delete process.env.SECURITY_OPERATIONS_AUDIT_PATH; else process.env.SECURITY_OPERATIONS_AUDIT_PATH = previousPath; if (previousKey === undefined) delete process.env.SECURITY_AUDIT_HMAC_KEY; else process.env.SECURITY_AUDIT_HMAC_KEY = previousKey; if (previousUrl === undefined) delete process.env.WAF_TELEMETRY_URL; else process.env.WAF_TELEMETRY_URL = previousUrl; if (previousToken === undefined) delete process.env.WAF_TELEMETRY_BEARER_TOKEN; else process.env.WAF_TELEMETRY_BEARER_TOKEN = previousToken; if (previousAdminBaseUrl === undefined) delete process.env.KEYCLOAK_ADMIN_BASE_URL; else process.env.KEYCLOAK_ADMIN_BASE_URL = previousAdminBaseUrl; if (previousAdminRealm === undefined) delete process.env.KEYCLOAK_ADMIN_REALM; else process.env.KEYCLOAK_ADMIN_REALM = previousAdminRealm; if (previousAdminClientId === undefined) delete process.env.KEYCLOAK_ADMIN_CLIENT_ID; else process.env.KEYCLOAK_ADMIN_CLIENT_ID = previousAdminClientId; if (previousAdminClientSecret === undefined) delete process.env.KEYCLOAK_ADMIN_CLIENT_SECRET; else process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = previousAdminClientSecret; if (previousAdminHosts === undefined) delete process.env.KEYCLOAK_ADMIN_ALLOWED_HOSTS; else process.env.KEYCLOAK_ADMIN_ALLOWED_HOSTS = previousAdminHosts; fs.rmSync(temporaryPath, { force: true }); });

describe("security operations", () => {
  it("records a HMAC-signed SIEM pivot without recording a destination query", () => {
    process.env.SECURITY_OPERATIONS_AUDIT_PATH = temporaryPath; process.env.SECURITY_AUDIT_HMAC_KEY = "test-signing-key";
    const result = recordSiemCorrelationOpen({ actor: "admin-1", auditEventId: "550e8400-e29b-41d4-a716-446655440000", destinationHost: "siem.example.test" });
    const event = listSecurityAuditEvents(10)[0]!;
    expect(result.signed).toBe(true); expect(event.payload.destinationHost).toBe("siem.example.test"); expect(event.hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(verifySecurityAuditChain()).toMatchObject({ valid: true, hmacStatus: "verified", totalEvents: 1 });
  });
  it("reports a broken chain without throwing when an audit record is modified", () => {
    process.env.SECURITY_OPERATIONS_AUDIT_PATH = temporaryPath; process.env.SECURITY_AUDIT_HMAC_KEY = "test-signing-key";
    recordSiemCorrelationOpen({ actor: "admin-1", auditEventId: "550e8400-e29b-41d4-a716-446655440000", destinationHost: "siem.example.test" });
    const contents = JSON.parse(fs.readFileSync(temporaryPath, "utf8")) as Array<{ payload: { destinationHost: string } }>; contents[0]!.payload.destinationHost = "tampered.example.test"; fs.writeFileSync(temporaryPath, JSON.stringify(contents));
    expect(verifySecurityAuditChain()).toMatchObject({ valid: false, firstInvalidEventId: expect.any(String) });
  });
  it("reports unavailable rather than fabricating WAF history without telemetry configuration", async () => {
    delete process.env.WAF_TELEMETRY_URL; delete process.env.WAF_TELEMETRY_BEARER_TOKEN;
    const trend = await getWafBlockTrend(); expect(trend.source).toBe("unavailable"); expect(trend.points).toEqual([]);
  });
  it("keeps remote session revocation unavailable without the guarded Keycloak administrative contract", () => {
    delete process.env.KEYCLOAK_ADMIN_BASE_URL; delete process.env.KEYCLOAK_ADMIN_REALM; delete process.env.KEYCLOAK_ADMIN_CLIENT_ID; delete process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
    expect(keycloakAdminStatus()).toMatchObject({ available: false });
  });
  it("fails closed without a network request when Keycloak administration is not HTTPS allowlisted", async () => {
    process.env.KEYCLOAK_ADMIN_BASE_URL = "http://idp.example.test"; process.env.KEYCLOAK_ADMIN_REALM = "idlrpts"; process.env.KEYCLOAK_ADMIN_CLIENT_ID = "admin"; process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = "secret"; process.env.KEYCLOAK_ADMIN_ALLOWED_HOSTS = "idp.example.test";
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    expect(keycloakAdminStatus()).toMatchObject({ available: false, reason: expect.stringContaining("HTTPS allowlisted") });
    await expect(revokeKeycloakSession("session-1")).resolves.toMatchObject({ revoked: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
