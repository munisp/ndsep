# Production Gaps, Audit Hash Chain, Outbox Delivery, and Incident Response

## Production gaps that remain

| Area | Current evidence | Production gap and release gate |
|---|---|---|
| Stakeholder review ledger | PostgreSQL migration artifacts only | Provision HA PostgreSQL, run shadow/backfill/reconciliation, and exercise rollback |
| Offline queue | SQLCipher/queue artifacts are design code | Native SQLCipher build, device test matrix, MDM attestation, KMS recovery drill |
| Authentication | Role and WebAuthn designs exist | Enterprise IdP, FIDO MDS, AAGUID enrollment, credential lifecycle, device revocation |
| Provider trust | Explicitly unavailable by default | Approved NIMC/CAC, liveness, document, and payment provider contracts/credentials |
| Financial controls | Local PostgreSQL/test evidence | Gateway contracts, webhook signing, reconciliation, ledger, segregation of duties, external audit |
| Event stream | Outbox design only | Broker cluster, consumer dedupe stores, retention/DR, latency/load test, schema registry |
| Operations | Dashboard and rules artifacts | Production Prometheus/Grafana/Alertmanager, on-call ownership, drill evidence |
| Security and privacy | Proposed encryption and recovery controls | Threat-model sign-off, penetration test, DPIA, key ceremony, SIEM retention and access review |
| Delivery | CI/CD templates only | Cloud workload identity, protected environments, signed artifacts/SBOM, change approvals |

## PostgreSQL schema and canonical cryptographic chain

The application must canonicalize the event payload before hashing; do not rely on arbitrary JSON serialization order. The server writes `event_hash = SHA-256(previous_hash || 0x00 || canonical_event_bytes)` and signs the 32-byte hash through an asymmetric KMS signing key. `previous_hash` is the preceding event hash within a single authorization chain.

```sql
create table audit_chain_heads (
  chain_id uuid primary key,
  last_sequence bigint not null default 0,
  last_hash bytea not null default decode(repeat('00', 32), 'hex'),
  updated_at timestamptz not null default now()
);
create table audit_events (
  id bigserial primary key,
  chain_id uuid not null,
  sequence bigint not null,
  event_type text not null,
  canonical_payload bytea not null,
  previous_hash bytea not null check(octet_length(previous_hash)=32),
  event_hash bytea not null check(octet_length(event_hash)=32),
  kms_key_version text not null,
  signature bytea not null,
  created_at timestamptz not null default now(),
  unique(chain_id, sequence), unique(chain_id, event_hash)
);
create table audit_outbox (
  id bigserial primary key,
  event_id bigint not null unique references audit_events(id) on delete restrict,
  topic text not null, partition_key text not null, payload bytea not null, payload_hash bytea not null,
  attempts integer not null default 0, published_at timestamptz, broker_message_id text, created_at timestamptz not null default now()
);
```

```ts
import crypto from "node:crypto";
const ZERO = Buffer.alloc(32);
const hash = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const canonicalize = (value: unknown): Buffer => Buffer.from(canonicalJson(value)); // RFC 8785/JCS implementation

export async function appendAuditEvent(tx: any, event: {chainId:string; type:string; payload:unknown}, kms: {sign(digest:Buffer):Promise<{signature:Buffer;keyVersion:string}>}) {
  const head = await tx.one("select * from audit_chain_heads where chain_id=$1 for update", [event.chainId]);
  const sequence = head.last_sequence + 1;
  const canonical = canonicalize({chainId:event.chainId,sequence,type:event.type,payload:event.payload});
  const eventHash = hash(Buffer.concat([head.last_hash ?? ZERO, Buffer.from([0]), canonical]));
  const signed = await kms.sign(eventHash);
  const saved = await tx.one("insert into audit_events(chain_id,sequence,event_type,canonical_payload,previous_hash,event_hash,kms_key_version,signature) values($1,$2,$3,$4,$5,$6,$7,$8) returning id", [event.chainId,sequence,event.type,canonical,head.last_hash ?? ZERO,eventHash,signed.keyVersion,signed.signature]);
  await tx.query("update audit_chain_heads set last_sequence=$2,last_hash=$3,updated_at=now() where chain_id=$1", [event.chainId,sequence,eventHash]);
  await tx.query("insert into audit_outbox(event_id,topic,partition_key,payload,payload_hash) values($1,'idlr.audit.v1',$2,$3,$4)", [saved.id,event.chainId,canonical,eventHash]);
}

export async function verifyChain(events: {sequence:number;previous_hash:Buffer;event_hash:Buffer;canonical_payload:Buffer;signature:Buffer;kms_key_version:string}[], verify: (hash:Buffer,sig:Buffer,keyVersion:string)=>Promise<boolean>) {
  let previous = ZERO; let sequence = 0;
  for (const event of events) {
    if (event.sequence !== ++sequence || !event.previous_hash.equals(previous)) return false;
    const expected = hash(Buffer.concat([previous, Buffer.from([0]), event.canonical_payload]));
    if (!event.event_hash.equals(expected) || !(await verify(expected,event.signature,event.kms_key_version))) return false;
    previous = event.event_hash;
  }
  return true;
}
```

## High-throughput outbox semantics

No generic database-plus-broker design can honestly promise **exactly-once publishing** across two independent systems. The transactional outbox guarantees atomic database event creation with at-least-once broker publication. It achieves effectively-once downstream processing through stable event IDs, broker keys, and consumer-side idempotent insertion.

```sql
with batch as (
  select id from audit_outbox where published_at is null order by id limit 500 for update skip locked
)
update audit_outbox o set attempts=o.attempts+1 from batch where o.id=batch.id returning o.*;
```

Workers publish each claimed row using `event_id` as the broker message key and `chain_id` as the partition key, preserving per-chain order. They set `published_at` only after broker acknowledgement. A crash after acknowledgement but before the database update republishes the message; consumers must insert into `consumed_audit_events(event_id primary key)` in their own transaction before side effects. This makes consumer outcomes effectively once even when publication is repeated.

## Broken or compromised audit-chain incident runbook

1. **Detect and contain.** Alertmanager disables replay/recovery feature cohorts, pauses the outbox publisher, blocks new recovery grants, and pages security, compliance, and the release owner. Preserve database WAL, broker offsets, KMS audit logs, and dashboards.
2. **Classify.** Run chain verification from the last externally anchored checkpoint. Distinguish a missing publisher acknowledgement, outbox duplication, row corruption, signature failure, key revocation, unauthorized write, or consumer-only inconsistency.
3. **Scope.** Identify affected chain IDs, sequence ranges, KMS key versions, principals, devices, brokers, and downstream consumers. Do not delete, rewrite, or rehash events.
4. **Investigate.** Export read-only evidence, verify KMS public signatures, compare point-in-time restore/WAL copies, inspect IAM and WebAuthn approval events, and rotate credentials if compromise is suspected.
5. **Recover.** For publisher interruption, resume from the unchanged outbox. For duplicate publication, replay consumers with dedupe. For valid chain corruption, restore database to a separate forensic instance and create a signed remediation event in a new chain; never alter historical hashes. For a compromised signing key, revoke it, publish a key-compromise event using a new key, and require independent verification of all events signed by the old key.
6. **Re-enable.** Security and compliance must jointly approve a restoration plan, chain verification must pass for the new checkpoint, the outbox backlog must be reconciled, and a staged cohort gate must pass before replay resumes.
7. **Close.** Retain evidence under policy, perform root-cause analysis, add a detection/control regression test, and update the threat model and key ceremony.
