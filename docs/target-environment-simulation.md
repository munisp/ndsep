# Target-Environment Simulation

The `docker-compose.integration.yml` and `docker-compose.target-simulation.yml` files are **development-only** service contracts. They are intended to make tests repeatable in a target environment that has Docker/Compose; they do not establish regulated payment settlement, government registry access, KMS/HSM custody, production backups, or enterprise identity assurance.

## Payment integration tests

Start the explicit test dependency:

```bash
docker compose -f docker-compose.integration.yml up -d --wait
PAYMENT_AUDIT_POSTGRES_URL=postgresql://idlr_tests:idlr_tests@127.0.0.1:5433/idlr_payment pnpm test
docker compose -f docker-compose.integration.yml down -v
```

The environment variable is required so tests never accidentally use a developer workstation database. CI uses the same isolated database contract.

## Local protocol simulation

`docker compose -f docker-compose.target-simulation.yml up` starts disposable PostgreSQL, MySQL, MinIO, Redis, and Keycloak containers. They must retain their **simulation** designation in UI, API responses, logs, and operational reports. The application must still fail closed when real provider credentials or signing keys are missing.

For a local S3-compatible test, use `OBJECT_STORAGE_MODE=s3`, `OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000`, a test bucket, and a **non-production** public base URL. In production, local filesystem uploads are disabled and the runtime readiness endpoint requires the complete object-storage configuration.

## Production deployment

Use `Dockerfile` only with a non-root workload identity, managed secrets, TLS reverse proxy/ingress, production database/object store, and an explicit `.env.production` derived from `.env.production.example`. Never copy simulation credentials into a production secret manager.
