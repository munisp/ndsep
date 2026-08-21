# FalkorDB Client-Adapter Replacement Plan

**Status:** Required before graph intelligence is re-enabled. The current worker has been intentionally retired because its adjacency-list implementation was process-local and could not be presented as durable graph state.

## Target Architecture

The replacement remains a Go worker, but it must depend on the official `github.com/FalkorDB/falkordb-go/v2` client rather than the retired `InMemoryGraph`. FalkorDB lists `falkordb-go` as its official Go client, and the client supports selecting a graph and executing graph queries from Go.[1] The adapter must be the sole graph read/write path: there can be no in-memory fallback, cache-as-source-of-truth, or success response after a graph write fails.

| Current worker behavior | Real adapter responsibility | Acceptance criterion |
|---|---|---|
| `buildGraph` reads organizations, violations, policies, and enforcement actions from PostgreSQL and populates `InMemoryGraph`. | Read a consistent PostgreSQL source snapshot, then write idempotent `MERGE` node/relationship statements to a named FalkorDB graph. | A rebuilt graph is queryable after worker restart; no process-local graph data is used. |
| `GetNeighbors` filters an in-memory adjacency list. | Execute parameterized Cypher `MATCH` queries with an allow-listed relationship type. | Query fails with 503 if FalkorDB is unreachable or rejects the query. |
| `FindPath` performs local breadth-first traversal. | Execute bounded Cypher path matching with an explicit maximum depth and query timeout. | Timeout/rejection is explicit; no locally calculated substitute path is returned. |
| `rebuildHandler` starts a goroutine and immediately reports success. | Submit a durable rebuild job or synchronously acknowledge only after the snapshot boundary and graph write outcome are known. | The HTTP response carries a durable job identifier or an explicit failure. |
| Health reports local graph counters. | Probe the real client/database and report dependency status separately from PostgreSQL source status. | Health is degraded/unready when FalkorDB is unavailable. |

## Implementation Work Packages

### 1. Replace the retired graph type with an explicit adapter interface

Create `internal/falkor/adapter.go` with a small interface such as `Ping`, `UpsertSnapshot`, `Neighbors`, `ShortestPath`, and `Close`. Its production implementation must construct `falkordb.FalkorDBNew` from `FALKORDB_URL`, select `NDSEP_GRAPH_NAME`, and use the named graph for every query. The configuration must require an explicit URL, graph name, username/password or TLS credential source where the deployment requires authentication, connect timeout, and per-query timeout. Startup must fail if the client cannot connect or the selected graph cannot be probed.

The adapter should expose a typed `Unavailable` error that HTTP handlers map to 503. Database response decoding and Cypher parse/query failures must map to non-success errors rather than empty nodes, empty paths, or zero counts.

### 2. Implement idempotent, parameterized snapshot writes

Map the existing PostgreSQL source rows to the current labels: `Organization`, `Sector`, `Violation`, `Policy`, `EnforcementAction`, and their relationships. Use `MERGE` statements keyed by a stable domain identifier, set only validated properties, and write relationship weights as numeric parameters. The query documentation recommends parameterized queries both to reuse plans and to prevent Cypher injection.[2] Labels and relationship types cannot be user supplied; keep them in an internal enum/allow-list.

A rebuild needs a consistency rule. The first implementation should assign a unique `snapshot_id` to every `MERGE`, complete all writes, validate mandatory node/edge counts, then remove only stale entities from the preceding snapshot. It must not call `GRAPH.DELETE` or clear the live graph before the next graph image has passed validation. For higher assurance, use a versioned graph name and atomically switch the configured active graph after a successful validation pass.

### 3. Implement query endpoints against FalkorDB, not application memory

The neighbor operation should use an allow-listed relationship type and a parameterized query such as `MATCH (n {id: $node_id})-[r:REL]->(m) RETURN m, r`. The path operation should use a bounded variable-length path with a fixed, validated maximum depth. FalkorDB supports per-query timeouts and reports an error when a query exceeds the configured timeout.[2] Handler responses must preserve that distinction as 503/504, never return an empty graph result as if the graph had no relationships.

### 4. Add a durable rebuild orchestration contract

Replace the current background goroutine with a Temporal workflow or another existing durable job mechanism. The workflow should: establish the PostgreSQL snapshot watermark, run the FalkorDB upserts, validate expected counts and mandatory relationship classes, mark the snapshot active, and emit a durable event only after the graph is valid. A restart must resume/retry the job or report it failed; it must never infer completion from an in-memory counter.

### 5. Provision production FalkorDB correctly

Add a `falkordb` service to the production topology using the production-focused `falkordb/falkordb-server` image. Mount persistent storage at `/var/lib/falkordb/data`, enable the approved durability mode, and set authentication/TLS according to the deployed network boundary. FalkorDB’s operations documentation recommends the server image for production and identifies persistence, replication, and cluster configuration as production responsibilities.[3]

Readiness must execute a real client probe, and liveness must remain distinct from readiness. Backups, restore drills, retention, resource limits, query-timeout defaults, metrics, and alerts for connection loss, rebuild failures, and query errors are release prerequisites. A standalone replica setup is not automatic failover; if high availability is required, use an appropriate cluster manager, Sentinel-style configuration, or a managed deployment.[3]

## Required Tests

| Test layer | Required evidence |
|---|---|
| Unit | URL/config validation; dependency-unavailable errors; relationship allow-list; Cypher parameter construction; response decoding; no empty-success conversion. |
| Integration | A real FalkorDB container or managed test instance; create/read/update relationship round trips; timeout behavior; rejected writes; authentication failure; restart persistence. |
| Rebuild | PostgreSQL fixture snapshot produces expected labels/edges; validation rejects partial writes; stale-snapshot cleanup is correct; restart/retry preserves status. |
| Outage | Kill or firewall FalkorDB during neighbor/path/rebuild requests; all callers receive explicit 503/504 and no local graph answer. |
| End-to-end | Rebuild through the durable workflow, query through the public worker endpoint, restart worker and graph database, then repeat query with the same durable result. |

## Release Gate

The retired worker may be re-enabled only when all listed tests pass against a real FalkorDB instance, the worker has no `InMemoryGraph` runtime path, the deployment has persistent storage and an authenticated connectivity path, and outage tests prove that graph service loss returns explicit failure instead of a plausible local result.

## References

[1]: https://docs.falkordb.com/getting-started/clients.html "FalkorDB official client libraries"
[2]: https://docs.falkordb.com/commands/graph.query.html "FalkorDB GRAPH.QUERY and parameterized queries"
[3]: https://docs.falkordb.com/operations/ "FalkorDB production operations"
[4]: https://github.com/FalkorDB/falkordb-go "falkordb-go official client README"
