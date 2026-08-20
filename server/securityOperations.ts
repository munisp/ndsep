import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type SecurityAuditEvent = {
  eventId: string;
  type: "siem_correlation_opened" | "integration_settings_saved";
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
