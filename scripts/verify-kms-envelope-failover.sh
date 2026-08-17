#!/usr/bin/env bash
set -euo pipefail
: "${PRIMARY_REGION:?}" "${SECONDARY_REGION:?}" "${PRIMARY_KEY_ID:?}" "${SECONDARY_KEY_ID:?}"
workdir="$(mktemp -d)"; trap 'rm -rf "$workdir"' EXIT
openssl rand 32 > "$workdir/plain.bin"; sha256sum "$workdir/plain.bin" > "$workdir/plain.sha256"

# Envelope/ciphertext is created with the primary replica; no production payload is used.
aws kms encrypt --region "$PRIMARY_REGION" --key-id "$PRIMARY_KEY_ID" --plaintext "fileb://$workdir/plain.bin" --output json > "$workdir/primary.json"
jq -r .CiphertextBlob "$workdir/primary.json" | base64 --decode > "$workdir/primary.blob"
# Re-encrypt to secondary replica without exposing plaintext outside KMS.
aws kms re-encrypt --region "$PRIMARY_REGION" --ciphertext-blob "fileb://$workdir/primary.blob" --source-key-id "$PRIMARY_KEY_ID" --destination-key-id "$SECONDARY_KEY_ID" --destination-encryption-context Environment=staging,Drill=failover --output json > "$workdir/secondary.json"
jq -r .CiphertextBlob "$workdir/secondary.json" | base64 --decode > "$workdir/secondary.blob"
aws kms decrypt --region "$SECONDARY_REGION" --ciphertext-blob "fileb://$workdir/secondary.blob" --encryption-context Environment=staging,Drill=failover --output json | jq -r .Plaintext | base64 --decode > "$workdir/recovered.bin"
sha256sum --check "$workdir/plain.sha256" --status --strict --ignore-missing || { echo "FAIL: recovered ciphertext differs" >&2; exit 1; }
echo "PASS: secondary-region KMS replica re-encryption and decrypt verification succeeded"
