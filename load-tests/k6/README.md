# NDSEP k6 Load Tests

Load scenarios for the NDSEP platform API. All scripts target the tRPC HTTP
endpoint (`/api/trpc`) with the server's **superjson** transformer — inputs
must be wrapped as `{"json": {...}}` (a bare JSON input is rejected with
`BAD_REQUEST`). The legacy `load-tests/k6-smoke.js` / `k6-stress.js` scripts
send unwrapped inputs and will fail against the current server unless fixed.

## SLO targets

| Traffic | p50 | p95 | p99 |
|---|---|---|---|
| Reads (queries, incl. batched single calls) | < 100 ms | < 500 ms | < 1 s |
| Batched fan-in (multi-procedure HTTP request) | < 150 ms | < 700 ms | < 1.5 s |
| Writes (mutations) | — | < 1 s | — |
| Error rate (5xx / transport) | — | — | < 1–2 % |

These thresholds are encoded directly in each script's `options.thresholds`,
so `k6 run` exits non-zero on an SLO regression (CI-gateable).

## Scripts

| Script | Auth | Covers |
|---|---|---|
| `k6/public-endpoints.js` | none | Public hot paths: DPO/DPCO registry browse (`dpoMarketplace.listProfiles`), sanctions register (`sanctionsRegister.search/.detail/.stats`), FOIA tracking (`foia.track`) |
| `k6/authed-api.js` | Bearer JWT or session cookie | Authenticated portal traffic in the web client's real shape: batched tRPC fan-in (dashboard stats + org list + inspection cases in one request), single reads, and ~10 % writes (`fieldInspection.createCase`, idempotent per-VU `case_uuid`) |

## Running

```bash
# Public endpoints (no credentials needed)
k6 run -e BASE_URL=http://localhost:3000 load-tests/k6/public-endpoints.js

# Authenticated API — Keycloak JWT
k6 run -e BASE_URL=http://localhost:3000 -e AUTH_TOKEN=$JWT \
  load-tests/k6/authed-api.js

# …or a session cookie copied from a logged-in browser
k6 run -e BASE_URL=http://localhost:3000 -e SESSION_COOKIE="ndsep_session=..." \
  load-tests/k6/authed-api.js
```

Notes:

- **No credentials**: `authed-api.js` still runs, but authed procedures
  return 401. The script counts those separately (`unauthorized_responses`)
  and does not fail the error budget — that mode only verifies the auth wall
  holds under load.
- **Writes**: `fieldInspection.createCase` upserts on the client-supplied
  `case_uuid`; each k6 VU reuses one UUID, so a run creates at most
  `max VUs` inspection-case rows. Point writes at a staging database.
- **FOIA track** uses synthetic reference numbers; the server responds 404
  (NOT_FOUND), which still exercises the full DB query path that the SLO
  applies to.

## Interpreting results

k6 prints per-metric percentiles at the end of the run; threshold breaches
are listed under `✗ thresholds`. Compare `registry_latency`,
`sanctions_latency`, `foia_track_latency`, `single_read_latency`,
`batch_read_latency`, and `write_latency` against the table above. A p95
breach on reads with a healthy error rate usually indicates a missing index
or an N+1 query — cross-reference `docs/PERFORMANCE.md` (budgets and the
migration-0070 index strategy) before raising limits.
