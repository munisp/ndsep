#!/usr/bin/env bash
# Verify that a rendered production Compose configuration uses immutable OCI digests.
# Usage: verify-production-image-lock.sh <rendered-compose.yaml>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <rendered-compose.yaml>" >&2
  exit 64
fi

compose_file=$1
if [[ ! -r "$compose_file" ]]; then
  echo "cannot read rendered Compose file: $compose_file" >&2
  exit 66
fi

invalid=0
image_count=0
line_number=0

while IFS= read -r line || [[ -n "$line" ]]; do
  line_number=$((line_number + 1))
  if [[ "$line" =~ ^[[:space:]]*build:([[:space:]]|$) ]]; then
    echo "$compose_file:$line_number: production configuration must not contain local build directives" >&2
    invalid=1
  fi

  if [[ "$line" =~ ^[[:space:]]*image:[[:space:]]*(.+)[[:space:]]*$ ]]; then
    image=${BASH_REMATCH[1]}
    image=${image%%[[:space:]]#*}
    image=${image#\"}
    image=${image%\"}
    image=${image#\'}
    image=${image%\'}
    image_count=$((image_count + 1))

    if [[ ! "$image" =~ ^[^[:space:]@]+@sha256:[a-f0-9]{64}$ ]]; then
      echo "$compose_file:$line_number: image must be an immutable lowercase OCI SHA-256 reference, found '$image'" >&2
      invalid=1
    fi
  fi
done < "$compose_file"

if [[ $image_count -eq 0 ]]; then
  echo "$compose_file: no image declarations found" >&2
  exit 65
fi

if [[ $invalid -ne 0 ]]; then
  exit 1
fi

echo "verified $image_count immutable OCI image digests in $compose_file"
