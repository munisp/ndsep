#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NDSEP Orchestration Layer — Start & Health-Check Script
# Usage: ./scripts/start-orchestration.sh [--check-only] [--service <name>]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()  { echo -e "${RED}✘${RESET}  $*"; }
info() { echo -e "${CYAN}ℹ${RESET}  $*"; }
hdr()  { echo -e "\n${BOLD}$*${RESET}"; }

# ── Service definitions ───────────────────────────────────────────────────────
declare -A SERVICE_PORTS=(
  [kafka]="9092"
  [redis]="6379"
  [keycloak]="8080"
  [temporal]="7233"
  [permify]="3476"
  [api-gateway]="8130"
  [iam-service]="8150"
  [event-bus]="8160"
  [workflow-engine]="8170"
  [ml-pipeline]="8200"
  [lakehouse]="8210"
  [dapr-bindings]="8220"
  [tigerbeetle-ledger]="8240"
)

declare -A SERVICE_HEALTH=(
  [kafka]="tcp"
  [redis]="tcp"
  [keycloak]="http://localhost:8080/health/ready"
  [temporal]="tcp"
  [permify]="http://localhost:3476/healthz"
  [api-gateway]="http://localhost:8130/health"
  [iam-service]="http://localhost:8150/health"
  [event-bus]="http://localhost:8160/health"
  [workflow-engine]="http://localhost:8170/health"
  [ml-pipeline]="http://localhost:8200/health"
  [lakehouse]="http://localhost:8210/health"
  [dapr-bindings]="http://localhost:8220/health"
  [tigerbeetle-ledger]="http://localhost:8240/health"
)

CHECK_ONLY=false
TARGET_SERVICE=""

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only) CHECK_ONLY=true; shift ;;
    --service)    TARGET_SERVICE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Functions ─────────────────────────────────────────────────────────────────
check_tcp() {
  local host="${1:-localhost}" port="$2"
  timeout 2 bash -c "echo >/dev/tcp/$host/$port" 2>/dev/null
}

check_http() {
  local url="$1"
  curl -sf --max-time 3 "$url" > /dev/null 2>&1
}

check_service() {
  local name="$1"
  local endpoint="${SERVICE_HEALTH[$name]:-}"
  local port="${SERVICE_PORTS[$name]:-}"

  if [[ "$endpoint" == "tcp" ]]; then
    check_tcp "localhost" "$port" && return 0 || return 1
  elif [[ "$endpoint" == http* ]]; then
    check_http "$endpoint" && return 0 || return 1
  fi
  return 1
}

wait_for_service() {
  local name="$1" max_wait="${2:-60}"
  local elapsed=0
  while ! check_service "$name"; do
    if [[ $elapsed -ge $max_wait ]]; then
      return 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 0
}

# ── Health check ──────────────────────────────────────────────────────────────
run_health_check() {
  hdr "═══ NDSEP Orchestration Health Check ═══"
  echo ""

  local all_ok=true
  local services_to_check=("${!SERVICE_PORTS[@]}")
  if [[ -n "$TARGET_SERVICE" ]]; then
    services_to_check=("$TARGET_SERVICE")
  fi

  printf "%-25s %-8s %-10s %s\n" "SERVICE" "PORT" "STATUS" "ENDPOINT"
  printf "%-25s %-8s %-10s %s\n" "-------" "----" "------" "--------"

  for name in "${services_to_check[@]}"; do
    local port="${SERVICE_PORTS[$name]:-?}"
    local endpoint="${SERVICE_HEALTH[$name]:-?}"
    if check_service "$name"; then
      printf "${GREEN}%-25s${RESET} %-8s ${GREEN}%-10s${RESET} %s\n" "$name" ":$port" "healthy" "$endpoint"
    else
      printf "${RED}%-25s${RESET} %-8s ${RED}%-10s${RESET} %s\n" "$name" ":$port" "offline" "$endpoint"
      all_ok=false
    fi
  done

  echo ""
  if $all_ok; then
    ok "All orchestration services are healthy"
    return 0
  else
    warn "Some services are offline — run 'docker compose up -d' to start them"
    return 1
  fi
}

# ── Start services ────────────────────────────────────────────────────────────
start_services() {
  hdr "═══ Starting NDSEP Orchestration Layer ═══"

  if ! command -v docker &>/dev/null; then
    err "Docker not found. Install Docker Desktop or Docker Engine first."
    exit 1
  fi

  if ! docker compose version &>/dev/null; then
    err "Docker Compose v2 not found. Update Docker Desktop or install the compose plugin."
    exit 1
  fi

  info "Starting infrastructure services (Kafka, Redis, Keycloak, Temporal, Permify)..."
  docker compose -f "$COMPOSE_FILE" up -d kafka redis keycloak temporal permify

  info "Waiting for Kafka to be ready..."
  if wait_for_service "kafka" 60; then
    ok "Kafka ready"
  else
    err "Kafka did not start within 60s"
    exit 1
  fi

  info "Waiting for Redis to be ready..."
  if wait_for_service "redis" 30; then
    ok "Redis ready"
  else
    err "Redis did not start within 30s"
    exit 1
  fi

  info "Starting NDSEP microservices..."
  docker compose -f "$COMPOSE_FILE" up -d \
    api-gateway iam-service event-bus workflow-engine \
    ml-pipeline lakehouse dapr-bindings tigerbeetle-ledger

  info "Waiting for microservices to be ready (up to 90s)..."
  local failed=()
  for svc in api-gateway iam-service event-bus workflow-engine ml-pipeline lakehouse dapr-bindings tigerbeetle-ledger; do
    if wait_for_service "$svc" 90; then
      ok "$svc ready"
    else
      warn "$svc did not respond within 90s"
      failed+=("$svc")
    fi
  done

  echo ""
  if [[ ${#failed[@]} -eq 0 ]]; then
    ok "All NDSEP orchestration services started successfully"
  else
    warn "The following services did not start: ${failed[*]}"
    warn "Check logs with: docker compose -f $COMPOSE_FILE logs <service-name>"
  fi

  echo ""
  run_health_check
}

# ── Main ──────────────────────────────────────────────────────────────────────
if $CHECK_ONLY; then
  run_health_check
else
  start_services
fi
