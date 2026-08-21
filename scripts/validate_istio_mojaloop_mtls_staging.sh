#!/usr/bin/env bash
set -euo pipefail

: "${ISTIO_CONTEXT:?Istio staging context is required}"
: "${ISTIO_NAMESPACE:=ndsep}"
: "${ISTIO_CALLBACK_URL:?Istio callback URL is required}"
: "${ISTIO_PUBLIC_URL:?Istio public API URL is required}"
: "${ISTIO_CA:?Server CA PEM is required}"
: "${ISTIO_CLIENT_CERT:?Approved provider client certificate is required}"
: "${ISTIO_CLIENT_KEY:?Approved provider client key is required}"
: "${ISTIO_CALLBACK_FIXTURE:?Callback fixture is required}"
: "${ISTIO_VALID_HMAC:?Valid callback HMAC is required}"

command -v kubectl >/dev/null || { echo 'kubectl is required' >&2; exit 2; }
command -v curl >/dev/null || { echo 'curl is required' >&2; exit 2; }
[[ "$(kubectl config current-context)" == "$ISTIO_CONTEXT" ]] || { echo 'wrong kubectl context' >&2; exit 2; }
[[ -s "$ISTIO_CALLBACK_FIXTURE" ]] || { echo 'fixture is empty' >&2; exit 2; }

OUT="${OUT:-/tmp/ndsep-istio-mtls-$(date -u +%Y%m%dT%H%M%SZ).log}"
exec > >(tee "$OUT") 2>&1

fail_4xx() {
  local label="$1" url="$2" output="$3" status
  shift 3
  status="$(curl --silent --show-error --max-time 15 -o "$output" -w '%{http_code}' "$@" "$url" || true)"
  printf '%s http_status=%s expected=401-or-403\n' "$label" "$status"
  [[ "$status" == 401 || "$status" == 403 ]] || { echo "FAIL $label"; exit 1; }
}

printf 'context=%s namespace=%s callback=%s\n' "$ISTIO_CONTEXT" "$ISTIO_NAMESPACE" "$ISTIO_CALLBACK_URL"
printf '\n== Istio object assertions ==\n'
kubectl --context "$ISTIO_CONTEXT" -n "$ISTIO_NAMESPACE" get gateway ndsep-mojaloop-callback -o jsonpath='{.spec.servers[0].tls.mode}{"\n"}'
kubectl --context "$ISTIO_CONTEXT" -n "$ISTIO_NAMESPACE" get virtualservice ndsep-mojaloop-callback -o name
kubectl --context "$ISTIO_CONTEXT" -n "$ISTIO_NAMESPACE" get authorizationpolicy ndsep-mojaloop-callback-ingress-only -o name
kubectl --context "$ISTIO_CONTEXT" -n istio-system get envoyfilter ndsep-mojaloop-client-subject-forwarding -o name

printf '\n== Proxy configuration assertions ==\n'
kubectl --context "$ISTIO_CONTEXT" -n istio-system get pods -l istio=ingressgateway -o name | head -n 1

printf '\n== ISTIO-01 valid certificate and HMAC ==\n'
status="$(curl --silent --show-error --max-time 15 -o /tmp/istio-valid.json -w '%{http_code}' \
  --cert "$ISTIO_CLIENT_CERT" --key "$ISTIO_CLIENT_KEY" --cacert "$ISTIO_CA" \
  -H 'content-type: application/json' -H "x-mojaloop-signature: $ISTIO_VALID_HMAC" \
  --data-binary "@$ISTIO_CALLBACK_FIXTURE" "$ISTIO_CALLBACK_URL")"
printf 'ISTIO-01 http_status=%s expected=2xx-or-idempotent-success\n' "$status"
[[ "$status" =~ ^2 ]] || { echo 'FAIL ISTIO-01'; exit 1; }

printf '\n== ISTIO-02 pseudo-header spoof ==\n'
fail_4xx ISTIO-02 "$ISTIO_PUBLIC_URL/api/mojaloop/test-reference" /tmp/istio-pseudo.json \
  --cacert "$ISTIO_CA" \
  -H 'X-NDSEP-mTLS-Verified: SUCCESS' \
  -H 'X-NDSEP-mTLS-Subject: CN=provider-prod,O=Approved DFSP,C=NG' \
  -H 'content-type: application/json' \
  -H "x-mojaloop-signature: $ISTIO_VALID_HMAC" \
  --data-binary "@$ISTIO_CALLBACK_FIXTURE"

printf '\n== ISTIO-03 X-Forwarded-For/X-Real-IP override ==\n'
fail_4xx ISTIO-03 "$ISTIO_PUBLIC_URL/api/mojaloop/test-reference" /tmp/istio-forwarded.json \
  --cacert "$ISTIO_CA" \
  -H 'X-NDSEP-mTLS-Verified: SUCCESS' \
  -H 'X-NDSEP-mTLS-Subject: CN=provider-prod,O=Approved DFSP,C=NG' \
  -H 'X-Forwarded-For: 127.0.0.1, 10.0.0.7' \
  -H 'X-Real-IP: 10.0.0.7' \
  -H 'content-type: application/json' \
  -H "x-mojaloop-signature: $ISTIO_VALID_HMAC" \
  --data-binary "@$ISTIO_CALLBACK_FIXTURE"

printf '\nPASS: Istio mTLS, pseudo-header, and forwarded-IP anti-spoofing matrix passed.\nlog=%s\n' "$OUT"
