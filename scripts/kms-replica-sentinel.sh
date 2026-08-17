#!/usr/bin/env bash
set -euo pipefail
: "${PRIMARY_REGION:?}" "${SECONDARY_REGION:?}" "${PRIMARY_KEY_ID:?}" "${SECONDARY_KEY_ID:?}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
printf 'idlr-staging-sentinel:%s' "$(date -u +%FT%TZ)" > "$tmp/plain"
aws kms encrypt --region "$PRIMARY_REGION" --key-id "$PRIMARY_KEY_ID" --plaintext "fileb://$tmp/plain" --output json > "$tmp/a.json"
jq -r .CiphertextBlob "$tmp/a.json" | base64 --decode > "$tmp/a.blob"
aws kms re-encrypt --region "$PRIMARY_REGION" --ciphertext-blob "fileb://$tmp/a.blob" --destination-key-id "$SECONDARY_KEY_ID" --destination-encryption-context Environment=staging,Probe=kms-replica --output json > "$tmp/b.json"
jq -r .CiphertextBlob "$tmp/b.json" | base64 --decode > "$tmp/b.blob"
aws kms decrypt --region "$SECONDARY_REGION" --ciphertext-blob "fileb://$tmp/b.blob" --encryption-context Environment=staging,Probe=kms-replica --output json | jq -r .Plaintext | base64 --decode > "$tmp/out"
cmp --silent "$tmp/plain" "$tmp/out" && echo 'idlr_kms_replica_sentinel_success 1' || { echo 'idlr_kms_replica_sentinel_success 0'; exit 1; }
