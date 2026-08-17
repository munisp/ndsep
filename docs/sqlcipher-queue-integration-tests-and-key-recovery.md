# SQLCipher Queue Integration Tests and Secure Key Recovery

## Test environment

These are **native integration tests**, not Expo Go, web, or pure Vitest mocks. Run them in an iOS Simulator and Android emulator custom development client containing the approved SQLCipher native module. The harness creates a temporary SQLCipher database, uses a test SecureStore adapter, and stubs only the remote tRPC transport.

```ts
// tests/native/stakeholder-offline-queue.integration.ts
import { describe, expect, it, beforeEach } from "vitest";
import { openTestCipherQueue, corruptCiphertext, testSecureStore } from "./nativeQueueHarness";
import { enqueueEncrypted, replayStakeholderQueue } from "@/lib/native/stakeholderQueue";

describe("stakeholder SQLCipher offline queue", () => {
  let queue: Awaited<ReturnType<typeof openTestCipherQueue>>;
  let api: { submitProfile: ReturnType<typeof vi.fn>; submitDocument: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    await testSecureStore.reset();
    queue = await openTestCipherQueue({ secureStore: testSecureStore });
    api = { submitProfile: vi.fn(), submitDocument: vi.fn() };
  });

  it("stores ciphertext and never plaintext in SQLCipher queue rows", async () => {
    const id = await enqueueEncrypted(queue, "stakeholder_profile", { cacNumber: "RC123456", tinNumber: "12345678-0001" });
    const row = await queue.readRaw(id);
    expect(row.ciphertext).not.toContain("RC123456");
    expect(row.ciphertext).not.toContain("12345678-0001");
    expect(await queue.decrypt(id)).toMatchObject({ cacNumber: "RC123456" });
  });

  it("replays once after a network failure with the same idempotency key", async () => {
    const id = await enqueueEncrypted(queue, "stakeholder_profile", { companyName: "Example Ltd" });
    api.submitProfile.mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "NETWORK_UNAVAILABLE" }));
    await replayStakeholderQueue(queue, api, new Date("2026-08-16T10:00:00Z"));
    await replayStakeholderQueue(queue, api, new Date("2026-08-16T10:01:00Z"));
    expect(api.submitProfile.mock.calls).toHaveLength(2);
    expect(api.submitProfile.mock.calls[0][1]).toBe(id);
    expect(api.submitProfile.mock.calls[1][1]).toBe(id);
  });

  it("quarantines corrupted ciphertext without any outbound replay", async () => {
    const id = await enqueueEncrypted(queue, "business_document", { type: "cac_certificate" });
    await corruptCiphertext(queue, id);
    await replayStakeholderQueue(queue, api, new Date());
    expect(api.submitDocument).not.toHaveBeenCalled();
    expect(await queue.deadLetter(id)).toMatchObject({ errorCode: "PAYLOAD_INTEGRITY_FAILED" });
  });

  it("dead-letters the sixth transient failure and preserves redacted diagnostics", async () => {
    const id = await enqueueEncrypted(queue, "stakeholder_profile", { companyName: "Example Ltd" });
    api.submitProfile.mockRejectedValue(Object.assign(new Error("gateway timeout"), { code: "NETWORK_UNAVAILABLE" }));
    for (let attempt = 0; attempt < 6; attempt++) await replayStakeholderQueue(queue, api, new Date(Date.now() + attempt * 3600_000));
    expect(await queue.deadLetter(id)).toMatchObject({ errorCode: "NETWORK_UNAVAILABLE" });
    expect((await queue.deadLetter(id))?.errorDetailRedacted).not.toContain("Example Ltd");
  });

  it("does not create external trust when replayed document review is manual", async () => {
    // PostgreSQL test fixture receives request_review decision after queue replay.
    await queue.fixtureServerDecision({ decision: "request_review" });
    expect(await queue.fixtureTrustStatus()).toBe("in_review");
    expect(await queue.fixtureExternalVerification()).toBe("unavailable");
  });
});
```

### Execution

| Target | Command | What it proves |
|---|---|---|
| Type contract | `pnpm run check` | TypeScript interfaces compile. |
| Server transition suite | `pnpm vitest run tests/stakeholder-review-ledger.test.ts` | PostgreSQL decision and idempotency logic. |
| Native iOS | `eas build --profile development --platform ios` then device harness | SQLCipher, Keychain, SecureStore, attachment behavior. |
| Native Android | `eas build --profile development --platform android` then device harness | SQLCipher, Keystore, backup/uninstall behavior. |
| Full regression | `pnpm test` plus native harness | Existing platform behavior and new transition controls. |

## Key lifecycle model

The queue database key is a random 256-bit data-encryption key (DEK), never a user-entered passphrase. SecureStore/Keychain/Keystore protects a **device key envelope** for the DEK. A staging/production server may hold a separately KMS-wrapped recovery envelope only after the authenticated stakeholder consents to recovery enrollment.

| Event | Safe action | Never do |
|---|---|---|
| Planned rotation | Create `DEK-v2`, run SQLCipher `PRAGMA rekey`, verify integrity, then atomically switch current version | Delete `DEK-v1` before integrity verification. |
| App restart | Read active DEK envelope from SecureStore and open SQLCipher | Cache a plaintext DEK in AsyncStorage or logs. |
| SecureStore biometric invalidation | Lock queue, require sign-in and recovery path | Substitute an empty/new key or retry corrupted decryption. |
| Device passcode/keychain reset | Treat queue as locally unrecoverable; obtain KMS rewrap only after authenticated recovery | Claim queued data survived when its only DEK is gone. |
| No server recovery envelope | Quarantine queue metadata and ask user to resubmit | Attempt to decrypt, export, or display ciphertext. |

```ts
type KeyEnvelope = { version: number; wrappedDek: string; createdAt: string };

export async function rotateSqlCipherKey(db: CipherDb, keys: KeyService) {
  const oldEnvelope = await keys.currentEnvelope();
  const nextDek = await keys.generateDek();
  // SQLCipher applies rekey under the currently open encrypted connection.
  await db.execute(`PRAGMA rekey = '${escapeSqlCipherKey(nextDek)}'`);
  const integrity = await db.query("PRAGMA cipher_integrity_check");
  if (!integrity.every((row) => row.cipher_integrity_check === "ok")) {
    await db.execute(`PRAGMA rekey = '${escapeSqlCipherKey(await keys.unwrap(oldEnvelope))}'`);
    throw new Error("KEY_ROTATION_INTEGRITY_FAILED");
  }
  const nextEnvelope = await keys.wrapForDeviceAndRecovery(nextDek, oldEnvelope.version + 1);
  await keys.commitEnvelope(nextEnvelope); // write current pointer only after verification
  await keys.retireEnvelopeAfterBackup(oldEnvelope);
}

export async function openOrRecoverQueue(keys: KeyService, queue: QueueDb) {
  try {
    return await queue.open(await keys.currentDek());
  } catch (error) {
    if (!keys.isSecureStoreInvalidation(error)) throw error;
    await queue.recordRecoveryRequired();
    const session = await requireFreshAuthenticatedSession();
    const recovered = await keys.requestKmsRewrap(session); // policy- and consent-controlled
    if (!recovered) throw new QueueRecoveryRequiredError("Offline submissions must be resubmitted");
    await keys.commitEnvelope(recovered);
    return queue.open(await keys.currentDek());
  }
}
```

## Recovery workflow

1. The app catches SecureStore invalidation and immediately stops replay workers.
2. It records a local **recovery required** state with queue item identifiers, not decrypted payloads.
3. The user completes fresh authenticated recovery. The server authorizes a KMS rewrap only if an enrolled recovery envelope exists and policy allows it.
4. The app opens SQLCipher with the recovered DEK and runs `cipher_integrity_check` before replay.
5. If recovery is unavailable or integrity fails, all local items are quarantined as unrecoverable; the user resubmits data. The app never silently starts with a new empty key and reports old entries as sent.

> Key invalidation is not an ordinary retry condition. It is a cryptographic state change that requires either an authenticated key-recovery ceremony or explicit data-loss handling.
