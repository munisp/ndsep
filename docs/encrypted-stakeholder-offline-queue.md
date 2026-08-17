# Encrypted, Idempotent Stakeholder Submission Queue

## Required storage design

Do **not** put document Base64 payloads into SecureStore. SecureStore is intended for small secret values and has platform size limits. Use it only for a per-installation queue key reference. Store encrypted payload blobs in a device-encrypted SQLite database or an encrypted file store, with document files staged outside the queue record. Web must use a separate authenticated PWA encryption strategy; browser local storage is not equivalent to native device encryption.

```ts
// lib/stakeholder-offline-queue.ts — production-oriented interface
export type QueueOperation = "stakeholder_profile" | "identity_document" | "business_document";
export type QueueItem = {
  id: string;                 // UUID, also sent as Idempotency-Key
  operation: QueueOperation;
  payloadCiphertext: Uint8Array;
  payloadNonce: Uint8Array;
  attachmentPaths: string[];  // encrypted files or durable object references
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  state: "queued" | "in_flight" | "failed" | "dead_letter";
};

export interface QueueStore {
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  insert(item: QueueItem): Promise<void>;
  due(now: Date, limit: number): Promise<QueueItem[]>;
  markInFlight(id: string): Promise<boolean>; // atomic compare-and-set queued → in_flight
  markSucceeded(id: string): Promise<void>;
  reschedule(id: string, attempts: number, nextAttemptAt: Date, errorCode: string): Promise<void>;
  deadLetter(id: string, errorCode: string): Promise<void>;
}

export interface StakeholderApi {
  submitProfile(payload: unknown, idempotencyKey: string): Promise<void>;
  submitDocument(payload: unknown, attachments: string[], idempotencyKey: string): Promise<void>;
}

const MAX_ATTEMPTS = 5;
const backoffMs = (attempt: number) => Math.min(60 * 60_000, 30_000 * 2 ** attempt);

export async function enqueueEncrypted(
  store: QueueStore,
  crypto: { encrypt(value: unknown): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> },
  operation: QueueOperation,
  payload: unknown,
  attachmentPaths: string[] = [],
) {
  const id = crypto.randomUUID();
  const encrypted = await crypto.encrypt(payload);
  await store.transaction(async () => store.insert({
    id, operation, payloadCiphertext: encrypted.ciphertext, payloadNonce: encrypted.nonce,
    attachmentPaths, attempts: 0, nextAttemptAt: new Date().toISOString(), createdAt: new Date().toISOString(), state: "queued",
  }));
  return id;
}

export async function replayStakeholderQueue(
  store: QueueStore,
  crypto: { decrypt(item: QueueItem): Promise<unknown> },
  api: StakeholderApi,
  now = new Date(),
) {
  for (const item of await store.due(now, 20)) {
    if (!(await store.markInFlight(item.id))) continue; // prevents duplicate workers
    try {
      const payload = await crypto.decrypt(item);
      if (item.operation === "stakeholder_profile") await api.submitProfile(payload, item.id);
      else await api.submitDocument(payload, item.attachmentPaths, item.id);
      await store.markSucceeded(item.id);
    } catch (error) {
      const attempts = item.attempts + 1;
      const code = toStableNetworkOrServerCode(error);
      if (attempts >= MAX_ATTEMPTS || !isRetryable(code)) await store.deadLetter(item.id, code);
      else await store.reschedule(item.id, attempts, new Date(now.getTime() + backoffMs(attempts)), code);
    }
  }
}
```

The server must store `idempotency_key` under a unique PostgreSQL constraint and return the previously committed result for duplicate keys. Never retry a reviewer decision without an explicit idempotency key and immutable request hash.

## Network-failure and transition test suite

```ts
describe("stakeholder queue replay", () => {
  it("keeps the encrypted record queued when the first profile request has a network failure", async () => {
    api.submitProfile.mockRejectedValueOnce(new NetworkError());
    await replayStakeholderQueue(store, crypto, api, now);
    expect(store.reschedule).toHaveBeenCalledWith(queueId, 1, expect.any(Date), "NETWORK_UNAVAILABLE");
  });

  it("uses the same idempotency key on every replay and commits one server ledger event", async () => {
    api.submitProfile.mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(undefined);
    await replayStakeholderQueue(store, crypto, api, now);
    await replayStakeholderQueue(store, crypto, api, later);
    expect(api.submitProfile.mock.calls[0][1]).toEqual(api.submitProfile.mock.calls[1][1]);
    expect(await postgres.countAuditEvents(queueId)).toBe(1);
  });

  it("does not turn a manual-review document into verified trust during replay", async () => {
    await submitReviewerDecision({ decision: "request_review", evidenceRefs: [] });
    expect(await postgres.documentStatus(documentId)).toBe("requires_review");
    expect(await postgres.externalTrustStatus(stakeholderId)).not.toBe("verified");
  });

  it("returns CONFLICT when two reviewer decisions target the same locked document", async () => {
    await expect(Promise.all([approve(), approve()])).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
```

### Execution sequence

1. Start isolated PostgreSQL with the stakeholder ledger migration applied.
2. Run `pnpm vitest run tests/stakeholder-offline-queue.test.ts tests/stakeholder-review-ledger.test.ts`.
3. Run the full suite only after the isolated database lifecycle is reliable: `pnpm test`.
4. Run device integration tests with airplane-mode interception and a real encrypted queue adapter; unit mocks do not prove keychain, SQLite, attachment encryption, or background-task behavior.

## Production closure constraints

This code is an implementation blueprint, not an applied production feature. Completing the outstanding gaps end-to-end also requires: PostgreSQL staging credentials and migration approval; a vetted encrypted SQLite/file implementation; mobile background task configuration; authenticated stakeholder/reviewer identity; real NIMC/CAC/liveness/document providers; security review; load/failure testing; and a rollback rehearsal. Until those exist, the platform should keep provider outcomes fail-closed and treat onboarding review as pending.
