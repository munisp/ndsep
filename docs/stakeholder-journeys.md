# NDSEP — 30 Stakeholder Journeys Reference

**National Data Sovereignty Enforcement Platform**
*Orchestration Layer v2.2.0 — March 2026*

---

## Overview

The NDSEP orchestration layer coordinates **10 middleware services** across **8 microservices** to execute 30 distinct stakeholder journeys. Each journey represents a complete end-to-end flow — from a triggering event through middleware processing to a measurable outcome — that solves a specific regulatory, operational, or financial problem for one or more stakeholder groups.

The platform serves **10 stakeholder roles**: Government Staff, Auditors, Organisation Admins, Organisation Users, Regulators, Legal Officers, Finance Officers, Technical Officers, Data Protection Officers, and Platform Administrators.

---

## Middleware Architecture

| Middleware | Role in Platform | Port |
|-----------|-----------------|------|
| **Kafka** | Durable event bus — all 30 journey events are published as Kafka topics | 9092 |
| **Fluvio** | Edge telemetry streaming — real-time network and IoT data ingestion | 9010 |
| **Dapr** | Service mesh — pub/sub, state management, service invocation sidecar | 3500 |
| **Temporal** | Workflow orchestration — long-running enforcement workflows with retry/timeout | 7233 |
| **Keycloak** | Identity and access management — JWT issuance, SSO, realm-level RBAC | 8080 |
| **Permify** | Fine-grained authorisation — resource-level permission checks (ReBAC) | 3476 |
| **Redis** | Caching layer — compliance scores, session tokens, rate limiting | 6379 |
| **APISIX** | API gateway — route management, rate limiting, JWT validation, load balancing | 9080 |
| **TigerBeetle** | Financial ledger — ACID double-entry accounting for penalties and distributions | 8240 |
| **Delta Lake** | Lakehouse — immutable audit-grade storage for compliance, ML, and reporting data | 8210 |

---

## The 30 Stakeholder Journeys

---

### J01 — Organisation Registration

**Stakeholders:** Organisation Admin, Government Staff

**Platform Services Used:** Universal Organisation Portal (`/portal`), Discovery Engine (Layer 1), Data Catalog (Layer 2), Compliance Engine (Layer 3), Role Management (`/roles`)

**Middleware:** Keycloak (identity provisioning), Kafka (`org.registered` topic), Dapr (service invocation to Discovery Agent), Delta Lake (registration record ingestion), Redis (session caching)

**Problem Solved:** Before NDSEP, organisations operating in the national digital economy had no standardised onboarding process. Regulators had no visibility into which entities held sensitive data, where it was stored, or what compliance posture they maintained. Shadow data processing was endemic.

**Value Delivered:** A five-step guided wizard collects organisational profile, asset inventory, data catalog entries, and a compliance self-assessment. Upon submission, the Discovery Agent automatically fingerprints declared assets, the Compliance Engine assigns an initial score, and Keycloak provisions the organisation's identity within the NDSEP realm. The complete registration record is ingested into the Delta Lake for immutable audit history. Government staff receive a notification and can begin the review workflow immediately.

---

### J02 — Compliance Assessment

**Stakeholders:** Auditor, Government Staff, Organisation Admin

**Platform Services Used:** Compliance Engine (Layer 3), ML Pipeline (orchestration), Continuous Monitoring (`/monitoring`)

**Middleware:** ML Pipeline (risk scoring), Kafka (`compliance.assessed` topic), Delta Lake (assessment record), Redis (score caching for 15-minute refresh)

**Problem Solved:** Manual compliance assessments were infrequent, inconsistent, and resource-intensive. Organisations could remain non-compliant for months before detection, and scores were not comparable across sectors.

**Value Delivered:** The ML Pipeline's `risk_scorer_v2.2` model evaluates seven features — violation count, compliance score, audit staleness, cross-border transfers, data volume, penalty history, and security alert count — against sector and country multipliers calibrated from live PostgreSQL data. Scores are cached in Redis and refreshed every 15 minutes by the Compliance Re-Scorer worker. The result is a continuously updated, sector-normalised compliance posture for every registered organisation.

---

### J03 — Violation Detection

**Stakeholders:** Government Staff, Auditor, Technical Officer

**Platform Services Used:** Compliance Engine (Layer 3), SIEM & Audit Trail (Layer 4), Network DPI (Layer 5)

**Middleware:** Kafka (`violation.detected` topic), Temporal (violation workflow), Delta Lake (violation record), Dapr (pub/sub to enforcement services)

**Problem Solved:** Compliance violations were detected reactively — typically after a data breach or complaint — rather than proactively through continuous monitoring. There was no automated linkage between a detected violation and an enforcement action.

**Value Delivered:** The Compliance Scoring Engine worker (Go, port 8083) continuously evaluates OPA policies against organisation data. When a violation is detected, it publishes a `violation.detected` Kafka event, which triggers a Temporal enforcement workflow. The workflow automatically creates an enforcement action record, notifies the responsible government officer, and begins the remediation timer. The SIEM correlator links the violation to any related security alerts, providing full incident context.

---

### J04 — Penalty Issuance

**Stakeholders:** Government Staff, Legal Officer, Finance Officer

**Platform Services Used:** Financial Enforcement (`/financial`), Compliance Engine (Layer 3), Portal Review (`/portal-review`)

**Middleware:** TigerBeetle (debit org account, credit government penalty fund), Kafka (`penalty.issued` topic), Temporal (penalty workflow with appeal window), Delta Lake (penalty record)

**Problem Solved:** Penalty issuance was a manual, paper-based process prone to calculation errors, inconsistent application across sectors, and long delays between violation detection and financial consequence. There was no auditable ledger of penalty transactions.

**Value Delivered:** Government staff issue penalties through a structured workflow that calculates the penalty amount based on violation severity, organisation size, and sector risk multiplier. TigerBeetle records the transaction as a double-entry ledger entry — debiting the organisation's compliance account and crediting the national enforcement fund — ensuring ACID guarantees and an immutable financial audit trail. A Temporal workflow manages the 30-day appeal window, automatically escalating to legal review if contested.

---

### J05 — Penalty Payment

**Stakeholders:** Organisation Admin, Finance Officer

**Platform Services Used:** Financial Enforcement (`/financial`), Universal Portal (`/portal`)

**Middleware:** TigerBeetle (payment settlement), Kafka (`penalty.paid` topic), Delta Lake (payment record), Redis (payment status caching)

**Problem Solved:** Organisations had no integrated payment mechanism within the compliance platform. Payments were made through separate banking channels with no automatic reconciliation against outstanding penalties, leading to disputes and delayed compliance status updates.

**Value Delivered:** Organisation admins initiate penalty payments through the portal, which triggers a TigerBeetle settlement transaction. The payment is recorded as a credit against the organisation's penalty account, and the compliance score is automatically updated to reflect the resolved liability. The Finance Officer receives a real-time notification via the Kafka `penalty.paid` event, and the Delta Lake ingests the settlement record for regulatory reporting.

---

### J06 — Cross-Border Transfer Approval

**Stakeholders:** Data Protection Officer, Regulator, Organisation Admin

**Platform Services Used:** Transfer Approvals (`/transfers`), ML Pipeline, Compliance Engine (Layer 3)

**Middleware:** ML Pipeline (transfer risk assessment), Keycloak (DPO authorisation), Temporal (approval workflow with deadline), Kafka (`transfer.requested` topic), Delta Lake (transfer record)

**Problem Solved:** Cross-border data transfers were unregulated and untracked. Organisations transferred sensitive national data to foreign jurisdictions without pre-approval, risk assessment, or audit trail. Regulators had no mechanism to enforce data localisation requirements.

**Value Delivered:** Organisations submit transfer requests specifying destination country, data classification, volume, purpose, and recipient type. The ML Pipeline assesses transfer risk using destination country risk scores and data sensitivity multipliers. The DPO and Regulator receive the risk assessment alongside the request. A Temporal workflow enforces a 72-hour review deadline, automatically escalating to the Regulator if the DPO does not respond. Approved transfers are recorded in the Delta Lake; denied transfers trigger a compliance violation record.

---

### J07 — Network Traffic Blocking

**Stakeholders:** Technical Officer, Government Staff

**Platform Services Used:** Network DPI (Layer 5), Arkime PCAP (`/pcap`), BGP Routes (`/bgp`)

**Middleware:** Dapr (blocking command to DPI Engine), Kafka (`network.blocked` topic), Fluvio (real-time traffic telemetry)

**Problem Solved:** When illegal data exfiltration or unauthorised cross-border transfers were detected, there was no automated mechanism to block the traffic at the network layer. Manual intervention required coordination between multiple agencies and took hours.

**Value Delivered:** The DPI Engine worker (Go, port 8081) monitors network traffic at IXP enforcement points using Suricata/Zeek signatures. When a blocking rule is triggered — either by a Temporal enforcement workflow or a manual government staff action — a Dapr service invocation command is sent to the DPI Engine, which applies a BGP blackhole route within seconds. The blocking action is published to the `network.blocked` Kafka topic, recorded in the Delta Lake, and visible in real-time on the Network DPI dashboard.

---

### J08 — BGP Hijack Response

**Stakeholders:** Technical Officer, Government Staff

**Platform Services Used:** BGP Routes (`/bgp`), Discovery Engine (Layer 1), Network DPI (Layer 5)

**Middleware:** Kafka (`bgp.hijack.detected` topic), Temporal (incident response workflow), Dapr (alert to SIEM), Fluvio (real-time BGP telemetry)

**Problem Solved:** BGP hijacking — where malicious actors reroute national internet traffic through foreign infrastructure — was detectable only after significant damage had occurred. There was no automated detection or response capability.

**Value Delivered:** The BGP Route Validator worker (Rust, port 8088) performs continuous RPKI validation of all BGP route announcements. When a hijack or route leak is detected, it publishes a `bgp.hijack.detected` Kafka event, which triggers a Temporal incident response workflow. The workflow automatically notifies the Technical Officer, creates a SIEM incident record, and initiates a blocking action through the DPI Engine. The full incident timeline is recorded in the Delta Lake for post-incident analysis.

---

### J09 — Threat Intelligence Ingestion

**Stakeholders:** Technical Officer, Auditor

**Platform Services Used:** SIEM & Audit Trail (Layer 4), Discovery Engine (Layer 1)

**Middleware:** Kafka (`threat.intel.ingested` topic), Dapr (pub/sub to SIEM correlator), Delta Lake (threat intel record), Fluvio (real-time IOC streaming)

**Problem Solved:** Threat intelligence from external sources (OpenCTI, MISP, government feeds) was not integrated into the compliance platform. Security teams operated in silos, and threat indicators were not correlated with compliance violations or network events.

**Value Delivered:** The SIEM Alert Correlator worker (Python, port 8085) ingests threat intelligence from multiple sources, maps indicators to the MITRE ATT&CK framework, and correlates them with existing security alerts and compliance violations. New threat indicators are published to the `threat.intel.ingested` Kafka topic and ingested into the Delta Lake. The SIEM dashboard displays a live threat intelligence feed with MITRE tactic mapping and confidence scores.

---

### J10 — Incident Response Workflow

**Stakeholders:** Government Staff, Technical Officer, Legal Officer

**Platform Services Used:** SIEM & Audit Trail (Layer 4), Compliance Engine (Layer 3), Network DPI (Layer 5)

**Middleware:** Temporal (multi-step incident workflow), Kafka (`incident.created` topic), Dapr (cross-service coordination), Delta Lake (incident record)

**Problem Solved:** Incident response was uncoordinated — different teams used different tools, there was no single source of truth for incident status, and post-incident reports were incomplete. SLA breaches during incident response were common.

**Value Delivered:** When a critical security alert is correlated with a compliance violation, the SIEM Correlator triggers a Temporal incident response workflow. The workflow coordinates actions across the Technical Officer (network blocking), Legal Officer (evidence preservation), and Government Staff (enforcement action initiation) with defined SLA timers at each step. The SLA Tracker worker (Rust, port 8102) monitors deadlines and escalates automatically. The complete incident timeline is recorded in the Delta Lake.

---

### J11 — Data Residency Audit

**Stakeholders:** Auditor, Data Protection Officer, Organisation Admin

**Platform Services Used:** Data Catalog (Layer 2), Compliance Engine (Layer 3), Continuous Monitoring (`/monitoring`)

**Middleware:** ML Pipeline (residency risk scoring), Delta Lake (audit record), Kafka (`residency.audit.completed` topic)

**Problem Solved:** Organisations frequently stored data in cloud regions outside the national jurisdiction without declaring it. Auditors had no automated tool to verify data residency claims against actual storage locations.

**Value Delivered:** The Data Residency Enforcer worker (Rust, port 8089) continuously checks declared storage locations against geospatial residency rules. The ML Pipeline's compliance predictor assesses the probability of residency violations based on organisation profile and historical patterns. Audit results are recorded in the Delta Lake and displayed on the Data Catalog geospatial map. Organisations with residency violations receive automated remediation notices with a 30-day cure period.

---

### J12 — IPAM Allocation

**Stakeholders:** Technical Officer, Government Staff

**Platform Services Used:** Discovery Engine (Layer 1), Network DPI (Layer 5)

**Middleware:** APISIX (route to IPAM service), Dapr (IPAM state management), Kafka (`ipam.allocated` topic)

**Problem Solved:** IP address allocation was managed by individual organisations without central oversight. Duplicate allocations, unregistered address blocks, and unauthorised routing were common, making it impossible to enforce data localisation at the network layer.

**Value Delivered:** The NetBox IPAM worker (Go, port 8091) maintains a central registry of all IP allocations, subnets, and routing policies. APISIX routes IPAM API requests through the gateway with rate limiting and JWT validation. New allocations are published to the `ipam.allocated` Kafka topic and stored in Dapr's state store for fast lookup by the DPI Engine. The Discovery Engine dashboard displays a live network topology map with VLAN and subnet data.

---

### J13 — Data Residency Violation

**Stakeholders:** Government Staff, Data Protection Officer, Organisation Admin

**Platform Services Used:** Data Catalog (Layer 2), Compliance Engine (Layer 3), Financial Enforcement (`/financial`)

**Middleware:** Temporal (residency violation workflow), Kafka (`residency.violation.detected` topic), Delta Lake (violation record), TigerBeetle (penalty ledger entry)

**Problem Solved:** Data residency violations — storing national data in foreign jurisdictions — had no automated detection or enforcement pathway. By the time violations were discovered manually, data had often been processed or shared with foreign entities.

**Value Delivered:** When the Data Residency Enforcer detects a violation, it publishes a `residency.violation.detected` Kafka event. A Temporal workflow initiates a 48-hour cure period, notifying the organisation and DPO. If the violation is not remediated, the workflow automatically creates a compliance violation record, triggers a penalty issuance (J04), and escalates to the Government Staff for enforcement action. The complete violation lifecycle is recorded in the Delta Lake.

---

### J14 — ML Risk Score Update

**Stakeholders:** Government Staff, Auditor, Technical Officer

**Platform Services Used:** Government Dashboard (`/`), Continuous Monitoring (`/monitoring`), ML Pipeline

**Middleware:** ML Pipeline (live DB risk scoring), Kafka (`risk.score.updated` topic), Redis (score cache invalidation), Delta Lake (score history)

**Problem Solved:** Risk scores were static — calculated once during onboarding and rarely updated. This meant that organisations that improved their compliance posture were not rewarded, and deteriorating organisations were not flagged until a manual audit.

**Value Delivered:** The ML Pipeline v2.2.0 pulls live training data from PostgreSQL — including recent violations, penalties, security alerts, and cross-border transfers — to compute updated risk scores. Scores are published to the `risk.score.updated` Kafka topic, which invalidates the Redis cache and triggers a Delta Lake ingestion. The Government Dashboard displays a live risk trend chart showing score trajectories over time. The nightly Temporal cron workflow retrains the model weights using the latest data.

---

### J15 — Compliance Audit Trail

**Stakeholders:** Auditor, Legal Officer, Government Staff

**Platform Services Used:** SIEM & Audit Trail (Layer 4), all platform services

**Middleware:** Dapr (audit event pub/sub), Delta Lake (7-year immutable audit log), Kafka (`audit.trail.entry` topic)

**Problem Solved:** Audit trails were fragmented across multiple systems, making it impossible to reconstruct a complete timeline of events for regulatory investigations or legal proceedings. There was no tamper-evident log.

**Value Delivered:** Every significant platform action — from user logins to penalty issuances to network blocking events — publishes an `audit.trail.entry` Kafka event via Dapr. The Delta Lake ingests these events into an immutable, append-only audit log with 7-year retention. The SIEM & Audit Trail dashboard provides a searchable, filterable view of the complete audit history. The `orchestration.auditTrail` tRPC mutation ensures that orchestration layer actions are also captured in the audit trail.

---

### J16 — Regulatory Report Generation

**Stakeholders:** Auditor, Regulator, Government Staff

**Platform Services Used:** Government Dashboard (`/`), Financial Enforcement (`/financial`), Compliance Engine (Layer 3)

**Middleware:** Delta Lake (report data source), ML Pipeline (trend analysis), Kafka (`report.generated` topic)

**Problem Solved:** Regulatory reports required weeks of manual data collection from disparate systems. Reports were often incomplete, inconsistent, and not comparable across reporting periods.

**Value Delivered:** The Delta Lake serves as the single source of truth for all regulatory reporting data. The ML Pipeline provides trend analysis and predictive insights. Reports are generated on-demand from the Government Dashboard, covering compliance scores, violation trends, penalty collections, cross-border transfer volumes, and network enforcement actions. The Lakehouse worker (Python, port 8210) pre-aggregates data into reporting tables, enabling sub-second report generation.

---

### J17 — Compliance Certificate Issuance

**Stakeholders:** Government Staff, Auditor, Organisation Admin

**Platform Services Used:** Portal Review (`/portal-review`), Universal Portal (`/portal`), Compliance Engine (Layer 3)

**Middleware:** Keycloak (certificate signing), Kafka (`certificate.issued` topic), Delta Lake (certificate record), Dapr (notification to organisation)

**Problem Solved:** Compliance certificates were issued manually on paper, with no digital verification mechanism. Organisations could not prove their compliance status to partners or regulators without contacting the authority directly.

**Value Delivered:** When an organisation completes the portal review process and achieves a compliance score above the threshold, a government staff member can issue a digital compliance certificate from the Portal Review page. The certificate is generated as a signed HTML document, recorded in the Delta Lake, and a `certificate.issued` Kafka event notifies the organisation via Dapr. The certificate includes a unique identifier, issue date, expiry date, and compliance score at time of issuance.

---

### J18 — Revenue Distribution

**Stakeholders:** Finance Officer, Government Staff

**Platform Services Used:** Financial Enforcement (`/financial`)

**Middleware:** TigerBeetle (multi-leg distribution transaction), Kafka (`revenue.distributed` topic), Delta Lake (distribution record)

**Problem Solved:** Penalty revenue collected from non-compliant organisations had no transparent distribution mechanism. Funds accumulated in a single account with no audit trail for how they were allocated to enforcement agencies, technology infrastructure, or capacity-building programmes.

**Value Delivered:** The Finance Officer initiates a revenue distribution from the Financial Enforcement page, specifying allocation percentages for each recipient (enforcement agency, technology fund, capacity building, etc.). TigerBeetle executes the distribution as a multi-leg double-entry transaction, ensuring that total debits equal total credits. The distribution is published to the `revenue.distributed` Kafka topic and recorded in the Delta Lake for annual reporting.

---

### J19 — Temporal Workflow Execution

**Stakeholders:** Technical Officer, Government Staff

**Platform Services Used:** Temporal Workflows (`/temporal`), all enforcement workflows

**Middleware:** Temporal (workflow scheduling, retry, timeout), Kafka (`workflow.triggered` topic), Dapr (activity invocation)

**Problem Solved:** Long-running enforcement processes — penalty appeals, residency violation remediation, cross-border transfer reviews — had no reliable execution guarantee. If a system failed mid-process, the workflow would need to be restarted manually from the beginning.

**Value Delivered:** All multi-step enforcement processes are implemented as Temporal workflows with durable execution guarantees. If any activity fails, Temporal automatically retries with exponential backoff. If the entire system restarts, workflows resume from their last checkpoint. The Temporal Workflows dashboard displays the status of all active workflows, their current step, elapsed time, and SLA status. The `orchestration.triggerWorkflow` tRPC mutation allows government staff to manually trigger workflows from the UI.

---

### J20 — Penalty Dispute (Escrow)

**Stakeholders:** Organisation Admin, Legal Officer, Government Staff

**Platform Services Used:** Financial Enforcement (`/financial`), Portal Review (`/portal-review`)

**Middleware:** TigerBeetle (escrow account), Temporal (dispute workflow with 30-day window), Kafka (`penalty.disputed` topic), Delta Lake (dispute record)

**Problem Solved:** Organisations had no formal mechanism to dispute penalties. Disputes were handled informally, with no escrow mechanism to hold funds during the review period and no defined timeline for resolution.

**Value Delivered:** When an organisation disputes a penalty, TigerBeetle moves the penalty amount from the organisation's compliance account to a neutral escrow account. A Temporal workflow manages the 30-day dispute window, during which the Legal Officer reviews the evidence. If the dispute is upheld, the escrow is released back to the organisation. If dismissed, the escrow is transferred to the enforcement fund. The complete dispute timeline is recorded in the Delta Lake.

---

### J21 — IXP Enforcement Action

**Stakeholders:** Technical Officer, Government Staff

**Platform Services Used:** Network DPI (Layer 5), BGP Routes (`/bgp`)

**Middleware:** Dapr (blocking command), Kafka (`ixp.enforcement.action` topic), Fluvio (real-time IXP telemetry)

**Problem Solved:** Internet Exchange Points (IXPs) are critical enforcement points for data sovereignty, but enforcement actions at IXPs required manual coordination with IXP operators, taking hours or days.

**Value Delivered:** The DPI Engine worker monitors all traffic at registered IXP enforcement sites. When an enforcement action is required — triggered by a Temporal workflow or manual government staff action — a Dapr service invocation command is sent directly to the IXP enforcement agent, applying the blocking rule within seconds. The action is published to the `ixp.enforcement.action` Kafka topic and visible in real-time on the Network DPI dashboard's IXP enforcement sites panel.

---

### J22 — Lakehouse Data Ingestion

**Stakeholders:** Technical Officer, Auditor

**Platform Services Used:** Data Catalog (Layer 2), all platform services

**Middleware:** Delta Lake (ingestion pipeline), Kafka (source topics), Dapr (ingestion trigger)

**Problem Solved:** Compliance and enforcement data was stored in operational databases that were not optimised for analytical queries. Generating reports required expensive queries against production databases, impacting platform performance.

**Value Delivered:** The Lakehouse worker (Python, port 8210) continuously ingests data from all Kafka topics into Delta Lake tables — organisations, violations, penalties, transfers, network events, audit logs, threat intelligence, and ML predictions. Delta Lake's ACID transactions and time-travel capabilities enable point-in-time queries for regulatory investigations. The Lakehouse serves as the analytical layer for all reporting and ML training, completely decoupled from the operational database.

---

### J23 — Prometheus Metrics Scrape

**Stakeholders:** Technical Officer

**Platform Services Used:** Prometheus Metrics (`/metrics`), all workers

**Middleware:** APISIX (metrics endpoint routing), Dapr (metrics aggregation), Kafka (`metrics.scraped` topic)

**Problem Solved:** Platform health metrics were scattered across individual worker endpoints with no centralised monitoring. There was no alerting mechanism for degraded service performance or capacity issues.

**Value Delivered:** The Prometheus Metrics Exporter worker (Go, port 8098) aggregates metrics from all 21 platform workers and exposes them in Prometheus format. APISIX routes scrape requests through the gateway with authentication. The Metrics dashboard displays 30+ metrics across five categories: compliance, network, financial, security, and infrastructure. AlertManager rules trigger notifications when critical thresholds are breached.

---

### J24 — Arkime PCAP Capture

**Stakeholders:** Technical Officer, Auditor, Legal Officer

**Platform Services Used:** Arkime PCAP (`/pcap`), Network DPI (Layer 5)

**Middleware:** Kafka (`pcap.session.indexed` topic), Delta Lake (session metadata), Fluvio (real-time packet telemetry)

**Problem Solved:** Network forensic evidence was not systematically captured or preserved. When a legal case required packet-level evidence of data exfiltration, the evidence was often unavailable or inadmissible due to chain-of-custody issues.

**Value Delivered:** The Arkime PCAP worker (Go, port 8099) captures and indexes full packet sessions at all IXP enforcement points, maintaining a 600TB rolling buffer with TLS decryption capability. Session metadata is published to the `pcap.session.indexed` Kafka topic and ingested into the Delta Lake for long-term preservation. The PCAP dashboard provides a forensic search interface — filtering by IP address, protocol, time range, session size, and IXP site — enabling auditors and legal officers to retrieve specific sessions for evidence.

---

### J25 — Financial Reconciliation

**Stakeholders:** Finance Officer, Auditor

**Platform Services Used:** Financial Enforcement (`/financial`)

**Middleware:** TigerBeetle (ledger reconciliation), Delta Lake (reconciliation report), Kafka (`reconciliation.completed` topic)

**Problem Solved:** Monthly financial reconciliation between penalty collections, distributions, and outstanding liabilities was a manual, error-prone process that took days to complete and frequently produced discrepancies.

**Value Delivered:** The `orchestration.reconcile` tRPC mutation triggers a TigerBeetle reconciliation query that verifies that all double-entry transactions balance — total debits equal total credits across all accounts. The reconciliation result is published to the `reconciliation.completed` Kafka topic and ingested into the Delta Lake as a point-in-time financial snapshot. Discrepancies are automatically flagged and routed to the Finance Officer for investigation.

---

### J26 — Security Incident Escalation

**Stakeholders:** Government Staff, Technical Officer, Legal Officer

**Platform Services Used:** SIEM & Audit Trail (Layer 4), Compliance Engine (Layer 3)

**Middleware:** Keycloak (role-based escalation routing), Temporal (escalation workflow), Kafka (`incident.escalated` topic), Dapr (cross-service notification)

**Problem Solved:** Critical security incidents — particularly those with compliance implications — were not automatically escalated to the appropriate authority level. Incidents frequently remained at the technical level without triggering the legal or enforcement response they required.

**Value Delivered:** When the SIEM Correlator classifies an incident as critical (CVSS ≥ 9.0 or involving a compliance violation), it triggers a Temporal escalation workflow. Keycloak's role-based routing ensures that the incident is simultaneously assigned to the Technical Officer (for containment), Legal Officer (for evidence preservation), and Government Staff (for enforcement action). Each role has a defined SLA, monitored by the SLA Tracker worker. The escalation chain is fully recorded in the Delta Lake.

---

### J27 — Streaming Event Processing

**Stakeholders:** Technical Officer, Auditor

**Platform Services Used:** Streaming Events (`/streaming`), Network DPI (Layer 5), SIEM (Layer 4)

**Middleware:** Kafka (event streaming), Fluvio (edge telemetry), Dapr (stream processing), Delta Lake (stream ingestion)

**Problem Solved:** Real-time event data from network sensors, compliance workers, and security tools was not processed or stored in a way that enabled real-time analysis or historical replay.

**Value Delivered:** The Fluvio Edge Telemetry worker (Python, port 8086) ingests real-time telemetry from network sensors and publishes it to Fluvio topics. The Dapr Bindings service subscribes to these topics and routes events to the appropriate downstream services — SIEM for security events, Compliance Engine for policy violations, and Delta Lake for archival. The Streaming Events dashboard displays live throughput charts, topic registry, and a real-time event feed with filtering by topic and event type.

---

### J28 — Violation Remediation

**Stakeholders:** Organisation Admin, Government Staff, Auditor

**Platform Services Used:** Compliance Engine (Layer 3), Portal Review (`/portal-review`), Continuous Monitoring (`/monitoring`)

**Middleware:** Temporal (remediation workflow with deadline), Kafka (`violation.remediated` topic), Delta Lake (remediation record), Redis (score cache invalidation)

**Problem Solved:** After a violation was detected, there was no structured remediation process. Organisations did not know what actions to take, government staff had no visibility into remediation progress, and compliance scores were not updated when violations were resolved.

**Value Delivered:** When a violation is detected, the Temporal enforcement workflow automatically generates a remediation plan with specific actions and a deadline. The organisation receives the plan through the portal and can submit evidence of remediation. Government staff review the evidence and mark the violation as remediated, triggering a compliance score recalculation by the ML Pipeline. The complete remediation timeline is recorded in the Delta Lake and visible on the Continuous Monitoring dashboard.

---

### J29 — SLA Breach Prediction

**Stakeholders:** Government Staff, Technical Officer

**Platform Services Used:** Continuous Monitoring (`/monitoring`), Temporal Workflows (`/temporal`)

**Middleware:** ML Pipeline (SLA breach prediction), Kafka (`sla.breach.predicted` topic), Dapr (proactive alert), Redis (prediction caching)

**Problem Solved:** SLA breaches in enforcement workflows were discovered only after they occurred, making it impossible to take preventive action. Repeated SLA breaches damaged the platform's credibility with regulated organisations.

**Value Delivered:** The ML Pipeline's `sla_breach_predictor_v1.0` model calculates breach probability for each active Temporal workflow based on elapsed time, SLA deadline, and workflow complexity score. When breach probability exceeds 70%, a `sla.breach.predicted` Kafka event is published, triggering a Dapr notification to the responsible officer. The Continuous Monitoring dashboard displays a live SLA breach risk panel, enabling proactive intervention before deadlines are missed.

---

### J30 — Regulatory Submission

**Stakeholders:** Regulator, Government Staff, Auditor

**Platform Services Used:** Government Dashboard (`/`), Data Catalog (Layer 2), Financial Enforcement (`/financial`)

**Middleware:** APISIX (regulatory API gateway), Keycloak (regulator authentication), Delta Lake (submission data), Kafka (`regulatory.submission.completed` topic)

**Problem Solved:** Regulatory submissions to international bodies (AU, ITU, ECOWAS) required manual compilation of data from multiple systems, with no standardised format and no automated submission mechanism.

**Value Delivered:** The APISIX gateway exposes a dedicated regulatory submission API endpoint, authenticated via Keycloak's regulator role. The submission data is compiled from the Delta Lake — covering compliance statistics, enforcement actions, penalty collections, and cross-border transfer volumes — in a standardised format. The submission is published to the `regulatory.submission.completed` Kafka topic and recorded in the Delta Lake for audit purposes. The Government Dashboard provides a submission history panel with status tracking.

---

## Journey-to-Middleware Matrix

| Journey | Kafka | Dapr | Temporal | Keycloak | Permify | Redis | APISIX | TigerBeetle | Delta Lake | Fluvio |
|---------|-------|------|----------|----------|---------|-------|--------|-------------|------------|--------|
| J01 Registration | ✔ | ✔ | | ✔ | | ✔ | | | ✔ | |
| J02 Assessment | ✔ | | | | | ✔ | | | ✔ | |
| J03 Violation | ✔ | ✔ | ✔ | | | | | | ✔ | |
| J04 Penalty Issue | ✔ | | ✔ | | | | | ✔ | ✔ | |
| J05 Penalty Pay | ✔ | | | | | ✔ | | ✔ | ✔ | |
| J06 Transfer | ✔ | | ✔ | ✔ | | | | | ✔ | |
| J07 Blocking | ✔ | ✔ | | | | | | | | ✔ |
| J08 BGP Hijack | ✔ | ✔ | ✔ | | | | | | ✔ | ✔ |
| J09 Threat Intel | ✔ | ✔ | | | | | | | ✔ | ✔ |
| J10 Incident | ✔ | ✔ | ✔ | | | | | | ✔ | |
| J11 Residency Audit | ✔ | | | | | | | | ✔ | |
| J12 IPAM | ✔ | ✔ | | | | | ✔ | | | |
| J13 Residency Viol. | ✔ | | ✔ | | | | | ✔ | ✔ | |
| J14 Risk Score | ✔ | | | | | ✔ | | | ✔ | |
| J15 Audit Trail | ✔ | ✔ | | | | | | | ✔ | |
| J16 Report Gen. | ✔ | | | | | | | | ✔ | |
| J17 Certificate | ✔ | ✔ | | ✔ | | | | | ✔ | |
| J18 Revenue Dist. | ✔ | | | | | | | ✔ | ✔ | |
| J19 Workflow Exec. | ✔ | ✔ | ✔ | | | | | | | |
| J20 Dispute Escrow | ✔ | | ✔ | | | | | ✔ | ✔ | |
| J21 IXP Enforce. | ✔ | ✔ | | | | | | | | ✔ |
| J22 Lakehouse | ✔ | ✔ | | | | | | | ✔ | |
| J23 Prometheus | ✔ | ✔ | | | | | ✔ | | | |
| J24 PCAP Capture | ✔ | | | | | | | | ✔ | ✔ |
| J25 Reconciliation | ✔ | | | | | | | ✔ | ✔ | |
| J26 Escalation | ✔ | ✔ | ✔ | ✔ | | | | | ✔ | |
| J27 Streaming | ✔ | ✔ | | | | | | | ✔ | ✔ |
| J28 Remediation | ✔ | | ✔ | | | ✔ | | | ✔ | |
| J29 SLA Prediction | ✔ | ✔ | | | | ✔ | | | | |
| J30 Reg. Submission | ✔ | | | ✔ | | | ✔ | | ✔ | |

---

## Stakeholder Role Coverage

| Role | Primary Journeys | Secondary Journeys |
|------|-----------------|-------------------|
| **Government Staff** | J03, J04, J07, J08, J17, J21 | J01, J02, J10, J13, J16, J19, J26, J30 |
| **Auditor** | J02, J11, J15, J16, J24 | J01, J09, J10, J22, J23 |
| **Organisation Admin** | J01, J05, J06, J20, J28 | J11, J13, J17 |
| **Data Protection Officer** | J06, J11, J13, J17 | J01, J02 |
| **Regulator** | J06, J16, J30 | J02, J11 |
| **Legal Officer** | J04, J10, J20, J24, J26 | J03, J15 |
| **Finance Officer** | J05, J18, J25 | J04, J20 |
| **Technical Officer** | J07, J08, J09, J12, J21, J23, J24, J27, J29 | J10, J19 |
| **Organisation User** | J01, J05, J28 | J06 |
| **Admin** | All journeys | — |

---

*Document generated by NDSEP Platform — March 2026*
*Orchestration Layer v2.2.0 | 8 microservices | 10 middleware components | 30 stakeholder journeys*
