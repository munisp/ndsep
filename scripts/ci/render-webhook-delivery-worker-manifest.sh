#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
template="$repo_root/infra/k8s/webhook-delivery-worker.yaml.tmpl"
output="${1:-${NDSEP_WEBHOOK_DELIVERY_MANIFEST_OUTPUT:-}}"
image="${NDSEP_WEBHOOK_DELIVERY_IMAGE:-}"

if [[ -z "$output" ]]; then
  echo "usage: NDSEP_WEBHOOK_DELIVERY_IMAGE=ghcr.io/munisp/ndsep@sha256:<64-hex> $0 /absolute/path/to/rendered.yaml" >&2
  exit 64
fi
if [[ "$output" != /* ]]; then
  echo "output path must be absolute" >&2
  exit 64
fi
if [[ ! "$image" =~ ^ghcr\.io/munisp/ndsep@sha256:[a-f0-9]{64}$ ]]; then
  echo "NDSEP_WEBHOOK_DELIVERY_IMAGE must be an approved immutable ghcr.io/munisp/ndsep@sha256:<64-lowercase-hex> reference" >&2
  exit 64
fi
if [[ ! -f "$template" ]]; then
  echo "deployment template is missing: $template" >&2
  exit 66
fi

mkdir -p "$(dirname "$output")"
sed "s|\${NDSEP_WEBHOOK_DELIVERY_IMAGE}|${image}|g" "$template" > "$output"
if grep -Fq '${NDSEP_WEBHOOK_DELIVERY_IMAGE}' "$output"; then
  echo "unresolved deployment image token" >&2
  exit 65
fi

grep -Fq "image: $image" "$output" || {
  echo "rendered manifest does not contain the approved immutable image reference" >&2
  exit 65
}
printf 'rendered_webhook_delivery_worker_manifest=%s\n' "$output"
