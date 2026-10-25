#!/usr/bin/env bash
###############################################################################
# NDSEP Let's Encrypt Certificate Auto-Renewal
# ============================================
# Renews certificates if they expire within 30 days, then reloads Nginx.
#
# Add to crontab (runs at 3:00 AM daily):
#   0 3 * * * /path/to/ndsep/infra/certbot/certbot-renew.sh >> /var/log/certbot-renew.log 2>&1
###############################################################################

set -euo pipefail

DOMAIN="${DOMAIN:-ndsep.nitda.gov.ng}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "[${TIMESTAMP}] Starting certificate renewal check for ${DOMAIN}..."

# Attempt renewal (certbot skips if not due)
docker run --rm \
  -v "/etc/letsencrypt:/etc/letsencrypt" \
  -v "/var/lib/letsencrypt:/var/lib/letsencrypt" \
  -v "/var/www/certbot:/var/www/certbot" \
  certbot/certbot renew \
    --webroot \
    --webroot-path=/var/www/certbot \
    --quiet \
    --deploy-hook "echo 'Certificate renewed, reloading Nginx...'"

# Reload Nginx if certificate was renewed
if docker compose -f /path/to/ndsep/docker-compose.production.yml ps nginx | grep -q "Up"; then
  docker compose -f /path/to/ndsep/docker-compose.production.yml exec nginx nginx -s reload
  echo "[${TIMESTAMP}] Nginx reloaded with renewed certificate."
fi

echo "[${TIMESTAMP}] Certificate renewal check complete."
