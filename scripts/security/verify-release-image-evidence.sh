#!/usr/bin/env bash
# Validate and bind scan/SBOM evidence to one immutable OCI image before signing.
# Usage:
#   verify-release-image-evidence.sh <image-name> <sha256-digest> <source-sha> \
#     <trivy-json> <cyclonedx-sbom-json> <output-evidence-json>
set -euo pipefail

if [[ $# -ne 6 ]]; then
  echo "usage: $0 <image-name> <sha256-digest> <source-sha> <trivy-json> <cyclonedx-sbom-json> <output-evidence-json>" >&2
  exit 64
fi

image_name=$1
image_digest=$2
source_sha=$3
trivy_report=$4
sbom=$5
output=$6

if [[ ! "$image_name" =~ ^[a-z0-9][a-z0-9._/-]*$ ]]; then
  echo "image name must be lowercase and untagged: '$image_name'" >&2
  exit 65
fi
if [[ ! "$image_digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "image digest must be a lowercase sha256 digest" >&2
  exit 65
fi
if [[ ! "$source_sha" =~ ^[a-f0-9]{40}$ ]]; then
  echo "source SHA must be a full lowercase Git SHA-1" >&2
  exit 65
fi
for required_file in "$trivy_report" "$sbom"; do
  if [[ ! -s "$required_file" ]]; then
    echo "required release evidence is missing or empty: $required_file" >&2
    exit 66
  fi
done

if ! jq -e 'type == "object" and (.bomFormat == "CycloneDX" or .spdxVersion != null)' "$sbom" >/dev/null; then
  echo "SBOM must be a CycloneDX or SPDX JSON document: $sbom" >&2
  exit 65
fi

high_critical_count=$(jq '[.Results[]?.Vulnerabilities[]? | select(.Severity == "HIGH" or .Severity == "CRITICAL")] | length' "$trivy_report")
if [[ "$high_critical_count" != "0" ]]; then
  echo "release image scan found $high_critical_count HIGH/CRITICAL vulnerability findings" >&2
  exit 1
fi

output_dir=$(dirname "$output")
mkdir -p "$output_dir"
trivy_sha256=$(sha256sum "$trivy_report" | awk '{print $1}')
sbom_sha256=$(sha256sum "$sbom" | awk '{print $1}')
generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
image_ref="${image_name}@${image_digest}"

jq -n \
  --arg generated_at "$generated_at" \
  --arg image_name "$image_name" \
  --arg image_digest "$image_digest" \
  --arg image_ref "$image_ref" \
  --arg source_sha "$source_sha" \
  --arg trivy_report "$trivy_report" \
  --arg trivy_sha256 "$trivy_sha256" \
  --arg sbom "$sbom" \
  --arg sbom_sha256 "$sbom_sha256" \
  --argjson high_critical_count "$high_critical_count" \
  '{schema:"ndsep.release-evidence.v1", generated_at:$generated_at, image:{name:$image_name,digest:$image_digest,reference:$image_ref}, source_sha:$source_sha, trivy:{report:$trivy_report,sha256:$trivy_sha256,high_critical_count:$high_critical_count}, sbom:{path:$sbom,sha256:$sbom_sha256}}' \
  > "$output"

echo "verified release evidence for $image_ref; output=$output"
