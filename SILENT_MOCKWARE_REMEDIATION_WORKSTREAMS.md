# Silent Mockware Remediation Workstreams

| Workstream | Confirmed components | Required fail-closed outcome | Acceptance evidence |
|---|---|---|---|
| Identity and authorization | DPCO gateways, DPCO audit, Permify, Keycloak helper, session revocation | No unauthenticated or locally authorized request can be accepted on dependency loss. | Negative tests for invalid tokens, absent services, rejected policy checks, and revoked sessions. |
| Durable state and messaging | Python/Go Dapr bridges, registry state, cache, Fluvio, DLQ replay | State and events are accepted only by configured durable services; outage returns error/503. | Contract tests against unavailable and rejected sidecars; no in-memory state symbols in production source. |
| Financial and payment flows | Rust financial ledger, NIP/RTGS, SWIFT, TigerBeetle | No paid/settled/acknowledged state without an authoritative external confirmation and durable ledger posting. | Negative transfer tests plus real-dependency integration test in a provisioned environment. |
| Screening and security intelligence | Watchlist, KYC, BGP, residency, Wazuh, SIGINT, SOCint, maritime/OSINT | No mock clearance, simulated result, or empty normal response when upstream is unavailable. | Error-path tests for each public API and worker. |
| AI and ML | AI compliance engine, ML pipeline, breach predictor, liveness | Only persisted approved model artifacts and real features produce inference; unavailable is explicit. | Artifact checksum/metadata checks, startup/readiness tests, and no static scoring fallback. |
| Workflows and schedules | Temporal, Dapr bindings, report scheduler, overdue scheduler | Workflow and scheduled jobs fail observably on durable-dependency failure. | Failure-injection tests and operator-visible unhealthy/job-failed status. |
| Infrastructure and operations | Compose/Kubernetes secrets, backup scripts, KEDA, APISIX | No placeholder credentials, swallowed verification failure, or unobservable fallback. | Configuration validation, secret preflight, and operational failure checks. |
| Frontend and adapters | Arkime, mobile API, service relay routers | UI and API clients distinguish zero records from an unavailable dependency. | Browser/API contract tests for 5xx/typed dependency failure display. |
