#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
COMPOSE_FILE=${FALKORDB_COMPOSE_FILE:-"$ROOT_DIR/infra/integration/docker-compose.falkordb-integration.yml"}
PROJECT_NAME=${COMPOSE_PROJECT_NAME:-"ndsep-falkor-it-${CI_PIPELINE_ID:-local}"}
GRAPH_NAME=${FALKORDB_GRAPH_NAME:-ndsep_integration}

if [ -z "${FALKORDB_PASSWORD:-}" ]; then
  if command -v openssl >/dev/null 2>&1; then
    FALKORDB_PASSWORD=$(openssl rand -base64 36 | tr -d '\n')
    export FALKORDB_PASSWORD
  else
    echo "FALKORDB_PASSWORD must be set when openssl is unavailable" >&2
    exit 2
  fi
fi
export FALKORDB_GRAPH_NAME=$GRAPH_NAME
export COMPOSE_PROJECT_NAME=$PROJECT_NAME

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

request() {
  payload=$1
  compose exec -T runner curl -sS -o /tmp/response.json -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    --data "$payload" \
    http://graph-worker:8090/query
}

expect_status() {
  expected=$1
  actual=$2
  description=$3
  if [ "$actual" != "$expected" ]; then
    echo "$description: expected HTTP $expected, got $actual" >&2
    compose logs --no-color >&2 || true
    exit 1
  fi
}

compose up -d --wait

# The test uses a dedicated graph and deletes only its own nodes.
run_graph_query() {
  query=$1
  compose exec -T falkordb sh -ec 'REDISCLI_AUTH="$FALKORDB_PASSWORD" redis-cli GRAPH.QUERY "$1" "$2"' sh "$GRAPH_NAME" "$query"
}

# The test uses a dedicated graph and deletes only its own nodes.
run_graph_query 'MATCH (n) DETACH DELETE n' >/dev/null
run_graph_query "CREATE (org:Organization {id: 'org:42', name: 'Acme Data', status: 'active'}), (sector:Sector {id: 'sector:finance', name: 'finance'}), (violation:Violation {id: 'violation:7', severity: 'high'}), (policy:Policy {id: 'policy:5', status: 'active'}), (org)-[:BELONGS_TO]->(sector), (org)-[:HAS_VIOLATION]->(violation), (policy)-[:APPLIES_TO_SECTOR]->(sector)" >/dev/null

health=$(compose exec -T runner curl -sS -o /tmp/health.json -w '%{http_code}' http://graph-worker:8090/health)
expect_status 200 "$health" "initial graph-worker health"

a=$(request '{"query_type":"neighbors","node_id":"org:42","relation":"HAS_VIOLATION"}')
expect_status 200 "$a" "neighbor query"
compose exec -T runner cat /tmp/response.json | grep -q 'violation:7'

b=$(request '{"query_type":"path","from_id":"policy:5","to_id":"violation:7","max_depth":4}')
expect_status 200 "$b" "path query"
compose exec -T runner cat /tmp/response.json | grep -q 'policy:5'
compose exec -T runner cat /tmp/response.json | grep -q 'violation:7'

c=$(request '{"query_type":"neighbors","node_id":"org:42\u0027}) MATCH (n) DETACH DELETE n //","relation":"HAS_VIOLATION"}')
expect_status 200 "$c" "parameter-injection probe"
d=$(request '{"query_type":"neighbors","node_id":"org:42","relation":"HAS_VIOLATION; MATCH (n)"}')
expect_status 400 "$d" "relationship allow-list probe"
e=$(request '{"query_type":"path","from_id":"policy:5","to_id":"violation:7","max_depth":9}')
expect_status 400 "$e" "path-depth cap probe"

compose restart falkordb
compose up -d --wait falkordb graph-worker
f=$(request '{"query_type":"neighbors","node_id":"org:42","relation":"HAS_VIOLATION"}')
expect_status 200 "$f" "persistence verification"
compose exec -T runner cat /tmp/response.json | grep -q 'violation:7'

compose stop falkordb
g=$(request '{"query_type":"neighbors","node_id":"org:42","relation":"HAS_VIOLATION"}')
expect_status 503 "$g" "dependency outage verification"

compose start falkordb
compose up -d --wait falkordb graph-worker
h=$(request '{"query_type":"path","from_id":"policy:5","to_id":"violation:7","max_depth":4}')
expect_status 200 "$h" "dependency recovery verification"

echo "FalkorDB real-server round-trip integration passed"
