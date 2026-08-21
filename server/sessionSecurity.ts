/**
 * NDSEP Session Security — Fixation Prevention & Lifecycle Management
 * ====================================================================
 * Regenerates session IDs on authentication events to prevent session fixation.
 * Provides session lifecycle hooks for security hardening.
 *
 * Recommendation M7: Session fixation prevention
 */

import type { Request, Response } from "express";
import crypto from "crypto";
import { logger } from "./logger";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";

/**
 * Regenerate session ID on authentication.
 * Clears the old cookie and sets a new one with a fresh token.
 */
export async function regenerateSession(
  req: Request,
  res: Response,
  sdk: { createSessionToken: (openId: string, opts: { name: string; expiresInMs: number }) => Promise<string> },
  openId: string,
  name: string
): Promise<string> {
  // Clear existing session cookie
  const cookieOptions = getSessionCookieOptions(req);
  res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });

  // Generate new session token
  const newToken = await sdk.createSessionToken(openId, { name, expiresInMs: ONE_YEAR_MS });

  // Set new cookie
  res.cookie(COOKIE_NAME, newToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

  logger.info({ openId }, "[Session] Session regenerated on authentication");
  return newToken;
}

/**
 * Generate a cryptographic session nonce for additional binding.
 * Can be used for binding CSRF tokens to specific sessions.
 */
export function generateSessionNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}
