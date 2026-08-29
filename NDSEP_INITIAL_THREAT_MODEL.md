# NDSEP Initial Threat Model

**System assessed:** `munisp/ndsep`, production branch
**Assessment type:** Initial architecture-level data-flow and trust-boundary analysis
**Scope:** Production Compose topology, public edge, gateway, Node/Express/tRPC API, Keycloak, OPA/Permify, persistence/event systems, workers, observability, and declared external integrations.
**Out of scope:** A live penetration test, production configuration/secrets, cloud IAM policies, third-party provider controls, and source-code review of every route/worker.

> This is an initial, source-informed threat model. It identifies architectural risk vectors that warrant design review, control validation, and targeted testing; it does not establish exploitability in a deployed environment.

## 1. Architecture and data-flow summary

NDSEP declares a public HTTPS edge through Caddy, which proxies application traffic to APISIX and exposes narrow Keycloak OpenID Connect paths. The gateway validates bearer tokens and rate-limits `/api/*` and `/trpc/*` before forwarding traffic to the Node/Express/tRPC application. [1] [2] The API adds request controls, CORS, Helmet headers, CSRF validation for tRPC mutations, PII encryption middleware, and rate limits; it also exposes webhook, worker-relay, health, metrics, report/export, and internal-service proxy surfaces. [3]

The application relies on Keycloak for authenticated identity and MFA claims, OPA for default-deny privileged decisions, and Permify for relationship authorization. A verified Keycloak bearer token is accepted before the fallback session path; failed bearer authentication does not fall through to cookie authentication. [4] [5] PostgreSQL stores users, regulated records, and audit data; Redis stores cache/session/rate-limit state; Kafka and Temporal carry asynchronous work; workers process compliance, KYC/AML, reporting, and sector-monitoring data. The declared production topology also integrates with external financial, regulatory, identity, storage, notification, and payment-provider endpoints. [6]

The companion source diagram is [`ndsep-initial-data-flow.mmd`](./ndsep-initial-data-flow.mmd); the rendered view is [`ndsep-initial-data-flow.png`](./ndsep-initial-data-flow.png). It is intentionally a **logical data-flow diagram**, not a network-configuration guarantee.

## 2. Assets, security objectives, and trust zones

| Asset / objective | Examples in the declared architecture | Primary security objective |
|---|---|---|
| Identity and authorization integrity | Keycloak tokens/MFA claims, role mapping, OPA decisions, Permify relationships | Prevent impersonation, privilege escalation, tenant-crossing access, and unauthorized approval/export/delete actions. |
| Regulated and personal data confidentiality | PostgreSQL records, KYC/AML inputs, citizen requests, audit records, report PDFs, backups | Prevent disclosure through routes, exports, logs, message streams, object storage, backups, or external providers. |
| Regulatory decision integrity | Compliance scores, workflows, reports, notifications, ML/GNN/Ray results, event projections | Prevent manipulation, replay, spoofed worker events, model/data poisoning, or unapproved workflow transitions. |
| Service availability | Caddy, gateway, API, PostgreSQL, Redis, Kafka, Temporal, workers, external dependencies | Resist volumetric/application-layer abuse and prevent cascading worker, message, database, or provider failures. |
| Evidence and accountability | Audit events, logs, SBOM/release provenance, monitoring, backup/restore evidence | Preserve trusted evidence without exposing sensitive payloads or allowing deletion/tampering. |
| Delivery integrity | GitHub source, lockfiles, CI/CD, container images, manifests, environment/secrets | Prevent unauthorized changes and deployment of unreviewed/vulnerable artifacts. |

The diagram separates six trust zones: untrusted external parties; Internet-facing edge; application ingress and identity; authorization/application services; data/event/state stores; internal workers; and operations/observability. The key control transitions are public edge → gateway, identity → application, application → OPA/Permify, application/workers → state/event systems, and operational actors → deployment/configuration.

## 3. Primary threat hypotheses and risk register

| ID | Threat vector | Architectural evidence / hypothesis | Potential consequence | Initial rating | Required validation or control |
|---|---|---|---|---|---|
| TM-01 | **Public-edge bypass or control drift** | Caddy proxies directly to APISIX, while the Compose file also declares a second WAF/nginx path that is not the stated Caddy ingress path. [1] [6] | Requests may bypass the intended inspection, WAF, or rate-limit layer; false confidence in perimeter controls. | **Critical** | Produce an authoritative ingress diagram; block all non-approved entry paths with network policy/security groups; prove request traversal with signed test headers and logs. |
| TM-02 | **Broken object-level / relationship authorization** | API authorization combines gateway OIDC, local session logic, OPA, and Permify. OPA is focused on privileged actions; authorization consistency across every business route remains to be demonstrated. [4] [5] | Cross-tenant data access or unauthorized approval, export, deletion, or policy changes. | **Critical** | Create a route-to-resource authorization matrix; implement automated negative tests for every role, tenant, object identifier, and privileged operation. |
| TM-03 | **Worker event forgery or confused deputy** | Workers post relay events to `/api/workers/event`; the handler broadcasts when `event` and `data` exist, while Compose shares broad internal networking. [3] [6] | Spoofed compliance, alert, or workflow events; arbitrary notification/realtime content; loss of event integrity. | **High** | Require service-to-service authentication (mTLS or short-lived workload JWT), event schema validation, event signing/idempotency keys, and topic/identity ACLs. |
| TM-04 | **Asynchronous workflow/message trust failure** | Kafka, Temporal, API, and heterogeneous workers exchange data and commands; the shown Kafka broker uses `PLAINTEXT` internally and automatic topic creation. [6] | Message injection, replay, unauthorized topic consumption, poisoned workflows, or systemic availability loss after a workload compromise. | **High** | Enforce broker TLS/SASL and per-service ACLs; disable auto-topic creation; validate schemas and idempotency; use isolated service identities and dead-letter handling. |
| TM-05 | **Secrets and configuration exposure** | Numerous data stores, API keys, identity credentials, backup keys, endpoint values, and alerting credentials flow through Compose environment variables. Some values have placeholder/default fallbacks. [6] | Privileged account/API-key compromise, production misconfiguration, backup disclosure, or lateral movement. | **Critical** | Use a managed secrets system; fail closed for all security-sensitive variables; remove defaults; scope each workload identity and rotate historical/exposed material. |
| TM-06 | **Data-store lateral movement and backup compromise** | PostgreSQL is shared by API, Keycloak, Permify, Temporal, and many workers; backup/WAL data is volume-mounted and can be uploaded to object storage. [6] | A single workload compromise could reach high-value records, identity data, workflow state, or unencrypted backup artifacts. | **Critical** | Create separate DB roles/databases/schemas with least privilege; enforce network policy; encrypt backups with managed keys; test immutable/off-site restore and access logging. |
| TM-07 | **Webhooks and third-party callbacks** | The application accepts a raw Stripe webhook and registers Mojaloop callbacks; external provider data is also consumed by sector/KYC/AML/financial workers. [3] [6] | Forged callbacks, replay, SSRF-style misuse of endpoint configuration, data poisoning, or provider-driven denial of service. | **High** | Verify signatures, timestamps, nonce/replay state, schemas, source constraints, timeout/retry/circuit-breaker behavior, and egress allowlists. |
| TM-08 | **ML / analytic control-plane abuse and data poisoning** | Authenticated API routes can trigger ETL, training, graph builds, predictions, continuous-training changes, and feedback ingest against lakehouse/ML/GNN/Ray services. [3] | Unauthorized/high-cost compute, unsafe model replacement, poisoned training data, inference data exposure, or operational disruption. | **High** | Separate read/inference from training/admin roles; require OPA-guarded MFA for mutating control-plane operations; constrain data lineage, quotas, model registry approvals, and audit trails. |
| TM-09 | **Observability and health data leakage** | The API exports metrics, health/readiness, errors, and worker-status data; Prometheus and Grafana are internal by declaration but the API exposes some related endpoints. [3] [6] | Topology, service health, identifiers, or sensitive operational data assists attackers; monitoring system becomes a pivot. | **Medium–High** | Authenticate/authorize non-public diagnostics; minimize exported labels; isolate telemetry endpoints; scan dashboards/alerts for credentials and PII; restrict Grafana/Prometheus roles. |
| TM-10 | **Realtime and event-polling data disclosure** | The application initializes WebSocket/SSE systems and offers event polling; worker events can drive broadcast behavior. [3] | Users receive events outside their role/tenant, event replays disclose data, or socket connections persist after authorization changes. | **High** | Bind every event to tenant/resource/role authorization at delivery time; authenticate reconnects; expire subscriptions; test revocation and replay behavior. |
| TM-11 | **Unsafe operational/demo paths** | Demo-login and demo-reset routes exist in the server entry point. The production safety of their guards and route exposure must be verified in the deployed ingress. [3] | Demo/admin session creation or data reset in an environment containing real data. | **Critical** | Remove demo routes from production image or verify compile/runtime exclusion; add an automated production negative test; restrict operational reset capability to a separate, audited admin plane. |
| TM-12 | **Supply-chain and deployment compromise** | The previous assessment found unprotected production governance, critical/high dependency exposure, mutable image tags, and failed/soft-fail release controls. | Untrusted or vulnerable artifacts can enter the platform; a compromised build pipeline can bypass application controls. | **Critical** | Require protected branch and `security-gate`, signed immutable images, SBOM/provenance, reviewed exceptions, secret scanning, and promotion by digest only. |
| TM-13 | **Data-retention and deletion conflict** | The API runs audit retention after seven years, while backups, projections, object storage, and worker-produced copies require matching lifecycle enforcement. [3] [6] | Retained regulated data or sensitive copies persist beyond policy; deletion requests fail to propagate. | **High** | Define system-of-record and retention/deletion map; apply lifecycle policies across DB, backups, object storage, logs, Kafka, and model/lakehouse stores; test erasure evidence. |
| TM-14 | **Availability cascade from shared dependencies** | Core components depend on shared PostgreSQL, Redis, Kafka, Temporal, and external services. Health readiness reports DB readiness but can report Redis/workers unavailable without making them decisive. [3] [6] | Partial outage causes queue buildup, duplicate actions, unbounded retries, data loss, or false-positive operational readiness. | **High** | Establish dependency SLOs, backpressure, circuit breakers, idempotency, graceful degradation, queue limits, chaos/failover tests, and explicit readiness policy. |

## 4. High-priority design decisions

The first design review should resolve five questions before production deployment: **(1)** What exact network path is allowed from the Internet to each exposed service? **(2)** Which component is authoritative for authorization of every data object and workflow action? **(3)** How are service-to-service requests and worker events authenticated, authorized, signed, and replay-protected? **(4)** Where may each sensitive data type reside, including backups, logs, event streams, and training artifacts? **(5)** Which mutating control-plane capabilities—training, ETL, configuration, exports, data resets, and deployment—require MFA, dual approval, and isolated administrative paths?

## 5. Validation backlog

| Priority | Test or artifact | Exit criterion |
|---|---|---|
| P0 | Network/ingress truth table | Every public route, service port, load balancer, WAF, proxy, and management endpoint is inventory-backed, default-denied, and tested from an external vantage point. |
| P0 | Authorization test matrix | Automated allow/deny tests cover every tRPC/REST action by user role, tenant, object ownership, MFA state, and authorization-policy outage. |
| P0 | Workload identity design | API, every worker family, Kafka consumer/producer, OPA/Permify client, and deployment agent has a unique authenticated identity and minimal permissions. |
| P0 | Sensitive-data inventory | Owners, classification, encryption state, retention, deletion, backup, and export paths are recorded for PostgreSQL, Redis, Kafka, Temporal, S3, logs, and ML/lakehouse stores. |
| P1 | Webhook/egress security test suite | External callbacks reject unsigned, stale, replayed, malformed, oversized, and unapproved-origin requests; egress is constrained to approved destinations. |
| P1 | Realtime and event integrity suite | Worker relay and WebSocket/event-polling flows demonstrate schema enforcement, tenant isolation, authorization-on-delivery, idempotency, and revocation. |
| P1 | Resilience exercise | Dependency loss, replay, queue overload, provider failure, rollback, backup restore, and key rotation are tested against agreed RTO/RPO/SLO targets. |
| P1 | ML governance design review | Data lineage, training authorization, model promotion, inference logging, drift response, data poisoning detection, and rollback are documented and tested. |

## 6. Next iteration

The next threat-model iteration should be held as a 90-minute workshop with application, platform, security, data-governance, identity, and service-owner representatives. It should replace assumptions with deployment evidence, enumerate individual data classifications, map every route and worker identity, score residual risk using the organization’s formal risk methodology, and assign dated owners for the P0/P1 backlog.

## References

[1]: https://github.com/munisp/ndsep/blob/production/infra/caddy/Caddyfile "NDSEP Caddy public-edge configuration"
[2]: https://github.com/munisp/ndsep/blob/production/config/apisix.yaml "NDSEP APISIX gateway configuration"
[3]: https://github.com/munisp/ndsep/blob/production/server/_core/index.ts "NDSEP Express server entry point"
[4]: https://github.com/munisp/ndsep/blob/production/server/_core/context.ts "NDSEP tRPC authentication context"
[5]: https://github.com/munisp/ndsep/blob/production/infra/opa/policies/ndsep_authz.rego "NDSEP OPA authorization policy"
[6]: https://github.com/munisp/ndsep/blob/production/docker-compose.production.yml "NDSEP production Compose topology"
