#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NDSEP mTLS Certificate Generator
# Generates a self-signed CA + per-service certificates for mutual TLS
# Usage: ./security/mtls/generate-certs.sh [output-dir]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CERT_DIR="${1:-./certs}"
CA_DAYS=3650     # 10 years for CA
CERT_DAYS=365    # 1 year for service certs
KEY_BITS=4096

mkdir -p "$CERT_DIR"/{ca,server,workers}

echo "=== Generating NDSEP mTLS Certificates ==="
echo "Output directory: $CERT_DIR"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Root CA
# ─────────────────────────────────────────────────────────────────────────────
echo "[1/4] Generating Root CA..."
openssl genrsa -out "$CERT_DIR/ca/ca.key" $KEY_BITS 2>/dev/null
openssl req -new -x509 -days $CA_DAYS \
  -key "$CERT_DIR/ca/ca.key" \
  -out "$CERT_DIR/ca/ca.crt" \
  -subj "/C=NG/ST=FCT/L=Abuja/O=NDSEP/OU=Security/CN=NDSEP-Root-CA"
echo "  CA certificate: $CERT_DIR/ca/ca.crt"

# ─────────────────────────────────────────────────────────────────────────────
# 2. API Server Certificate
# ─────────────────────────────────────────────────────────────────────────────
echo "[2/4] Generating API server certificate..."
openssl genrsa -out "$CERT_DIR/server/server.key" $KEY_BITS 2>/dev/null
openssl req -new \
  -key "$CERT_DIR/server/server.key" \
  -out "$CERT_DIR/server/server.csr" \
  -subj "/C=NG/ST=FCT/L=Abuja/O=NDSEP/OU=API/CN=ndsep-api"

cat > "$CERT_DIR/server/server-ext.cnf" << EOF
[req]
req_extensions = v3_req
distinguished_name = req_distinguished_name
[req_distinguished_name]
[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names
[alt_names]
DNS.1 = ndsep-api
DNS.2 = localhost
DNS.3 = *.ndsep.gov.ng
IP.1 = 127.0.0.1
EOF

openssl x509 -req -days $CERT_DAYS \
  -in "$CERT_DIR/server/server.csr" \
  -CA "$CERT_DIR/ca/ca.crt" \
  -CAkey "$CERT_DIR/ca/ca.key" \
  -CAcreateserial \
  -out "$CERT_DIR/server/server.crt" \
  -extfile "$CERT_DIR/server/server-ext.cnf" \
  -extensions v3_req 2>/dev/null
echo "  Server certificate: $CERT_DIR/server/server.crt"

# ─────────────────────────────────────────────────────────────────────────────
# 3. Worker Service Certificates (one per worker group)
# ─────────────────────────────────────────────────────────────────────────────
echo "[3/4] Generating worker certificates..."
WORKERS=(
  "compliance-engine"
  "discovery-agent"
  "dpi-engine"
  "kafka-monitor"
  "ml-prediction"
  "siem-correlator"
  "fluvio-telemetry"
  "bgp-validator"
  "residency-enforcer"
  "financial-ledger"
  "evidence-signer"
  "gitops-sync"
  "ndsep-agent"
)

for worker in "${WORKERS[@]}"; do
  mkdir -p "$CERT_DIR/workers/$worker"
  openssl genrsa -out "$CERT_DIR/workers/$worker/$worker.key" 2048 2>/dev/null
  openssl req -new \
    -key "$CERT_DIR/workers/$worker/$worker.key" \
    -out "$CERT_DIR/workers/$worker/$worker.csr" \
    -subj "/C=NG/ST=FCT/L=Abuja/O=NDSEP/OU=Workers/CN=$worker"
  openssl x509 -req -days $CERT_DAYS \
    -in "$CERT_DIR/workers/$worker/$worker.csr" \
    -CA "$CERT_DIR/ca/ca.crt" \
    -CAkey "$CERT_DIR/ca/ca.key" \
    -CAcreateserial \
    -out "$CERT_DIR/workers/$worker/$worker.crt" 2>/dev/null
  echo "  Worker cert: $CERT_DIR/workers/$worker/$worker.crt"
done

# ─────────────────────────────────────────────────────────────────────────────
# 4. Set secure permissions
# ─────────────────────────────────────────────────────────────────────────────
echo "[4/4] Setting secure file permissions..."
find "$CERT_DIR" -name "*.key" -exec chmod 600 {} \;
find "$CERT_DIR" -name "*.crt" -exec chmod 644 {} \;
find "$CERT_DIR" -name "*.csr" -exec chmod 644 {} \;
chmod 700 "$CERT_DIR/ca"

echo ""
echo "=== Certificate Generation Complete ==="
echo "CA Certificate:    $CERT_DIR/ca/ca.crt"
echo "Server Cert:       $CERT_DIR/server/server.crt"
echo "Worker Certs:      $CERT_DIR/workers/*/"
echo ""
echo "Next steps:"
echo "  1. Set MTLS_CA_CERT, MTLS_SERVER_CERT, MTLS_SERVER_KEY in environment"
echo "  2. Distribute worker certs to each worker service"
echo "  3. Configure APISIX gateway to enforce mTLS on /api/trpc routes"
echo "  4. Rotate certs annually (set calendar reminder)"
