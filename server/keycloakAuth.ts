/**
 * NDSEP Keycloak Authentication Integration
 * ============================================
 * Provides OAuth2/OIDC authentication via Keycloak with graceful
 * fallback to demo-login when Keycloak is unavailable.
 *
 * Features:
 *   - OIDC token validation (JWT + JWKS)
 *   - Role mapping (Keycloak realm roles → NDSEP roles)
 *   - Session management with Redis-backed sessions
 *   - Token refresh flow
 *   - Graceful degradation to demo-login in development
 *
 * Environment:
 *   KEYCLOAK_URL      — Keycloak base URL (e.g., http://keycloak:8080)
 *   KEYCLOAK_REALM    — Realm name (default: ndsep)
 *   KEYCLOAK_CLIENT_ID — Client ID (default: ndsep-web)
 *   KEYCLOAK_CLIENT_SECRET — Client secret (optional for public clients)
 *   KEYCLOAK_ENABLED  — "true" | "false" (default: "false")
 */

import { logger } from "./logger";
import { captureError } from "./errorMonitoring";
import { verifyKeycloakToken } from "./keycloak";

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? "http://localhost:8080";
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? "ndsep";
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "ndsep-web";
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET;
const KEYCLOAK_ENABLED = (process.env.KEYCLOAK_ENABLED ?? "false") === "true";

const OIDC_BASE = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect`;

interface KeycloakConfig {
  enabled: boolean;
  url: string;
  realm: string;
  clientId: string;
  issuer: string;
  authUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  logoutUrl: string;
  jwksUrl: string;
}

interface TokenPayload {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  realm_access?: { roles: string[] };
  resource_access?: Record<string, { roles: string[] }>;
  exp: number;
  iat: number;
}

interface KeycloakSession {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  user: {
    sub: string;
    email: string;
    name: string;
    username: string;
    roles: string[];
  };
}

let jwksCache: Record<string, unknown>[] | null = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 3600_000; // 1 hour

export function getKeycloakConfig(): KeycloakConfig {
  return {
    enabled: KEYCLOAK_ENABLED,
    url: KEYCLOAK_URL,
    realm: KEYCLOAK_REALM,
    clientId: KEYCLOAK_CLIENT_ID,
    issuer: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`,
    authUrl: `${OIDC_BASE}/auth`,
    tokenUrl: `${OIDC_BASE}/token`,
    userinfoUrl: `${OIDC_BASE}/userinfo`,
    logoutUrl: `${OIDC_BASE}/logout`,
    jwksUrl: `${OIDC_BASE}/certs`,
  };
}

export function isKeycloakEnabled(): boolean {
  return KEYCLOAK_ENABLED;
}

async function fetchJWKS(): Promise<Record<string, unknown>[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCacheTime < JWKS_CACHE_TTL) {
    return jwksCache;
  }
  try {
    const res = await fetch(`${OIDC_BASE}/certs`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const data = (await res.json()) as { keys: Record<string, unknown>[] };
    jwksCache = data.keys;
    jwksCacheTime = now;
    return data.keys;
  } catch (err) {
    captureError(err instanceof Error ? err : new Error(String(err)), "keycloak-jwks");
    return jwksCache ?? [];
  }
}

function decodeJwtPayload(token: string): TokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload) as TokenPayload;
  } catch {
    return null;
  }
}

function mapRoles(payload: TokenPayload): string[] {
  const roles = new Set<string>();

  // Realm roles
  if (payload.realm_access?.roles) {
    for (const role of payload.realm_access.roles) {
      roles.add(role);
    }
  }

  // Client-specific roles
  const clientAccess = payload.resource_access?.[KEYCLOAK_CLIENT_ID];
  if (clientAccess?.roles) {
    for (const role of clientAccess.roles) {
      roles.add(role);
    }
  }

  // Map Keycloak roles to NDSEP roles
  const ndsepRoles: string[] = [];
  if (roles.has("admin") || roles.has("realm-admin")) ndsepRoles.push("admin");
  if (roles.has("ndpc-officer") || roles.has("regulator")) ndsepRoles.push("regulator");
  if (roles.has("dpco-manager") || roles.has("dpco")) ndsepRoles.push("dpco");
  if (roles.has("org-dpo") || roles.has("dpo")) ndsepRoles.push("dpo");
  if (roles.has("auditor")) ndsepRoles.push("auditor");
  if (roles.has("citizen")) ndsepRoles.push("citizen");

  // Default role if none mapped
  if (ndsepRoles.length === 0) ndsepRoles.push("viewer");

  return ndsepRoles;
}

export async function validateAccessToken(token: string): Promise<KeycloakSession["user"] | null> {
  if (!KEYCLOAK_ENABLED) return null;

  // This verifier checks the signed JWT's algorithm, key ID, RS256 signature,
  // issuer, audience, expiry, and not-before claims. Never replace it with a
  // decoded-payload cache: a cache must not become an authorization bypass.
  const verified = await verifyKeycloakToken(token);
  if (!verified) return null;

  return {
    sub: verified.sub,
    email: verified.email ?? "",
    name: verified.name ?? verified.username,
    username: verified.username,
    roles: mapRoles({
      sub: verified.sub,
      exp: Math.floor(Date.now() / 1000) + 1,
      iat: Math.floor(Date.now() / 1000),
      realm_access: { roles: verified.roles },
      resource_access: { [KEYCLOAK_CLIENT_ID]: { roles: verified.clientRoles } },
    }),
  };
}

export async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
): Promise<KeycloakSession | null> {
  if (!KEYCLOAK_ENABLED) return null;

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: KEYCLOAK_CLIENT_ID,
      ...(KEYCLOAK_CLIENT_SECRET ? { client_secret: KEYCLOAK_CLIENT_SECRET } : {}),
    });

    const res = await fetch(`${OIDC_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text();
      captureError(`Keycloak token exchange failed: ${res.status} ${errText}`, "keycloak-auth");
      return null;
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      id_token: string;
      expires_in: number;
    };

    const user = await validateAccessToken(data.access_token);
    if (!user) return null;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      idToken: data.id_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      user,
    };
  } catch (err) {
    captureError(err instanceof Error ? err : new Error(String(err)), "keycloak-exchange");
    return null;
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<KeycloakSession | null> {
  if (!KEYCLOAK_ENABLED) return null;

  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: KEYCLOAK_CLIENT_ID,
      ...(KEYCLOAK_CLIENT_SECRET ? { client_secret: KEYCLOAK_CLIENT_SECRET } : {}),
    });

    const res = await fetch(`${OIDC_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      id_token: string;
      expires_in: number;
    };

    const user = await validateAccessToken(data.access_token);
    if (!user) return null;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      idToken: data.id_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      user,
    };
  } catch (err) {
    captureError(err instanceof Error ? err : new Error(String(err)), "keycloak-refresh");
    return null;
  }
}

export async function logoutSession(idToken: string): Promise<boolean> {
  if (!KEYCLOAK_ENABLED) return false;

  try {
    const res = await fetch(`${OIDC_BASE}/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: KEYCLOAK_CLIENT_ID,
        id_token_hint: idToken,
      }).toString(),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function getKeycloakHealthStatus() {
  return {
    enabled: KEYCLOAK_ENABLED,
    url: KEYCLOAK_ENABLED ? KEYCLOAK_URL : null,
    realm: KEYCLOAK_ENABLED ? KEYCLOAK_REALM : null,
    clientId: KEYCLOAK_ENABLED ? KEYCLOAK_CLIENT_ID : null,
    jwksCached: !!jwksCache,
    jwksCacheAge: jwksCacheTime > 0 ? Math.floor((Date.now() - jwksCacheTime) / 1000) : null,
  };
}

if (KEYCLOAK_ENABLED) {
  logger.info(`[Keycloak] Enabled — realm=${KEYCLOAK_REALM}, client=${KEYCLOAK_CLIENT_ID}`);
  fetchJWKS().then((keys) => {
    logger.info(`[Keycloak] JWKS loaded: ${keys.length} keys`);
  }).catch(() => {
    logger.warn("[Keycloak] Could not load JWKS — will retry on first token validation");
  });
} else {
  logger.info("[Keycloak] Not enabled — using demo-login authentication");
}
