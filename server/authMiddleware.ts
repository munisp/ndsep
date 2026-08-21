/**
 * NDSEP Authentication Middleware for Express routes
 * Supports dual auth: Keycloak OIDC (when KEYCLOAK_ENABLED=true) + internal session.
 * Used to protect PDF download endpoints and other non-tRPC routes.
 */
import type { Request, Response, NextFunction } from "express";
import { parse as parseCookieHeader } from "cookie";
import { sdk } from "./_core/sdk";
import { COOKIE_NAME } from "@shared/const";
import { logger } from "./logger";
import { getUserByOpenId } from "./db";
import { keycloakValidate } from "./middlewareExtensions";

const KEYCLOAK_ENABLED = process.env.KEYCLOAK_ENABLED === "true";

function extractToken(req: Request): string | undefined {
  if (req.cookies?.[COOKIE_NAME]) return req.cookies[COOKIE_NAME] as string;
  const header = req.headers.cookie;
  if (!header) return undefined;
  const parsed = parseCookieHeader(header);
  return parsed[COOKIE_NAME] || undefined;
}

function extractBearerToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return undefined;
  return auth.slice(7);
}

/**
 * Validate via Keycloak OIDC if enabled and Bearer token present.
 * Returns { valid, user } or null if Keycloak path not applicable.
 */
async function tryKeycloakAuth(req: Request): Promise<{ sub: string; roles: string[]; username?: string } | null> {
  if (!KEYCLOAK_ENABLED) return null;
  const bearer = extractBearerToken(req);
  if (!bearer) return null;

  try {
    const result = await keycloakValidate(bearer);
    if (!result.valid) return null;
    return { sub: result.sub ?? "", roles: result.roles, username: result.username };
  } catch (err) {
    logger.warn({ err }, "[Keycloak] Token validation failed, falling back to session");
    return null;
  }
}

/**
 * requireSession: validates via Keycloak OIDC (if enabled) or session cookie.
 * Attaches user to req. Returns 401 if no valid auth.
 */
export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Path 1: Keycloak OIDC Bearer token
    const kcUser = await tryKeycloakAuth(req);
    if (kcUser) {
      const user = kcUser.sub ? await getUserByOpenId(kcUser.sub) : null;
      if (user) {
        (req as any).sessionUser = user;
        next();
        return;
      }
      // Keycloak token valid but user not in local DB — still set basic info
      (req as any).sessionUser = {
        id: 0,
        openId: kcUser.sub,
        username: kcUser.username ?? "keycloak-user",
        role: kcUser.roles.includes("admin") ? "admin" : kcUser.roles.includes("government_staff") ? "government_staff" : "user",
      };
      next();
      return;
    }

    // Path 2: Internal session cookie
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const session = await sdk.verifySession(token);
    if (!session) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }
    const user = await getUserByOpenId(session.openId);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    (req as any).sessionUser = user;
    next();
  } catch (err) {
    logger.warn({ err }, "[requireSession] Session validation failed");
    res.status(401).json({ error: "Authentication required" });
  }
}

/**
 * requireAdmin: validates session AND checks that user has admin role.
 * Returns 403 if user is not an admin.
 */
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
