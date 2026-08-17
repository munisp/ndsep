# Mobile Submission Queueing, PostgreSQL Staging, and Production-Gap Program

## What the mobile tRPC layer currently does

The onboarding mutations in `lib/mobile-sync.ts` are **not optimistic updates**. `submitBusinessProfile`, `analyzeIdentityDocument`, `analyzeBusinessDocument`, `completeLiveness`, and `approveIdentityDocument` execute the tRPC mutation and then invalidate `sync.getBundle` on success. The UI refreshes only after the server response.

The repository has a true offline/optimistic fallback for **mission status** only. `updateMissionStatus` first attempts the remote mutation. If it fails, it writes a `mission_status` item through `queueMissionStatusMutation`, updates the in-memory bundle, persists the bundle locally, increments pending mutations, emits a queued-offline activity/notification, and rethrows the original error. The queued item is therefore visible in the field workflow but not silently treated as synchronized.

```ts
try {
  return await rawMissionStatusMutation.mutateAsync(input);
} catch (error) {
  const queued = await queueMissionStatusMutation({ type: "mission_status", missionId: input.missionId, status: input.status });
  const optimisticBundle = {
    ...bundle,
    missions: bundle.missions.map((mission) =>
      mission.id === input.missionId ? { ...mission, status: input.status, lastUpdated: queued.queuedAt } : mission),
  };
  setCachedBundle(optimisticBundle);
  await persistBundle(optimisticBundle);
  throw error;
}
```

> **Gap:** onboarding/profile and document submissions currently do not receive this offline request queue. They are server-first mutations with cache invalidation on success. They need idempotency keys, encrypted local payload storage, attachment staging, and replay handlers before being described as offline-safe submissions.

## Staging PostgreSQL migration runbook

| Stage | Required action | Go/no-go control |
|---|---|---|
| Isolate | Provision a managed PostgreSQL staging database with TLS, backups/PITR, migration role, and least-privilege application role | A connection health check, recovery test, and network access review pass. |
| Baseline | Export the existing local onboarding bundle and classify records as imported workflow evidence | No seeded/local `verified` value is converted into authoritative external verification. |
| Migrate | Apply `0001_postgres_stakeholder_review_ledger.sql` using a one-time migration job | Migration runs in a transaction; schema introspection and indexes match the expected artifact. |
| Backfill | Insert stakeholders/documents as `legacy_import` evidence and preserve original timestamps/provenance | Row counts, hashes, and sampled records reconcile. |
| Dual-read | Deploy a feature flag that compares local-bundle reads with PostgreSQL reads for selected staging users | Mismatches are logged and resolved; PostgreSQL remains the write target for new reviewer decisions only after acceptance. |
| Cut over | Require authenticated owner/reviewer subject and role on the new tRPC procedures; switch stakeholder writes to PostgreSQL | Validation, concurrency, role, evidence, and rollback tests pass. |
| Roll back | Disable the PostgreSQL write feature flag; preserve the audit ledger as read-only evidence | No destructive rollback or ledger deletion. |

Production activation additionally requires an approved connection URL, secrets management, migration approval, restore rehearsal, observability, an authority-provider evidence policy, and a data-retention/PII assessment.

## Test inventory and missing transition coverage

Existing tests cover manual-review routing in `tests/mobile-platform-repository.test.ts`: the action produces `requires_review`, `manual_review`, and an explicit non-verification reason. Payment tests cover PostgreSQL audit and reconciliation controls, but they do not validate the proposed stakeholder PostgreSQL ledger.

The transition must add the following deterministic test groups:

1. **Profile validation:** reject malformed CAC, TIN, phone, and email; reject incomplete business profiles; accept normalized valid input.
2. **Authorization:** reject unauthenticated stakeholder writes and reviewer decisions from unauthorized roles.
3. **Decision integrity:** verify a manual-review request never changes external trust status; require evidence references before a decision marked as approval.
4. **Concurrency:** two simultaneous decisions yield one committed decision and one `CONFLICT` result.
5. **Readiness:** recompute readiness from the PostgreSQL document/liveness/provider evidence graph; do not count legacy seeded statuses as authority evidence.
6. **Migration:** apply migration to an empty database, replay a representative backfill, verify foreign keys and append-only decision history, and test the rollback feature flag.
7. **Mobile mapping:** ensure `BAD_REQUEST` returns inline errors; `FORBIDDEN` produces a role alert; `CONFLICT` produces a refresh/retry action; and provider unavailability never presents verified trust.

## Evidence-based production gaps

| Priority | Gap | Current state | Required remediation |
|---|---|---|---|
| Critical | Stakeholder review ledger | Local bundle; no relational reviewer history | Deploy the PostgreSQL schema, procedures, audit events, and migration runbook above. |
| Critical | Authority verification | NIMC, CAC, Docling, and liveness are fail-closed/unconfigured | Contract, configure, authenticate, and evidence real providers in staging before activation. |
| Critical | Identity and role | Onboarding procedures are currently public | Bind stakeholder ownership and reviewer roles to authenticated enterprise claims. |
| High | Offline onboarding | Only field mission status has a local queue | Add encrypted, idempotent profile/document draft queue and attachment replay. |
| High | Client validation | Current profile form has generic alerts and weak string-shape checks | Apply the CAC/TIN/email/phone schema and inline field-error patch. |
| High | PWA payment UI | Calendar, branded export, saved ranges, and animated bars remain pending | Implement and test each control; retain unavailable states where real data is unavailable. |
| Medium | Observability and release controls | No stakeholder migration telemetry or approval evidence dashboard | Add structured audit logs, migration dashboards, health checks, and staging acceptance gates. |

No tool can safely claim that all production gaps are solved until the external providers, staging PostgreSQL environment, authenticated role model, migration tests, and PWA feature backlog have been completed and independently validated.
