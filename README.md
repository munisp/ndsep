# NDSEP — National Data Sovereignty Enforcement Platform

**Nigeria's regulatory-grade platform for data protection compliance, breach management, and sector oversight under the Nigeria Data Protection Act 2023.**

Built for the **Nigeria Data Protection Commission (NDPC)** to serve as the national custodian of data sovereignty, breach notification, and compliance enforcement across 20+ regulated sectors.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (React + Vite)                     │
│  205 pages · 85 components · 202 lazy-loaded routes             │
│  Dark/Light/Auto theming · PWA offline · Recharts dashboards     │
├─────────────────────────────────────────────────────────────────┤
│                     API Layer (Express + tRPC)                   │
│  801 procedures (521 queries + 280 mutations)                    │
│  2,382 Zod schemas · CSRF · Rate limiting · Helmet/CSP          │
├─────────────────┬─────────────────┬─────────────────────────────┤
│  Go Workers     │  Rust Workers   │  Python Workers              │
│  DPI engine     │  CSP validator  │  ML prediction               │
│  Discovery agent│  API key hasher │  SIEM analytics              │
│  SQL auditor    │  Offline sync   │  DPIA engine                 │
│  Breach monitor │                 │  Compliance scheduler        │
├─────────────────┴─────────────────┴─────────────────────────────┤
│                    Infrastructure                                │
│  PostgreSQL 16 · Redis · Kafka · Temporal · Keycloak             │
│  OpenSearch · TigerBeetle · APISIX · OpenAppSec WAF              │
│  Docker · Kubernetes · GitHub Actions CI/CD                      │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React, Vite, Radix UI, Tailwind CSS | NDSEP single-page application |
| API | Express, tRPC, Zod | Type-safe RPC backend |
| Database | PostgreSQL 16, Drizzle ORM | **168 public tables** and **35 canonical SQL migrations** verified on a clean database |
| Auth | Keycloak, OAuth 2.0, JWT | SSO with RBAC + PBAC |
| Encryption | AES-256-GCM, KMS (AWS/Vault) | Field-level on 27 PII fields |
| Workers (Go) | DPI engine, SQL auditor, breach monitor | High-performance processing |
| Workers (Rust) | CSP validator, API key hasher | Security-critical operations |
| Workers (Python) | ML pipeline, DPIA engine, SIEM | Data science & analytics |
| Workflows | Temporal | Accreditation, breach notification |
| Messaging | Kafka, Dapr, Fluvio | Event streaming & pub/sub |
| Search | OpenSearch | Full-text search across entities |
| Gateway | APISIX | API gateway with rate limiting |
| WAF | OpenAppSec | OWASP CRS Paranoia Level 2 |
| Monitoring | Pino, OpenTelemetry, Prometheus | Structured logging & traces |
| CI/CD | GitHub Actions (5 workflows) | TS, Go, Rust, Python, Security scans |

## Prerequisites

- **Node.js** 22+ (see `.nvmrc`)
- **pnpm** 9+
- **PostgreSQL** 16+
- **Redis** 7+ (optional, graceful degradation)
- **Go** 1.22+ (for Go workers)
- **Rust** 1.78+ (for Rust workers)
- **Python** 3.11+ (for Python workers)
- **Docker** & **Docker Compose** (for full stack)

## Quick Start

### Local Development

```bash
# 1. Clone and install
git clone https://github.com/munisp/ndsep.git
cd ndsep
pnpm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your local PostgreSQL credentials

# 3. Database setup
pnpm db:push          # Apply Drizzle schema
pnpm db:seed          # Seed initial data (optional)

# 4. Start development server
pnpm dev              # Starts on http://localhost:3000
```

### Docker (Full Stack)

```bash
# Development
docker compose up -d

# Production (with WAF, monitoring, workers)
docker compose -f docker-compose.production.yml up -d
```

### Workers

```bash
# Go workers
cd workers/go && go build ./... && cd ../..

# Rust workers
cd workers/rust && cargo build --release && cd ../..

# Python workers
cd workers/python && pip install -r requirements.txt && cd ../..
```

## Project Structure

```
ndsep/
├── client/                 # React frontend (Vite)
│   ├── src/
│   │   ├── pages/          # 205 page components
│   │   ├── components/     # 85 reusable components
│   │   └── lib/            # Utilities, i18n, hooks
│   └── dev-dist/           # PWA service worker
├── server/                 # Express + tRPC backend
│   ├── _core/              # App initialization, middleware
│   ├── routers/            # tRPC router definitions
│   ├── kms.ts              # KMS envelope encryption
│   ├── csrf.ts             # CSRF protection
│   ├── envValidation.ts    # Startup env var validation
│   ├── featureFlags.ts     # Feature flag system
│   └── openapi.ts          # OpenAPI doc generation
├── drizzle/                # Database schema & ORM
│   └── schema.ts           # Drizzle schema definitions
│   └── 0000_*.sql … 0034_*.sql  # 35 canonical SQL migration files
├── workers/
│   ├── go/                 # Go workers (DPI, discovery, SQL audit)
│   ├── rust/               # Rust workers (CSP, API key, offline)
│   ├── python/             # Python workers (ML, DPIA, SIEM)
│   └── temporal/           # Temporal workflow definitions
├── infra/
│   ├── k8s/                # Kubernetes manifests (9 files)
│   └── postgres/           # Backup cron config
├── security/
│   ├── DPIA-NDSEP-Platform.md
│   ├── penetration-test-scope.md
│   └── automated-security-tests.ts
├── e2e/                    # Playwright E2E tests (7 specs)
├── .github/workflows/      # CI/CD (5 workflows)
├── docker-compose.yml      # Development stack
├── docker-compose.production.yml  # Production stack with WAF
├── openapi.yaml            # OpenAPI 3.1 specification
└── .env.production.example # Production env template (60 vars)
```

## Key Features

### Compliance & Regulation
- **NDPA 2023** — Full section mapping (S.24–S.49): consent, breach notification, DSAR, DPIA, DPO registry, DPCO accreditation, cross-border transfers, children's data protection
- **Sector Compliance** — Real-time dashboards for 20+ sectors: Banking, Fintech, Healthcare, Telecom, Energy, Insurance, Capital Markets, AML/CFT
- **Enforcement** — Penalty calculator, financial enforcement, fine collection, revenue splits
- **Audit Trail** — Hash-chained SHA-256 immutable log with correlation IDs

### Security
- **Encryption at Rest** — AES-256-GCM on 27 PII fields across 13 tables
- **KMS** — AWS KMS + HashiCorp Vault + local fallback with key rotation
- **Auth** — Keycloak SSO, OAuth 2.0, JWT with rotation, RBAC + PBAC
- **Network** — CSRF, CORS, Helmet/CSP, HSTS (2yr), rate limiting (7-tier), WAF
- **Validation** — 2,382 Zod schemas on all tRPC procedures, zero eval()
- **Env Security** — Startup validation of 8 critical vars (throws in production)
- **SAST/DAST** — CodeQL, Semgrep, OWASP ZAP, dependency review

### Data Management
- **DSAR Portal** — Public subject access request submission and tracking
- **Data Retention** — Automated purge with configurable policies per table
- **Anonymization** — PII masking and pseudonymization for analytics
- **Backup & DR** — pg_dump automation, WAL archiving, restore scripts

### Platform
- **Real-time** — WebSocket live updates, Kafka event streaming
- **Workflows** — Temporal for accreditation and breach notification
- **Search** — OpenSearch full-text across all entities
- **Mobile** — Flutter companion app (45 files)
- **PWA** — Offline support, install prompt, background sync
- **i18n** — Internationalization framework configured
- **Feature Flags** — Runtime feature toggle system

## API Documentation

OpenAPI 3.1 spec available at:
- **Swagger UI**: `GET /api/docs` (when server is running)
- **Raw spec**: `openapi.yaml` in repo root

All 801 tRPC procedures are documented with Zod schema-derived types.

## Testing

```bash
# Unit tests (Vitest)
pnpm test

# E2E tests (Playwright)
pnpm test:e2e

# Type checking
npx tsc --noEmit

# Go tests
cd workers/go && go test ./...

# Rust tests
cd workers/rust && cargo test

# Python tests
cd workers/python && python -m pytest

# Security tests
npx tsx security/automated-security-tests.ts
```

## Deployment

### Kubernetes

```bash
# Apply namespace and configmap
kubectl apply -f infra/k8s/namespace.yaml
kubectl apply -f infra/k8s/configmap.yaml

# Deploy API and workers
kubectl apply -f infra/k8s/api-deployment.yaml
kubectl apply -f infra/k8s/workers-deployment.yaml

# Ingress and network policies
kubectl apply -f infra/k8s/ingress.yaml
kubectl apply -f infra/k8s/network-policy.yaml

# Auto-scaling
kubectl apply -f infra/k8s/hpa.yaml
```

### Blue-Green Deployment

```bash
kubectl apply -f infra/blue-green-deploy.yaml
```

### Database Backup

```bash
# Manual backup
./scripts/backup-postgres.sh

# Restore from backup
./scripts/restore-postgres.sh <backup-file>
```

## Environment Variables

See `.env.example` for local development and `.env.production.example` for production (60 variables across 18 service categories).

Critical variables validated at startup (`server/envValidation.ts`):
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — JWT signing key (min 32 chars)
- `FIELD_ENCRYPTION_KEY` — AES-256-GCM key (64 hex chars)
- `STRIPE_SECRET_KEY` — Payment processing
- `KEYCLOAK_CLIENT_SECRET` — IAM integration
- `APISIX_ADMIN_KEY` — API gateway admin
- Sector regulator API keys (NCC, NHIA, NERC, DPR, NAICOM, CBN)

## Security

See `security/` directory for:
- **DPIA** — `DPIA-NDSEP-Platform.md` (NDPA S.39 compliant)
- **Pen Test Scope** — `penetration-test-scope.md` (CREST-certified, 17 test days)
- **Automated Tests** — `automated-security-tests.ts` (28 security checks)

Report vulnerabilities to: security@ndsep.gov.ng

## License

Proprietary — Government of Nigeria. See `LICENSE` file.
