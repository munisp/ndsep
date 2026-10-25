# PostgREST exposure for NDSEP workers

The Python workers `workers/python/egress_monitor_worker.py` and
`workers/python/adverse_media_worker.py` never connect to Postgres directly —
they read/write exclusively through PostgREST
(`SOVEREIGNTY_DB_API_URL` / `ADVERSE_MEDIA_DB_API_URL`). This directory holds
the PostgREST side of that contract; `drizzle/migrations/0121_postgrest_worker_role.sql`
holds the database side.

## Components

| Piece | Where | Purpose |
| --- | --- | --- |
| `ndsep-postgrest.conf` | here | PostgREST server config (auth model below) |
| Role `ndsep_worker` | migration 0121 | NOLOGIN role the workers run as; least-privilege GRANTs |
| Role `ndsep_postgrest_anon` | migration 0121 | `db-anon-role`; **zero** privileges (fail closed) |
| Role `ndsep_postgrest_authenticator` | migration 0121 | PostgREST connection role; may switch into the two roles above |

## Authentication model

1. PostgREST connects as `ndsep_postgrest_authenticator`. Migration 0121
   creates it `NOLOGIN`; a DBA grants LOGIN and a SCRAM password out of band
   (migrations never embed credentials):

   ```sql
   ALTER ROLE ndsep_postgrest_authenticator LOGIN PASSWORD '<from secrets manager>';
   ```

2. Workers send `Authorization: Bearer <jwt>` where the JWT carries
   `{"role": "ndsep_worker"}` signed (HS256) with `PGRST_JWT_SECRET`.
   PostgREST verifies the signature and runs `SET LOCAL ROLE ndsep_worker`
   for the request.

3. Unauthenticated requests fall into `ndsep_postgrest_anon`, which has no
   table privileges at all — any anonymous request returns 401/403 with an
   empty result.

## Least-privilege surface (0121)

`ndsep_worker` can touch exactly what the two workers use — nothing else:

| Table | Privileges | Used by |
| --- | --- | --- |
| `asn_geo_reference` | SELECT | egress_monitor (destination classifier; `status=eq.active` rows only since Round 10) |
| `egress_thresholds` | SELECT | egress_monitor |
| `hosting_declarations` | SELECT | egress_monitor |
| `egress_flow_rollups` | SELECT, INSERT, UPDATE | egress_monitor (window rollups; PATCH merge) |
| `residency_violations` | SELECT, INSERT | egress_monitor (violation emission) |
| `adverse_media_sources` | SELECT, UPDATE | adverse_media (source fetch state) |
| `adverse_media_items` | SELECT, INSERT | adverse_media |
| `adverse_media_entity_matches` | SELECT, INSERT | adverse_media |
| `supervision_risk_signals` | SELECT, INSERT | adverse_media / intelligence signals |
| `organizations` | SELECT (id, name) | adverse_media (entity registry for matching) |

There is **no DELETE** grant anywhere, and UPDATE only on the two tables the
workers actually PATCH. Sequence USAGE is granted on the `BIGSERIAL` insert
targets.

## Row-Level Security

RLS is enabled on every worker-reachable table with policies scoped
`TO ndsep_worker`. Consequences:

- `ndsep_worker` sees all rows of those tables (it is the ingestion writer;
  row scoping is meaningless for it).
- The application role (table owner) bypasses RLS by default, so the main
  app is unaffected.
- Any *other* future role exposed via PostgREST gets **zero rows** from these
  tables until an explicit policy is added — new exposure requires a
  migration, not a config edit.

If you need belt-and-braces for the app role too, add
`ALTER TABLE <t> FORCE ROW LEVEL SECURITY;` **and** app-role policies in a
follow-up migration — do not do it in 0121 without app-role policies or the
API would break.

## Running

```sh
export PGRST_AUTHENTICATOR_PASSWORD=...   # SCRAM password (secrets manager)
export PGRST_DB_HOST=postgres PGRST_DB_PORT=5432 PGRST_DB_NAME=ndsep_db
export PGRST_JWT_SECRET=...               # >=32 chars, shared with token minter
postgrest infra/postgrest/ndsep-postgrest.conf
```

Point the workers at it:

```sh
SOVEREIGNTY_DB_API_URL=http://postgrest:3000   # egress_monitor_worker
ADVERSE_MEDIA_DB_API_URL=http://postgrest:3000 # adverse_media_worker
```

Both workers additionally need the `Authorization` header plumbed through
(`SESSION.headers` in each worker); mint worker JWTs with claim
`{"role": "ndsep_worker", "exp": ...}`.

## Verification

```sql
-- As ndsep_postgrest_authenticator:
SET ROLE ndsep_worker;
SELECT count(*) FROM egress_flow_rollups;  -- works
DELETE FROM egress_flow_rollups;           -- ERROR: permission denied
SELECT * FROM enforcement_fines;           -- ERROR: permission denied
RESET ROLE;
SET ROLE ndsep_postgrest_anon;
SELECT count(*) FROM egress_flow_rollups;  -- ERROR: permission denied
```
