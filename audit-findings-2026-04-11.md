# NDSEP Full Platform Audit Findings — 2026-04-11

## 1. Orphaned DB Tables (no CRUD in any router/db.ts)
- `ai_systems` — AI system registry, no list/create/update/delete
- `audit_logs` — platform audit trail, no query endpoint
- `compliance_policies` — policy library, no CRUD
- `config_snapshots` — GitOps config history, no list/detail
- `data_catalog_entries` — data catalog, no CRUD
- `dpco_audit_logs` — DPCO-specific audit trail, no query
- `dpco_performance_metrics` — scorecard data, mock only
- `enforcement_actions` — enforcement action items, no CRUD
- `evidence_packages` — evidence package bundles, no CRUD
- `ml_risk_predictions` — ML predictions, no query endpoint
- `penalty_appeals` — penalty appeal workflow, no CRUD
- `policy_templates` — policy template library, no CRUD
- `streaming_events` — Kafka/Fluvio events, mock only
- `threat_intelligence` — threat intel feeds, no CRUD
- `tia_assessments` — Transfer Impact Assessments, no CRUD
- `transfer_impact_assessments` — duplicate TIA table, no CRUD

## 2. Workers Not Registered in Worker Manager
- `ai_governance_scorer.py` — new ML scorer, not registered
- `bgp_live_monitor` (Go) — new BGP monitor, not registered
- `car_pdf_generator` (Go) — new CAR PDF generator, not registered
- `webhook_delivery` (Go) — new webhook delivery, not registered
- `dsar_deadline_tracker.py` — new DSAR tracker, not registered
- `sector_benchmarking.py` — new benchmarking worker, not registered
- `citizen_sla_tracker` (Go) — SLA tracker, not registered
- `compliance_analytics.py` — analytics worker, not registered
- `dpia_engine.py` — DPIA engine, not registered
- `dpo_report_engine.py` — DPO report engine, not registered

## 3. Mock/Stub Data to Replace
- `DpcoPerformanceScorecard.tsx` — deterministic mock metrics (line 41)
- `StreamingEvents.tsx` — all Math.random() simulated events
- `WebhookManagement.tsx` — retryDelivery stub (line 64)
- `websocket.ts` — Math.random() for live data streams
- `server/workerManager.ts` — "stub mode" description (line 487)

## 4. PWA Pages Missing tRPC (static only — OK)
- `ApiDocs` — static docs page (OK)
- `DpcoBrochure` — marketing brochure (OK)
- `Home` — landing page (OK)
- `NotFound` — 404 page (OK)

## 5. React Native Screens Missing (87 PWA pages, only 18 RN screens)
Key missing screens:
- DPCO portal screens (DpcoPortal, DpcoApply, DpcoOnboard, DpcoBilling, DpcoSubscription)
- Accreditation screens (AccreditationApplication, AccreditationStatus)
- DSAR screens (CitizenDSAR, DsarTracking)
- DPIA/TIA screens (DpiaAssessment, TiaAssessment)
- AI Governance screens
- Evidence Vault screen
- Breach Notification screen
- Transfer Approvals screen
- Policy Hub screen
- Staff Training screen
- Sector Benchmarking screen
- Webhook Management screen
- Global Search screen
- CAR Automation screen

## 6. Flutter App
- NO Flutter app directory exists — needs to be created from scratch

## 7. Environment Variables Not Documented
- 95 env vars used across the codebase, only ~15 documented in README
- Missing: SMTP_*, RESEND_API_KEY, SLACK_WEBHOOK_URL, PAGERDUTY_INTEGRATION_KEY,
  KEYCLOAK_*, TEMPORAL_*, TIGERBEETLE_*, REDIS_*, KAFKA_*, FLUVIO_*, DAPR_*,
  VAPID_*, OTEL_*, PERMIFY_*, APISIX_*

## 8. i18nRouter Not Registered in appRouter
- `i18nRouter` exported from enhancements.ts but not added to appRouter

## 9. retryDelivery Procedure Missing in webhookRouter
- WebhookManagement.tsx has a commented-out retryDelivery call
- webhookRouter has no retryDelivery procedure

## 10. DpcoPerformanceScorecard Uses Mock Data
- `dpco_performance_metrics` table exists but scorecard reads mock data
- Need real tRPC procedure reading from `dpco_performance_metrics`
