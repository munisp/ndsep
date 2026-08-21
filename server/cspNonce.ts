/**
 * NDSEP Content Security Policy — Nonce-Based Script Loading
 * ============================================================
 * Generates a unique nonce per request and injects it into CSP headers.
 * Scripts must include the nonce attribute to execute.
 *
 * Usage:
 *   app.use(cspNonceMiddleware());
 *   // In templates: <script nonce="<%= res.locals.cspNonce %>">
 */

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

export function cspNonceMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const nonce = crypto.randomBytes(16).toString("base64");
    res.locals.cspNonce = nonce;

    // Override the CSP header to include the nonce
    const isDev = process.env.NODE_ENV !== "production";
    const existingCsp = res.getHeader("Content-Security-Policy") as string | undefined;
    if (existingCsp) {
      const updated = existingCsp
        .replace(
          /script-src[^;]*/,
          isDev
            ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'nonce-${nonce}'`
            : `script-src 'self' 'nonce-${nonce}'`
        );
      res.setHeader("Content-Security-Policy", updated);
    } else {
      res.setHeader(
        "Content-Security-Policy",
        isDev
          ? `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' ws: wss:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
          : `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
      );
    }

    next();
  };
}

export function getNonce(res: Response): string {
  return res.locals.cspNonce ?? "";
}
