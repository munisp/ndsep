/**
 * Keycloak SSO JWT Verification
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies Keycloak-issued JWTs so enterprise users can authenticate via
 * Keycloak SSO in addition to Manus OAuth.
 *
 * Configuration (env vars):
 *   KEYCLOAK_URL          Base URL of the Keycloak server (e.g. https://sso.nitda.gov.ng)
 *   KEYCLOAK_REALM        Realm name (e.g. ndsep)
 *   KEYCLOAK_CLIENT_ID    Client ID registered in Keycloak (e.g. ndsep-platform)
 *   KEYCLOAK_CLIENT_SECRET  Optional client secret for confidential clients
 *
 * The module fetches the realm's JWKS on first use and caches it for 1 hour.
 * All operations degrade gracefully — if Keycloak is unreachable the function
 * returns null so the caller can fall back to Manus OAuth.
 */

import * as crypto from "crypto";
import { logger } from "./logger";

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? "http://localhost:8080";
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? "ndsep";
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "ndsep-platform";

// ── JWKS cache ────────────────────────────────────────────────────────────────
interface JwksKey {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n?: string;
  e?: string;
  x5c?: string[];
}
interface JwksCache {
  keys: JwksKey[];
  fetchedAt: number;
}
let jwksCache: JwksCache | null = null;
const JWKS_TTL_MS = 60 * 60 * 1_000; // 1 hour

async function getJwks(): Promise<JwksKey[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  try {
    const url = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return [];
    const data = await res.json();
    jwksCache = { keys: data.keys ?? [], fetchedAt: Date.now() };
    return jwksCache.keys;
  } catch {
    return [];
  }
}

// ── JWT parsing (no external dependency) ─────────────────────────────────────
function base64UrlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + (4 - (str.length % 4)) % 4, "=");
  return Buffer.from(padded, "base64");
}

interface JwtHeader { alg: string; kid?: string; typ?: string; }
interface JwtPayload {
  sub?: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
}

function parseJwtUnsafe(token: string): { header: JwtHeader; payload: JwtPayload } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(base64UrlDecode(parts[0]).toString("utf8")) as JwtHeader;
    const payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf8")) as JwtPayload;
    return { header, payload };
  } catch {
    return null;
  }
}

async function verifyRs256(token: string, jwk: JwksKey): Promise<boolean> {
  try {
    const parts = token.split(".");
    const signingInput = `${parts[0]}.${parts[1]}`;
    const signature = base64UrlDecode(parts[2]);

    // Build PEM from JWK n/e
    if (!jwk.n || !jwk.e) return false;
    const keyObj = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", use: "sig" },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      keyObj,
      signature,
      Buffer.from(signingInput, "utf8")
    );
  } catch {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface KeycloakUser {
  sub: string;
  username: string;
  email?: string;
  name?: string;
  roles: string[];
  clientRoles: string[];
  raw: JwtPayload;
}

/**
 * Verify a Keycloak JWT and return the decoded user, or null if invalid.
 * Gracefully returns null if Keycloak is unreachable.
 */
export async function verifyKeycloakToken(token: string): Promise<KeycloakUser | null> {
  const parsed = parseJwtUnsafe(token);
  if (!parsed) return null;

  const { header, payload } = parsed;

  const now = Math.floor(Date.now() / 1_000);
  const expectedIssuer = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`;

  // A bearer token is only accepted when its cryptographic and registered
  // claims bind it to this exact realm and client. Never decode-only trust a
  // token and never accept an unsigned/development fallback.
  if (!payload.sub || !payload.exp || payload.exp <= now || (payload.nbf !== undefined && payload.nbf > now)) return null;
  if (payload.iss !== expectedIssuer) return null;
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud ?? ""];
  if (!audience.includes(KEYCLOAK_CLIENT_ID)) return null;
  if (header.alg !== "RS256" || !header.kid) return null;

  const keys = await getJwks();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk || jwk.kty !== "RSA" || jwk.use !== "sig" || (jwk.alg && jwk.alg !== "RS256")) {
    logger.warn({ kid: header.kid }, "[Keycloak] Signing key unavailable or incompatible");
    return null;
  }
  if (!(await verifyRs256(token, jwk))) return null;

  const realmRoles = payload.realm_access?.roles ?? [];
  const clientRoles = payload.resource_access?.[KEYCLOAK_CLIENT_ID]?.roles ?? [];

  return {
    sub: payload.sub ?? "",
    username: payload.preferred_username ?? payload.sub ?? "",
    email: payload.email,
    name: payload.name,
    roles: realmRoles,
    clientRoles,
    raw: payload,
  };
}

/**
 * Map Keycloak roles to NDSEP platform roles.
 */
export function mapKeycloakRoleToNdsep(kcUser: KeycloakUser): "admin" | "auditor" | "org_admin" | "user" {
  const all = [...kcUser.roles, ...kcUser.clientRoles];
  if (all.includes("ndsep-admin") || all.includes("admin")) return "admin";
  if (all.includes("ndsep-auditor") || all.includes("auditor")) return "auditor";
  if (all.includes("ndsep-org-admin") || all.includes("org_admin")) return "org_admin";
  return "user";
}

/**
 * Health check — returns true if Keycloak realm is reachable.
 */
export async function isKeycloakHealthy(): Promise<boolean> {
  try {
    const url = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get Keycloak realm info (for admin display).
 */
export async function getKeycloakRealmInfo(): Promise<Record<string, unknown> | null> {
  try {
    const url = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
