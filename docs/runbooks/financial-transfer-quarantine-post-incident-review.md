# Financial Transfer Quarantine — Post-Incident Review

**Incident ID:** `SEV-1-FIN-{YYYYMMDD}-{NNN}`  
**Status:** `Draft | In review | Approved | Closed`  
**Incident Commander:**  
**Payment Operations Lead:**  
**Ledger/TigerBeetle Owner:**  
**Database Owner:**  
**Security and Compliance Reviewer:**  
**Financial Control Approvers:**  
**Review Date:**

## 1. Executive Summary

Describe what happened, when it began and ended, which transfers were affected, whether any funds were duplicated, delayed, rejected, or left uncertain, and what customer, regulatory, or operational impact occurred. Do not include secrets or unnecessary personal data.

> **Closure rule:** A quarantine incident is not closed because the API is healthy. It is closed only after provider truth, ledger state, callback authenticity, outbox state, approvals, and customer/accounting impact are reconciled.

## 2. Timeline

| UTC time | Event                                        | Evidence/reference | Owner |
| -------- | -------------------------------------------- | ------------------ | ----- |
|          | Alert fired                                  |                    |       |
|          | Quarantine detected                          |                    |       |
|          | Funds-movement containment applied           |                    |       |
|          | Provider lookups completed                   |                    |       |
|          | Reconciliation decision approved             |                    |       |
|          | Callback or provider terminal state observed |                    |       |
|          | Canary completed                             |                    |       |
|          | Funds-movement freeze lifted                 |                    |       |

## 3. Affected Transfer Inventory

| Transfer reference | Kind | Amount minor units | Currency | Actor | Initial state | Final state | Provider result | Customer impact |
| ------------------ | ---- | -----------------: | -------- | ----- | ------------- | ----------- | --------------- | --------------- |
|                    |      |                    |          |       |               |             |                 |                 |

Attach the evidence output from:

```sql
SELECT id, transfer_reference, transfer_kind, amount_minor, currency, state,
       attempts, lease_owner, lease_expires_at, last_error, created_at, updated_at
FROM financial_transfer_outbox
WHERE state IN ('reconciliation_required','dead_letter')
ORDER BY updated_at;

SELECT transfer_reference, provider, observed_state, response_sha256,
       action, detail, created_at
FROM financial_provider_reconciliation
WHERE transfer_reference IN ('{references}')
ORDER BY created_at;
```

## 4. Provider Truth and State Decision

For every transfer, record the independent immutable-reference lookup result.

| Reference | TigerBeetle lookup | Mojaloop lookup | Callback mTLS/HMAC | Decision | Approver 1 | Approver 2 |
| --------- | ------------------ | --------------- | ------------------ | -------- | ---------- | ---------- |
|           |                    |                 |                    |          |            |            |

Confirm that timeout, TLS failure, malformed JSON, 401/403, and 5xx were treated as **unknown**, not as `not_found`. Confirm that no TigerBeetle transfer was replayed after acknowledgment loss.

## 5. Root Cause and Contributing Factors

**Primary technical cause:**

**Trigger:**

**Why the acknowledgment was ambiguous:**

**Why detection did or did not work:**

**Why quarantine response did or did not work:**

**Human/process contributors:**

**Control-plane or deployment contributors:**

## 6. Security and Integrity Review

Mark each item `Pass`, `Fail`, or `Not applicable`, and link evidence.

| Control                                    | Result | Evidence |
| ------------------------------------------ | ------ | -------- |
| No direct SQL state edits                  |        |          |
| No blind provider replay                   |        |          |
| Immutable reference preserved              |        |          |
| Duplicate idempotency prevented            |        |          |
| Provider observations durably recorded     |        |          |
| mTLS client certificate verified           |        |          |
| mTLS subject allowlist verified            |        |          |
| Raw-body HMAC verified                     |        |          |
| Public-ingress identity headers stripped   |        |          |
| Two-person manual decision approval        |        |          |
| Audit log integrity and retention verified |        |          |
| Secrets absent from logs/evidence          |        |          |

## 7. Corrective and Preventive Actions

| Action | Priority | Owner | Due date | Verification test | Status |
| ------ | -------- | ----- | -------- | ----------------- | ------ |
|        | P0/P1/P2 |       |          |                   | Open   |

Actions must be specific, code- or configuration-linked, and independently verifiable. “Monitor more closely” is not an adequate corrective action.

## 8. Recovery and Closure Checklist

- [ ] Incident Commander confirmed the complete transfer inventory.
- [ ] Funds movement remained frozen until provider truth was established.
- [ ] Every quarantined transfer has two authoritative provider lookup results or an explicitly approved manual disposition.
- [ ] Every provider observation is recorded in `financial_provider_reconciliation`.
- [ ] No transfer was settled without a valid terminal provider state and authenticated callback where required.
- [ ] No duplicate ledger or Mojaloop transfer was created.
- [ ] All idempotency keys and request fingerprints were preserved.
- [ ] mTLS positive and negative tests passed after recovery.
- [ ] A controlled canary transfer completed and reconciled.
- [ ] Quarantine and dead-letter queues are zero or explicitly dispositioned.
- [ ] Financial-control approvers signed the affected-transfer inventory.
- [ ] Security/compliance reviewed callback, evidence, and data exposure.
- [ ] Customer/accounting reconciliation was completed.
- [ ] Corrective actions have owners and dates.
- [ ] Post-incident communications were sent.
- [ ] Independent reviewer approved closure.

## 9. Communications

**Internal status update:**

**Customer/support communication:**

**Provider communication/case ID:**

**Regulatory/compliance assessment:**

## 10. Approval

| Role                 | Name | Decision | Signature/timestamp |
| -------------------- | ---- | -------- | ------------------- |
| Incident Commander   |      |          |                     |
| Payment Operations   |      |          |                     |
| Financial Control    |      |          |                     |
| Security             |      |          |                     |
| Compliance           |      |          |                     |
| Independent Reviewer |      |          |                     |
