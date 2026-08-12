import { afterEach, describe, expect, it, vi } from "vitest";

import {
  convertWithDocling,
  getProviderHealth,
  verifyBusinessRegistration,
  verifyDojahLiveness,
  verifyNationalIdentity,
  verifyRegistryTitle,
} from "../server/trustProviders";

const providerKeys = [
  "DOCLING_SERVICE_URL",
  "DOCLING_SERVICE_API_KEY",
  "DOJAH_APP_ID",
  "DOJAH_SECRET_KEY",
  "NIMC_NVS_BRIDGE_URL",
  "NIMC_NVS_BRIDGE_TOKEN",
  "CAC_VAS_BRIDGE_URL",
  "CAC_VAS_BRIDGE_TOKEN",
  "STATE_REGISTRY_BRIDGE_URL",
  "STATE_REGISTRY_BRIDGE_TOKEN",
] as const;

const originalEnvironment = Object.fromEntries(providerKeys.map((key) => [key, process.env[key]]));

function clearProviderEnvironment() {
  for (const key of providerKeys) delete process.env[key];
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearProviderEnvironment();
  for (const key of providerKeys) {
    const value = originalEnvironment[key];
    if (value) process.env[key] = value;
  }
});

describe("trust provider defaults", () => {
  it("reports every external trust provider as unavailable by default", () => {
    clearProviderEnvironment();
    const health = getProviderHealth();
    expect(health).toHaveLength(5);
    expect(health.every((item) => item.state === "unavailable" && item.configuredAtRuntime === false)).toBe(true);
  });

  it("fails closed without replacing unconfigured providers with plausible verification output", async () => {
    clearProviderEnvironment();
    await expect(convertWithDocling({ fileName: "title.pdf", mimeType: "application/pdf", base64Data: "dGVzdA==" })).resolves.toMatchObject({ state: "unavailable", provider: "docling" });
    await expect(verifyDojahLiveness({ base64Data: "dGVzdA==" })).resolves.toMatchObject({ state: "unavailable", provider: "dojah_liveness" });
    await expect(verifyNationalIdentity({ nin: "12345678901" })).resolves.toMatchObject({ state: "unavailable", provider: "nimc_nvs_bridge" });
    await expect(verifyBusinessRegistration({ rcNumber: "RC12345" })).resolves.toMatchObject({ state: "unavailable", provider: "cac_vas_bridge" });
    await expect(verifyRegistryTitle({ state: "Lagos", registryReference: "LS-2026-001" })).resolves.toMatchObject({ state: "unavailable", provider: "state_registry_bridge" });
  });

  it("normalizes configured Docling and liveness provider responses without upgrading their trust scope", async () => {
    process.env.DOCLING_SERVICE_URL = "https://docling.internal";
    process.env.DOCLING_SERVICE_API_KEY = "docling-key";
    process.env.DOJAH_APP_ID = "dojah-app";
    process.env.DOJAH_SECRET_KEY = "dojah-secret";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ documents: [{ markdown: "# Converted title" }] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ entity: { liveness: { liveness_check: true, liveness_probability: 98 }, face: { face_detected: true } } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const document = await convertWithDocling({ fileName: "title.pdf", mimeType: "application/pdf", base64Data: "dGVzdA==" });
    const liveness = await verifyDojahLiveness({ base64Data: "dGVzdA==" });

    expect(document).toEqual({ state: "ready", provider: "docling", value: { text: "# Converted title", source: "docling" } });
    expect(liveness).toMatchObject({ state: "ready", provider: "dojah_liveness", value: { passed: true, probability: 98, faceDetected: true } });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { "X-Api-Key": "docling-key" } });
  });

  it("passes only normalized verified, not-verified, or review-required results from an authorized bridge", async () => {
    process.env.NIMC_NVS_BRIDGE_URL = "https://nimc-bridge.internal/verify";
    process.env.NIMC_NVS_BRIDGE_TOKEN = "nimc-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "verified", providerReference: "nvs-001", attributes: { nameMatched: true } }), { status: 200 })));

    await expect(verifyNationalIdentity({ nin: "12345678901", legalName: "Amina Yusuf" })).resolves.toEqual({
      state: "ready",
      provider: "nimc_nvs_bridge",
      value: { status: "verified", providerReference: "nvs-001", reason: null, attributes: { nameMatched: true } },
    });
  });
});
