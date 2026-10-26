# Round 13 — W3 Report: Infra Posture Scanning + Crypto Ransom Tracing

Scope: P0.3 (infrastructure security posture scanning of registered
controllers via OSIRIS RECON, feeding compliance scanning + supervision risk)
and P0.4 (crypto wallet tracing for ransomware/breach enforcement).

## Deliverables

### A. Vulnerability posture scanning

| File | Status | Notes |
|---|---|---|
| `server/osiris/scannerClient.ts` | NEW | `scanHost(host)`, `cveForProduct(query)`, `kevFeed()`, `scannerKeyPresent()`. Fail-closed: no `OSIRIS_SCANNER_KEY` → `status:'unavailable'` **without calling the scanner** (it would 503); 503/5xx/unreachable degrade identically. Defensive payload parsing; TTL cache; key read at call time. |
| `server/services/infraPostureScan.ts` | NEW | `scanTargetPosture(target)`, `mapPostureSeverity()`, `buildPostureEvidence()`, `normalizePostureSignal()`, `postureSignalForOrg(orgId)` (normalized 0–1), `infraPostureWeightedByOrg(orgIds)`. Findings inserted into the existing `scan_findings` table with `finding_type='infra_posture'`, `status='open'`, evidence jsonb (open ports, matched CVEs + CVSS + KEV flags, cert issues, `scanner_key_present`), plus `evidence_hash` dedupe mirroring migration 0108. Severity: KEV-listed or CVSS≥9 → critical; admin/DB ports (22/3389/5900/1433/1521/3306/5432/6379/9200/27017/9042) or expired cert → high; CVSS 7–8.9 / other exposure → medium; clean → low. Scanner unavailable ⇒ bookkeeping row only, **no findings fabricated**. |
| `server/routers/complianceScanning.ts` | SURGICAL | `FINDING_TYPES` gained `'infra_posture'`; two new endpoints on the existing router (already mounted): `runInfraPostureScan` (admin) and `listInfraPostureRuns` (protected). Suppression/status workflow reused unchanged. |
| `server/routers/supervisionRisk.ts` | SURGICAL | `collectRiskInputs` / `collectRiskInputsBatch` now gather the infra-posture signal (defensive, grouped query) and persist it on each `risk_score_inputs` row as `inputs.infra_posture` + `normalized.infra_posture` with `source_tables.infra_posture` (source='infra_posture'). **Weights, factor keys and every other signal untouched** — it is an observed input, not a scoring factor. |
| `drizzle/migrations/0144_infra_posture.sql` | NEW | Widens `scan_findings_finding_type_check` with `'infra_posture'`; creates `infra_posture_runs` (target/host, scanner availability, key presence, findings count, duration). sqlglot-validated (postgres dialect, 5 statements). |
| `drizzle/schema_ext/infraPosture.ts` | NEW | Drizzle defs for `infra_posture_runs` + `ransom_traces` (hand-off snippet; schema.ts not edited per constraints). |

### B. Crypto ransom tracing

| File | Status | Notes |
|---|---|---|
| `server/osiris/cryptoClient.ts` | NEW | `traceWallet(address)` → `{chain, chainInferred, balance, txCount, recentTxs[], ofacSanctioned, status}` via OSIRIS `/api/osint/crypto` (blockstream/Blockscout proxy). Defensive parsing (`extractOfacFlag` accepts ofac_sanctioned/sanctions.hit/labels), chain inference labelled, unreachable ⇒ `status:'unavailable'` (never reported as clean). |
| `server/routers/ransomTrace.ts` | NEW | `ransomTraceRouter`: `traceWallet(address, caseId?)` (staffProcedure) — persists `ransom_traces`, attaches to the enforcement case via the existing `case_timeline` notes mechanism (`addCaseTimelineEntry`, same channel as `enforcementCases.update`); OFAC hits ⇒ prominent `ofacAlert` + hash-chained `audit_ledger` entry (`ransom_wallet_ofac_hit`). `listTraces(caseId?)`. |
| `drizzle/migrations/0145_ransom_traces.sql` | NEW | `ransom_traces` (id, case_id nullable FK→enforcement_cases, address, chain, ofac_sanctioned, status ok/unavailable, result jsonb, traced_by, created_at). sqlglot-validated (4 statements). |

### Client (additive mounts only)

- `client/src/components/InfraPosturePanel.tsx` — NEW; posture summary,
  findings table, sweep history, "Scan posture" trigger. Mounted as a new
  **"Infra posture"** tab in `client/src/pages/ComplianceScanning.tsx`
  (Round-12 bulk bar untouched).
- `client/src/components/RansomTraceCard.tsx` — NEW; address input, result
  card with OFAC badge + ledger seq, trace history. Mounted as a new
  **"Wallet Trace"** tab in the enforcement case detail modal of
  `client/src/pages/EnforcementCases.tsx`. Uses `(trpc as any).ransomTrace`
  (InsiderThreat.tsx precedent) until the router mount lands.

## Mount required (lead)

```ts
// server/routers.ts
import { ransomTraceRouter } from "./routers/ransomTrace";
// appRouter:
ransomTrace: ransomTraceRouter,
```

Everything else is already reachable: infra-posture endpoints live on the
already-mounted `complianceScanning` router; `postureSignalForOrg` is
exported from `server/services/infraPostureScan.ts`; supervisionRisk wiring
is in place.

## Tests & checks

- `server/osiris/__tests__/scannerClient.test.ts` (10) — fail-closed without
  scanner key (fetch never called), 503/unreachable degradation, defensive
  parsing, alias fallback, CVE list parsing, KEV feed.
- `server/services/__tests__/infraPostureScan.test.ts` (20) — severity
  mapping, signal normalization/saturation, finding insertion shape
  (finding_type/severity/evidence/evidence_hash), fail-closed run records
  `scanner_available=false` with no findings, clean posture ⇒ no finding.
- `server/routers/__tests__/ransomTrace.test.ts` (7) — OFAC flag + ledger +
  timeline attach, unavailable ≠ clean, malformed address BAD_REQUEST,
  unknown case NOT_FOUND, staff role enforcement, listTraces.
- `vitest run` of the 3 new files: **37/37 pass**; neighboring suites
  (`server/routers/__tests__`, `server/services/__tests__`, bulkOps):
  **197/197 pass**.
- `tsc --noEmit`: no errors in any touched/created file (baseline carries
  pre-existing errors in unrelated files incl. TS2802 iterator errors that
  predate this change; my additions avoid that pattern).
- Both migrations validated with sqlglot (postgres).

## Notes / residual risk

- OSIRIS endpoint shapes are assumed (`/api/scanner` primary,
  `/api/osint/scan` alias; `/api/osint/crypto`); parsing is deliberately
  shape-tolerant and fail-closed. First live run should be sanity-checked
  against the real payloads.
- `infra_posture` is persisted as an explainable risk input but is NOT a
  weighted scoring factor, per mission constraint (weights unchanged). If it
  should influence the composite score later, add a factor via the
  `learned_risk_weights`/`risk_weights` path, not by editing the sweep.
- No scheduled sweep wires `scanTargetPosture` to Temporal (workers/temporal
  is off-limits); operators trigger via `complianceScanning.runInfraPostureScan`
  or the panel button. A follow-up schedule can call the service directly.
