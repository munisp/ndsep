export type ExportAuditEvent = { eventId: string; type: string; actor: string; occurredAt: string; payload: Record<string, string | string[]> };
export type ExportIntegrity = { valid: boolean; totalEvents: number; hmacStatus: string; firstInvalidEventId: string | null; reason: string | null };

function escapeCsv(value: string) { return `"${value.replace(/"/g, '""')}"`; }
function escapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

export function buildAuditCsv(events: ExportAuditEvent[], integrity: ExportIntegrity) {
  const header = ["event_id", "occurred_at", "type", "actor", "payload", "integrity_valid", "hmac_status", "first_invalid_event_id"];
  const rows = events.map((event) => [event.eventId, event.occurredAt, event.type, event.actor, JSON.stringify(event.payload), String(integrity.valid), integrity.hmacStatus, integrity.firstInvalidEventId ?? ""]);
  return [header, ...rows].map((row) => row.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
}

export function buildAuditReportHtml(events: ExportAuditEvent[], integrity: ExportIntegrity) {
  const state = integrity.valid ? "VALID" : "INVALID";
  const rows = events.map((event) => `<tr><td>${escapeHtml(event.occurredAt)}</td><td>${escapeHtml(event.type)}</td><td>${escapeHtml(event.actor)}</td><td><code>${escapeHtml(event.eventId)}</code></td><td><code>${escapeHtml(JSON.stringify(event.payload))}</code></td></tr>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{margin:28px}body{font-family:Arial,sans-serif;color:#101828}h1{color:#0B4F47}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #D0D5DD;padding:6px;text-align:left;vertical-align:top}th{background:#F2F4F7}.invalid{color:#B42318}.valid{color:#027A48}code{word-break:break-all}</style></head><body><h1>IDLR-PTS Security Audit Investigation</h1><p class="${integrity.valid ? "valid" : "invalid"}"><strong>Chain status: ${state}</strong> · HMAC: ${escapeHtml(integrity.hmacStatus)} · Events: ${integrity.totalEvents}</p><p>First invalid record: ${escapeHtml(integrity.firstInvalidEventId ?? "None")}<br>Verification note: ${escapeHtml(integrity.reason ?? "No further detail.")}</p><table><thead><tr><th>Timestamp</th><th>Event</th><th>Actor</th><th>Event ID</th><th>Safe payload</th></tr></thead><tbody>${rows}</tbody></table><p>Generated ${escapeHtml(new Date().toISOString())}. Secret values are excluded from this report.</p></body></html>`;
}
