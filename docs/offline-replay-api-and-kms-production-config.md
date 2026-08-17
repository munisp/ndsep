# Offline Replay API and KMS Recovery Production Configuration

## Critical encryption boundary

The server should **not decrypt the native SQLCipher queue payload**. SQLCipher payload encryption is device-at-rest protection; the device opens its queue locally, decrypts a due item, and sends the validated submission over TLS. Giving the backend the device DEK would defeat the intended device-bound security model.

The backend therefore receives a normal structured payload with a stable idempotency key, validates it again, stores it in PostgreSQL, and encrypts sensitive server-side recovery envelopes using KMS. The transport is protected with TLS and authenticated identity.

## Replay API contract

```http
POST /trpc/onboarding.replaySubmission
Authorization: Bearer <OIDC access token>
Idempotency-Key: 8cfe5cc4-5522-43b5-8d9d-5d2e54395318
Content-Type: application/json

{
  "idempotencyKey": "8cfe5cc4-5522-43b5-8d9d-5d2e54395318",
  "operation": "stakeholder_profile",
  "payload": {
    "companyName": "Example Land Services Ltd",
    "cacNumber": "RC123456",
    "tinNumber": "12345678-0001",
    "businessEmail": "compliance@example.ng",
    "businessPhone": "+2348012345678",
    "businessAddress": "Lagos, Nigeria",
    "contactPerson": "Amina Bello"
  },
  "attachmentRefs": []
}
```

The `Idempotency-Key` header and body key must match. For document replay, `attachmentRefs` contain server-issued upload IDs/object keys from resumable uploads; the request never embeds a whole Base64 document in a JSON replay payload.

| Response | Meaning | Client behavior |
|---|---|---|
| `200` / `201` | New replay committed | Mark queue item succeeded. |
| `200` with `replayed: true` | Same key and request hash already committed | Mark queue item succeeded; do not create duplicate audit events. |
| `409 CONFLICT` | Same key, different request hash or state version conflict | Quarantine and require review. |
| `400 BAD_REQUEST` | Replay payload violates validation rules | Dead-letter; request corrected submission. |
| `401/403` | Session or agency role invalid | Lock queue/recover session; no automatic retry until reauth. |
| `429/5xx` | Transient server/provider condition | Retry with bounded backoff. |

## PostgreSQL idempotency table

```sql
create table stakeholder_submission_replays (
  idempotency_key uuid primary key,
  owner_subject varchar(255) not null,
  operation varchar(80) not null,
  request_hash char(64) not null,
  result jsonb,
  committed_at timestamptz,
  created_at timestamptz not null default now()
);
create index stakeholder_submission_replays_owner_idx
  on stakeholder_submission_replays(owner_subject, created_at);
```

## tRPC procedure implementation

```ts
// server/routers/onboardingReplay.ts — PostgreSQL-backed, proposed implementation
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { protectedProcedure, router } from "@/server/_core/trpc";
import { stakeholders, stakeholderSubmissionReplays } from "@/server/postgres/schema";
import { normalizeStakeholderProfile, stakeholderProfileSchema } from "@/server/stakeholderValidation";

const replayInput = z.object({
  idempotencyKey: z.string().uuid(),
  operation: z.enum(["stakeholder_profile", "identity_document", "business_document"]),
  payload: z.unknown(),
  attachmentRefs: z.array(z.string().uuid()).max(12).default([]),
});

const hashRequest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex"); // replace with canonical JSON serializer in production

export const onboardingReplayRouter = router({
  replaySubmission: protectedProcedure.input(replayInput).mutation(async ({ ctx, input }) => {
    const ownerSubject = ctx.enterprise?.subject ?? ctx.user?.id;
    if (!ownerSubject) throw new TRPCError({ code: "UNAUTHORIZED", message: "Authenticated subject required" });
    const requestHash = hashRequest({ operation: input.operation, payload: input.payload, attachmentRefs: input.attachmentRefs });

    return ctx.postgres.transaction(async (tx) => {
      const existing = await tx.query.stakeholderSubmissionReplays.findFirst({
        where: eq(stakeholderSubmissionReplays.idempotencyKey, input.idempotencyKey),
      });
      if (existing) {
        if (existing.ownerSubject !== ownerSubject || existing.requestHash !== requestHash)
          throw new TRPCError({ code: "CONFLICT", message: "Idempotency key does not match original request" });
        if (!existing.committedAt) throw new TRPCError({ code: "CONFLICT", message: "Replay is already being processed" });
        return { replayed: true, result: existing.result };
      }

      await tx.insert(stakeholderSubmissionReplays).values({
        idempotencyKey: input.idempotencyKey, ownerSubject, operation: input.operation, requestHash,
      });

      let result: unknown;
      if (input.operation === "stakeholder_profile") {
        const profile = normalizeStakeholderProfile(stakeholderProfileSchema.parse(input.payload));
        const [saved] = await tx.insert(stakeholders).values({
          ownerSubject, type: "business", ...profile, onboardingStatus: "in_review",
        }).onConflictDoUpdate({ target: stakeholders.ownerSubject, set: { ...profile, updatedAt: new Date() } }).returning();
        result = { stakeholderId: saved.id, onboardingStatus: saved.onboardingStatus };
      } else {
        // Validate ownership and attachment state, then create a document row as `pending`.
        // No client payload can set `verified` trust status.
        result = await createPendingStakeholderDocument(tx, ownerSubject, input);
      }

      await tx.update(stakeholderSubmissionReplays)
        .set({ result, committedAt: new Date() })
        .where(and(eq(stakeholderSubmissionReplays.idempotencyKey, input.idempotencyKey), eq(stakeholderSubmissionReplays.ownerSubject, ownerSubject)));
      return { replayed: false, result };
    });
  }),
});
```

## KMS recovery service configuration

### Required environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `POSTGRES_REVIEW_LEDGER_URL` | Yes | TLS PostgreSQL connection string for stakeholder/review ledger. |
| `KMS_PROVIDER` | Yes | Allowed values: `aws-kms`, `gcp-kms`, or `azure-key-vault`; reject any other value at boot. |
| `KMS_KEY_ID` | Yes | Versioned KMS key ARN/resource ID; grant encrypt/decrypt only to recovery service identity. |
| `KMS_REGION` | AWS only | KMS region, for example `af-south-1` only if supported by the selected account/region policy. |
| `RECOVERY_ENVELOPE_STORE` | Yes | Private bucket/container/database reference holding KMS-wrapped DEK envelopes. |
| `RECOVERY_ENVELOPE_AAD_VERSION` | Yes | Version for additional authenticated data schema. |
| `RECOVERY_OIDC_ISSUER` | Yes | Exact OIDC issuer allowed to request recovery. |
| `RECOVERY_OIDC_AUDIENCE` | Yes | Exact audience for the recovery API. |
| `RECOVERY_REQUIRE_MFA` | Yes | `true` in production; recovery session must contain verified MFA/step-up claim. |
| `RECOVERY_RATE_LIMIT_PER_SUBJECT_HOUR` | Yes | Small integer such as `3`; throttles recovery abuse. |
| `RECOVERY_AUDIT_SINK` | Yes | Immutable audit/log destination identifier. |

**Never set a KMS plaintext key, device DEK, or recovery envelope plaintext in an environment variable.** KMS authorization must be workload-identity/IAM based, not long-lived access key based.

### Recovery endpoint policy

```http
POST /trpc/recovery.requestDeviceDekRewrap
Authorization: Bearer <fresh OIDC token with MFA claim>
{
  "deviceId": "device-bound-public-key-fingerprint",
  "keyVersion": 3,
  "devicePublicKey": "base64url...",
  "attestation": "platform-specific-attestation..."
}
```

The service validates issuer, audience, fresh authentication, subject/device enrollment, rate limit, and policy before KMS decrypting the recovery envelope in memory. It immediately re-encrypts the DEK to the registered/new device public key and returns only the device-wrapped envelope. It writes an immutable recovery audit event. The backend never returns the plaintext DEK.

### Deployment controls

1. Deploy a separate recovery service identity with permission to use only `KMS_KEY_ID` and only the recovery envelope store prefix.
2. Enforce mutual TLS or private ingress between API and recovery service, TLS from mobile to API, WAF/rate limit, and structured security audit logs.
3. Rotate KMS keys with provider-managed rotation or versioned key migration; retain decrypt permission for prior key versions until all active envelopes have rewrapped.
4. Test deny paths: no MFA, wrong audience, device mismatch, expired token, excess rate, absent recovery envelope, and KMS decrypt failure.
5. Feature-flag recovery off until staging disaster-recovery rehearsal proves rewrap, SQLCipher integrity validation, audit event, and rollback behavior.

## Current status

This endpoint and KMS service are a production design artifact. They are not present in the current application and cannot be activated without a selected KMS provider, approved OIDC/MFA policy, PostgreSQL staging service, secure workload identity, and security review.
