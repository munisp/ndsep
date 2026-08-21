/**
 * NDSEP CSRF Protection — Double-Submit Cookie Pattern
 * =====================================================
 * Generates a CSRF token on session creation and validates it
 * on all state-changing requests (POST, PUT, PATCH, DELETE).
 *
 * Recommendation H3: Prevent cross-site request forgery attacks.
 */

import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { parse as parseCookieHeader } from "cookie";
import { logger } from "./logger";

const CSRF_COOKIE = "ndsep_csrf";
const CSRF_HEADER = "x-csrf-token";
const TOKEN_LENGTH = 32;

/** Generate a cryptographically secure CSRF token */
function generateToken(): string {
  return crypto.randomBytes(TOKEN_LENGTH).toString("hex");
}

/**
 * Middleware: Set CSRF cookie if not already present.
 * The cookie is SameSite=Strict, httpOnly=false (client JS needs to read it).
 */
/** Parse a named cookie from the raw Cookie header (no cookie-parser dependency). */
function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const parsed = parseCookieHeader(header);
  return parsed[name];
}

export function csrfCookieMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!getCookie(req, CSRF_COOKIE)) {
    const token = generateToken();
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,       // Client JS must read this to set the header
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
  }
  next();
}

/**
 * Middleware: Validate CSRF token on state-changing requests.
 * Compares the X-CSRF-Token header against the csrf cookie value.
 */
export function csrfValidationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip safe methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  // Skip API key authenticated requests (machine-to-machine)
  if (req.headers.authorization?.startsWith("Bearer ndsep_")) {
    return next();
  }

  // Skip Stripe webhooks (authenticated via signature)
  if (req.path === "/api/stripe/webhook") {
    return next();
  }

  // Skip in development/test unless explicitly enabled
  if (process.env.NODE_ENV !== "production" && process.env.ENFORCE_CSRF !== "true") {
    return next();
  }

  const cookieToken = getCookie(req, CSRF_COOKIE);
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;

  if (!cookieToken || !headerToken) {
    logger.warn({ ip: req.ip, path: req.path }, "[CSRF] Missing token");
    res.status(403).json({ error: "CSRF token missing" });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  if (cookieToken.length !== headerToken.length ||
      !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
    logger.warn({ ip: req.ip, path: req.path }, "[CSRF] Token mismatch");
    res.status(403).json({ error: "CSRF token invalid" });
    return;
  }

  next();
}
