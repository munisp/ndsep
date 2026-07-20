# Production Readiness Checklist

This checklist is intended for teams deploying the permitting platform outside the current development environment.

## Core platform

| Area | Minimum action |
| --- | --- |
| Backend API | Run the Express and tRPC backend behind Caddy, Nginx, or Traefik with TLS enabled. |
| Database | Provision a managed MySQL instance or migrate the schema to the target production database before launch. |
| Storage | Replace local uploads with MinIO or another S3-compatible object store for durable evidence retention. |
| AI runtime | Pin the configured `AI_MODEL` and verify extraction latency for permit uploads under production load. |
| Mobile and PWA config | Set `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_APP_SCHEME`, and `APP_BUNDLE_ID` explicitly for each environment. |

## Security and access control

| Area | Minimum action |
| --- | --- |
| Session signing | Replace development secrets with strong environment-specific values. |
| Identity | Upgrade from local JWT login to Keycloak or Authentik when multi-tenant or federated identity is required. |
| Authorization | Connect fine-grained permissions to the planned policy engine so field-level controls are enforced centrally, not only in UI flows. |
| File uploads | Restrict maximum file sizes, allow only expected MIME types, and scan uploaded documents before downstream processing. |

## Workflow operations

| Area | Minimum action |
| --- | --- |
| Queue visibility | Review SLA metrics daily and alert on growing overdue queues. |
| Permit evidence | Confirm uploaded document retention, public access rules, and audit visibility for every permit case. |
| Observability | Add structured logs, request tracing, and queue-level metrics export before public launch. |
| Backup and recovery | Back up the database and uploaded evidence store on a fixed schedule and test restoration procedures. |

## Recommended next infrastructure upgrades

The current portable baseline is suitable for continued product development, demos, and controlled pilot use. For a fuller production rollout, the next upgrades should be Keycloak or Authentik for identity, MinIO or managed S3 for storage durability, and centralized policy enforcement through the planned authorization engine.
