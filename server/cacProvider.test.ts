import { afterEach, describe, expect, it, vi } from "vitest";
import { CacProviderError, verifyBusinessRegistration } from "./cacProvider";

const originalEnvironment = { ...process.env };

function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
}

function configureTestBridge() {
  process.env.NODE_ENV = "test";
  process.env.NDSEP_ALLOW_TEST_PROVIDER_EMULATORS = "true";
  process.env.CAC_BRIDGE_URL = "http://127.0.0.1:8346";
  process.env.CAC_BRIDGE_TOKEN = "test-token";
}

afterEach(() => {
  restoreEnvironment();
  vi.unstubAllGlobals();
});

describe("verifyBusinessRegistration", () => {
  it("fails closed when CAC configuration is missing", async () => {
    delete process.env.CAC_BRIDGE_URL;
    delete process.env.CAC_BRIDGE_TOKEN;

    await expect(
      verifyBusinessRegistration({
        registrationNumber: "RC-TEST-001",
        purpose: "contract test",
      })
    ).rejects.toMatchObject<Partial<CacProviderError>>({
      kind: "configuration",
    });
  });

  it("accepts a labelled test emulator only after explicit non-production opt-in", async () => {
    configureTestBridge();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          verified: true,
          provider_reference: "sim-cac-reference",
          status: "active",
          legal_name: "Test Business Ltd",
          registration_type: "company",
        }),
        { headers: { "X-NDSEP-Simulation": "true" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyBusinessRegistration({
        registrationNumber: "RC-TEST-001",
        purpose: "contract test",
      })
    ).resolves.toEqual({
      verified: true,
      providerReference: "sim-cac-reference",
      providerStatus: "active",
      legalName: "Test Business Ltd",
      registrationType: "company",
      provenance: "test_emulator",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a labelled CAC emulator response in production", async () => {
    configureTestBridge();
    process.env.NODE_ENV = "production";
    process.env.CAC_BRIDGE_URL = "https://cac-bridge.example.test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            verified: true,
            provider_reference: "sim-cac-reference",
            status: "active",
          }),
          { headers: { "X-NDSEP-Simulation": "true" } }
        )
      )
    );

    await expect(
      verifyBusinessRegistration({
        registrationNumber: "RC-TEST-001",
        purpose: "contract test",
      })
    ).rejects.toMatchObject<Partial<CacProviderError>>({
      kind: "simulation_forbidden",
    });
  });

  it("fails closed when the CAC bridge times out", async () => {
    configureTestBridge();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("timeout", "AbortError"))
    );

    await expect(
      verifyBusinessRegistration({
        registrationNumber: "RC-TEST-001",
        purpose: "contract test",
      })
    ).rejects.toMatchObject<Partial<CacProviderError>>({
      kind: "unavailable",
    });
  });

  it("fails closed on a malformed CAC provider payload", async () => {
    configureTestBridge();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ verified: true })))
    );

    await expect(
      verifyBusinessRegistration({
        registrationNumber: "RC-TEST-001",
        purpose: "contract test",
      })
    ).rejects.toMatchObject<Partial<CacProviderError>>({
      kind: "invalid_response",
    });
  });
});
