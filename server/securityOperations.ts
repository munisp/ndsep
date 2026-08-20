import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type SecurityAuditEvent = {
  eventId: string;
  type: "siem_correlation_opened" | "integration_settings_saved" | "keycloak_session_revocation_requested";
  actor: string;
  occurredAt: string;
  payload: Record<string, string | string[]>;
  previousHash: string | null;
  eventHash: string;
  hmac: string | null;
};

function storePath() { return process.env.SECURITY_OPERATIONS_AUDIT_PATH ?? path.join(process.cwd(), "server", "data", "security-operations-audit.json"); }

function readEvents(): SecurityAuditEvent[] {
  try { return JSON.parse(fs.readFileSync(storePath(), "utf8")) as SecurityAuditEvent[]; } catch { return []; }
}

function canonical(event: Omit<SecurityAuditEvent, "eventHash" | "hmac">) { return JSON.stringify(event); }

function appendEvent(input: { type: SecurityAuditEvent["type"]; actor: string; payload: SecurityAuditEvent["payload"] }) {
  const events = readEvents();
  const previousHash = events.at(-1)?.eventHash ?? null;
  const draft: Omit<SecurityAuditEvent, "eventHash" | "hmac"> = { eventId: crypto.randomUUID(), type: input.type, actor: input.actor, occurredAt: new Date().toISOString(), payload: input.payload, previousHash };
  const eventHash = crypto.createHash("sha256").update(`${previousHash ?? "genesis"}:${canonical(draft)}`).digest("hex");
  const key = process.env.SECURITY_AUDIT_HMAC_KEY?.trim() || null;
  const event: SecurityAuditEvent = { ...draft, eventHash, hmac: key ? crypto.createHmac("sha256", key).update(eventHash).digest("hex") : null };
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify([...events, event], null, 2));
  return { eventId: event.eventId, signed: Boolean(event.hmac) };
}

export function recordSiemCorrelationOpen(input: { actor: string; auditEventId: string; destinationHost: string }) {
  return appendEvent({ type: "siem_correlation_opened", actor: input.actor, payload: { auditEventId: input.auditEventId, destinationHost: input.destinationHost } });
}

export function recordIntegrationSettingsSaved(input: { actor: string; configuredFields: string[] }) { return appendEvent({ type: "integration_settings_saved", actor: input.actor, payload: { configuredFields: [...input.configuredFields].sort() } }); }
export function listSecurityAuditEvents(limit = 100) { return readEvents().slice(-Math.max(1, Math.min(limit, 250))).reverse(); }
export function recordKeycloakSessionRevocation(input: { actor: string; sessionHash: string; outcome: "revoked" | "unavailable" | "rejected"; reason?: string; batchId?: string }) { return appendEvent({ type: "keycloak_session_revocation_requested", actor: input.actor, payload: { sessionHash: input.sessionHash, outcome: input.outcome, ...(input.reason ? { reason: input.reason } : {}), ...(input.batchId ? { batchId: input.batchId } : {}) } }); }

export function verifySecurityAuditChain() {
  const events = readEvents(); const key = process.env.SECURITY_AUDIT_HMAC_KEY?.trim() || null; let previousHash: string | null = null;
  for (const event of events) {
    const draft: Omit<SecurityAuditEvent, "eventHash" | "hmac"> = { eventId: event.eventId, type: event.type, actor: event.actor, occurredAt: event.occurredAt, payload: event.payload, previousHash: event.previousHash };
    const expectedHash: string = crypto.createHash("sha256").update(`${previousHash ?? "genesis"}:${canonical(draft)}`).digest("hex");
    if (event.previousHash !== previousHash || event.eventHash !== expectedHash) return { valid: false, totalEvents: events.length, hmacStatus: key ? "invalid" : "not_configured", firstInvalidEventId: event.eventId, reason: "Hash-chain link or event digest does not match." } as const;
    const expectedHmac = key ? crypto.createHmac("sha256", key).update(event.eventHash).digest("hex") : null;
    if (expectedHmac && (!event.hmac || event.hmac.length !== expectedHmac.length || !crypto.timingSafeEqual(Buffer.from(event.hmac, "hex"), Buffer.from(expectedHmac, "hex")))) return { valid: false, totalEvents: events.length, hmacStatus: "invalid", firstInvalidEventId: event.eventId, reason: "HMAC does not match the configured integrity key." } as const;
    previousHash = event.eventHash;
  }
  return { valid: true, totalEvents: events.length, hmacStatus: key ? "verified" : "not_configured", firstInvalidEventId: null, reason: events.length ? null : "No security audit events have been recorded yet." } as const;
}
