import crypto from "node:crypto";
import { getConfiguredIntegrationValue } from "./integrationSettingsRepository";

type KeycloakAdminConfig = { baseUrl: URL; realm: string; clientId: string; clientSecret: string };
export type KeycloakDirectorySession = { subject: string; username: string; sessionId: string; lastAccessAt: string | null; sourceAddress: string | null; geography: string | null; riskScore: number | null };

function configuredAdmin() {
  const rawBase = getConfiguredIntegrationValue("KEYCLOAK_ADMIN_BASE_URL")?.trim(); const realm = getConfiguredIntegrationValue("KEYCLOAK_ADMIN_REALM")?.trim(); const clientId = getConfiguredIntegrationValue("KEYCLOAK_ADMIN_CLIENT_ID")?.trim(); const clientSecret = getConfiguredIntegrationValue("KEYCLOAK_ADMIN_CLIENT_SECRET")?.trim();
  if (!rawBase || !realm || !clientId || !clientSecret) return null;
  const baseUrl = new URL(rawBase); const hosts = (getConfiguredIntegrationValue("KEYCLOAK_ADMIN_ALLOWED_HOSTS") ?? process.env.KEYCLOAK_ADMIN_ALLOWED_HOSTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (baseUrl.protocol !== "https:" || !hosts.includes(baseUrl.hostname.toLowerCase())) throw new Error("Keycloak administration URL is not HTTPS allowlisted.");
  return { baseUrl, realm, clientId, clientSecret } satisfies KeycloakAdminConfig;
}

export function keycloakAdminStatus() { const available = Boolean(configuredAdmin()); return { available, reason: available ? null : "Keycloak administrative session revocation is not configured." }; }
export function sessionFingerprint(sessionId: string) { return crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 20); }

function redactAddress(value: unknown) { if (typeof value !== "string" || !value) return null; if (value.includes(":")) return `${value.split(":").slice(0, 2).join(":")}::/32`; const chunks = value.split("."); return chunks.length === 4 ? `${chunks[0]}.${chunks[1]}.${chunks[2]}.0/24` : null; }
async function adminAccessToken(config: KeycloakAdminConfig) { const response = await fetch(new URL(`/realms/${encodeURIComponent(config.realm)}/protocol/openid-connect/token`, config.baseUrl), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }), signal: AbortSignal.timeout(5_000) }); if (!response.ok) throw new Error(`Keycloak administrative token request returned ${response.status}.`); const body = await response.json() as { access_token?: unknown }; if (typeof body.access_token !== "string" || !body.access_token) throw new Error("Keycloak administrative token response did not contain an access token."); return body.access_token; }

export async function listKeycloakDirectorySessions(search: string, maxUsers = 10): Promise<KeycloakDirectorySession[]> {
  const config = configuredAdmin(); if (!config) throw new Error("Keycloak session directory is not configured."); const token = await adminAccessToken(config); const usersUrl = new URL(`/admin/realms/${encodeURIComponent(config.realm)}/users`, config.baseUrl); usersUrl.searchParams.set("search", search); usersUrl.searchParams.set("max", String(Math.max(1, Math.min(maxUsers, 10))));
  const usersResponse = await fetch(usersUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) }); if (!usersResponse.ok) throw new Error(`Keycloak user directory returned ${usersResponse.status}.`); const users = await usersResponse.json() as Array<{ id?: unknown; username?: unknown }>;
  const rows = await Promise.all(users.filter((user): user is { id: string; username?: unknown } => typeof user.id === "string").map(async (user) => { const url = new URL(`/admin/realms/${encodeURIComponent(config.realm)}/users/${encodeURIComponent(user.id)}/sessions`, config.baseUrl); const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) }); if (!response.ok) throw new Error(`Keycloak session directory returned ${response.status}.`); const sessions = await response.json() as Array<{ id?: unknown; lastAccess?: unknown; ipAddress?: unknown; geography?: unknown; riskScore?: unknown }>; return sessions.filter((session): session is { id: string; lastAccess?: unknown; ipAddress?: unknown; geography?: unknown; riskScore?: unknown } => typeof session.id === "string").map((session) => ({ subject: user.id, username: typeof user.username === "string" ? user.username : user.id, sessionId: session.id, lastAccessAt: typeof session.lastAccess === "number" ? new Date(session.lastAccess).toISOString() : null, sourceAddress: redactAddress(session.ipAddress), geography: typeof session.geography === "string" && session.geography.trim().length <= 120 ? session.geography.trim() : null, riskScore: typeof session.riskScore === "number" && Number.isFinite(session.riskScore) && session.riskScore >= 0 && session.riskScore <= 100 ? Math.round(session.riskScore) : null })); })); return rows.flat();
}

export async function sessionBelongsToSubject(subject: string, sessionId: string) { const sessions = await listKeycloakDirectorySessions(subject, 1); return sessions.some((session) => session.subject === subject && session.sessionId === sessionId); }

export async function revokeKeycloakSession(sessionId: string) {
  const config = configuredAdmin(); if (!config) return { revoked: false, reason: "Keycloak administrative session revocation is not configured." } as const;
  const token = await adminAccessToken(config); const response = await fetch(new URL(`/admin/realms/${encodeURIComponent(config.realm)}/sessions/${encodeURIComponent(sessionId)}`, config.baseUrl), { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) });
  if (!response.ok && response.status !== 204) throw new Error(`Keycloak session revocation returned ${response.status}.`);
  return { revoked: true, reason: null } as const;
}
