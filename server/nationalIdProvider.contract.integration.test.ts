import { describe, expect, it } from "vitest";
import { verifyNationalId } from "./nationalIdProvider";

const simulatorUrl = process.env.NDSEP_CONTRACT_SIMULATOR_URL;
const simulatorToken = process.env.NDSEP_CONTRACT_SIMULATOR_TOKEN;

const contractSuite = simulatorUrl && simulatorToken ? describe : describe.skip;

contractSuite("NIMC provider contract simulator", () => {
  it("preserves explicit test-emulator provenance from the live contract endpoint", async () => {
    process.env.NODE_ENV = "test";
    process.env.NDSEP_ALLOW_TEST_PROVIDER_EMULATORS = "true";
    process.env.NIMC_NVS_URL = simulatorUrl;
    process.env.NIMC_NVS_TOKEN = simulatorToken;

    await expect(
      verifyNationalId({
        idType: "nin",
        idValue: "TEST-NIN-NOT-A-REAL-IDENTIFIER",
        purpose: "contract-test-only",
      })
    ).resolves.toMatchObject({
      provenance: "test_emulator",
      providerStatus: "not_found",
      verified: false,
    });
  });
});
