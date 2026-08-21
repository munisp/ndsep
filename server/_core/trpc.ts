import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { buildOpaInput, requireOpaDecision, type OpaAction } from "../security/opa";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    // Administrative mutations require both the platform role and an
    // authoritative relationship-based decision. A Permify outage denies the
    // request; it must never become an implicit authorization bypass.
    const { checkPermission } = await import("../middlewareIntegration");
    const allowed = await checkPermission(ctx.user.id, "admin", "write");
    if (!allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Permify: admin write permission denied",
      });
    }

    await requireOpaDecision(buildOpaInput(ctx.user, "admin", "platform.admin", {
      mfaVerified: ctx.authAssurance?.mfaVerified,
    }));

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);

// ─── NDSEP RBAC Procedures ────────────────────────────────────────────────────

/** Government staff: full read access to all platform data */
export const governmentStaffProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const allowedRoles: string[] = ["admin", "government_staff"];
    if (!ctx.user || !allowedRoles.includes(ctx.user.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Government staff access required",
      });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
);

/** Org admin: can manage their own organization's data only */
export const orgAdminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const allowedRoles: string[] = ["admin", "government_staff", "org_admin"];
    if (!ctx.user || !allowedRoles.includes(ctx.user.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Organization admin access required",
      });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
);

/** Auditor: read-only access to audit trail, compliance, and violations */
export const auditorProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const allowedRoles: string[] = [
      "admin",
      "government_staff",
      "org_admin",
      "auditor",
    ];
    if (!ctx.user || !allowedRoles.includes(ctx.user.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Auditor access required",
      });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
);

// ─── PBAC-enforced procedure factories ───────────────────────────────────────
import { pbacMiddleware } from "../security/pbac";

/**
 * Additional externalized policy guard for destructive, approval, and export
 * paths. A missing or unavailable OPA decision denies in production.
 */
export function opaGuard(resource: string, action: OpaAction) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    await requireOpaDecision(buildOpaInput(ctx.user, action, resource, {
      mfaVerified: ctx.authAssurance?.mfaVerified,
    }));
    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  });
}

/** protectedProcedure + PBAC + OPA export guard */
export const exportProcedure = protectedProcedure.use(pbacMiddleware("*", "export")).use(opaGuard("platform.export", "export"));

/** protectedProcedure + PBAC + OPA delete guard */
export const deleteProcedure = protectedProcedure.use(pbacMiddleware("*", "delete")).use(opaGuard("platform.delete", "delete"));

/** protectedProcedure + PBAC + OPA approval guard */
export const approveProcedure = protectedProcedure.use(pbacMiddleware("*", "approve")).use(opaGuard("platform.approve", "approve"));

// ─── Permify ReBAC middleware ────────────────────────────────────────────────
import { checkPermission } from "../middlewareIntegration";

/**
 * tRPC middleware factory for Permify ReBAC enforcement.
 * Checks relationship-based permissions and denies when the authorization
 * service cannot make an explicit allow decision.
 * Usage: protectedProcedure.use(permifyGuard("resource", "action"))
 */
export function permifyGuard(resource: string, action: string) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }
    const allowed = await checkPermission(ctx.user.id, resource, action);
    if (!allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Permission denied: '${action}' on '${resource}'`,
      });
    }
    return next({ ctx });
  });
}

/** Procedures with Permify enforcement for specific domains */
export const complianceMutationProcedure = protectedProcedure.use(
  permifyGuard("compliance", "write")
);
export const enforcementMutationProcedure = protectedProcedure.use(
  permifyGuard("enforcement", "write")
);
export const bankingMutationProcedure = protectedProcedure.use(
  permifyGuard("banking", "write")
);
export const auditMutationProcedure = protectedProcedure.use(
  permifyGuard("audit", "write")
);

/**
 * Irreversible money-movement actions require the administrative platform role
 * plus an explicit relationship-based transfer permission. Neither an ordinary
 * authenticated session nor a broad read/write role is sufficient.
 */
export const fundsMovementProcedure = adminProcedure.use(
  permifyGuard("financial_transfer", "execute")
);

/** Helper: check if a user can access a specific organization's data */
export function canAccessOrg(
  user: { role: string; organizationId?: number | null },
  orgId: number
): boolean {
  if (["admin", "government_staff"].includes(user.role)) return true;
  if (user.role === "org_admin" && user.organizationId === orgId) return true;
  return false;
}
