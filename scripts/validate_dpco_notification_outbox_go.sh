#!/usr/bin/env bash
# Build and validate the durable DPCO notification outbox. This script never deploys.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
go_root="$root/orchestration/go"
service="dpco_notification_outbox_service"
output_dir="${DPCO_OUTBOX_BUILD_DIR:-/tmp/ndsep-dpco-outbox-build}"
build_container=false

usage() {
  cat <<'USAGE'
Usage: scripts/validate_dpco_notification_outbox_go.sh [--with-container]

Required: Go 1.22 or newer. The optional container build additionally requires Docker.
Artifacts are written to /tmp by default and are never staged or committed.
USAGE
}

while (($#)); do
  case "$1" in
    --with-container) build_container=true ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

command -v go >/dev/null || { echo "Go 1.22+ is required" >&2; exit 69; }
command -v awk >/dev/null || { echo "awk is required" >&2; exit 69; }
version="$(go env GOVERSION | sed 's/^go//')"
major_minor="$(printf '%s' "$version" | awk -F. '{print $1 "." $2}')"
awk -v actual="$major_minor" 'BEGIN { exit !(actual + 0 >= 1.22) }' || {
  echo "Go 1.22+ required; found $(go version)" >&2
  exit 69
}

mkdir -p "$output_dir"
cd "$go_root"

echo '== Go dependency resolution =='
go mod download
go mod verify

echo '== Targeted static checks =='
go vet ./internal/dpconotificationoutbox ./cmd/dpco_notification_outbox_service

echo '== Targeted tests and compilation =='
go test -count=1 ./internal/dpconotificationoutbox ./cmd/dpco_notification_outbox_service
go build -trimpath -buildvcs=false -o "$output_dir/dpco_notification_outbox_service" \
  ./cmd/dpco_notification_outbox_service/main.go

if "$build_container"; then
  command -v docker >/dev/null || { echo "Docker is required for --with-container" >&2; exit 69; }
  echo '== Container build =='
  docker build \
    --build-arg SERVICE="$service" \
    --tag "ndsep/dpco-notification-outbox:validation" \
    "$go_root"
fi

printf 'OUTBOX_GO_VALIDATION=PASS\nartifact=%s\n' "$output_dir/dpco_notification_outbox_service"
