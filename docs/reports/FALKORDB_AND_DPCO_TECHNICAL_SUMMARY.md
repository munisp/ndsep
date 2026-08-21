# FalkorDB Integration and DPCO Lifecycle Migration Technical Summary

**Author:** Manus AI
**Date:** 2026-08-18
**Branch:** `audit/full-platform-integration-20260812`
**Publication review:** [PR #2](https://github.com/munisp/ndsep/pull/2)

## Executive summary

The NDSEP audit branch replaces a retired in-memory graph implementation with a fail-closed FalkorDB integration, normalizes DPCO service lifecycle persistence into canonical PostgreSQL records, and hardens the associated delivery, authorization, ledger, AI, and configuration boundaries. The branch is reviewable through PR #2. Its real FalkorDB round trip has not completed in the sandbox because the host cannot create Docker bridge-network endpoints; the code, test fixture, CI preflight, and runner are prepared for a bridge-capable self-hosted runner.

The DPCO lifecycle model now has canonical tables, typed organization/engagement references, foreign keys, supporting indexes, and final-state validation. New writes cannot mark a registry record `active` without a non-empty licence number, nor a verification statement `issued` without a non-empty reference number. A safe legacy remediation script quarantines bad final-state records without inventing legal identifiers.

## FalkorDB integration

### Architecture and phases

The original FalkorDB worker kept graph nodes and edges in process memory. That design could return graph-like answers that did not survive restarts or represent a real graph database. It was first retired so it could not serve plausible data. The current adapter uses the official `falkordb-go/v2` client and requires a configured server URL, graph name, successful server ping, and bounded graph probe before the worker starts.[1]

| Capability | Current behavior | Failure behavior |
|---|---|---|
| Startup/readiness | Requires `FALKORDB_URL`, `FALKORDB_GRAPH_NAME`, and a live server probe. | Worker fails startup; readiness is unavailable. |
| Neighbor lookup | Executes a parameterized read-only Cypher query through the real adapter. | Explicit upstream error; no local graph fallback. |
| Shortest path | Executes a parameterized bounded `shortestPath` query. | Explicit upstream error; no local graph fallback. |
| Relationship selection | Uses an allow-list of relationship types. | Unsupported value returns a validation error. |
| Traversal depth | Defaults to 5 and is capped at 8 before it is used as Cypher structure. | Out-of-range value returns a validation error. |
| Rebuild, embeddings, node inspection | Intentionally disabled during the transition. | Explicit `501` rather than fabricated graph output. |

The query body is limited to 64 KiB, graph identifiers have an explicit length bound, query identifiers are parameters, relationship labels are allow-listed, and client-facing errors are JSON-encoded. These controls prevent user-supplied values from being concatenated into Cypher structure. FalkorDB documents its official Go client and graph query interface for application connectivity.[1]

### Live integration fixture

The repository includes a real-server fixture at `infra/integration/docker-compose.falkordb-integration.yml`, a multi-stage graph-worker image, a non-secret environment template, and `scripts/integration/run-falkordb-roundtrip.sh`. The runner seeds a dedicated graph and verifies health, neighbor lookup, path traversal, injection rejection, relationship/depth rejection, AOF persistence after restart, outage-triggered `503`, and recovery.

The fixture uses the published immutable server tag `falkordb/falkordb-server:v4.20.3`, AOF persistence, an internal network, a generated per-run password, and cleanup on exit. The integration script uses `REDISCLI_AUTH` inside the server container rather than `redis-cli -a`, so the generated password is not printed in command logs.

## DPCO lifecycle schema and persistence

### Canonical service records

Migrations `0030` through `0032` introduce authoritative PostgreSQL records for DPCO audit, registry, and verification lifecycle services. Each table has a UUID primary key, non-null JSONB payload, timestamps, and query-oriented indexes. The Go services were changed so creation, reads, state transitions, reporting, and metrics use durable PostgreSQL records rather than process-local maps.

| Migration | Table | Durable responsibility |
|---|---|---|
| `0030_dpco_audit_service_records.sql` | `dpco_audit_service_records` | Audit initiation, stages, assessments, reads, and metrics. |
| `0031_dpco_registry_service_records.sql` | `dpco_registry_service_records` | Registration, renewal, suspension, reads, health, and metrics. |
| `0032_dpco_verification_service_records.sql` | `dpco_verification_service_records` | Statement draft, signing, issuance, reads, health, and metrics. |

Migration `0033_dpco_lifecycle_reference_keys.sql` extracts validated numeric references into typed columns and installs seven foreign keys with supporting B-tree indexes. The fresh schema check confirmed the indexes are valid. The original JSON expressions remain for transitional search compatibility; typed columns are the relational integrity mechanism.

### Final-state identifier enforcement

Migration `0034_dpco_final_lifecycle_identifier_checks.sql` adds two `NOT VALID` check constraints:

| Constraint | Enforced new-write rule |
|---|---|
| `dpco_registry_active_requires_licence_number` | A record cannot have `payload.status = 'active'` unless `payload.licence_number` is a non-empty string after trimming. |
| `dpco_verification_issued_requires_ref_number` | A record cannot have `payload.status = 'issued'` unless `payload.ref_number` is a non-empty string after trimming. |

`NOT VALID` is intentional. PostgreSQL enforces both constraints on inserted and updated rows immediately, while allowing existing bad rows to be remediated before a later `VALIDATE CONSTRAINT`. The registry renewal path and verification issuance path also perform application-level checks before final-state writes. A transactional database contract test verified that missing identifiers are rejected and valid records are accepted.

The report-first remediation script, `scripts/remediate-dpco-lifecycle-identifiers.sh`, identifies legacy violations, changes only invalid final-state records to `identifier_remediation_required`, preserves `previous_final_status`, and writes an audit reason/time. It never creates a licence or reference number. On the local staging-equivalent database, both report counts were zero.

## Fail-closed integration posture

The audit branch removes or explicitly retires silent-success patterns across the affected service surface. Key examples include Keycloak token validation, Permify authorization, Redis session revocation, Temporal workflow submission, TigerBeetle transaction posting, Dapr state/publishing, Kafka delivery, OpenSearch indexing/query behavior, watchlist screening, CPU AI availability, and APISIX credential handling. In each case, an unavailable authoritative dependency now causes an explicit error or a pending state rather than a completed-looking result.

The strict Rust WASM scoring API also now returns `Result<f64, JsValue>`. Malformed or non-array JSON produces the stable `INVALID_CONTROLS_JSON` error rather than returning the baseline score for an empty control list.

## Validation evidence

| Surface | Latest verified result |
|---|---|
| TypeScript type checking | Passed. |
| Vitest | 73 test files and 928 tests passed. |
| Go orchestration/services/workers | Module test suites passed. |
| Python | `compileall` passed over services, workers, and orchestration. |
| Rust services/workers | Both workspaces passed `cargo test --workspace`. |
| Rust WASM | Four strict-input tests and Clippy with warnings denied passed. |
| Fresh canonical PostgreSQL migration | Passed through migration `0034`; lifecycle identifier constraints present. |
| Compose syntax | Core, middleware, data operations, intelligence, orchestration, and FalkorDB fixture manifests passed structural validation. |
| Full repository ESLint | Not green: pre-existing backlog of 168 errors and 3,143 warnings remains. |

## Deployment and CI/CD status

The sandbox cannot complete the real server-backed FalkorDB test because Docker bridge endpoint creation fails at the host kernel's missing iptables raw table. Docker documents that bridge networking requires Docker-managed firewall rules and uses the raw table `PREROUTING` chain for direct-routing protection.[2] [3]

The CI workflow `.github/workflows/falkordb-live-integration.yml` requires a `self-hosted`, `linux`, `docker-bridge` runner. It verifies Docker Engine, Compose v2, Buildx, raw-table access, IP forwarding, and an actual disposable bridge-network container before it runs the integration script. Workflow publication requires merging PR #2 into the `production` default branch; GitHub cannot manually dispatch a workflow that exists only on the audit branch. The associated `actionlint` configuration declares the custom runner label and validates the workflow syntax.

## Outstanding prerequisites and recommended next actions

| Priority | Required action | Owner / environment |
|---|---|---|
| P0 | Review and merge PR #2 to publish the workflow on `production`. | Repository maintainers. |
| P0 | Provide an actual `STAGING_DATABASE_URL`; run the remediation script `--report`, then `--apply` only if counts are nonzero, then `--validate-constraints` after remediation review. | Staging database operator. |
| P0 | Bring a `self-hosted`, `linux`, `docker-bridge` runner online with raw-table support and IP forwarding. | CI/CD infrastructure owner. |
| P1 | Dispatch **FalkorDB Live Integration** after the workflow is published and runner preflight passes. | CI/CD operator. |
| P1 | Implement the retired graph rebuild/embedding/node-inspection operations against the real adapter, with server-backed tests. | Application engineering. |
| P2 | Triage the TypeScript lint backlog separately from functional validation. | Application engineering. |

### References

[1]: https://github.com/FalkorDB/falkordb-go "Official FalkorDB Go client"

[2]: https://docs.falkordb.com/operations/docker.html "FalkorDB Docker operations"

[3]: https://docs.docker.com/engine/network/firewall-iptables/ "Docker with iptables"

[4]: https://docs.docker.com/engine/network/packet-filtering-firewalls/ "Docker packet filtering and firewalls"
