import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  secureStore: new Map<string, string>(),
  refreshAsync: vi.fn(),
  fetchDiscoveryAsync: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => mocks.secureStore.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { mocks.secureStore.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { mocks.secureStore.delete(key); }),
}));

vi.mock("expo-auth-session", () => ({
  fetchDiscoveryAsync: mocks.fetchDiscoveryAsync,
  refreshAsync: mocks.refreshAsync,
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import {
  assertOidcConfig,
  getBiometricSessionMetadata,
  refreshBiometricSession,
  revokeAndClearSession,
  saveBiometricSession,
} from "../lib/oidc-session";

const config = {
  issuer: "https://sso.example.ng/realms/idlrpts",
  clientId: "idlrpts-mobile",
  redirectUri: "idlrpts://oauth/callback",
};

const session = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: Date.now() + 60_000,
  subject: "subject-1",
};

describe("OIDC session lifecycle", () => {
  beforeEach(() => {
    mocks.secureStore.clear();
    vi.clearAllMocks();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("rejects a non-HTTPS issuer before any provider call", () => {
    expect(() => assertOidcConfig({ ...config, issuer: "http://issuer.example.ng" })).toThrow("HTTPS OIDC issuer");
    expect(mocks.fetchDiscoveryAsync).not.toHaveBeenCalled();
  });

  it("clears native session data after a rejected refresh grant", async () => {
    await saveBiometricSession(session);
    mocks.fetchDiscoveryAsync.mockResolvedValue({ tokenEndpoint: "https://sso.example.ng/token" });
    mocks.refreshAsync.mockRejectedValue(new Error("invalid_grant"));

    await expect(refreshBiometricSession(config)).rejects.toThrow("Session refresh was rejected: invalid_grant");
    await expect(getBiometricSessionMetadata()).resolves.toBeNull();
    expect(mocks.secureStore.has("idlr.oidc.session.v1")).toBe(false);
  });

  it("revokes the refresh token when the IdP advertises a revocation endpoint and always clears local state", async () => {
    await saveBiometricSession(session);
    mocks.fetchDiscoveryAsync.mockResolvedValue({ revocationEndpoint: "https://sso.example.ng/revoke" });
    const fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await revokeAndClearSession(config);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://sso.example.ng/revoke",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.secureStore.size).toBe(0);
  });
});
