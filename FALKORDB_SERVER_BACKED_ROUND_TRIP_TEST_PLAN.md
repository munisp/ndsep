# FalkorDB Server-Backed Round-Trip Integration Plan

## Purpose

This plan validates the NDSEP FalkorDB worker against a **real FalkorDB server**, rather than a mocked client or in-memory graph. It verifies live parameterized neighbor queries, bounded shortest-path traversal, persistence across restart, authentication, and fail-closed behavior when the graph dependency disappears.

The worker uses the official Go client and the RESP endpoint. FalkorDB documents the `falkordb/falkordb-server` image for production-oriented server deployments, port `6379` for the server, `REDIS_ARGS` for password/AOF configuration, and `redis-cli ping` as the container health check.[1] The server data directory is `/var/lib/falkordb/data`, and a named volume plus AOF is required for restart-persistence validation.[2]

## Required Deployment Fixture

Create `docker-compose.falkordb-integration.yml` outside production topology or as a CI-only override. The graph port is exposed only to the test runner network; production deployments should use `expose` rather than a public port.

```yaml
services:
  falkordb:
    image: falkordb/falkordb-server:<PINNED_VERSION>
    command: >-
      falkordb-server
      --requirepass ${FALKORDB_PASSWORD}
      --appendonly yes
      --appendfsync everysec
    volumes:
      - falkordb_integration_data:/var/lib/falkordb/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a $$FALKORDB_PASSWORD ping | grep -qx PONG"]
      interval: 5s
      timeout: 3s
      retries: 20
    networks: [falkor-test]

  graph-worker:
    build:
      context: .
      dockerfile: workers/go/cmd/falkordb_kg_worker/Dockerfile
    environment:
      FALKORDB_URL: redis://:${FALKORDB_PASSWORD}@falkordb:6379
      FALKORDB_GRAPH_NAME: ndsep_integration
      FALKORDB_QUERY_TIMEOUT_MS: "3000"
      PORT: "8090"
    depends_on:
      falkordb:
        condition: service_healthy
    networks: [falkor-test]

  runner:
    image: curlimages/curl:<PINNED_VERSION>
    depends_on:
      graph-worker:
        condition: service_started
    networks: [falkor-test]

networks:
  falkor-test:
    internal: true

volumes:
  falkordb_integration_data:
```

The CI environment must inject a randomly generated `FALKORDB_PASSWORD`; it must never use a repository default or an ordinary production secret. The production image version must be pinned by immutable version or digest.

## Seed Contract

Before exercising the worker, seed one deterministic graph directly through `redis-cli` or a minimal Go seeder using the same official client. The fixture uses stable `id` properties because the worker queries those properties.

```cypher
CREATE
  (org:Organization {id: 'org:42', name: 'Acme Data', status: 'active'}),
  (sector:Sector {id: 'sector:finance', name: 'finance'}),
  (violation:Violation {id: 'violation:7', severity: 'high'}),
  (policy:Policy {id: 'policy:5', status: 'active'}),
  (org)-[:BELONGS_TO]->(sector),
  (org)-[:HAS_VIOLATION]->(violation),
  (policy)-[:APPLIES_TO_SECTOR]->(sector);
```

The seeder must perform an idempotent cleanup (`MATCH (n) DETACH DELETE n`) only inside the dedicated `ndsep_integration` graph before inserting the fixture. It must then verify the expected node and relationship counts.

## Round-Trip Assertions

The job runs the following steps in order. Every response body and status must be retained as a CI artifact.

| Step | Request or action | Expected result |
|---|---|---|
| 1 | Poll `GET /health` | HTTP 200, `status=ready`, `graph_backend=falkordb`. |
| 2 | Seed graph | Graph has 4 nodes and 3 relationships. |
| 3 | `POST /query` with `{"query_type":"neighbors","node_id":"org:42","relation":"HAS_VIOLATION"}` | HTTP 200, exactly `violation:7`, no unrelated node. |
| 4 | `POST /query` with `{"query_type":"path","from_id":"policy:5","to_id":"violation:7","max_depth":4}` | HTTP 200 and ordered path `policy:5 → sector:finance → org:42 → violation:7`. |
| 5 | Injection probe | Use a node ID such as `org:42'}) MATCH (n) DETACH DELETE n //`; expect HTTP 200 with no match or a bounded client error, and verify the seed graph remains unchanged. |
| 6 | Relation probe | Use `HAS_VIOLATION; MATCH (n)`; expect HTTP 400 from the allow-list. |
| 7 | Depth probe | Use `max_depth:9`; expect HTTP 400. |
| 8 | Persistence | Restart only the FalkorDB container, wait for health, repeat steps 3 and 4; results must be unchanged. |
| 9 | Dependency outage | Stop FalkorDB, then call `/health`, neighbor, and path endpoints; each must return explicit HTTP 503 and must not return cached graph data. |
| 10 | Recovery | Restart FalkorDB, wait for health, and repeat steps 3 and 4 successfully. |

## Automated Runner Shape

The pipeline must use an isolated Compose project name and clean the named volume only in test environments.

```bash
set -euo pipefail
export COMPOSE_PROJECT_NAME=ndsep-falkor-it-${CI_PIPELINE_ID:-local}
export FALKORDB_PASSWORD="$(openssl rand -base64 36)"
docker compose -f docker-compose.falkordb-integration.yml up -d --wait
./scripts/falkordb-seed-integration-graph.sh
go test ./workers/go/cmd/falkordb_kg_worker -run 'TestServerBackedRoundTrip' -count=1 -v
docker compose -f docker-compose.falkordb-integration.yml stop falkordb
./scripts/falkordb-assert-outage.sh
docker compose -f docker-compose.falkordb-integration.yml start falkordb
./scripts/falkordb-assert-recovery.sh
docker compose -f docker-compose.falkordb-integration.yml down -v
```

The proposed `TestServerBackedRoundTrip` must run only when `FALKORDB_INTEGRATION=1`; ordinary unit tests remain hermetic and do not require Docker. CI should preserve Compose logs, worker logs, request/response artifacts, and a final `GRAPH.QUERY` count check whenever a round-trip step fails.

## Pass and Fail Criteria

The integration job passes only if every query is served from the real FalkorDB container, persistence survives a restart, invalid graph inputs do not change graph state, and dependency loss produces 503 responses with no graph payload. A query, health check, or path response that succeeds while FalkorDB is stopped is a **release-blocking fail-open defect**.

## Operational Prerequisites

The target runner must support Docker bridge networking, named volumes, and outbound image retrieval, and must provide sufficient memory for FalkorDB plus the worker. The current sandbox lacks the required Docker bridge/iptables support, so this exact job must run in CI, a development workstation, or a persistent deployment runner with a functional Docker daemon.

## References

[1]: https://docs.falkordb.com/operations/docker.html "FalkorDB Docker and Compose operations"

[2]: https://docs.falkordb.com/operations/durability/persistence.html "FalkorDB persistence on Docker"

[3]: https://docs.falkordb.com/getting-started/clients.html "Official FalkorDB client libraries"
