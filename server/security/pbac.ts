/**
 * PBAC — Policy-Based Access Control
 * ====================================
 * Implements a fine-grained, attribute-based access control layer on top of
 * the existing role-based auth.  Policies are evaluated at the tRPC procedure
 * level and can reference:
 *   - ctx.user.role  (admin | user)
 *   - ctx.user.id    (numeric user ID)
 *   - resource       (the tRPC procedure namespace, e.g. "banking.kyc")
 *   - action         (read | write | delete | export | approve)
 *   - environment    (production | staging | development)
 *
 * Usage (in a tRPC procedure):
 *   import { enforcePolicy } from "../security/pbac";
 *   enforcePolicy(ctx, "banking.kyc", "export");
 */

import { TRPCError } from "@trpc/server";

// ── Policy definitions ────────────────────────────────────────────────────
export type Action = "read" | "write" | "delete" | "export" | "approve" | "admin";
export type Resource = string; // e.g. "banking.kyc", "phase13.penaltyCalculator"

interface PolicyRule {
  /** Glob-style resource pattern, e.g. "banking.*" or "phase13.penaltyCalculator" */
  resource: string;
  /** Allowed actions for this rule */
  actions: Action[];
  /** Roles that this rule applies to */
  roles: ("admin" | "user")[];
  /** Optional: deny rule (default: allow) */
  deny?: boolean;
  /** Optional: condition function for attribute-based checks */
  condition?: (ctx: PolicyContext) => boolean;
}

interface PolicyContext {
  userId: number;
  role: "admin" | "user";
  resource: Resource;
  action: Action;
  env: string;
}

// ── Policy table ─────────────────────────────────────────────────────────
const POLICIES: PolicyRule[] = [
  // ── Admin: full access to everything ───────────────────────────────────
  {
    resource: "*",
    actions: ["read", "write", "delete", "export", "approve", "admin"],
    roles: ["admin"],
  },

  // ── Regular users: read-only on most modules ───────────────────────────
  {
    resource: "banking.*",
    actions: ["read"],
    roles: ["user"],
  },
  {
    resource: "phase12.*",
    actions: ["read"],
    roles: ["user"],
  },
  {
    resource: "phase13.*",
    actions: ["read"],
    roles: ["user"],
  },

  // ── DSAR: users can submit their own requests ──────────────────────────
  {
    resource: "dsar.*",
    actions: ["read", "write"],
    roles: ["user"],
  },

  // ── Consent: users can manage their own consent ────────────────────────
  {
    resource: "consentRecord.*",
    actions: ["read", "write"],
    roles: ["user"],
  },

  // ── Whistleblower: any authenticated user can submit ──────────────────
  {
    resource: "phase12.whistleblower.*",
    actions: ["read", "write"],
    roles: ["user"],
  },

  // ── Penalty calculator: read-only for regular users ────────────────────
  {
    resource: "phase13.penaltyCalculator.*",
    actions: ["read"],
    roles: ["user"],
  },

  // ── Export: admin-only ─────────────────────────────────────────────────
  {
    resource: "*.export*",
    actions: ["export"],
    roles: ["admin"],
  },

  // ── Delete: admin-only ─────────────────────────────────────────────────
  {
    resource: "*",
    actions: ["delete"],
    roles: ["admin"],
  },

  // ── Approve: admin-only ────────────────────────────────────────────────
  {
    resource: "*",
    actions: ["approve"],
    roles: ["admin"],
  },

  // ── Stripe payments: admin-only ────────────────────────────────────────
  {
    resource: "phase12.stripePayments.*",
    actions: ["read", "write", "approve"],
    roles: ["admin"],
  },

  // ── User management: admin-only ────────────────────────────────────────
  {
    resource: "userManagement.*",
    actions: ["read", "write", "delete", "admin"],
    roles: ["admin"],
  },

  // ── Security audit: admin-only ─────────────────────────────────────────
  {
    resource: "securityAudit.*",
    actions: ["read", "admin"],
    roles: ["admin"],
  },
];

// ── Glob matcher ─────────────────────────────────────────────────────────
function matchesGlob(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (pattern === value) return true;
  // Convert glob to regex: * matches any segment
  const regex = new RegExp(
    "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
  );
  return regex.test(value);
}

// ── Policy evaluator ─────────────────────────────────────────────────────
export function evaluatePolicy(ctx: PolicyContext): boolean {
  let allowed = false;
  let denied = false;

  for (const rule of POLICIES) {
    if (!matchesGlob(rule.resource, ctx.resource)) continue;
    if (!rule.roles.includes(ctx.role)) continue;
    if (!rule.actions.includes(ctx.action)) continue;
    if (rule.condition && !rule.condition(ctx)) continue;

    if (rule.deny) {
      denied = true;
    } else {
      allowed = true;
    }
  }

  // Deny rules always win
  return allowed && !denied;
}

// ── Enforcement helper (throws TRPCError on deny) ────────────────────────
export function enforcePolicy(
  ctx: { user: { id: number; role: "admin" | "user" } },
  resource: Resource,
  action: Action
): void {
  const policyCtx: PolicyContext = {
    userId: ctx.user.id,
    role: ctx.user.role,
    resource,
    action,
    env: process.env.NODE_ENV ?? "development",
  };

  if (!evaluatePolicy(policyCtx)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `PBAC: action '${action}' on resource '${resource}' is not permitted for role '${ctx.user.role}'`,
    });
  }
}

// ── tRPC middleware factory ───────────────────────────────────────────────
/**
 * Creates a tRPC middleware that enforces a PBAC policy.
 * Usage:
 *   .use(pbacMiddleware("banking.kyc", "export"))
 */
export function pbacMiddleware(resource: Resource, action: Action) {
  return ({ ctx, next }: { ctx: any; next: () => any }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    enforcePolicy(ctx, resource, action);
    return next();
  };
}
