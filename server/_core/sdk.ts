import { ForbiddenError } from "../../shared/_core/errors.js";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
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
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        return null;
      }
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
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session");
    }

    const signedInAt = new Date();
    let user = await db.getUserByOpenId(session.openId);
    if (!user) {
      await db.upsertUser({
        openId: session.openId,
        name: session.name,
        email: session.email ?? null,
        loginMethod: "local-jwt",
        role: session.role === "admin" ? "admin" : "user",
        lastSignedIn: signedInAt,
      });
      user = await db.getUserByOpenId(session.openId);
    }

    if (!user) {
      throw ForbiddenError("User not found");
    }

    await db.upsertUser({
      openId: user.openId,
      name: user.name,
      email: user.email,
      loginMethod: user.loginMethod ?? "local-jwt",
      role: user.role,
      lastSignedIn: signedInAt,
    });

    return {
      ...user,
      role: user.role ?? "user",
    } as AuthenticatedUser;
  }
}

export type AuthenticatedUser = User & {
  taskUid?: string;
  isCron?: boolean;
};

export { COOKIE_NAME, ONE_YEAR_MS };
export const sdk = new SDKServer();
