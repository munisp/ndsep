#!/usr/bin/env bash
set -euo pipefail

# Staging-only mTLS callback policy validation. No funds are moved.
: "${STAGING_CONTEXT:?Exact staging kubectl context is required}"
: "${STAGING_NAMESPACE:?Staging namespace is required}"
: "${CALLBACK_URL:?Staging callback URL is required}"
: "${CALLBACK_SERVER_CA:?Callback server CA PEM is required}"
: "${PROVIDER_CLIENT_CERT:?Approved staging provider client certificate is required}"
: "${PROVIDER_CLIENT_KEY:?Approved staging provider client private key is required}"
: "${WRONG_CLIENT_CERT:?Untrusted/wrong-subject staging client certificate is required}"
: "${WRONG_CLIENT_KEY:?Untrusted/wrong-subject staging client key is required}"
: "${VALID_HMAC:?Valid staging HMAC for the fixture is required}"
: "${INVALID_HMAC:?Invalid HMAC fixture is required}"
: "${CALLBACK_FIXTURE:?Callback JSON fixture is required}"
: "${EXPECTED_SUBJECT_DN:?Expected staging provider subject DN is required}"

command -v kubectl >/dev/null || { echo 'kubectl is required' >&2; exit 1; }
command -v curl >/dev/null || { echo 'curl is required' >&2; exit 1; }
command -v openssl >/dev/null || { echo 'openssl is required' >&2; exit 1; }
[[ "$(kubectl config current-context)" == "$STAGING_CONTEXT" ]] || { echo 'wrong kubectl context' >&2; exit 1; }
[[ -s "$CALLBACK_FIXTURE" ]] || { echo 'fixture is empty' >&2; exit 1; }

OUT="${OUT:-/tmp/ndsep-mtls-staging-$(date -u +%Y%m%dT%H%M%SZ).log}"
exec > >(tee "$OUT") 2>&1

printf 'target_context=%s namespace=%s callback=%s\n' "$STAGING_CONTEXT" "$STAGING_NAMESPACE" "$CALLBACK_URL"
printf '\n== Certificate inspection ==\n'
openssl x509 -in "$PROVIDER_CLIENT_CERT" -noout -subject -issuer -dates
actual_subject="$(openssl x509 -in "$PROVIDER_CLIENT_CERT" -noout -subject -nameopt RFC2253 | sed 's/^subject=//')"
[[ "$actual_subject" == "$EXPECTED_SUBJECT_DN" ]] || { echo "FAIL: approved certificate subject mismatch"; exit 1; }

printf '\n== Kubernetes ingress and policy assertions ==\n'
kubectl -n "$STAGING_NAMESPACE" get ingress ndsep-mojaloop-callback -o jsonpath='{.metadata.annotations.nginx\.ingress\.kubernetes\.io/auth-tls-verify-client}{"\n"}'
kubectl -n "$STAGING_NAMESPACE" get ingress ndsep-mojaloop-callback -o jsonpath='{.spec.tls[0].hosts[0]}{"\n"}'
kubectl -n "$STAGING_NAMESPACE" get networkpolicy ndsep-api-callback-ingress-only -o jsonpath='{.metadata.name}{"\n"}'
kubectl -n "$STAGING_NAMESPACE" get secret mojaloop-client-ca -o jsonpath='{.metadata.name}{"\n"}'

printf '\n== MTLS-01 valid certificate + valid HMAC ==\n'
status="$(curl --silent --show-error --max-time 15 -o /tmp/mtls-positive.json -w '%{http_code}' \
  --cert "$PROVIDER_CLIENT_CERT" --key "$PROVIDER_CLIENT_KEY" --cacert "$CALLBACK_SERVER_CA" \
  -H 'content-type: application/json' -H "x-mojaloop-signature: $VALID_HMAC" \
  --data-binary "@$CALLBACK_FIXTURE" "$CALLBACK_URL")"
printf 'http_status=%s expected=2xx-or-idempotent-success\n' "$status"
[[ "$status" =~ ^2 ]] || { echo 'FAIL MTLS-01'; exit 1; }

printf '\n== MTLS-02 no client certificate ==\n'
status="$(curl --silent --show-error --max-time 15 -o /tmp/mtls-no-cert.json -w '%{http_code}' \
  --cacert "$CALLBACK_SERVER_CA" -H 'content-type: application/json' \
  -H "x-mojaloop-signature: $VALID_HMAC" --data-binary "@$CALLBACK_FIXTURE" "$CALLBACK_URL" || true)"
printf 'http_status=%s expected=tls-failure-or-4xx\n' "$status"
[[ -z "$status" || "$status" =~ ^4 ]] || { echo 'FAIL MTLS-02'; exit 1; }

printf '\n== MTLS-03 wrong/untrusted client certificate ==\n'
status="$(curl --silent --show-error --max-time 15 -o /tmp/mtls-wrong-cert.json -w '%{http_code}' \
  --cert "$WRONG_CLIENT_CERT" --key "$WRONG_CLIENT_KEY" --cacert "$CALLBACK_SERVER_CA" \
  -H 'content-type: application/json' -H "x-mojaloop-signature: $VALID_HMAC" \
  --data-binary "@$CALLBACK_FIXTURE" "$CALLBACK_URL" || true)"
printf 'http_status=%s expected=tls-failure-or-4xx\n' "$status"
[[ -z "$status" || "$status" =~ ^4 ]] || { echo 'FAIL MTLS-03'; exit 1; }

printf '\n== MTLS-04 valid certificate + invalid HMAC ==\n'
status="$(curl --silent --show-error --max-time 15 -o /tmp/mtls-invalid-hmac.json -w '%{http_code}' \
  --cert "$PROVIDER_CLIENT_CERT" --key "$PROVIDER_CLIENT_KEY" --cacert "$CALLBACK_SERVER_CA" \
  -H 'content-type: application/json' -H "x-mojaloop-signature: $INVALID_HMAC" \
  --data-binary "@$CALLBACK_FIXTURE" "$CALLBACK_URL")"
printf 'http_status=%s expected=401\n' "$status"
[[ "$status" == 401 ]] || { echo 'FAIL MTLS-04'; exit 1; }

printf '\n== MTLS-05 public-host identity-header spoof test ==\n'
: "${PUBLIC_API_URL:?Public staging API URL is required}"
status="$(curl --silent --show-error --max-time 15 -o /tmp/mtls-spoofed-header.json -w '%{http_code}' \
  --cacert "$CALLBACK_SERVER_CA" --header 'X-NDSEP-mTLS-Verified: SUCCESS' \
  --header "X-NDSEP-mTLS-Subject: $EXPECTED_SUBJECT_DN" \
  -H 'content-type: application/json' -H "x-mojaloop-signature: $VALID_HMAC" \
  --data-binary "@$CALLBACK_FIXTURE" "$PUBLIC_API_URL/api/mojaloop/test-reference" || true)"
printf 'http_status=%s expected=401-or-403\n' "$status"
[[ "$status" == 401 || "$status" == 403 ]] || { echo 'FAIL MTLS-05'; exit 1; }

printf '\n== MTLS-06 pseudo-header + X-Forwarded-For override on public ingress ==\n'
status="$(curl --silent --show-error --max-time 15 -o /tmp/mtls-forwarded-spoof.json -w '%{http_code}' \
  --cacert "$CALLBACK_SERVER_CA" \
  -H 'X-NDSEP-mTLS-Verified: SUCCESS' \
  -H "X-NDSEP-mTLS-Subject: $EXPECTED_SUBJECT_DN" \
  -H 'X-NDSEP-mTLS-Issuer: CN=Approved-CA' \
  -H 'X-Forwarded-For: 127.0.0.1, 10.0.0.7' \
  -H 'X-Real-IP: 10.0.0.7' \
  -H 'content-type: application/json' -H "x-mojaloop-signature: $VALID_HMAC" \
  --data-binary "@$CALLBACK_FIXTURE" "$PUBLIC_API_URL/api/mojaloop/test-reference" || true)"
printf 'http_status=%s expected=401-or-403\n' "$status"
[[ "$status" == 401 || "$status" == 403 ]] || { echo 'FAIL MTLS-06'; exit 1; }

printf '\n== Log assertions ==\n'
kubectl -n "$STAGING_NAMESPACE" logs -l app=ndsep-api --since=15m --all-containers=true | tee /tmp/ndsep-mtls-api.log
for marker in 'mTLS' 'callback' 'signature'; do
  grep -qi "$marker" /tmp/ndsep-mtls-api.log || echo "WARN: expected log marker not found: $marker"
done
printf '\nPASS: staging mTLS policy matrix completed; no funds mutation was authorized by this script.\nlog=%s\n' "$OUT"
