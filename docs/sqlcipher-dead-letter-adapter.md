# SQLCipher + Expo SecureStore Adapter and Dead-Letter Recovery

## Corruption recovery is quarantine, not automatic replay

A decryption failure, missing nonce, invalid authentication tag, malformed JSON, missing attachment, or payload-hash mismatch is an **integrity failure**. It must move the queue item to `dead_letter` and never be automatically retried. Network timeouts and 5xx provider errors are transient and may be rescheduled with bounded backoff.

| Failure class | Queue action | Reviewer action | Replay allowed |
|---|---|---|---|
| Network timeout / connection refused | Reschedule with backoff | None unless retry ceiling reached | Yes |
| 429 / 5xx | Reschedule with retry-after/backoff | None unless retry ceiling reached | Yes |
| 4xx validation / evidence precondition | Dead-letter with redacted code | Correct profile/evidence and create a new submission | No |
| SQLCipher decrypt / authentication tag mismatch | Dead-letter with `PAYLOAD_INTEGRITY_FAILED` | Inspect metadata; request a fresh submission | No |
| Missing encrypted attachment | Dead-letter with `ATTACHMENT_MISSING` | Request re-capture | No |
| Server idempotency conflict | Query the server record by idempotency key | Mark succeeded if hash matches; otherwise investigate | Conditional |

The review console must show **metadata only**: queue ID, operation, created time, attempt count, stable error code, payload hash, attachment count, and resolution audit events. It must never render decrypted sensitive payload blobs just to diagnose failure.

## Native dependency and configuration boundary

Expo Go cannot load a SQLCipher native module. This adapter requires a custom development/production build with a vetted SQLCipher binding such as `react-native-sqlcipher-storage`, a native iOS/Android security review, and an Expo config plugin or prebuild integration. SecureStore holds only a randomly generated 256-bit database passphrase; it does not hold payload blobs.

```bash
pnpm add react-native-sqlcipher-storage react-native-get-random-values
npx expo prebuild
# Build an internal development client / production native binary, not Expo Go.
```

Add `expo-secure-store` to `app.config.ts` plugins and configure native backup behavior. The module should be available only for iOS and Android; the web PWA needs a separately designed, browser-appropriate encryption boundary.

## Queue database schema

```sql
create table if not exists stakeholder_submission_queue (
  id text primary key,
  operation text not null check (operation in ('stakeholder_profile','identity_document','business_document')),
  ciphertext blob not null,
  nonce blob not null,
  payload_hash text not null,
  attachment_manifest text not null default '[]',
  state text not null check (state in ('queued','in_flight','failed','dead_letter','succeeded')),
  attempts integer not null default 0,
  next_attempt_at text not null,
  last_error_code text,
  created_at text not null,
  updated_at text not null
);
create index if not exists queue_due_idx on stakeholder_submission_queue(state, next_attempt_at);

create table if not exists stakeholder_submission_dead_letters (
  id text primary key,
  queue_id text not null,
  operation text not null,
  payload_hash text not null,
  attachment_count integer not null,
  error_code text not null,
  error_detail_redacted text,
  quarantined_at text not null,
  resolved_by text,
  resolved_at text,
  resolution text
);
```

## Adapter implementation

```ts
// lib/native/stakeholderQueueStore.native.ts
import "react-native-get-random-values";
import * as SecureStore from "expo-secure-store";
import SQLite from "react-native-sqlcipher-storage";
import { randomBytes, createHash, randomUUID } from "crypto"; // use a vetted RN-compatible crypto bridge

const KEY_NAME = "idlr.stakeholder.queue.sqlcipher.key.v1";
const DB_NAME = "idlr_stakeholder_queue.db";

async function databaseKey(): Promise<string> {
  let key = await SecureStore.getItemAsync(KEY_NAME, {
    requireAuthentication: true,
    authenticationPrompt: "Unlock offline stakeholder submissions",
  });
  if (key) return key;
  key = randomBytes(32).toString("base64");
  await SecureStore.setItemAsync(KEY_NAME, key, {
    requireAuthentication: true,
    authenticationPrompt: "Protect offline stakeholder submissions",
  });
  return key;
}

export async function openStakeholderQueue() {
  const key = await databaseKey();
  const db = await SQLite.openDatabase({ name: DB_NAME, key, location: "default" });
  await db.executeSql("PRAGMA cipher_memory_security = ON");
  await db.executeSql("PRAGMA foreign_keys = ON");
  // Execute schema SQL exactly once through a versioned migration runner.
  return db;
}

export async function enqueueProfile(db: SQLite.SQLiteDatabase, encrypted: { ciphertext: Uint8Array; nonce: Uint8Array }, attachmentManifest: string[]) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const hash = createHash("sha256").update(encrypted.ciphertext).digest("hex");
  await db.transaction(async (tx) => {
    await tx.executeSql(
      `insert into stakeholder_submission_queue
       (id, operation, ciphertext, nonce, payload_hash, attachment_manifest, state, attempts, next_attempt_at, created_at, updated_at)
       values (?, 'stakeholder_profile', ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`,
      [id, encrypted.ciphertext, encrypted.nonce, hash, JSON.stringify(attachmentManifest), now, now, now],
    );
  });
  return id; // Send unchanged as Idempotency-Key on every replay.
}

export async function quarantineCorruptItem(db: SQLite.SQLiteDatabase, item: { id: string; operation: string; payloadHash: string; attachmentCount: number }, code: string, detail: string) {
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.executeSql("update stakeholder_submission_queue set state='dead_letter', last_error_code=?, updated_at=? where id=?", [code, now, item.id]);
    await tx.executeSql(
      `insert into stakeholder_submission_dead_letters
       (id, queue_id, operation, payload_hash, attachment_count, error_code, error_detail_redacted, quarantined_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), item.id, item.operation, item.payloadHash, item.attachmentCount, code, redact(detail), now],
    );
  });
}
```

## Reviewer inspection workflow

1. A supervisor opens the dead-letter queue and sees redacted metadata.
2. They classify it as transient, invalid evidence, missing attachment, or integrity failure.
3. For integrity failure, they do **not** decrypt or repair the blob. They request a new upload/profile submission and record the resolution.
4. For idempotency conflict, the supervisor queries the server-side idempotency record; matching payload hash marks the local item succeeded, differing hash opens a security incident.
5. Every resolution appends a local audit event and should later synchronize to the PostgreSQL stakeholder audit ledger.

## Tests that must run in a custom native build

- Queue survives airplane-mode submission and uses one stable idempotency key after recovery.
- SQLCipher database cannot be opened without the SecureStore-protected key.
- Corrupted ciphertext / nonce causes a `PAYLOAD_INTEGRITY_FAILED` dead letter and zero outbound replay attempts.
- Missing attachment causes `ATTACHMENT_MISSING` and a reviewer-visible metadata record.
- Replay after a server timeout is bounded; the sixth retry becomes dead letter.
- Reinstall/key invalidation produces an explicit recovery-required state rather than a false success.

These cannot be proven using Expo Go, a web preview, or mocked SecureStore alone.
