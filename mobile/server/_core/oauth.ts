import type { Express, Request, Response } from "express";
import { getUserByOpenId, upsertUser } from "../db";
import { getSessionCookieOptions } from "./cookies";
import { COOKIE_NAME, ONE_YEAR_MS, sdk } from "./sdk";

async function syncUser(input: {
  email: string;
  name?: string | null;
  role?: "user" | "admin";
}) {
  const identity = sdk.normalizeIdentity(input);
  const lastSignedIn = new Date();
  await upsertUser({
    openId: identity.openId,
    name: identity.name,
    email: identity.email,
    loginMethod: "local-jwt",
    role: identity.role,
    lastSignedIn,
  });
  const saved = await getUserByOpenId(identity.openId);
  return (
    saved ?? {
      id: null,
      openId: identity.openId,
      name: identity.name,
      email: identity.email,
      loginMethod: "local-jwt",
      role: identity.role,
      lastSignedIn,
    }
  );
}

function buildUserResponse(
  user:
    | Awaited<ReturnType<typeof getUserByOpenId>>
    | {
        id?: number | null;
        openId: string;
        name?: string | null;
        email?: string | null;
        loginMethod?: string | null;
        role?: "user" | "admin";
        lastSignedIn?: Date | null;
      },
) {
  return {
    id: (user as any)?.id ?? null,
    openId: user?.openId ?? null,
    name: user?.name ?? null,
    email: user?.email ?? null,
    loginMethod: user?.loginMethod ?? "local-jwt",
    role: user?.role ?? "user",
    lastSignedIn: (user?.lastSignedIn ?? new Date()).toISOString(),
  };
}

export function registerOAuthRoutes(app: Express) {
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { email, name, role } = req.body ?? {};
    if (typeof email !== "string" || email.trim().length < 3) {
      res.status(400).json({ error: "email is required" });
      return;
    }

    try {
      const user = await syncUser({
        email,
        name: typeof name === "string" ? name : null,
        role: role === "admin" ? "admin" : "user",
      });

      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || user.openId,
        email: user.email ?? null,
        role: user.role ?? "user",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ sessionToken, user: buildUserResponse(user) });
    } catch (error) {
      console.error("[Auth] Login failed", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    const cookieOptions = getSessionCookieOptions(_req);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      res.json({ user: buildUserResponse(user) });
    } catch (error) {
      console.error("[Auth] /api/auth/me failed:", error);
      res.status(401).json({ error: "Not authenticated", user: null });
    }
  });

  app.post("/api/auth/session", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
        res.status(400).json({ error: "Bearer token required" });
        return;
      }
      const token = authHeader.slice("Bearer ".length).trim();
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true, user: buildUserResponse(user) });
    } catch (error) {
      console.error("[Auth] /api/auth/session failed", error);
      res.status(401).json({ error: "Invalid token" });
    }
  });
}
