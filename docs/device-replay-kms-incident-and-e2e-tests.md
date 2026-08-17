# Secure Device Replay, KMS Incident Response, and End-to-End Tests

## Device-side decrypt and revalidate before TLS transmission

```ts
// lib/native/replayStakeholderSubmission.native.ts
import { z } from "zod";
import { stakeholderProfileSchema, normalizeStakeholderProfile } from "@/server/stakeholderValidation";

const queuedProfileSchema = stakeholderProfileSchema.extend({
  queueId: z.string().uuid(),
  attachmentRefs: z.array(z.string().uuid()).max(12).default([]),
});

export async function replayOne(item: QueueItem, deps: {
  queue: QueueStore;
  decrypt: (item: QueueItem) => Promise<unknown>;
  postReplay: (request: { idempotencyKey: string; operation: string; payload: unknown; attachmentRefs: string[] }) => Promise<{ replayed: boolean }>;
}) {
  if (!(await deps.queue.markInFlight(item.id))) return;
  try {
    // Authentication-tag / SQLCipher errors throw here. Never transmit corrupt data.
    const decoded = await deps.decrypt(item);
    const input = queuedProfileSchema.parse(decoded); // local revalidation prevents stale/malformed replay
    const payload = normalizeStakeholderProfile(input);
    await deps.postReplay({
      idempotencyKey: item.id, // immutable UUID reused on every retry
      operation: item.operation,
      payload,
      attachmentRefs: input.attachmentRefs,
    });
    await deps.queue.markSucceeded(item.id);
  } catch (error) {
    if (isIntegrityFailure(error)) {
      await deps.queue.quarantine(item.id, "PAYLOAD_INTEGRITY_FAILED", redactError(error));
      return;
    }
    if (isValidationFailure(error)) {
      await deps.queue.quarantine(item.id, "REPLAY_VALIDATION_FAILED", redactError(error));
      return;
    }
    await deps.queue.rescheduleOrDeadLetter(item.id, toStableErrorCode(error));
  }
}
```

>The replay client must never submit a client-selected `verified` trust status, reviewer decision, or arbitrary stakeholder owner. The server derives ownership from the authenticated session and constrains all document outcomes.

## Production incident runbook

| Incident | Immediate containment | Recovery decision | Evidence and closure |
|---|---|---|---|
| KMS envelope integrity failure | Disable recovery endpoint via feature flag; stop queue replay; preserve ciphertext and audit logs | Rotate affected KMS key/envelopes; rewrap only after root-cause approval | Correlation IDs, envelope versions, KMS audit event, security approval |
| Suspected device key compromise | Revoke device enrollment and recovery envelope; invalidate sessions; stop device replay | User authenticates on a new attested device; re-enroll and issue a new device envelope | Device revocation record, fresh MFA, attestation, user notification |
| SecureStore invalidation | Lock queue locally; no silent new key | KMS rewrap only with enrolled envelope + MFA; otherwise quarantine and resubmit | Recovery event, integrity check, user acknowledgement |
| Idempotency collision | Freeze affected queue item and reject automatic replay | Compare server request hash and authenticated owner; hash mismatch is a security incident | Incident ticket, hash values, reviewer decision |

The incident commander owns containment; security owns key/envelope rotation; application operations owns recovery-service availability; compliance owns user notification and evidence retention. Do not rotate a KMS key by deleting prior key versions: retention is required to decrypt existing recovery envelopes during a controlled rewrap.

## End-to-end KMS rewrap and collision suite

```ts
// tests/e2e/stakeholder-kms-recovery.e2e.test.ts
describe("KMS recovery and replay", () => {
  it("rewraps a device envelope after fresh MFA and preserves SQLCipher queue integrity", async () => {
    const queueId = await deviceA.enqueueProfile(validProfile);
    await deviceA.simulateSecureStoreInvalidation();
    await expect(deviceA.replay()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });

    const envelope = await recoveryApi.requestDeviceDekRewrap({
      token: mfaTokenFor(subject), devicePublicKey: deviceB.publicKey, keyVersion: 1,
    });
    await deviceB.installRecoveryEnvelope(envelope);
    expect(await deviceB.openQueueAndCheckIntegrity()).toBe("ok");
    await deviceB.replay();
    expect(await postgres.replayCount(queueId)).toBe(1);
    expect(await postgres.auditEvents(queueId)).toContainEqual(expect.objectContaining({ type: "device_key_recovered" }));
  });

  it("returns the prior result for a matching idempotency key and hash", async () => {
    const first = await api.replay(validRequest("11111111-1111-4111-8111-111111111111"));
    const second = await api.replay(validRequest("11111111-1111-4111-8111-111111111111"));
    expect(second).toMatchObject({ replayed: true, result: first.result });
    expect(await postgres.countSubmissionAuditEvents()).toBe(1);
  });

  it("quarantines an idempotency collision with a different request hash", async () => {
    await api.replay(validRequest("22222222-2222-4222-8222-222222222222"));
    await expect(api.replay({ ...validRequest("22222222-2222-4222-8222-222222222222"), payload: { ...validProfile, companyName: "Altered" } }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(await device.deadLetterForKey("22222222-2222-4222-8222-222222222222")).toMatchObject({ errorCode: "IDEMPOTENCY_COLLISION" });
  });
});
```

### Mandatory staging acceptance conditions

1. The KMS service denies recovery with an expired token, wrong issuer/audience, no MFA, device mismatch, revoked device, or excessive request rate.
2. The service emits an immutable audit event for every recovery request, deny, rewrap, and device revocation.
3. SQLCipher integrity succeeds before replay after a valid rewrap; no outbound request occurs after an integrity failure.
4. A duplicate idempotency key with the same hash returns one committed result; a different hash returns `CONFLICT` without state mutation.
5. A manual-review replay remains `in_review` and never grants external verification.
