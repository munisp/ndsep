import { afterEach, describe, expect, it } from "vitest";

import { createRecoveryAuthorization, getRecoveryControllerStatus, RecoveryUnavailableError } from "../server/recoveryRepository";

const recoveryKeys = [
  "RECOVERY_KMS_REGION",
  "RECOVERY_KMS_KEY_ID",
  "RECOVERY_WEBAUTHN_ORIGIN",
  "RECOVERY_WEBAUTHN_RP_ID",
  "RECOVERY_REPLAY_URL",
  "RECOVERY_REPLAY_SHARED_SECRET",
  "RECOVERY_REPLAY_ALLOWED_HOSTS",
] as const;

const previous = Object.fromEntries(recoveryKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of recoveryKeys) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function clearRecoveryConfiguration() {
  for (const key of recoveryKeys) delete process.env[key];
}

describe("dual-approval recovery controller", () => {
  it("reports every missing external safeguard instead of claiming recovery availability", () => {
    clearRecoveryConfiguration();

    const status = getRecoveryControllerStatus();

    expect(status).toMatchObject({ available: false, configurationComplete: false, operationalVerification: "not_run", webauthn: { available: false }, kms: { available: false }, replay: { available: false } });
    expect(status.reasons).toHaveLength(3);
  });

  it("refuses to create a device-bound recovery authorization before WebAuthn, KMS, and replay safeguards are configured", async () => {
    clearRecoveryConfiguration();

    await expect(
      createRecoveryAuthorization({
        principal: {
          subject: "security-officer-01",
          issuer: "https://identity.example.test/realms/idlrpts",
          agencyId: "fct-land-agency",
          agencyRoles: ["security_engineer"],
          authMethod: "oidc",
          passkeyAuthenticated: true,
        },
        queueId: "stakeholder-dead-letter-01",
        payloadHash: "a".repeat(64),
        idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
        targetDeviceFingerprint: "b".repeat(64),
        kmsCiphertext: Buffer.from("encrypted-payload").toString("base64"),
      }),
    ).rejects.toBeInstanceOf(RecoveryUnavailableError);
  });
});
