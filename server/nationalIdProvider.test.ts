import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NationalIdProviderError,
  verifyNationalId,
} from "./nationalIdProvider";

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
  process.env.NIMC_NVS_URL = "http://127.0.0.1:8346";
  process.env.NIMC_NVS_TOKEN = "test-token";
}

afterEach(() => {
  restoreEnvironment();
  vi.unstubAllGlobals();
});

describe("verifyNationalId", () => {
  it("fails closed when NIMC configuration is missing", async () => {
    delete process.env.NIMC_NVS_URL;
    delete process.env.NIMC_NVS_TOKEN;

    await expect(
      verifyNationalId({ idType: "nin", idValue: "TEST-NIN", purpose: "test" })
    ).rejects.toMatchObject<Partial<NationalIdProviderError>>({
      kind: "configuration",
    });
  });

  it("accepts a labelled simulator response only after explicit non-production opt-in", async () => {
    configureTestBridge();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          verified: true,
          provider_reference: "sim-nimc-reference",
          status: "verified",
          subject_reference: "redacted-subject",
        }),
        { headers: { "X-NDSEP-Simulation": "true" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyNationalId({
        idType: "nin",
        idValue: "TEST-NIN",
        purpose: "contract test",
      })
    ).resolves.toEqual({
      verified: true,
      providerReference: "sim-nimc-reference",
      providerStatus: "verified",
      subjectReference: "redacted-subject",
      provenance: "test_emulator",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a labelled simulator response in production", async () => {
    configureTestBridge();
    process.env.NODE_ENV = "production";
    process.env.NIMC_NVS_URL = "https://nimc-bridge.example.test";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          verified: true,
          provider_reference: "sim-nimc-reference",
          status: "verified",
        }),
        { headers: { "X-NDSEP-Simulation": "true" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyNationalId({
        idType: "nin",
        idValue: "TEST-NIN",
        purpose: "contract test",
      })
    ).rejects.toMatchObject<Partial<NationalIdProviderError>>({
      kind: "simulation_forbidden",
    });
  });

  it("fails closed when the NIMC bridge times out", async () => {
    configureTestBridge();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("timeout", "AbortError"))
    );

    await expect(
      verifyNationalId({
        idType: "nin",
        idValue: "TEST-NIN",
        purpose: "contract test",
      })
    ).rejects.toMatchObject<Partial<NationalIdProviderError>>({
      kind: "unavailable",
    });
  });

  it("fails closed on an invalid provider payload", async () => {
    configureTestBridge();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ verified: true }), { status: 200 })
        )
    );

    await expect(
      verifyNationalId({
        idType: "nin",
        idValue: "TEST-NIN",
        purpose: "contract test",
      })
    ).rejects.toMatchObject<Partial<NationalIdProviderError>>({
      kind: "invalid_response",
    });
  });
});
