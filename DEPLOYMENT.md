# NDSEP Production Deployment Guide

**National Data Sovereignty Enforcement Platform**
National Information Technology Development Agency (NITDA)

---

## Prerequisites

| Requirement | Minimum Spec |
|---|---|
| OS | Ubuntu 22.04 LTS |
| CPU | 8 vCPU |
| RAM | 16 GB |
| Disk | 200 GB SSD |
| Docker | 24.0+ |
| Docker Compose | 2.20+ |
| Domain | DNS A record pointing to server IP |
| Ports | 80, 443 open inbound |

---

## 1. Environment Setup

Copy the example environment file and fill in all required values:

```bash
cp .env.production.example .env.production
nano .env.production
```

**Required secrets** (never commit these):

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Minimum 32-character random string |
| `REDIS_URL` | Redis connection string with password |
| `RESEND_API_KEY` | Resend API key for email notifications |
| `EMAIL_FROM` | Sender address (must be verified in Resend) |
| `PLATFORM_URL` | Public URL e.g. `https://ndsep.nitda.gov.ng` |
| `NITDA_COMPLIANCE_EMAIL` | Compliance team email for reply-to |

---

## 2. TLS Certificate Setup

### Option A: Let's Encrypt (Production)

Ensure your domain DNS is pointing to this server, then run:

```bash
# Set your domain and admin email
export DOMAIN=ndsep.nitda.gov.ng
export EMAIL=admin@nitda.gov.ng

# Initialize certificates (runs Certbot via Docker)
chmod +x infra/certbot/certbot-init.sh
./infra/certbot/certbot-init.sh
```

Set the TLS cert directory for Docker Compose:

```bash
export TLS_CERT_DIR=/etc/letsencrypt/live/ndsep.nitda.gov.ng
```

**Auto-renewal** — add to crontab (`crontab -e`):

```cron
0 3 * * * DOMAIN=ndsep.nitda.gov.ng /path/to/ndsep/infra/certbot/certbot-renew.sh >> /var/log/certbot-renew.log 2>&1
```

### Option B: Self-Signed (Local Development / Testing)

```bash
chmod +x infra/certbot/gen-self-signed.sh
./infra/certbot/gen-self-signed.sh
# TLS_CERT_DIR defaults to ./infra/nginx/ssl (already set)
```

Browsers will show a security warning — add the certificate to your trusted store to suppress it.

### Option C: Government CA Certificate

Place your CA-issued certificates at `infra/nginx/ssl/`:

```
infra/nginx/ssl/
  fullchain.pem   ← Server cert + intermediate chain
  privkey.pem     ← Private key
  chain.pem       ← Intermediate chain only
```

---

## 3. Database Setup

```bash
# Run migrations
pnpm db:push

# Verify tables (should show 34 tables)
sudo -u postgres psql ndsep_db -c "\dt"
```

---

## 4. Start the Platform

```bash
# Pull all images
docker compose -f docker-compose.production.yml pull

# Start all services (detached)
TLS_CERT_DIR=/etc/letsencrypt/live/ndsep.nitda.gov.ng \
docker compose -f docker-compose.production.yml up -d

# Check all services are healthy
docker compose -f docker-compose.production.yml ps
```

Expected healthy services:

| Service | Port | Purpose |
|---|---|---|
| ndsep-api | 3000 (internal) | Main API + frontend |
| nginx | 80, 443 | TLS termination + reverse proxy |
| postgres | 5432 (internal) | Primary database |
| redis | 6379 (internal) | Cache + session store |
| kafka | 9092 (internal) | Event streaming |
| zookeeper | 2181 (internal) | Kafka coordination |
| keycloak | 8080 (internal) | Identity provider |
| temporal | 7233 (internal) | Workflow engine |
| prometheus | 9090 (internal) | Metrics collection |
| grafana | 3001 (internal) | Metrics dashboards |

---

## 5. Email Notifications

NDSEP sends automated emails for the following events:

| Event | Recipients | Template |
|---|---|---|
| Financial penalty issued | Organization DPO + NITDA officer | `sendPenaltyNotice` |
| Enforcement case opened | Organization DPO | `sendEnforcementCaseOpened` |
| Citizen request status update | Data subject (citizen) | `sendCitizenRequestUpdate` |
| Penalty appeal decision | Organization DPO | `sendAppealUpdate` |
| Compliance certificate granted | Organization DPO | `sendCertificateGranted` |
| Portal phase advance | Organization contact | `sendPortalPhaseUpdate` |
| SLA breach warning | Organization DPO + NITDA compliance | `sendSlaBreachWarningEmail` |

**Transport priority:**
1. **Resend** (if `RESEND_API_KEY` is set) — production transactional email
2. **Manus Forge API** — fallback / development environment

To configure Resend:
1. Create an account at [resend.com](https://resend.com)
2. Verify your domain (`ndsep.nitda.gov.ng`)
3. Generate an API key and set `RESEND_API_KEY` in `.env.production`
4. Set `EMAIL_FROM` to a verified sender address

---

## 6. Health Checks

```bash
# API health endpoint
curl https://ndsep.nitda.gov.ng/api/health

# Expected response:
# {"status":"ok","service":"ndsep-api","version":"1.0.0","uptime":...}

# Worker health endpoints (internal)
curl http://localhost:8081/health  # DPI Engine
curl http://localhost:8082/health  # Discovery Agent
# ... ports 8081-8099 for all 19 workers
```

---

## 7. Monitoring

Access Grafana dashboards at `http://localhost:3001` (internal) or via SSH tunnel:

```bash
ssh -L 3001:localhost:3001 user@ndsep.nitda.gov.ng
# Then open http://localhost:3001 in your browser
```

Default credentials: `admin` / `${GRAFANA_ADMIN_PASSWORD}` (set in `.env.production`)

Prometheus alerting rules are configured in `infra/prometheus/alerts.yml` and cover:
- API availability and error rates
- Database connection count and slow queries
- Worker health and Kafka consumer lag
- Citizen request SLA breaches
- Security events (BGP anomalies, auth failures)
- Infrastructure (CPU, memory, disk)

---

## 8. Kubernetes Deployment

For Kubernetes deployment, apply the manifests in order:

```bash
# 1. Create namespace
kubectl apply -f infra/k8s/namespace.yaml

# 2. Create secrets (edit secrets.yaml.template first)
kubectl apply -f infra/k8s/secrets.yaml

# 3. Deploy API
kubectl apply -f infra/k8s/api-deployment.yaml

# 4. Configure ingress with TLS
kubectl apply -f infra/k8s/ingress.yaml

# 5. Verify deployment
kubectl get pods -n ndsep
kubectl get ingress -n ndsep
```

---

## 9. Backup and Recovery

```bash
# Database backup
pg_dump -U ndsep_user ndsep_db | gzip > ndsep_backup_$(date +%Y%m%d).sql.gz

# Restore
gunzip -c ndsep_backup_YYYYMMDD.sql.gz | psql -U ndsep_user ndsep_db
```

---

## 10. Security Checklist

- [ ] All secrets rotated from defaults in `.env.production`
- [ ] TLS certificate installed and HSTS enabled
- [ ] PostgreSQL not accessible from public internet
- [ ] Redis password set and not accessible from public internet
- [ ] Grafana admin password changed from default
- [ ] Keycloak admin password changed from default
- [ ] Rate limiting configured in Nginx (`60 req/s` per IP)
- [ ] Firewall rules: only ports 80 and 443 open inbound
- [ ] SSH key-based authentication only (password auth disabled)
- [ ] Automated certificate renewal configured in crontab
- [ ] Log rotation configured for application logs
- [ ] Database backups scheduled and tested

---

*This document is maintained by the NDSEP Platform Engineering team.*
*For support: compliance@nitda.gov.ng*
