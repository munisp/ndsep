import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const LEDGER_PATH = path.join(process.cwd(), "server", "data", "security-operations-ledger.json");
type LedgerEvent = { eventId: string; type: "integration_mode_changed" | "runtime_health_changed" | "runtime_alert_acknowledged"; actor: string; occurredAt: string; payload: Record<string, string | null>; previousHash: string | null; eventHash: string };
type Ledger = { events: LedgerEvent[] };

function key() { return process.env.CONFIGURATION_AUDIT_HMAC_KEY?.trim() || null; }
function canonical(value: Record<string, unknown>) { return JSON.stringify(value, Object.keys(value).sort()); }
function read(): Ledger { try { return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8")) as Ledger; } catch { return { events: [] }; } }
function write(ledger: Ledger) { fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true }); const temporary = `${LEDGER_PATH}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(ledger, null, 2), { mode: 0o600 }); fs.renameSync(temporary, LEDGER_PATH); }
function sign(input: Omit<LedgerEvent, "eventHash">, secret: string) { return crypto.createHmac("sha256", secret).update(canonical(input)).digest("hex"); }

export function appendSecurityEvent(input: Omit<LedgerEvent, "eventId" | "occurredAt" | "previousHash" | "eventHash">) {
  const secret = key();
  if (!secret) throw new Error("Configuration and runtime security events are unavailable until CONFIGURATION_AUDIT_HMAC_KEY is configured.");
  const ledger = read(); const previousHash = ledger.events.at(-1)?.eventHash ?? null;
  const eventInput = { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), previousHash, ...input };
  const event: LedgerEvent = { ...eventInput, eventHash: sign(eventInput, secret) };
  ledger.events.push(event); write(ledger); return event;
}

export function listSecurityEvents(limit = 100) { return read().events.slice(-limit).reverse(); }
export function verifySecurityLedger() { const secret = key(); if (!secret) return { valid: false, reason: "CONFIGURATION_AUDIT_HMAC_KEY is not configured." }; let previousHash: string | null = null; for (const event of read().events) { const { eventHash, ...unsigned } = event; if (event.previousHash !== previousHash || sign(unsigned, secret) !== eventHash) return { valid: false, reason: `Integrity check failed at event ${event.eventId}.` }; previousHash = eventHash; } return { valid: true, reason: null }; }
export function listRuntimeStatusAlerts(limit = 100) { const events = read().events; const acknowledged = new Set(events.filter((event) => event.type === "runtime_alert_acknowledged" && event.payload.alertEventId).map((event) => event.payload.alertEventId)); return events.filter((event) => event.type === "runtime_health_changed" && event.payload.state === "unreachable").slice(-limit).reverse().map((event) => ({ ...event, acknowledged: acknowledged.has(event.eventId) })); }
export function acknowledgeRuntimeStatusAlert(input: { alertEventId: string; actor: string }) { const alert = read().events.find((event) => event.eventId === input.alertEventId && event.type === "runtime_health_changed"); if (!alert) throw new Error("The runtime health alert was not found."); return appendSecurityEvent({ type: "runtime_alert_acknowledged", actor: input.actor, payload: { alertEventId: input.alertEventId, service: alert.payload.service, state: alert.payload.state } }); }

function allowedProbeUrl(value: string) {
  const parsed = new URL(value); if (parsed.protocol !== "https:") throw new Error("Authenticated staging probes require HTTPS URLs.");
  const host = parsed.hostname.toLowerCase(); if (host === "localhost" || host.endsWith(".local") || /^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error("Authenticated staging probes reject loopback and private-network destinations.");
  const allowlist = process.env.INTEGRATION_PROBE_ALLOWED_HOSTS?.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) ?? [];
  if (allowlist.length && !allowlist.includes(host)) throw new Error("Probe destination is not present in INTEGRATION_PROBE_ALLOWED_HOSTS.");
  return parsed.toString();
}

export async function probeApprovedStagingEndpoint(input: { service: string; probeUrl: string; actor: string }) {
  const token = process.env.INTEGRATION_HEALTH_PROBE_TOKEN?.trim(); if (!token) throw new Error("Authenticated probes are disabled until INTEGRATION_HEALTH_PROBE_TOKEN is configured.");
  const url = allowedProbeUrl(input.probeUrl); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5_000);
  let state: "reachable" | "unreachable"; let detail: string;
  try { const response = await fetch(url, { method: "GET", redirect: "error", signal: controller.signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }); state = response.ok ? "reachable" : "unreachable"; detail = response.ok ? `Authenticated health endpoint returned ${response.status}.` : `Authenticated health endpoint returned ${response.status}.`; }
  catch { state = "unreachable"; detail = "Authenticated health endpoint could not be reached within the allowed timeout."; }
  finally { clearTimeout(timeout); }
  const last = listSecurityEvents(500).find((event) => event.type === "runtime_health_changed" && event.payload.service === input.service);
  if (!last || last.payload.state !== state) appendSecurityEvent({ type: "runtime_health_changed", actor: input.actor, payload: { service: input.service, state, detail } });
  return { service: input.service, state, detail, checkedAt: new Date().toISOString() };
}
