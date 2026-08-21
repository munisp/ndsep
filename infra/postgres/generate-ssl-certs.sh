#!/bin/bash
# ============================================================
# Generate self-signed SSL certificates for PostgreSQL
# For production: use certificates from a trusted CA or Let's Encrypt.
# Usage: bash infra/postgres/generate-ssl-certs.sh
# ============================================================

set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAYS=3650  # 10 years for dev; use shorter for production

echo "Generating PostgreSQL SSL certificates in ${CERT_DIR}..."

# Generate CA key and certificate
openssl req -new -x509 -days ${DAYS} -nodes \
  -out "${CERT_DIR}/ca.crt" \
  -keyout "${CERT_DIR}/ca.key" \
  -subj "/CN=NDSEP PostgreSQL CA/O=NDPC/C=NG"

# Generate server key
openssl genrsa -out "${CERT_DIR}/server.key" 4096

# Generate server CSR
openssl req -new \
  -key "${CERT_DIR}/server.key" \
  -out "${CERT_DIR}/server.csr" \
  -subj "/CN=ndsep-postgres/O=NDPC/C=NG"

# Sign server certificate with CA
openssl x509 -req -days ${DAYS} \
  -in "${CERT_DIR}/server.csr" \
  -CA "${CERT_DIR}/ca.crt" \
  -CAkey "${CERT_DIR}/ca.key" \
  -CAcreateserial \
  -out "${CERT_DIR}/server.crt"

# Set permissions (PostgreSQL requires key to be readable only by owner)
chmod 600 "${CERT_DIR}/server.key"
chmod 644 "${CERT_DIR}/server.crt"
chmod 644 "${CERT_DIR}/ca.crt"

# Clean up CSR
rm -f "${CERT_DIR}/server.csr" "${CERT_DIR}/ca.srl"

echo "Done. Files generated:"
echo "  ${CERT_DIR}/ca.crt       — CA certificate (distribute to clients for verification)"
echo "  ${CERT_DIR}/server.crt   — Server certificate"
echo "  ${CERT_DIR}/server.key   — Server private key (keep secret!)"
echo ""
echo "To enable client certificate verification, set in .env.production:"
echo "  DB_SSL_CA=/path/to/ca.crt"
echo "  DB_SSL_REJECT_UNAUTHORIZED=true"
