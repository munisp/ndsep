import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import type { EnterprisePrincipal } from "./enterpriseAuth";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  enterprise?: EnterprisePrincipal | null;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;
  let enterprise: EnterprisePrincipal | null = null;

  try {
    const authenticatedUser = await sdk.authenticateRequest(opts.req);
    user = authenticatedUser;
    enterprise = authenticatedUser.enterprise ?? null;
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    enterprise,
  };
}
