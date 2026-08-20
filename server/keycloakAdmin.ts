import crypto from "node:crypto";
import { getConfiguredIntegrationValue } from "./integrationSettingsRepository";

type KeycloakAdminConfig = { baseUrl: URL; realm: string; clientId: string; clientSecret: string };

function configuredAdmin() {
  const rawBase = getConfiguredIntegrationValue("KEYCLOAK_ADMIN_BASE_URL")?.trim(); const realm = getConfiguredIntegrationValue("KEYCLOAK_ADMIN_REALM")?.trim(); const clientId = getConfiguredIntegrationValue("KEYCLOAK_ADMIN_CLIENT_ID")?.trim(); const clientSecret = getConfiguredIntegrationValue("KEYCLOAK_ADMIN_CLIENT_SECRET")?.trim();
  if (!rawBase || !realm || !clientId || !clientSecret) return null;
  const baseUrl = new URL(rawBase); const hosts = (getConfiguredIntegrationValue("KEYCLOAK_ADMIN_ALLOWED_HOSTS") ?? process.env.KEYCLOAK_ADMIN_ALLOWED_HOSTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (baseUrl.protocol !== "https:" || !hosts.includes(baseUrl.hostname.toLowerCase())) throw new Error("Keycloak administration URL is not HTTPS allowlisted.");
  return { baseUrl, realm, clientId, clientSecret } satisfies KeycloakAdminConfig;
}

export function keycloakAdminStatus() { const available = Boolean(configuredAdmin()); return { available, reason: available ? null : "Keycloak administrative session revocation is not configured." }; }
export function sessionFingerprint(sessionId: string) { return crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 20); }

export async function revokeKeycloakSession(sessionId: string) {
  const config = configuredAdmin(); if (!config) return { revoked: false, reason: "Keycloak administrative session revocation is not configured." } as const;
  const tokenResponse = await fetch(new URL(`/realms/${encodeURIComponent(config.realm)}/protocol/openid-connect/token`, config.baseUrl), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }), signal: AbortSignal.timeout(5_000) });
  if (!tokenResponse.ok) throw new Error(`Keycloak administrative token request returned ${tokenResponse.status}.`);
  const tokenPayload = await tokenResponse.json() as { access_token?: unknown }; if (typeof tokenPayload.access_token !== "string" || !tokenPayload.access_token) throw new Error("Keycloak administrative token response did not contain an access token.");
  const response = await fetch(new URL(`/admin/realms/${encodeURIComponent(config.realm)}/sessions/${encodeURIComponent(sessionId)}`, config.baseUrl), { method: "DELETE", headers: { Authorization: `Bearer ${tokenPayload.access_token}` }, signal: AbortSignal.timeout(5_000) });
  if (!response.ok && response.status !== 204) throw new Error(`Keycloak session revocation returned ${response.status}.`);
  return { revoked: true, reason: null } as const;
}
