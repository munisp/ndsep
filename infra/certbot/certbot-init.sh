#!/usr/bin/env bash
###############################################################################
# NDSEP Let's Encrypt Certificate Initialization
# ==============================================
# Run this script ONCE on a fresh server to obtain TLS certificates.
# After initial issuance, certificates are auto-renewed by certbot-renew.sh.
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - Domain DNS A record pointing to this server's public IP
#   - Port 80 accessible from the internet (for ACME HTTP-01 challenge)
#
# Usage:
#   chmod +x infra/certbot/certbot-init.sh
#   DOMAIN=ndsep.nitda.gov.ng EMAIL=admin@nitda.gov.ng ./infra/certbot/certbot-init.sh
###############################################################################

set -euo pipefail

DOMAIN="${DOMAIN:-ndsep.nitda.gov.ng}"
EMAIL="${EMAIL:-admin@nitda.gov.ng}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
WEBROOT="/var/www/certbot"

echo "=== NDSEP TLS Certificate Initialization ==="
echo "Domain : ${DOMAIN}"
echo "Email  : ${EMAIL}"
echo ""

# ─── Step 1: Create webroot directory ────────────────────────────────────────
mkdir -p "${WEBROOT}"

# ─── Step 2: Start Nginx in HTTP-only mode for ACME challenge ─────────────────
echo "[1/4] Starting Nginx in HTTP-only mode for ACME challenge..."
docker compose -f docker-compose.production.yml up -d nginx
sleep 3

# ─── Step 3: Obtain certificate via Certbot ───────────────────────────────────
echo "[2/4] Requesting Let's Encrypt certificate..."
docker run --rm \
  -v "/etc/letsencrypt:/etc/letsencrypt" \
  -v "/var/lib/letsencrypt:/var/lib/letsencrypt" \
  -v "${WEBROOT}:/var/www/certbot" \
  certbot/certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "${EMAIL}" \
    --agree-tos \
    --no-eff-email \
    --force-renewal \
    -d "${DOMAIN}" \
    -d "www.${DOMAIN}"

echo "[3/4] Certificate obtained successfully."
echo "  Certificate: ${CERT_DIR}/fullchain.pem"
echo "  Private key: ${CERT_DIR}/privkey.pem"

# ─── Step 4: Reload Nginx with TLS ────────────────────────────────────────────
echo "[4/4] Reloading Nginx with TLS configuration..."
docker compose -f docker-compose.production.yml exec nginx nginx -s reload

echo ""
echo "=== TLS Certificate Setup Complete ==="
echo "Your platform is now accessible at: https://${DOMAIN}"
echo ""
echo "Certificate expires in 90 days. Auto-renewal is handled by certbot-renew.sh."
echo "Add the following to crontab for automatic renewal:"
echo "  0 3 * * * /path/to/ndsep/infra/certbot/certbot-renew.sh >> /var/log/certbot-renew.log 2>&1"
