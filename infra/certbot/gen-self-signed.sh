#!/usr/bin/env bash
###############################################################################
# NDSEP Self-Signed Certificate Generator (Local Development Only)
# ================================================================
# Generates a self-signed TLS certificate for local HTTPS testing.
# DO NOT use in production — use certbot-init.sh for production.
#
# Usage:
#   chmod +x infra/certbot/gen-self-signed.sh
#   ./infra/certbot/gen-self-signed.sh
###############################################################################

set -euo pipefail

CERT_DIR="infra/nginx/ssl"
DOMAIN="${DOMAIN:-localhost}"

mkdir -p "${CERT_DIR}"

echo "=== Generating self-signed certificate for ${DOMAIN} ==="

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "${CERT_DIR}/privkey.pem" \
  -out "${CERT_DIR}/fullchain.pem" \
  -subj "/C=NG/ST=FCT/L=Abuja/O=NITDA/OU=NDSEP/CN=${DOMAIN}" \
  -addext "subjectAltName=DNS:${DOMAIN},DNS:localhost,IP:127.0.0.1"

# Create chain.pem (same as fullchain for self-signed)
cp "${CERT_DIR}/fullchain.pem" "${CERT_DIR}/chain.pem"

echo ""
echo "=== Self-signed certificate generated ==="
echo "  Certificate : ${CERT_DIR}/fullchain.pem"
echo "  Private key : ${CERT_DIR}/privkey.pem"
echo "  Chain       : ${CERT_DIR}/chain.pem"
echo ""
echo "NOTE: Browsers will show a security warning for self-signed certificates."
echo "To trust locally: add ${CERT_DIR}/fullchain.pem to your system's trusted CA store."
echo ""
echo "To start Nginx with TLS:"
echo "  docker compose -f docker-compose.production.yml up -d nginx"
