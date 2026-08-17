# WebAuthn Policy Tests and Tamper-Evident Replay Audit Streaming

## Integration test suite

```ts
import { describe, expect, it } from "vitest";

describe("dual-approval WebAuthn recovery", () => {
  it("rejects an invalid assertion before it writes approval state", async () => {
    const h = await stagingHarness(); const a = await h.authorization();
    await expect(h.approve(a.id, { subject:"sec-1", role:"security_engineer", assertion:"bad-signature" }))
      .rejects.toMatchObject({ code:"UNAUTHORIZED" });
    expect(await h.approvalCount(a.id)).toBe(0);
  });
  it("rejects an authenticator whose AAGUID is not enterprise-enrolled", async () => {
    const h = await stagingHarness({ allowedAaguids:["approved-aaguid"] }); const a = await h.authorization();
    await expect(h.approve(a.id, { subject:"sec-1", role:"security_engineer", aaguid:"unapproved-aaguid", assertion:"valid" }))
      .rejects.toMatchObject({ code:"AAGUID_NOT_ENROLLED" });
  });
  it("requires distinct subjects and distinct required roles", async () => {
    const h = await stagingHarness(); const a = await h.authorization();
    await h.approve(a.id, { subject:"sec-1", role:"security_engineer", assertion:"valid" });
    await expect(h.approve(a.id, { subject:"sec-1", role:"planning_supervisor", assertion:"valid" })).rejects.toMatchObject({ code:"CONFLICT" });
    await h.approve(a.id, { subject:"sup-1", role:"planning_supervisor", assertion:"valid" });
    expect(await h.authorizationStatus(a.id)).toBe("authorized");
  });
  it("detects an altered audit event and rejects an unauthorized replay", async () => {
    const h = await stagingHarness(); const a = await h.authorizedRecovery();
    await h.tamperAuditEvent(a.id); expect(await h.verifyAuditChain(a.id)).toEqual({ valid:false });
    await expect(h.replay(a.id)).rejects.toMatchObject({ code:"AUDIT_INTEGRITY_FAILURE" });
  });
});
declare function stagingHarness(opts?: unknown): any;
```

## Immutable audit-event chain and outbox

```sql
alter table recovery_audit_events add column sequence bigint not null default 0;
alter table recovery_audit_events add column previous_hash char(64);
alter table recovery_audit_events add column event_json jsonb not null default '{}'::jsonb;
alter table recovery_audit_events add column signature bytea;
create unique index recovery_audit_sequence_idx on recovery_audit_events(authorization_id, sequence);

create table recovery_audit_outbox (
 id bigserial primary key, event_id bigint not null unique references recovery_audit_events(id),
 topic text not null, payload jsonb not null, payload_hash char(64) not null,
 published_at timestamptz, attempts integer not null default 0, created_at timestamptz not null default now()
);
```

```ts
import crypto from "node:crypto";
const canonical = (v: unknown) => JSON.stringify(v, Object.keys(v as object).sort());
const hash = (text:string) => crypto.createHash("sha256").update(text).digest("hex");

export async function appendRecoveryAudit(tx: any, input: {authorizationId:string;type:string;actor?:string;payload:Record<string,unknown>}, kmsSign: (digest:Buffer)=>Promise<Buffer>) {
  const prior = await tx.maybeOne("select sequence,event_hash from recovery_audit_events where authorization_id=$1 order by sequence desc limit 1 for update", [input.authorizationId]);
  const sequence = (prior?.sequence ?? 0) + 1;
  const event = { authorizationId:input.authorizationId, sequence, type:input.type, actor:input.actor ?? null, payload:input.payload };
  const previousHash = prior?.event_hash ?? "0".repeat(64);
  const eventHash = hash(`${previousHash}|${canonical(event)}`);
  const signature = await kmsSign(Buffer.from(eventHash, "hex")); // asymmetric KMS Sign; never HMAC shared with consumers
  const saved = await tx.one("insert into recovery_audit_events(authorization_id,sequence,previous_hash,event_hash,event_json,signature,event_type,actor_subject) values($1,$2,$3,$4,$5,$6,$7,$8) returning id", [input.authorizationId,sequence,previousHash,eventHash,event,signature,input.type,input.actor]);
  await tx.query("insert into recovery_audit_outbox(event_id,topic,payload,payload_hash) values($1,'idlr.recovery.audit.v1',$2,$3)", [saved.id,event,eventHash]);
}
```

The publisher reads un-published outbox rows using `FOR UPDATE SKIP LOCKED`, publishes `(payload, payload_hash, signature, KMS key version)`, and marks `published_at` only after broker acknowledgement. Consumers verify the KMS public-key signature and recompute the linked chain. They must reject missing sequence numbers, altered hashes, reused event IDs, or invalid signatures. The recovery worker calls `verifyAuditChain` immediately before consuming a grant; a failed chain disables replay and pages security.
