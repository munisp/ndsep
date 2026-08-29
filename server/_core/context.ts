import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { verifyKeycloakToken, mapKeycloakRoleToNdsep } from "../keycloak";
import { getUserByOpenId, upsertUser } from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /** Present only for a successfully verified Keycloak bearer token. */
  authAssurance?: { source: "keycloak"; mfaVerified: boolean };
};

/**
 * Try to authenticate via Keycloak Bearer token.
 * Returns a User record (upserted into the DB) or null.
 */
type KeycloakAuthResult = {
  attempted: boolean;
  user: User | null;
  assurance?: { source: "keycloak"; mfaVerified: boolean };
};

async function tryKeycloakAuth(authHeader: string | undefined): Promise<KeycloakAuthResult> {
  if (!authHeader) return { attempted: false, user: null };
  if (!authHeader.startsWith("Bearer ")) return { attempted: true, user: null };

  const token = authHeader.slice(7).trim();
  if (!token) return { attempted: true, user: null };
  try {
    const kcUser = await verifyKeycloakToken(token);
    if (!kcUser) return { attempted: true, user: null };

    const role = mapKeycloakRoleToNdsep(kcUser);
    await upsertUser({
      openId: `kc:${kcUser.sub}`,
      name: kcUser.name ?? kcUser.username,
      email: kcUser.email ?? null,
      role,
    });
    return {
      attempted: true,
      user: (await getUserByOpenId(`kc:${kcUser.sub}`)) ?? null,
      assurance: { source: "keycloak", mfaVerified: kcUser.mfaVerified },
    };
  } catch {
    // A bearer-authentication failure must not fall through to cookie auth.
    return { attempted: true, user: null };
  }
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null;
  let authAssurance: TrpcContext["authAssurance"];

  // 1. Try Keycloak SSO (Authorization: Bearer <jwt>)
  const keycloakAuth = await tryKeycloakAuth(opts.req.headers.authorization);
  if (keycloakAuth.attempted) {
    user = keycloakAuth.user;
    authAssurance = keycloakAuth.assurance;
  } else {
    // 2. Fall back to Manus OAuth only when no bearer credential was supplied.
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    authAssurance,
  };
}
