/**
 * NDSEP Authentication Middleware for Express routes.
 *
 * Production accepts only a cryptographically verified Keycloak bearer token
 * mapped to a persisted local user. Internal sessions are development/test
 * tooling and cannot authorize production HTTP routes.
 */
import type { Request, Response, NextFunction } from "express";
import { parse as parseCookieHeader } from "cookie";
import { sdk } from "./_core/sdk";
import { COOKIE_NAME } from "@shared/const";
import { logger } from "./logger";
import { getUserByOpenId } from "./db";
import { keycloakValidate } from "./middlewareExtensions";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
}

function keycloakEnabled(): boolean {
  return process.env.KEYCLOAK_ENABLED === "true";
}

function extractToken(req: Request): string | undefined {
  if (req.cookies?.[COOKIE_NAME]) return req.cookies[COOKIE_NAME] as string;
  const header = req.headers.cookie;
  if (!header) return undefined;
  return parseCookieHeader(header)[COOKIE_NAME];
}

function extractBearerToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return undefined;
  const token = auth.slice(7).trim();
  return token || undefined;
}

async function tryKeycloakAuth(req: Request): Promise<{ sub: string; roles: string[]; username?: string } | null> {
  if (!keycloakEnabled()) return null;
  const bearer = extractBearerToken(req);
  if (!bearer) return null;
  try {
    const result = await keycloakValidate(bearer);
    if (!result.valid || !result.sub) return null;
    return { sub: result.sub, roles: result.roles, username: result.username };
  } catch (error) {
    logger.warn({ err: error }, "[Keycloak] token validation failed");
    return null;
  }
}

function unauthorized(res: Response, message: string): void {
  res.status(401).json({ error: message });
}

/**
 * requireSession attaches a persisted user to the request.
 * In production it accepts only Keycloak bearer tokens and never falls back to
 * session cookies or creates an ephemeral local identity for an unknown `sub`.
 */
export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const kcUser = await tryKeycloakAuth(req);
    if (kcUser) {
      const user = await getUserByOpenId(kcUser.sub);
      if (!user) {
        res.status(403).json({ error: "Keycloak identity is not provisioned in NDSEP" });
        return;
      }
      (req as any).sessionUser = user;
      next();
      return;
    }

    if (isProduction()) {
      unauthorized(res, "A valid Keycloak bearer token is required");
      return;
    }

    const token = extractToken(req);
    if (!token) {
      unauthorized(res, "Authentication required");
      return;
    }
    const session = await sdk.verifySession(token);
    if (!session) {
      unauthorized(res, "Invalid or expired session");
      return;
    }
    const user = await getUserByOpenId(session.openId);
    if (!user) {
      unauthorized(res, "User not found");
      return;
    }
    (req as any).sessionUser = user;
    next();
  } catch (error) {
    logger.warn({ err: error }, "[requireSession] authorization failed");
    unauthorized(res, "Authentication required");
  }
}

/** Require a persisted NDSEP administrator after the same authentication gate. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireSession(req, res, async () => {
    const user = (req as any).sessionUser;
    if (!user || user.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}
