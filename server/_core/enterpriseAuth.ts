import { TRPCError } from "@trpc/server";

export const ENTERPRISE_AGENCY_ROLES = [
  "applicant",
  "mining_reviewer",
  "petroleum_reviewer",
  "environment_reviewer",
  "planning_supervisor",
] as const;

export type EnterpriseAgencyRole = (typeof ENTERPRISE_AGENCY_ROLES)[number];

export type EnterprisePrincipal = {
  subject: string;
  issuer: string;
  agencyId: string;
  agencyRoles: EnterpriseAgencyRole[];
  authMethod: "oidc" | "local_development";
  /** Optional session identifier only when a verified OIDC token supplied sid or session_state. */
  sessionId?: string;
  /** True only when the verified OIDC access token's AMR claim reports a WebAuthn/passkey method. */
  passkeyAuthenticated: boolean;
};

export function isEnterpriseAgencyRole(value: unknown): value is EnterpriseAgencyRole {
  return typeof value === "string" && (ENTERPRISE_AGENCY_ROLES as readonly string[]).includes(value);
}

export function assertEnterpriseRole(principal: EnterprisePrincipal, allowedRoles: EnterpriseAgencyRole[]) {
  if (!principal.agencyRoles.some((role) => allowedRoles.includes(role))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Enterprise authorization denied. Required agency role: ${allowedRoles.join(" or ")}.`,
    });
  }
}
