# Round-13 P0.2 — Evidence-Based Hosting-Declaration Verification

**Workstream:** W2 (OSIRIS RECON × data sovereignty)
**Regulatory driver:** CBN Circular PSS/DIR/PUB/CIR/001/004 — payment data must be
hosted in Nigeria by **2027-01-01**. Self-declared hosting posture is not evidence;
this workstream adds independent verification that declared in-Nigeria
infrastructure actually resolves to Nigerian prefixes.

## What was built

### 1. `server/osiris/reconClient.ts` (NEW — `osirisClient.ts` untouched)
OSIRIS RECON toolkit client with osirisClient conventions (`OSIRIS_URL` env,
default `https://osirisai.live`, optional `X-Scanner-Key`, 10s timeout, 15-min
in-memory cache, graceful `null` — never throws, never fabricates):

- `resolveDns(domain)` → `GET /api/osint/dns?domain=` (defensive normalisation of
  `records`/`answers`/bare-array payload shapes). **Local DNS fallback**
  (`node:dns.promises`, A/AAAA only) when OSIRIS DNS is down, stamped
  `source: 'local_dns_fallback'` — proves resolution, **not** geography.
- `ipIntel(ipOrDomain)` → `GET /api/osint/ip?ip=` → country, ASN (parsed to
  number), org, threat flags. **No local fallback exists for geography** —
  fail-closed by construction.
- `sslInspect(domain)` → `GET /api/osint/ssl?domain=` if present; otherwise a
  **direct local TLS handshake** (`node:tls`, SNI, 8s timeout) — the certificate
  is fetched from the host itself, so it remains genuine evidence. Reports
  expiry, days-to-expiry, SAN hostname match (wildcard-aware).

### 2. `server/services/hostingVerification.ts` (NEW)
- `extractDeclaredHosts(declaration)` — pulls valid FQDNs / IP literals from the
  host-shaped fields of the 0094 declaration schema (`primary_dc_name`,
  `cloud_regions`, `backup/dr/admin_access_locations[].name`,
  `encryption_key_custody.hsm_provider`, `subprocessors[].name`); org names and
  region labels (`lagos-1`) are dropped by regex/`net.isIP` validation.
- Per-IP classification (fail-closed): **in_nigeria** requires positive evidence —
  containment in the 422 verified AFRINIC/NG prefixes seeded by migration 0120
  (`asn_geo_reference`, `reference_type='nigerian_cidr'`, `status='active'`,
  via the inet containment operator `cidr >>= $1::inet`, most-specific match
  first), OR ASN in the verified NG ASN seed (`reference_type='nigerian_asn'`),
  OR OSIRIS intel `country='NG'`. **outside_nigeria** requires positive foreign
  geo evidence (intel country ≠ NG without any domestic match). Everything else
  → **unverified**. Recon down / reference table missing ⇒ unverified, NEVER
  compliant (unit-tested).
- SSL cert sanity (expiry, hostname match, expiring-soon) recorded per host in
  the evidence JSONB; cert issues are flagged as evidence notes.
- Aggregate declaration verdict: any host outside → `violation`; all hosts
  in_nigeria → `compliant`; otherwise → `unverified`.
- Persistence: `hosting_verification_runs` + `hosting_verification_hosts`
  (migration 0142), each host row carrying evidence JSONB (resolved IPs, matched
  prefix, ASN + provider, country/org, cert summary, notes, `checked_at`).
- Violation runs mint a `decision_feedback` baseline (surface
  `hosting_verification`) via the existing `mintPrediction` helper; the
  prediction id is stored on the run row for human confirm/reject.
- Every run emits `ndsep.sovereignty.verification` via `publishWithOutbox`
  (durable outbox, migration 0110) and appends
  `sovereignty.hosting_verification` to the hash-chained `audit_ledger`.
- `runDueVerifications()` — plainly-named async scheduling hook: re-verifies
  in-scope, non-rejected declarations never verified or last checked > 30 days
  ago (bounded, per-declaration error isolation). **workers/temporal untouched**
  — the integrator wires this into the scheduler.

### 3. `server/routers/hostingVerification.ts` (NEW — `routers.ts` untouched)
`hostingVerificationRouter` (staffProcedure throughout; reads degrade gracefully
when 0142 is not applied):
- `verifyNow(declarationId)` — manual trigger (spec-required procedure).
- `runDue(limit?)` — operator override for the sweep (same function the
  scheduler calls; scheduled/manual paths cannot drift).
- `listVerdicts(status?)` — latest run per declaration, **violations first**.
- `declarationVerdict(declarationId)` — latest run + per-host evidence (badge
  popover data source).
- `stats` — verdict distribution, never-verified count, 24h run/violation counts.
- `confirmFlag(runId)` / `rejectFlag(runId, reason)` — the **only** paths that
  write `decision_feedback` outcomes for surface `hosting_verification`
  (appends outcome row for the minted prediction, publishes
  `ndsep.feedback.recorded`, ledger entry, stamps `evidence.human_review`).

**Integration gap (by design/constraint):** the router is not yet registered in
`server/routers.ts` (owned elsewhere). The integrator adds
`hostingVerification: hostingVerificationRouter`.

### 4. Client (additive; Round-12 declaration tab + FormCopilotInput untouched)
- `client/src/components/HostingVerificationBadge.tsx` — verdict chip +
  evidence popover (per-host resolved IPs, matched prefix, ASN, cert summary,
  notes; "Verify now" button). Uses a `(trpc as any)` shim until the router is
  wired (see above).
- `client/src/pages/DataSovereigntyDashboard.tsx` — new **Hosting verification**
  tab: stats cards + verification queue (violations first), per-row badge,
  verify-now, and confirm/reject flag controls for unreviewed violations.

### 5. Persistence
- `drizzle/migrations/0142_hosting_verification.sql` — Postgres-native,
  idempotent, sqlglot-validated (8 statements parse clean, read='postgres').
- `drizzle/schema_ext/hostingVerification.ts` — drizzle defs as hand-off
  artifact (schema.ts owned by another workstream; same convention as
  `drizzle/schema-snippets`).

### 6. Tests — `server/services/hostingVerification.test.ts` (21 tests, all pass)
- CIDR matching: `ipv4InCidr` boundaries (/0, /32, /19 edge, malformed → null).
- Verdict logic with mocked reconClient + db (VerificationDeps seam):
  IP in NG prefix → `in_nigeria` → declaration `compliant`; foreign intel →
  `violation` (+ feedback baseline minted); NG-ASN-only evidence → compliant;
  **recon fully down → unverified, NEVER compliant**; local-DNS fallback with
  intel down → still unverified; reference table missing (42P01) → unverified;
  no extractable hosts → unverified; mixed hosts → violation.
- `runDueVerifications` sweep: counts verdicts, isolates per-declaration errors.

## Verification performed
- `vitest run server/services/hostingVerification.test.ts
  server/routers/__tests__/decisionFeedback.test.ts` → **30/30 pass**.
- `tsc -p tsconfig.json --noEmit` → 41 pre-existing errors in other workstreams'
  files; **zero** in any file touched here.
- sqlglot (postgres) parse of migration 0142 → clean.

## Constraints honoured
No edits to `server/routers.ts`, `drizzle/schema.ts`, `server/osirisClient.ts`,
`workers/temporal/`, `egress_monitor`. OSIRIS schema drift handled defensively
throughout. Fail-closed invariant enforced in code and tests.

## Residual risk / follow-ups
- OSIRIS endpoint shapes (`/api/osint/dns|ip|ssl`) are assumed; normalisers
  tolerate drift, but a live smoke test against OSIRIS is recommended.
- Router wiring into `server/routers.ts` + `trpc` client types is the
  integrator's step; the badge/queue then work without the `(trpc as any)` shim.
- IPv6 prefixes are not seeded in `asn_geo_reference` (0120 is IPv4-only);
  AAAA-only hosts rely on OSIRIS intel for a domestic verdict.
