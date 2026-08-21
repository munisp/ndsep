import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { createRemoteJWKSet, SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { getConfiguredIntegrationValue } from "../integrationSettingsRepository";
import { type EnterpriseAgencyRole, type EnterprisePrincipal, isEnterpriseAgencyRole } from "./enterpriseAuth";
import { ENV } from "./env";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
  email?: string | null;
  role?: "user" | "admin";
};

const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
const COOKIE_NAME = "idlr_pts_session";

function resolveClaim(payload: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, payload);
}

function toAgencyRoles(value: unknown): EnterpriseAgencyRole[] {
  const candidates = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[ ,]+/) : [];
  return candidates.filter(isEnterpriseAgencyRole);
}

function isPasskeyAuthenticated(value: unknown) {
  const methods = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[ ,]+/) : [];
  return methods.some((method) => ["webauthn", "passkey", "fido2"].includes(String(method).toLowerCase()));
}

function enterpriseOidcConfig() {
  const issuer = getConfiguredIntegrationValue("OIDC_ISSUER")?.trim() || ENV.oidcIssuer;
  const audience = getConfiguredIntegrationValue("OIDC_AUDIENCE")?.trim() || ENV.oidcAudience;
  const jwksUrl = getConfiguredIntegrationValue("OIDC_JWKS_URL")?.trim() || ENV.oidcJwksUrl;
  if (!issuer || !audience || !jwksUrl) return null;
  try {
    const issuerUrl = new URL(issuer);
    const jwks = new URL(jwksUrl);
    if (issuerUrl.protocol !== "https:" || jwks.protocol !== "https:") return null;
    return { issuer, audience, jwksUrl };
  } catch {
    return null;
  }
}

class SDKServer {
  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    return new TextEncoder().encode(ENV.cookieSecret);
  }

  private getExternalJwks(jwksUrl: string) {
    return createRemoteJWKSet(new URL(jwksUrl));
  }

  private async verifyEnterpriseToken(token: string): Promise<{ identity: SessionPayload; principal: EnterprisePrincipal } | null> {
    const oidc = enterpriseOidcConfig();
    if (!oidc) return null;
    const jwks = this.getExternalJwks(oidc.jwksUrl);
    if (!jwks) return null;
    const { payload } = await jwtVerify(token, jwks, {
      issuer: oidc.issuer,
      audience: oidc.audience,
    });
    const claims = payload as Record<string, unknown>;
    const subject = typeof claims.sub === "string" ? claims.sub : null;
    const sessionId = typeof claims.sid === "string" ? claims.sid : typeof claims.session_state === "string" ? claims.session_state : undefined;
    const agencyId = resolveClaim(claims, ENV.oidcAgencyIdClaim);
    const agencyRoles = toAgencyRoles(resolveClaim(claims, ENV.oidcAgencyRolesClaim));
    if (!subject || typeof agencyId !== "string" || !agencyId || agencyRoles.length === 0) return null;

    const email = typeof claims.email === "string" ? claims.email : null;
    const name = typeof claims.name === "string" ? claims.name : email ?? subject;
    return {
      identity: {
        openId: `${oidc.issuer}:${subject}`.slice(0, 63),
        appId: ENV.appId,
        name,
        email,
        role: agencyRoles.includes("planning_supervisor") ? "admin" : "user",
      },
      principal: {
        subject,
        issuer: oidc.issuer,
        agencyId,
        agencyRoles,
        authMethod: "oidc",
        sessionId,
        passkeyAuthenticated: isPasskeyAuthenticated(claims.amr),
      },
    };
  }

  normalizeIdentity(input: {
    email: string;
    name?: string | null;
    role?: "user" | "admin";
  }) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const openId = normalizedEmail.replace(/[^a-z0-9]+/g, "-");
    return {
      openId,
      email: normalizedEmail,
      name: input.name?.trim() || normalizedEmail,
      role: input.role ?? (normalizedEmail === ENV.ownerOpenId ? "admin" : "user"),
    };
  }

  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string; email?: string | null; role?: "user" | "admin" } = {},
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || openId,
        email: options.email ?? null,
        role: options.role ?? "user",
      },
      options,
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {},
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
      email: payload.email ?? null,
      role: payload.role ?? "user",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .setIssuer(ENV.authIssuer)
      .setAudience(ENV.authAudience)
      .sign(secretKey);
  }

  async verifySession(cookieValue: string | undefined | null) {
    if (!cookieValue) return null;
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
        issuer: ENV.authIssuer,
        audience: ENV.authAudience,
      });
      const { openId, appId, name, email, role } = payload as Record<string, unknown>;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) return null;
      return {
        openId,
        appId,
        name,
        email: typeof email === "string" ? email : null,
        role: role === "admin" ? "admin" : "user",
      };
    } catch {
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    let token: string | undefined;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice("Bearer ".length).trim();
    }

    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = token || cookies.get(COOKIE_NAME);
    const external = token ? await this.verifyEnterpriseToken(token).catch(() => null) : null;
    const session = external?.identity ?? (await this.verifySession(sessionCookie));

    if (!session) throw new Error("Invalid session");

    const signedInAt = new Date();
    let user = await db.getUserByOpenId(session.openId);
    if (!user) {
      await db.upsertUser({
        openId: session.openId,
        name: session.name,
        email: session.email ?? null,
        loginMethod: external ? "oidc" : "local-jwt",
        role: session.role === "admin" ? "admin" : "user",
        lastSignedIn: signedInAt,
      });
      user = await db.getUserByOpenId(session.openId);
    }

    if (!user) throw new Error("User not found");

    await db.upsertUser({
      openId: user.openId,
      name: user.name,
      email: user.email,
      loginMethod: external ? "oidc" : user.loginMethod ?? "local-jwt",
      role: user.role,
      lastSignedIn: signedInAt,
    });

    const localPrincipal: EnterprisePrincipal | undefined =
      !external && ENV.allowLocalEnterpriseAuth && session.role === "admin"
        ? {
            subject: session.openId,
            issuer: "local-development",
            agencyId: "local-development-agency",
            agencyRoles: ["planning_supervisor"],
            authMethod: "local_development",
            sessionId: undefined,
            passkeyAuthenticated: false,
          }
        : undefined;

    return {
      ...user,
      role: user.role ?? "user",
      enterprise: external?.principal ?? localPrincipal,
    } as AuthenticatedUser;
  }
}

export type AuthenticatedUser = User & {
  taskUid?: string;
  isCron?: boolean;
  enterprise?: EnterprisePrincipal;
};

export { COOKIE_NAME, ONE_YEAR_MS };
export const sdk = new SDKServer();
