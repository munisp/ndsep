import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  completeEnrollment,
  createRecoveryAuthorization,
  generateEnrollmentChallenge,
  getRecoveryAuthorization,
  getRecoveryControllerStatus,
  listEnrolledCredentials,
  RecoveryAuthorizationError,
  RecoveryUnavailableError,
  revokeCredential,
} from "../server/recoveryRepository";
import type { EnterprisePrincipal } from "../server/_core/enterpriseAuth";

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

function setRecoveryEnv() {
  process.env.RECOVERY_WEBAUTHN_ORIGIN = "https://ops.staging.idlrpts.gov.ng";
  process.env.RECOVERY_WEBAUTHN_RP_ID = "ops.staging.idlrpts.gov.ng";
  process.env.RECOVERY_KMS_REGION = "eu-west-1";
  process.env.RECOVERY_KMS_KEY_ID = "arn:aws:kms:eu-west-1:000000000000:key/test-recovery-key";
  process.env.RECOVERY_REPLAY_URL = "https://replay.staging.idlrpts.gov.ng/api/recovery/replay";
  process.env.RECOVERY_REPLAY_SHARED_SECRET = "drill-shared-secret";
  process.env.RECOVERY_REPLAY_ALLOWED_HOSTS = "replay.staging.idlrpts.gov.ng";
}

afterEach(() => {
  for (const key of recoveryKeys) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function makePrincipal(subject: string, role: "security_engineer" | "planning_supervisor"): EnterprisePrincipal {
  return {
    subject,
    issuer: "https://identity.staging.idlrpts.gov.ng/realms/idlrpts",
    agencyId: "fct-land-agency",
    agencyRoles: [role],
    authMethod: "oidc",
    passkeyAuthenticated: true,
  };
}

describe("two-passkey recovery drill", () => {
  it("reports configuration complete when all recovery boundaries are set", () => {
    setRecoveryEnv();
    const status = getRecoveryControllerStatus();
    expect(status.configurationComplete).toBe(true);
    expect(status.webauthn.available).toBe(true);
    expect(status.kms.available).toBe(true);
    expect(status.replay.available).toBe(true);
  });

  it("rejects enrollment challenge for non-recovery roles", async () => {
    setRecoveryEnv();
    const applicant = makePrincipal("applicant-01", "security_engineer");
    applicant.agencyRoles = ["applicant" as never];
    await expect(generateEnrollmentChallenge(applicant)).rejects.toThrow(RecoveryAuthorizationError);
  });

  it("generates an enrollment challenge for a security engineer", async () => {
    setRecoveryEnv();
    const engineer = makePrincipal("engineer-drill-01", "security_engineer");
    const result = await generateEnrollmentChallenge(engineer);
    expect(result.options).toBeDefined();
    expect(result.options.challenge).toBeTruthy();
    expect(result.rpId).toBe("ops.staging.idlrpts.gov.ng");
    expect(result.origin).toBe("https://ops.staging.idlrpts.gov.ng");
  });

  it("creates a recovery authorization when configuration is complete", async () => {
    setRecoveryEnv();
    const engineer = makePrincipal("engineer-drill-02", "security_engineer");
    const result = await createRecoveryAuthorization({
      principal: engineer,
      queueId: `stakeholder-dead-letter-drill-${Date.now()}`,
      payloadHash: crypto.createHash("sha256").update("drill-payload").digest("hex"),
      idempotencyKey: crypto.randomUUID(),
      targetDeviceFingerprint: crypto.createHash("sha256").update(`drill-device-${Date.now()}-${crypto.randomUUID()}`).digest("hex"),
      kmsCiphertext: Buffer.from("drill-encrypted-payload").toString("base64"),
    });
    expect(result.authorization.status).toBe("pending");
    expect(result.challenge).toMatch(/^[a-f0-9]{64}$/);
    const retrieved = await getRecoveryAuthorization(result.authorization.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.status).toBe("pending");
  });

  it("rejects authorization creation when configuration is incomplete", async () => {
    delete process.env.RECOVERY_KMS_REGION;
    delete process.env.RECOVERY_KMS_KEY_ID;
    const engineer = makePrincipal("engineer-drill-03", "security_engineer");
    await expect(
      createRecoveryAuthorization({
        principal: engineer,
        queueId: "stakeholder-dead-letter-drill-02",
        payloadHash: "a".repeat(64),
        idempotencyKey: crypto.randomUUID(),
        targetDeviceFingerprint: "b".repeat(64),
        kmsCiphertext: Buffer.from("test").toString("base64"),
      }),
    ).rejects.toBeInstanceOf(RecoveryUnavailableError);
  });

  it("rejects authorization creation by non-security-engineer roles", async () => {
    setRecoveryEnv();
    const supervisor = makePrincipal("supervisor-drill-01", "planning_supervisor");
    await expect(
      createRecoveryAuthorization({
        principal: supervisor,
        queueId: "stakeholder-dead-letter-drill-03",
        payloadHash: "c".repeat(64),
        idempotencyKey: crypto.randomUUID(),
        targetDeviceFingerprint: "d".repeat(64),
        kmsCiphertext: Buffer.from("test").toString("base64"),
      }),
    ).rejects.toThrow(RecoveryAuthorizationError);
  });

  it("lists enrolled credentials for a subject with none enrolled", async () => {
    setRecoveryEnv();
    const credentials = await listEnrolledCredentials("nonexistent-subject");
    expect(credentials).toEqual([]);
  });

  it("rejects credential revocation for a nonexistent credential", async () => {
    setRecoveryEnv();
    const engineer = makePrincipal("engineer-drill-04", "security_engineer");
    await expect(revokeCredential(engineer, crypto.randomUUID())).rejects.toThrow(RecoveryAuthorizationError);
  });
});
