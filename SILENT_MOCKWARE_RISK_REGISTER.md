# Silent Mockware Risk Register

**Revision reviewed:** `0b0c0a0`
**Scope:** Findings from the eight-surface microservice audit.
**Status rule:** `Remediated` means the current branch contains a tested source change. `Open` means the finding still requires implementation and validation.

## Priority order

| Priority | Finding | Service path | Primary impact | Status | Required disposition |
|---|---|---|---|---|---|
| P0 | Arbitrary bearer-token sandbox fallback | `orchestration/go/cmd/dpco_api_gateway/main.go` | Authentication bypass and cross-tenant data exposure | Open | Remove the non-production token fallback; require authoritative API-key or Keycloak validation on every execution path. |
| P0 | DPCO audit token fallback plus volatile audit store | `orchestration/go/cmd/dpco_audit_service/main.go` | Authentication bypass and non-durable audit evidence | Open | Remove fallback identity and in-memory audit persistence; reject requests and return 503 when durable dependencies are unavailable. |
| P0 | Local RBAC authorization substitute | `orchestration/go/pkg/permify/client.go` | Authorization bypass when Permify fails | Open | Remove `localCheck`; propagate failure and deny protected operations. |
| P0 | Dapr state/pubsub in-memory substitute | `workers/python/dapr_state_bridge.py` | Lost state and fabricated successful side effects | Open | Remove local state and pub/sub queues; make every state and publish failure explicit. |
| P0 | TigerBeetle posting ignored before penalty settlement | `workers/rust/financial_ledger/src/main.rs` | Paid status without double-entry financial record | Open | Require a successful durable ledger post before changing business settlement state. |
| P1 | Mock watchlist clearance mode | `workers/python/watchlist_screener_fallback.py` | Sanctions/KYC decision without durable screening evidence | Open | Remove mock mode; fail screening requests when PostgreSQL or its driver is unavailable. |
| P1 | In-memory ML state and formula prediction | `orchestration/python/ml_pipeline/service.py` | Fabricated AI prediction and false model readiness | Open | Require persisted model artifacts and durable feature data; return unavailable otherwise. |
| P1 | Randomized NIBSS/RTGS settlement | `workers/go/cmd/nip_rtgs_processor/main.go` | Fabricated funds settlement | Remediated in `40fb3b5` | Worker now records `settlement_pending` until an authoritative gateway response exists. |
| P1 | Randomized SWIFT correspondent ACK | `workers/go/cmd/swift_gateway/main.go` | Fabricated correspondent acknowledgement | Remediated in `40fb3b5` | Worker now records `awaiting_correspondent_ack` until an external receipt exists. |
| P1 | Python Dapr bridge silent durable substitute | `workers/python/dapr_state_bridge.py` | Lost workflow state and unreported event loss | Open | Covered by the P0 Dapr remediation. |
| P1 | Rule-based response presented as LLM inference | `workers/python/ai_compliance_engine.py` | Misrepresented compliance guidance | Open | Raise a clear inference-unavailable error; never substitute generated-looking rule text. |
| P1 | Rule/formula ML breach and pipeline fallbacks | `workers/python/ml_breach_predictor.py`, `orchestration/python/ml_pipeline/service.py` | Fabricated risk scores | Open | Require loaded CPU model and real persisted features. |
| P1 | External-intelligence outages returned as empty normal data | `server/routers/{phantomTide,sigint,estorides,socint,wazuh}.ts` | False negative security/compliance intelligence | Open | Propagate upstream errors; retain empty arrays only for successful zero-result queries. |
| P1 | Default evidence signing secret | `workers/rust/evidence_signer/src/main.rs` | Forged legal/evidentiary signatures | Open | Require a non-empty signing key on process startup. |
| P1 | DPCO registry in-memory Dapr substitute | `orchestration/go/cmd/dpco_registry_service/main.go` | Lost registry state and false persistence | Open | Remove map fallback; return explicit sidecar/storage failure. |
| P2 | Dapr bridge swallows publish/state errors | `workers/go/cmd/dapr_bridge/main.go` | Unreported lost events | Open | Propagate non-2xx and transport errors. |
| P2 | DLQ retry sends empty body | `services/go/dlq-processor/cmd/main.go` | Corrupted replay with plausible retry success | Open | Serialize original payload and require a downstream 2xx response. |
| P2 | Scheduler creates empty/default compliance report on DB failure | `workers/python/monthly_report_scheduler.py` | Fabricated operational reporting | Open | Abort/report failure when durable data cannot be read. |
| P2 | Overdue scheduler returns zero work after database error | `server/overdueScheduler.ts` | Silent missed penalties and notifications | Open | Propagate the exception and emit an operational failure event. |
| P2 | Unchecked compliance/security database writes | Rust BGP, residency, watchlist, SLA workers | Lost regulatory evidence | Open | Handle write errors explicitly and retry or fail the job. |
| P2 | Static infrastructure secrets/placeholders | Compose and Kubernetes templates | Credential compromise or broken deployment | Open | Replace literals with required external secret references and preflight validation. |

## Assurance conclusion

The platform remains **not releaseable** under a no-silent-mockware policy while any P0 or P1 finding is open. The next remediation sequence is Dapr state, Permify, DPCO authentication/audit, financial ledger posting, then strict Python AI and screening behavior.
