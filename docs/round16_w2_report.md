# Round-16 W2 — Orphan-Backend UI Surfaces

**Scope:** Web consoles for three orphan tRPC routers that had zero consumers:
`consentPropagation`, `whistleblowerChannel`, `ninIdentity`.

## Pages

| Page | Route | Procedures wired |
|---|---|---|
| `client/src/pages/ConsentPropagation.tsx` | `/consent-propagation` | 16/16 |
| `client/src/pages/WhistleblowerChannel.tsx` | `/whistleblower-channel` | 15/15 |
| `client/src/pages/NinIdentity.tsx` | `/nin-identity` | 7/7 |

### ConsentPropagation.tsx — consent revocation propagation console (16/16)
- **Purposes & processors tab:** `listPurposes`, `createPurpose`, `deactivatePurpose`,
  `listProcessors`, `registerProcessor` (org-scoped selector; SSRF note on ack endpoints).
- **Withdrawals tab:** `recordWithdrawal` (fan-out form; one-time ack tokens surfaced in a
  copy-now banner), `listWithdrawals` (audit trail; `subject_ref_hash` rendered masked/truncated only).
- **Propagation & SLA tab:** `listPropagationRecords` (status/event filters), per-record
  `markNotified` with channel picker, SLA countdown computed from `notified_at + sla_hours`
  (green remaining / orange overdue), `ack_overdue` badges, retry metadata.
  Admin actions: `retryFailedDispatches`, `flagOverdue`, `reissueAckToken` (token shown once via toast).
- **Tokens & self-service tab:** `acknowledgeByToken` (processor ack + proof ref),
  `createWithdrawalLink` (staff mints one-time link token), `withdrawByToken` (NDPA s.35
  self-service parity).
- **Overdue report tab:** `overdueAckReport` — totals KPIs + per-processor escalation table.

### WhistleblowerChannel.tsx — officer-side secure channel console (15/15)
Distinct from the public submit portal (`/whistleblower`); this is the case-officer console.
- **Case inbox & thread tab:** `getThreadForOfficer` (bubble thread per report ref, read
  receipts), `postOfficerMessage`. Inbox quick-picks assembled from report refs surfaced by
  protection flags/rewards/intake.
- **Intake + channel tab:** `submitWithChannel` (staff-assisted submission provisioning the
  channel; one-time access token banner).
- **Protection flags tab (admin):** `listProtectionFlags` (status filter),
  `updateProtectionFlag` (workflow: open → under_review → protective_measures → closed).
- **Rewards tab (admin):** `nominateReward`, `listRewards`, `decideReward` (approve / mark paid / decline).
- **Tokens tab (admin):** `issueChannelToken`, `revokeChannelToken`.
- **Reporter channel tab (token-auth public endpoints):** `getChannelMessages`, `markRead`,
  `postReporterMessage`, `getMyRewardStatus`, `reportRetaliation` — exercises the reporter-side
  pseudonymous flow exactly as the public endpoints expose it.
- Anonymity-integrity indicator badges: pseudonymous refs only, encrypted-at-rest messages,
  hash-only tokens, retaliation-protection workflow.

### NinIdentity.tsx — NIN identity verification console (7/7)
- NIMC adapter status card: `adapterStatus` (configured/UNCONFIGURED, TTL, biometric seam).
- **Verify tab:** `verifyNin` (11-digit NIN never stored/displayed — result shows only a
  masked last-3 form `ninMasked`; match/no-match verdict + assurance level; adapter returns
  only an aggregate verdict, attribute-level breakdown explicitly noted as not surfaced).
- **Basic attestation tab:** `verifyBasic` (cannot supersede nin_verified).
- **Status check tab (staff):** `checkVerification` (gated to staff roles).
- **History tab (admin):** `auditTrail` — verification history table.
- **Revoke tab (admin):** `revoke` with reason.
- **Biometric tab:** `verifyBiometric` — surfaces the explicit NOT_IMPLEMENTED adapter seam.

## Routes & navigation
- `client/src/App.tsx` — lazy imports + routes in a marked `{/* Round-16 W2 */}` block
  (alongside concurrent W1/W3 blocks; coexists cleanly).
- `client/src/components/DashboardLayout.tsx` — three nav entries added under
  "Advanced Features" with a `// Round-16 W2` comment (uses already-imported icons).

## Privacy compliance
- No raw NIN / MSISDN / subject identifiers rendered anywhere: consent page displays only
  truncated keyed-HMAC `subject_ref_hash` values; NIN page masks to last-3 and discards the
  raw value from state immediately post-mutation; whistleblower console shows only anonymous
  report refs (WBR-YYYY-NNNNN).
- No pre-existing masking helper existed in `client/src/lib` or `client/src/components`
  (searched), so small local `maskHash` / `maskNin` helpers are defined per page.
- Staff/admin gating via `useRbac()` (`isGovernmentStaff` for `checkVerification`, `isAdmin`
  for adminProcedure surfaces); the server enforces auth regardless.

## Validation
- `node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit`:
  **35 errors — identical to pre-existing baseline** (same files/messages), zero new errors
  in `ConsentPropagation.tsx`, `WhistleblowerChannel.tsx`, `NinIdentity.tsx`, `App.tsx`,
  or `DashboardLayout.tsx`.
- Procedure wiring verified by grep: 16/16, 15/15, 7/7 unique router procedures referenced.

## Notes / residual risk
- One-time secrets (ack tokens, channel tokens, withdrawal links, NIMC verification token)
  are surfaced via long-duration toast/banner "shown once" — operators must copy immediately;
  this mirrors the server's security contract.
- `recordWithdrawal` requires an org context: the org selector gates purpose loading and
  the purpose dropdown gates the withdrawal form (org_admin scoping enforced server-side).
- Response row shapes are `any[]` from the routers' raw SQL `exec()`; the pages use
  defensive optional chaining / `?? []` throughout.
- No server edits, no new tables.
