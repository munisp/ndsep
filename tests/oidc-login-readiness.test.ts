import { describe, expect, it } from "vitest";

import { getOidcLoginReadiness } from "../lib/oidc-login-readiness";

describe("OIDC login readiness", () => {
  it("rejects incomplete or non-HTTPS enterprise sign-in configuration with explicit missing fields", () => {
    const result = getOidcLoginReadiness({ issuer: "http://identity.example.ng", clientId: "", redirectUri: "" });
    expect(result).toMatchObject({ ready: false, missing: ["issuer", "clientId", "redirectUri"] });
  });

  it("reports configured HTTPS OIDC values as ready without exposing any secrets", () => {
    const result = getOidcLoginReadiness({ issuer: "https://identity.example.ng/realms/idlr", clientId: "idlr-mobile", redirectUri: "idlrpts://oauth/callback" });
    expect(result).toEqual(expect.objectContaining({ ready: true, missing: [] }));
  });
});
