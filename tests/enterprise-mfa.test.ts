import { describe, expect, it } from "vitest";
import { assertMfaAuthenticated } from "../server/_core/enterpriseAuth";

describe("enterprise MFA step-up", () => {
  it("rejects a privileged session without a verified MFA claim", () => {
    expect(() => assertMfaAuthenticated({ subject: "admin", issuer: "https://identity.example.ng", agencyId: "fct", agencyRoles: ["planning_supervisor"], authMethod: "oidc", mfaAuthenticated: false })).toThrow("Step-up MFA is required");
  });
  it("accepts a principal carrying a verified MFA claim", () => {
    expect(() => assertMfaAuthenticated({ subject: "admin", issuer: "https://identity.example.ng", agencyId: "fct", agencyRoles: ["planning_supervisor"], authMethod: "oidc", mfaAuthenticated: true })).not.toThrow();
  });
});
