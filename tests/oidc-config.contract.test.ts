import { describe, expect, it } from "vitest";

function acceptsOidcConfig(config: { issuer: string; clientId: string; redirectUri: string }) {
  return config.issuer.startsWith("https://") && Boolean(config.clientId) && Boolean(config.redirectUri);
}

describe("OIDC mobile activation contract", () => {
  it("requires a HTTPS issuer, public client id, and explicit deep-link redirect", () => {
    expect(acceptsOidcConfig({ issuer: "https://sso.example.ng/realms/idlrpts", clientId: "idlrpts-mobile", redirectUri: "idlrpts://oauth/callback" })).toBe(true);
    expect(acceptsOidcConfig({ issuer: "http://issuer", clientId: "idlrpts-mobile", redirectUri: "idlrpts://oauth/callback" })).toBe(false);
    expect(acceptsOidcConfig({ issuer: "https://issuer", clientId: "", redirectUri: "idlrpts://oauth/callback" })).toBe(false);
  });
});
