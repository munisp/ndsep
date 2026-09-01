/**
 * NDSEP Worker Process Manager
 * =============================
 * Spawns and supervises all Go and Python background microservices:
 *
 * Go Workers:
 *   - dpi_engine       (Layer 5: DPI, IXP monitoring, blocking)
 *   - discovery_agent  (Layer 1: Asset discovery heartbeat)
 *   - compliance_engine (Layer 3: Compliance scoring)
 *   - kafka_monitor    (Streaming: Kafka + Fluvio metrics)
 *
 * Python Workers:
 *   - ml_prediction_worker.py  (Layer 6: ML risk prediction)
 *   - siem_correlator.py       (Layer 4: Wazuh + OpenCTI alerts)
 *   - fluvio_telemetry.py      (Layer 5: Fluvio edge ingestion)
 *
 * Each worker:
 *   - Runs as a child process
 *   - Has its own HTTP status endpoint (/health, /status, /metrics)
 *   - Posts events to /api/workers/event which relays via WebSocket
 *   - Is auto-restarted on crash (with exponential backoff)
 */

import { spawn, execSync, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { getDatabaseUrl } from "./config";
import { logger } from "./logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKERS_DIR = path.join(__dirname, "..", "workers");
const BIN_DIR = path.join(WORKERS_DIR, "bin");
const PYTHON_DIR = path.join(WORKERS_DIR, "python");
const GO_DIR = path.join(WORKERS_DIR, "go", "bin");

// ─────────────────────────────────────────────────────────────────────────────
// Worker Definitions
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkerDef {
  id: string;
  name: string;
  layer: string;
  language: "Go" | "Python" | "Rust";
  command: string;
  args: string[];
  port: number;
  env: Record<string, string>;
  description: string;
  technology: string;
}

const _rawDbUrl = getDatabaseUrl();
const DB_URL = _rawDbUrl.includes("sslmode=") ? _rawDbUrl : _rawDbUrl + "?sslmode=disable";
const RELAY_URL = process.env.WORKER_RELAY_URL ?? "http://localhost:3000/api/workers/event";
const ENABLE_CANDIDATE_ML_FOUNDATION = process.env.NDSEP_ENABLE_CANDIDATE_ML_FOUNDATION === "true";

export const WORKER_DEFS: WorkerDef[] = [
  {
    id: "dpi-engine",
    name: "Layer 5 DPI Engine",
    layer: "L5",
    language: "Go",
    command: path.join(BIN_DIR, "dpi_engine"),
    args: [],
    port: 8081,
    env: { DPI_PORT: "8081", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description:
      "Deep Packet Inspection engine with Suricata/Zeek simulation, IXP monitoring, and blocking mechanism triggers.",
    technology: "Go · Suricata · Zeek · nDPI · IXP",
  },
  {
    id: "discovery-agent",
    name: "Discovery Agent Heartbeat",
    layer: "L1",
    language: "Go",
    command: path.join(BIN_DIR, "discovery_agent"),
    args: [],
    port: 8082,
    env: { DISCOVERY_PORT: "8082", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description:
      "Scans all registered organizations for new assets, updates heartbeats, and triggers vulnerability assessments.",
    technology: "Go · NMAP · Censys · CloudQuery · GLPI",
  },
  {
    id: "compliance-engine",
    name: "Compliance Scoring Engine",
    layer: "L3",
    language: "Go",
    command: path.join(BIN_DIR, "compliance_engine"),
    args: [],
    port: 8083,
    env: { COMPLIANCE_PORT: "8083", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description:
      "Evaluates OPA policies, recalculates compliance scores, detects cross-border violations, and triggers Temporal enforcement workflows.",
    technology: "Go · OPA · Temporal · PostgreSQL",
  },
  {
    id: "kafka-monitor",
    name: "Kafka Broker Monitor",
    layer: "Streaming",
    language: "Go",
    command: path.join(BIN_DIR, "kafka_monitor"),
    args: [],
    port: 8084,
    env: { KAFKA_PORT: "8084", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description:
      "Monitors 16 Kafka topics and 4 Fluvio edge streams. Tracks consumer lag, broker health, and produces synthetic events.",
    technology: "Go · Apache Kafka · Fluvio · Confluent",
  },
  {
    id: "ml-prediction",
    name: "ML Prediction Worker",
    layer: "L6",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "ml_prediction_worker.py")],
    port: 8085,
    env: {
      ML_PORT: "8085",
      WORKER_DATABASE_URL: getDatabaseUrl(),
      WORKER_RELAY_URL: RELAY_URL,
    },
    description:
      "scikit-learn Random Forest risk classification + Isolation Forest anomaly detection. Runs predictions every 25 seconds.",
    technology: "Python · scikit-learn · numpy · Apache Sedona · Ray",
  },
  ...(ENABLE_CANDIDATE_ML_FOUNDATION ? [{
    id: "ml-foundation-candidate",
    name: "CPU Candidate ML Foundation",
    layer: "L6",
    language: "Python" as const,
    command: "python3",
    args: [path.join(PYTHON_DIR, "ml_foundation", "service.py")],
    port: 8251,
    env: {
      NDSEP_ML_PORT: "8251",
      NDSEP_ML_MODEL_DIR: process.env.NDSEP_ML_MODEL_DIR ?? "/var/lib/ndsep-ml/models",
    },
    description: "Signed synthetic-only CPU MLP and GraphSAGE candidate inference. Returns human-review support only; no automated enforcement.",
    technology: "Python · PyTorch CPU · PyTorch Geometric · signed artifacts",
  }] : []),
  {
    id: "siem-correlator",
    name: "SIEM Alert Correlator",
    layer: "L4",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "siem_correlator.py")],
    port: 8086,
    env: {
      SIEM_PORT: "8086",
      WORKER_DATABASE_URL: getDatabaseUrl(),
      WORKER_RELAY_URL: RELAY_URL,
    },
    description:
      "Wazuh rule-based alert generation, OpenCTI threat intelligence enrichment, MITRE ATT&CK mapping, and 7-year audit log writing.",
    technology: "Python · Wazuh · OpenCTI · OpenSearch · Elastic SIEM",
  },
  {
    id: "fluvio-telemetry",
    name: "Fluvio Edge Telemetry",
    layer: "L5",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "fluvio_telemetry.py")],
    port: 8087,
    env: {
      FLUVIO_PORT: "8087",
      WORKER_DATABASE_URL: getDatabaseUrl(),
      WORKER_RELAY_URL: RELAY_URL,
    },
    description:
      "Ingests low-latency edge telemetry from 4 IXP sites via Fluvio streams. Performs real-time DDoS detection, bandwidth anomaly analysis, and cross-border flow enforcement.",
    technology: "Python · Fluvio · Apache Kafka · IXP Edge Nodes · DDoS Detection",
  },
  // ─── New Workers: Full Spec Coverage ───────────────────────────────────────
  {
    id: "netbox-ipam",
    name: "NetBox IPAM",
    layer: "L1",
    language: "Go",
    command: path.join(BIN_DIR, "netbox_ipam"),
    args: [],
    port: 8091,
    env: { WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "NetBox network topology mapping and IP Address Management (IPAM). Tracks subnets, VLANs, and IP allocations across all national data centres.",
    technology: "Go · NetBox · IPAM · VLANs · Network Topology",
  },
  {
    id: "nmap-scanner",
    name: "Nmap/ZMap/Masscan Scanner",
    layer: "L1",
    language: "Go",
    command: path.join(BIN_DIR, "nmap_scanner"),
    args: [],
    port: 8092,
    env: { WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Active network scanning with Nmap (detailed), ZMap (internet-scale), and Masscan (high-speed). Detects undeclared devices and cross-references with Shodan passive recon.",
    technology: "Go · Nmap · ZMap · Masscan · Shodan API",
  },
  {
    id: "falco-steampipe",
    name: "Falco + Steampipe",
    layer: "L4+L1",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "falco_steampipe.py")],
    port: 8093,
    env: {
      WORKER_DATABASE_URL: getDatabaseUrl(),
      WORKER_RELAY_URL: RELAY_URL,
    },
    description: "Falco cloud-native runtime threat detection (syscall monitoring, container drift, privilege escalation) + Steampipe live SaaS/cloud API querying for asset discovery.",
    technology: "Python · Falco · Steampipe · eBPF · Container Security",
  },
  {
    id: "egeria-openlineage",
    name: "Egeria + OpenLineage",
    layer: "L2",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "egeria_openlineage.py")],
    port: 8094,
    env: {
      WORKER_DATABASE_URL: getDatabaseUrl(),
      WORKER_RELAY_URL: RELAY_URL,
    },
    description: "Apache Egeria vendor-neutral metadata exchange + OpenLineage pipeline lineage capture from Airflow, Spark, and dbt. Tracks PII data flow and schema changes.",
    technology: "Python · Apache Egeria · OpenLineage · Apache Atlas · DataHub",
  },
  {
    id: "ranger-policy",
    name: "Apache Ranger Policy Engine",
    layer: "L3",
    language: "Go",
    command: path.join(BIN_DIR, "ranger_policy"),
    args: [],
    port: 8095,
    env: { WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Apache Ranger centralized security administration for Hadoop/Kafka. Enforces row-level security, column masking, and ACL policies across all data services.",
    technology: "Go · Apache Ranger · Hadoop · Kafka ACLs · Column Masking",
  },
  {
    id: "kyverno-policy",
    name: "Kyverno + Privacera",
    layer: "L3",
    language: "Go",
    command: path.join(BIN_DIR, "kyverno_policy"),
    args: [],
    port: 8096,
    env: { WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Kyverno Kubernetes-native policy engine (admission control, mutation) + Privacera unified data access governance with consent management and data minimization.",
    technology: "Go · Kyverno · Privacera · Kubernetes · GDPR Consent",
  },
  {
    id: "prometheus-exporter",
    name: "Prometheus + Grafana Exporter",
    layer: "L4",
    language: "Go",
    command: path.join(BIN_DIR, "prometheus_exporter"),
    args: [],
    port: 8098,
    env: { WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Prometheus metrics exporter scraping all NDSEP services. Feeds Grafana dashboards with compliance scores, risk scores, alert rates, and infrastructure health.",
    technology: "Go · Prometheus · Grafana · AlertManager · PromQL",
  },
  {
    id: "arkime-pcap",
    name: "Arkime Full Packet Capture",
    layer: "L5",
    language: "Go",
    command: path.join(BIN_DIR, "arkime_pcap"),
    args: [],
    port: 8099,
    env: { WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Arkime (formerly Moloch) full packet capture and indexing at all IXP sites. 600TB rolling buffer, TLS decryption, forensic session search, and anomaly detection.",
    technology: "Go · Arkime · PCAP · TLS Decryption · Elasticsearch",
  },
  {
    id: "compliance-rescorer",
    name: "Compliance Re-Scorer",
    layer: "MON",
    language: "Go",
    command: path.join(BIN_DIR, "compliance_rescorer"),
    args: [],
    port: 8100,
    env: { WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Continuously re-evaluates compliance scores for all organizations every 4 hours using OPA scoring engine. Detects score drift and triggers SLA breach checks.",
    technology: "Go · OPA · PostgreSQL · CUSUM · Scoring Engine",
  },
  {
    id: "drift-detector",
    name: "Compliance Drift Detector",
    layer: "MON",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "drift_detector.py")],
    port: 8101,
    env: { WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "ML-based compliance drift detection using Isolation Forest + CUSUM. Runs every 30 minutes to identify organizations showing anomalous degradation patterns.",
    technology: "Python · scikit-learn · IsolationForest · CUSUM · NumPy",
  },
  {
    id: "sla-tracker",
    name: "SLA Tracker",
    layer: "MON",
    language: "Rust",
    command: path.join(BIN_DIR, "sla_tracker"),
    args: [],
    port: 8102,
    env: { WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Evaluates 5 SLA dimensions per organization every hour: compliance score minimum, data residency violation rate, incident response time, audit log completeness, and open critical violations.",
    technology: "Rust · Tokio · PostgreSQL · SLA Management · Warp",
  },
  {
    id: "wiredigg",
    name: "Network Intelligence Engine",
    layer: "L1",
    language: "Rust",
    command: path.join(BIN_DIR, "wiredigg"),
    args: [],
    port: 8160,
    env: { WIREDIGG_PORT: "8160", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description:
      "Real-time packet capture, deep protocol dissection (40+ protocols), ML anomaly detection (Isolation Forest + Z-score), threat classification (27 types, MITRE ATT&CK mapped), IoT device fingerprinting, and NDPA compliance monitoring.",
    technology: "Rust · pnet · etherparse · Axum · Aho-Corasick · ndarray · Tokio",
  },
  {
    id: "audit-chain",
    name: "Blockchain Audit Trail",
    layer: "L1",
    language: "Rust",
    command: path.join(BIN_DIR, "audit_chain"),
    args: [],
    port: 8165,
    env: { AUDIT_CHAIN_PORT: "8165", WORKER_DATABASE_URL: DB_URL },
    description:
      "Tamper-proof audit logging with SHA-256 hash chains, Merkle tree aggregation, blockchain anchoring interface (Ethereum L2), and cryptographic proof generation for regulatory evidence.",
    technology: "Rust · Axum · SHA-256 · Merkle Trees · AES-256-GCM · Tokio",
  },
  {
    id: "quantum-crypto",
    name: "Post-Quantum Cryptography",
    layer: "L1",
    language: "Rust",
    command: path.join(BIN_DIR, "quantum_crypto"),
    args: [],
    port: 8185,
    env: { QUANTUM_CRYPTO_PORT: "8185" },
    description:
      "NIST-standardized post-quantum cryptographic operations: CRYSTALS-Kyber-768 key encapsulation, CRYSTALS-Dilithium3 digital signatures, hybrid encryption (ECDH+Kyber), and crypto-agility layer.",
    technology: "Rust · CRYSTALS-Kyber · CRYSTALS-Dilithium · AES-256-GCM · SHA3-256 · Axum",
  },
  {
    id: "ai-compliance-engine",
    name: "AI Compliance Engine",
    layer: "L2",
    language: "Python",
    command: "python3",
    args: [path.join(PYTHON_DIR, "ai_compliance_engine.py")],
    port: 8155,
    env: { AI_COMPLIANCE_PORT: "8155", OLLAMA_URL: process.env.OLLAMA_URL ?? "http://localhost:11434", WORKER_DATABASE_URL: DB_URL },
    description:
      "LLM-powered regulatory reasoning: natural language NDPA compliance queries, automated DPIA generation, AI-assisted gap analysis, regulatory change impact analysis. Uses Ollama (Llama 3.1) with Nigerian data residency.",
    technology: "Python · FastAPI · Ollama · Llama 3.1 · httpx · Pydantic",
  },
  {
    id: "federated-learning",
    name: "Federated Learning Service",
    layer: "L2",
    language: "Python",
    command: "python3",
    args: [path.join(PYTHON_DIR, "federated_learning.py")],
    port: 8170,
    env: { FEDERATED_LEARNING_PORT: "8170", WORKER_DATABASE_URL: DB_URL },
    description:
      "Privacy-preserving cross-organization threat intelligence via Federated Averaging (FedAvg) with differential privacy noise injection. Organizations share only model gradients, never raw data.",
    technology: "Python · FastAPI · Federated Averaging · Differential Privacy · Pydantic",
  },
  {
    id: "sovereign-ai",
    name: "Sovereign AI Infrastructure",
    layer: "L2",
    language: "Python",
    command: "python3",
    args: [path.join(PYTHON_DIR, "sovereign_ai.py")],
    port: 8180,
    env: { SOVEREIGN_AI_PORT: "8180", OLLAMA_URL: process.env.OLLAMA_URL ?? "http://localhost:11434" },
    description:
      "On-premises AI with Nigerian data residency guarantees: model provenance tracking, AI fairness monitoring, Nigerian language support (Yoruba, Hausa, Igbo, Pidgin), and model red-teaming framework.",
    technology: "Python · FastAPI · Ollama · i18n · Fairness Metrics · Pydantic",
  },
  {
    id: "digital-twin",
    name: "Digital Twin Engine",
    layer: "L2",
    language: "Go",
    command: path.join(GO_DIR, "digital_twin"),
    args: [],
    port: 8175,
    env: { DIGITAL_TWIN_PORT: "8175", WORKER_DATABASE_URL: DB_URL },
    description:
      "Digital twin of Nigeria's data ecosystem: sector-by-sector simulation, regulatory impact analysis (what-if scenarios), breach probability prediction, and cross-border data flow visualization.",
    technology: "Go · net/http · Simulation Engine · Monte Carlo · JSON",
  },
  {
    id: "bgp-validator",
    name: "BGP Route Validator",
    layer: "L1",
    language: "Rust",
    command: path.join(BIN_DIR, "bgp_validator"),
    args: [],
    port: 8088,
    env: { BGP_PORT: "8088", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description:
      "RPKI-based BGP route validation using Routinator/BIRD simulation. Detects route hijacks, AS path leaks, and cross-border routing anomalies.",
    technology: "Rust · RPKI · Routinator · BIRD · BGP",
  },
  {
    id: "residency-enforcer",
    name: "Data Residency Enforcer",
    layer: "L2",
    language: "Rust",
    command: path.join(BIN_DIR, "residency_enforcer"),
    args: [],
    port: 8089,
    env: { RESIDENCY_PORT: "8089", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description:
      "Geospatial data residency enforcement using Apache Sedona ST_Contains checks. Validates all data assets are within national borders.",
    technology: "Rust · Apache Sedona · PostGIS · GeoJSON · GDPR",
  },
  {
    id: "financial-ledger",
    name: "Financial Ledger Engine",
    layer: "FIN",
    language: "Rust",
    command: path.join(BIN_DIR, "financial_ledger"),
    args: [],
    port: 8090,
    env: { LEDGER_PORT: "8090", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description:
      "Double-entry financial ledger for penalty processing using TigerBeetle and Mojaloop. Handles penalty collection, settlement, and audit trails.",
    technology: "Rust · TigerBeetle · Mojaloop · ISO 20022 · SWIFT",
  },
  {
    id: "policy-evaluator",
    name: "Policy-as-Code Evaluator",
    layer: "POL",
    language: "Go",
    command: path.join(BIN_DIR, "policy_evaluator"),
    args: [],
    port: 8110,
    env: { POLICY_PORT: "8110", WORKER_DATABASE_URL: DB_URL },
    description: "Evaluates OPA/Rego-style policy rules against organization data. Provides real-time compliance scoring against NDPR, GDPR, PIPL, DPDP, and DOJ EO 14117 templates.",
    technology: "Go · OPA · Rego · PostgreSQL",
  },
  {
    id: "ndsep-agent",
    name: "NDSEP Org Agent",
    layer: "AGT",
    language: "Go",
    command: path.join(BIN_DIR, "ndsep_agent"),
    args: [],
    port: 8111,
    env: { AGENT_PORT: "8111", WORKER_DATABASE_URL: DB_URL },
    description: "Lightweight agent deployed on organization servers. Collects telemetry, enforces local policies, and reports compliance status back to the central NDSEP platform.",
    technology: "Go · gRPC · mTLS · PostgreSQL",
  },
  {
    id: "gitops-sync",
    name: "GitOps Config Sync",
    layer: "GIT",
    language: "Go",
    command: path.join(BIN_DIR, "gitops_sync"),
    args: [],
    port: 8112,
    env: { GITOPS_PORT: "8112", WORKER_DATABASE_URL: DB_URL },
    description: "Syncs NDSEP platform configuration from Git repositories. Detects configuration drift, captures snapshots, and applies approved config changes with full audit trail.",
    technology: "Go · Git · PostgreSQL · YAML",
  },
  {
    id: "evidence-signer",
    name: "Evidence Package Signer",
    layer: "EVD",
    language: "Rust",
    command: path.join(BIN_DIR, "evidence_signer"),
    args: [],
    port: 8113,
    env: { EVIDENCE_PORT: "8113", WORKER_DATABASE_URL: DB_URL },
    description: "Generates tamper-evident audit evidence packages using HMAC-SHA256 signatures. Packages compliance reports, violation records, and enforcement actions for regulatory submission.",
    technology: "Rust · HMAC-SHA256 · PostgreSQL · JSON",
  },
  {
    id: "remediation-engine",
    name: "Remediation Workflow Engine",
    language: "Python",
    layer: "REM",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "remediation_engine.py")],
    port: 8114,
    env: { REMEDIATION_PORT: "8114", WORKER_DATABASE_URL: DB_URL },
    description: "Automates remediation workflows when compliance violations are detected. Assigns actions (localize, block, delete, tokenize), tracks progress, and escalates unresolved issues.",
    technology: "Python · PostgreSQL · asyncio",
  },
  {
    id: "ai-governance-worker",
    name: "AI Governance Monitor",
    language: "Python",
    layer: "AIG",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "ai_governance_worker.py")],
    port: 8115,
    env: { AI_GOV_PORT: "8115", WORKER_DATABASE_URL: DB_URL },
    description: "Monitors AI systems operated by regulated organizations. Tracks training data provenance, model risk scores, and compliance with AI governance frameworks.",
    technology: "Python · PostgreSQL · asyncio",
  },
  {
    id: "evidence-expiry-cron",
    name: "Evidence Expiry Cron",
    language: "Python",
    layer: "EVD",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "evidence_expiry_cron.py")],
    port: 8116,
    env: { EXPIRY_CRON_PORT: "8116", WORKER_DATABASE_URL: DB_URL },
    description: "Scheduled cron that runs every 5 minutes. Automatically marks evidence packages as expired when their expiresAt date passes, and writes audit log entries for each expiry event.",
    technology: "Python · PostgreSQL · threading",
  },
  {
    id: "monthly-report-scheduler",
    name: "Monthly Report Scheduler",
    language: "Python",
    layer: "RPT",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "monthly_report_scheduler.py")],
    port: 8117,
    env: { MONTHLY_REPORT_PORT: "8117", WORKER_DATABASE_URL: DB_URL },
    description: "Runs on the 1st of each month. Generates a Markdown NDPR compliance report from live DB stats and sends it to the platform owner via the built-in notification API. Exposes /api/report/trigger for manual on-demand generation.",
    technology: "Python · PostgreSQL · threading",
  },
  {
    id: "citizen-sla-tracker",
    name: "Citizen SLA Tracker",
    language: "Go",
    layer: "CIT",
    command: path.join(BIN_DIR, "citizen_sla_tracker"),
    args: [],
    port: 8118,
    env: { CITIZEN_SLA_PORT: "8118", WORKER_DATABASE_URL: DB_URL },
    description: "Monitors citizen_requests table for NDPA Section 34 SLA compliance. Escalates requests older than 30 days to overdue status and notifies the platform owner. Runs every 15 minutes.",
    technology: "Go · PostgreSQL · net/http",
  },
  {
    id: "lakehouse-iceberg",
    name: "Lakehouse Iceberg Sync",
    language: "Python",
    layer: "DTA",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "lakehouse_iceberg.py")],
    port: 8119,
    env: { LAKEHOUSE_PORT: "8119", WORKER_DATABASE_URL: DB_URL },
    description: "Syncs compliance violations and monitoring snapshots to Apache Iceberg REST catalog for data lakehouse analytics. Runs every 30 minutes.",
    technology: "Python · Apache Iceberg REST · PostgreSQL",
  },
  // ── Orchestration Services (Go + Python) ────────────────────────────────
  // The legacy `api_gateway` worker is intentionally not registered here: it
  // carried a compiled APISIX route map and is superseded by `apisix-manager`,
  // which loads the PostgreSQL-authoritative gateway_routes registry.
  {
    id: "event-bus",
    name: "Kafka + Fluvio Event Bus",
    language: "Go",
    layer: "INFRA",
    command: path.join(BIN_DIR, "event_bus"),
    args: [],
    port: 8160,
    env: {
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
      KAFKA_ENABLED: process.env.KAFKA_ENABLED ?? "true",
      FLUVIO_HTTP_URL: process.env.FLUVIO_HTTP_URL ?? "http://localhost:9003",
      FLUVIO_ENABLED: process.env.FLUVIO_ENABLED ?? "true",
    },
    description: "Produces events to 30 NDSEP Kafka topics via IBM/sarama SyncProducer. Publishes edge events to Fluvio via HTTP. Graceful degradation to stub mode.",
    technology: "Go · Kafka (IBM/sarama) · Fluvio HTTP · gorilla/mux",
  },
  {
    id: "iam-service",
    name: "Keycloak + Permify IAM Service",
    language: "Go",
    layer: "INFRA",
    command: path.join(BIN_DIR, "iam_service"),
    args: [],
    port: 8150,
    env: {
      KEYCLOAK_URL: process.env.KEYCLOAK_URL ?? "",
      KEYCLOAK_REALM: process.env.KEYCLOAK_REALM ?? "",
      KEYCLOAK_CLIENT_ID: process.env.KEYCLOAK_CLIENT_ID ?? "",
      KEYCLOAK_CLIENT_SECRET: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
      KEYCLOAK_ENABLED: process.env.KEYCLOAK_ENABLED ?? "true",
      PERMIFY_URL: process.env.PERMIFY_URL ?? "",
      PERMIFY_TENANT: process.env.PERMIFY_TENANT ?? "",
      PERMIFY_ENABLED: process.env.PERMIFY_ENABLED ?? "true",
    },
    description: "Validates JWT bearer tokens through Keycloak and delegates permission decisions to Permify; unavailable dependencies deny requests.",
    technology: "Go · Keycloak (gocloak v13) · Permify HTTP REST · gorilla/mux",
  },
  {
    id: "tigerbeetle-ledger",
    name: "TigerBeetle Double-Entry Ledger",
    language: "Go",
    layer: "FIN",
    command: path.join(BIN_DIR, "tigerbeetle_ledger"),
    args: [],
    port: 8240,
    env: {
      TIGERBEETLE_CLUSTER_ID: process.env.TIGERBEETLE_CLUSTER_ID ?? "0",
      TIGERBEETLE_ADDRESSES: process.env.TIGERBEETLE_ADDRESSES ?? "localhost:3000",
      TIGERBEETLE_PORT: "8240",
    },
    description: "ACID double-entry accounting ledger for penalty transactions. Provides balance queries, transaction history, and settlement tracking.",
    technology: "Go · TigerBeetle-style ACID ledger · gorilla/mux",
  },
  {
    id: "workflow-engine",
    name: "Temporal Workflow Engine",
    language: "Go",
    layer: "ORCH",
    command: path.join(BIN_DIR, "workflow_engine"),
    args: [],
    port: 8170,
    env: {
      TEMPORAL_HOST: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
      TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE ?? "default",
      TEMPORAL_TASK_QUEUE: process.env.TEMPORAL_TASK_QUEUE ?? "ndsep-main",
      TEMPORAL_TLS_CERT: process.env.TEMPORAL_TLS_CERT ?? "",
      TEMPORAL_TLS_KEY: process.env.TEMPORAL_TLS_KEY ?? "",
    },
    description: "Executes enforcement workflows via Temporal Go SDK: ComplianceEnforcement, PenaltyDispute, IncidentResponse, CrossBorderApproval, NightlyMLRetrain.",
    technology: "Go · Temporal Go SDK · gorilla/mux",
  },
  {
    id: "dapr-bindings",
    name: "Dapr Bindings Service",
    language: "Python",
    layer: "INFRA",
    command: "python3.11",
    args: [path.join(WORKERS_DIR, "..", "orchestration", "python", "dapr_bindings", "service.py")],
    port: 8120,
    env: {
      DAPR_HTTP_PORT: process.env.DAPR_HTTP_PORT ?? "3500",
      DAPR_GRPC_PORT: process.env.DAPR_GRPC_PORT ?? "50001",
      DAPR_APP_ID: process.env.DAPR_APP_ID ?? "ndsep-platform",
      DAPR_BINDINGS_PORT: "8120",
      WORKER_DATABASE_URL: DB_URL,
    },
    description: "Dapr pub/sub and state store bindings. Publishes compliance events to Dapr pubsub (Kafka backend). Reads/writes Dapr state store (Redis backend).",
    technology: "Python · Dapr HTTP SDK · FastAPI · Redis · Kafka",
  },
  {
    id: "lakehouse-ingestion",
    name: "Lakehouse Ingestion Pipeline",
    language: "Python",
    layer: "DTA",
    command: "python3.11",
    args: [path.join(WORKERS_DIR, "..", "orchestration", "python", "lakehouse", "ingestion.py")],
    port: 8140,
    env: {
      LAKEHOUSE_CATALOG_URL: process.env.LAKEHOUSE_CATALOG_URL ?? "http://localhost:8181",
      LAKEHOUSE_S3_ENDPOINT: process.env.LAKEHOUSE_S3_ENDPOINT ?? "http://localhost:9000",
      LAKEHOUSE_S3_BUCKET: process.env.LAKEHOUSE_S3_BUCKET ?? "ndsep-lakehouse",
      LAKEHOUSE_S3_ACCESS_KEY: process.env.LAKEHOUSE_S3_ACCESS_KEY ?? "",
      LAKEHOUSE_S3_SECRET_KEY: process.env.LAKEHOUSE_S3_SECRET_KEY ?? "",
      LAKEHOUSE_ENABLED: process.env.LAKEHOUSE_ENABLED === "true" ? "true" : "false",
      LAKEHOUSE_PORT: "8140",
      WORKER_DATABASE_URL: DB_URL,
    },
    description: "Ingests compliance data into Apache Iceberg REST catalog. Writes Parquet files to S3/MinIO. Provides table scan and snapshot management APIs.",
    technology: "Python · Apache Iceberg REST · PyArrow · MinIO/S3 · FastAPI",
  },
  {
    id: "ml-pipeline",
    name: "ML Training Pipeline",
    language: "Python",
    layer: "AI",
    command: "python3.11",
    args: [path.join(WORKERS_DIR, "..", "orchestration", "python", "ml_pipeline", "service.py")],
    port: 8125,
    env: {
      ML_PIPELINE_PORT: "8125",
      WORKER_DATABASE_URL: DB_URL,
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
    },
    description: "Trains and serves ML models for compliance risk prediction. Publishes model metrics to Kafka. Provides prediction API for real-time risk scoring.",
    technology: "Python · scikit-learn · FastAPI · Kafka · PostgreSQL",
  },
  // ── Banking Workers ────────────────────────────────────────────────────────
  {
    id: "nip-rtgs-processor",
    name: "NIP/RTGS Payment Processor",
    language: "Go",
    layer: "Banking",
    command: path.join(WORKERS_DIR, "go", "bin", "nip_rtgs_processor"),
    args: [],
    port: 8130,
    env: {
      NIP_RTGS_PORT: "8130",
      WORKER_DATABASE_URL: DB_URL,
      RELAY_URL,
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
      CBN_NIP_ENDPOINT: process.env.CBN_NIP_ENDPOINT ?? "https://nip.cbn.gov.ng/api/v1",
      CBN_RTGS_ENDPOINT: process.env.CBN_RTGS_ENDPOINT ?? "https://rtgs.cbn.gov.ng/api/v1",
    },
    description: "Processes NIP instant payments and RTGS high-value settlements. Validates BVN/NIN, enforces CBN transaction limits, posts to TigerBeetle ledger.",
    technology: "Go · PostgreSQL · Kafka · TigerBeetle · CBN NIP/RTGS APIs",
  },
  {
    id: "swift-gateway",
    name: "SWIFT Message Gateway",
    language: "Go",
    layer: "Banking",
    command: path.join(WORKERS_DIR, "go", "bin", "swift_gateway"),
    args: [],
    port: 8131,
    env: {
      SWIFT_GATEWAY_PORT: "8131",
      WORKER_DATABASE_URL: DB_URL,
      RELAY_URL,
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
      SWIFT_BIC: process.env.SWIFT_BIC ?? "NDPCNGLA",
      SWIFT_ALLIANCE_HOST: process.env.SWIFT_ALLIANCE_HOST ?? "localhost:9300",
    },
    description: "Processes inbound/outbound SWIFT MT103/MT202/MT940 messages. Validates against OFAC/UN sanctions, routes to correspondent banks, generates ACK/NACK.",
    technology: "Go · SWIFT Alliance · PostgreSQL · Kafka · Sanctions Screening",
  },
  {
    id: "fraud-detection-engine",
    name: "Real-Time Fraud Detection Engine",
    language: "Go",
    layer: "Banking",
    command: path.join(WORKERS_DIR, "go", "bin", "fraud_detection_engine"),
    args: [],
    port: 8132,
    env: {
      FRAUD_ENGINE_PORT: "8132",
      WORKER_DATABASE_URL: DB_URL,
      RELAY_URL,
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
      ML_MODEL_ENDPOINT: process.env.ML_MODEL_ENDPOINT ?? "http://localhost:8133/predict",
    },
    description: "Real-time fraud detection using rule engine + ML models. Detects card fraud, account takeover, money mule patterns, synthetic identity fraud. Triggers instant card blocking.",
    technology: "Go · Rule Engine · ML Inference · PostgreSQL · Kafka · Redis",
  },
  {
    id: "watchlist-screener",
    name: "Watchlist & Sanctions Screener",
    language: "Rust",
    layer: "Banking",
    command: "python3",
    args: [path.join(WORKERS_DIR, "python", "watchlist_screener_fallback.py")],
    port: 8133,
    env: {
      WATCHLIST_PORT: "8133",
      WORKER_DATABASE_URL: DB_URL,
      RELAY_URL,
      OFAC_API_KEY: process.env.OFAC_API_KEY ?? "",
      UN_LIST_URL: process.env.UN_LIST_URL ?? "https://scsanctions.un.org/resources/xml/en/consolidated.xml",
      NFIU_API_ENDPOINT: process.env.NFIU_API_ENDPOINT ?? "https://api.nfiu.gov.ng/v1/watchlist",
    },
    description: "High-performance watchlist screening against OFAC SDN, UN Consolidated, EU Consolidated, UK HMT, and NFIU domestic lists. Fuzzy name matching with Levenshtein distance. Sub-millisecond screening.",
    technology: "Rust · Levenshtein · PostgreSQL · OFAC API · UN/EU/UK/NFIU Lists",
  },
  {
    id: "aml-scorer",
    name: "AML Risk Scoring Engine",
    language: "Python",
    layer: "Banking",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "aml_scoring_worker.py")],
    port: 8134,
    env: {
      AML_SCORER_PORT: "8134",
      WORKER_DATABASE_URL: DB_URL,
      RELAY_URL,
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
      NFIU_STR_ENDPOINT: process.env.NFIU_STR_ENDPOINT ?? "https://api.nfiu.gov.ng/v1/str",
    },
    description: "ML-based AML risk scoring using transaction pattern analysis, network graph analysis, and behavioral profiling. Generates STR candidates for NFIU filing. Implements FATF Recommendation 20.",
    technology: "Python · scikit-learn · NetworkX · FastAPI · Kafka · PostgreSQL",
  },
  {
    id: "kyc-analyzer",
    name: "KYC Document Analyzer",
    language: "Python",
    layer: "Banking",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "kyc_analysis_worker.py")],
    port: 8135,
    env: {
      KYC_ANALYZER_PORT: "8135",
      WORKER_DATABASE_URL: DB_URL,
      RELAY_URL,
      BVN_API_ENDPOINT: process.env.BVN_API_ENDPOINT ?? "https://api.nibss-plc.org.ng/v1/bvn",
      NIN_API_ENDPOINT: process.env.NIN_API_ENDPOINT ?? "https://api.nimc.gov.ng/v1/nin",
      NIBSS_API_KEY: process.env.NIBSS_API_KEY ?? "",
    },
    description: "Automated KYC document analysis: BVN/NIN verification via NIBSS/NIMC APIs, liveness detection, document OCR, PEP screening, adverse media checks. Implements CBN KYC Directive 2023.",
    technology: "Python · OpenCV · Tesseract OCR · FastAPI · NIBSS API · NIMC API",
  },
  {
    id: "cbn-reporter",
    name: "CBN Regulatory Report Generator",
    language: "Python",
    layer: "Banking",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "cbn_report_generator.py")],
    port: 8136,
    env: {
      CBN_REPORTER_PORT: "8136",
      WORKER_DATABASE_URL: DB_URL,
      RELAY_URL,
      CBN_PORTAL_ENDPOINT: process.env.CBN_PORTAL_ENDPOINT ?? "https://portal.cbn.gov.ng/api/v1",
      CBN_API_KEY: process.env.CBN_API_KEY ?? "",
      NFIU_GOAML_ENDPOINT: process.env.NFIU_GOAML_ENDPOINT ?? "https://goaml.nfiu.gov.ng/api/v1",
    },
    description: "Generates and submits CBN regulatory reports: STR (Suspicious Transaction Reports), CTR (Currency Transaction Reports), AML quarterly returns. Submits to CBN portal and NFIU goAML system.",
    technology: "Python · FastAPI · PostgreSQL · CBN Portal API · NFIU goAML · XBRL",
  },
  // ─── Sector Workers ───────────────────────────────────────────────────────────
  {
    id: "telecom-monitor",
    name: "Telecom Sector Monitor (NCC)",
    language: "Python",
    layer: "Telecom",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "telecom_monitor.py")],
    port: 8122,
    env: {
      TELECOM_MONITOR_PORT: "8122",
      WORKER_DATABASE_URL: DB_URL,
      RELAY_URL,
      NCC_API_BASE_URL: process.env.NCC_API_BASE_URL ?? "https://ncc.gov.ng/api/v1",
      NCC_API_KEY: process.env.NCC_API_KEY ?? "",
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
    },
    description: "Monitors NCC spectrum licence compliance, QoS violations, interconnect disputes, and type approval status. Publishes Kafka events for enforcement triggers.",
    technology: "Python · FastAPI · PostgreSQL · NCC API · Kafka",
  },
  {
    id: "healthcare-monitor",
    name: "Healthcare Sector Monitor (NHIA/FMOH)",
    language: "Python",
    layer: "Healthcare",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "healthcare_monitor.py")],
    port: 8123,
    env: {
      HEALTHCARE_MONITOR_PORT: "8123",
      WORKER_DATABASE_URL: DB_URL,
      RELAY_URL,
      NHIA_API_BASE_URL: process.env.NHIA_API_BASE_URL ?? "https://nhia.gov.ng/api/v1",
      NHIA_API_KEY: process.env.NHIA_API_KEY ?? "",
      FMOH_API_BASE_URL: process.env.FMOH_API_BASE_URL ?? "https://health.gov.ng/api/v1",
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
    },
    description: "Monitors healthcare data localisation compliance: patient data residency checks, clinical trial data governance, NHIA claims data sovereignty, FMOH health data standards.",
    technology: "Python · FastAPI · PostgreSQL · NHIA API · FMOH API · Kafka",
  },
  {
    id: "energy-monitor",
    name: "Energy Sector Monitor (NERC/DPR)",
    language: "Python",
    layer: "Energy",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "energy_monitor.py")],
    port: 8124,
    env: {
      ENERGY_MONITOR_PORT: "8124",
      WORKER_DATABASE_URL: DB_URL,
      RELAY_URL,
      NERC_API_BASE_URL: process.env.NERC_API_BASE_URL ?? "https://nerc.gov.ng/api/v1",
      NERC_API_KEY: process.env.NERC_API_KEY ?? "",
      DPR_API_BASE_URL: process.env.DPR_API_BASE_URL ?? "https://dpr.gov.ng/api/v1",
      DPR_API_KEY: process.env.DPR_API_KEY ?? "",
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
    },
    description: "Monitors energy sector data sovereignty: NERC grid operational data localisation, DPR oil/gas exploration data residency, NBET power trading data compliance.",
    technology: "Python · FastAPI · PostgreSQL · NERC API · DPR API · Kafka",
  },
  {
    id: "insurance-monitor",
    name: "Insurance Sector Monitor (NAICOM)",
    language: "Python",
    layer: "Insurance",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "insurance_monitor.py")],
    port: 8125,
    env: {
      INSURANCE_MONITOR_PORT: "8125",
      WORKER_DATABASE_URL: DB_URL,
      RELAY_URL,
      NAICOM_API_BASE_URL: process.env.NAICOM_API_BASE_URL ?? "https://naicom.gov.ng/api/v1",
      NAICOM_API_KEY: process.env.NAICOM_API_KEY ?? "",
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
    },
    description: "Monitors NAICOM insurance data compliance: policyholder data localisation, claims data residency, reinsurance data sovereignty, actuarial data governance.",
    technology: "Python · FastAPI · PostgreSQL · NAICOM API · Kafka",
  },
  {
    id: "fintech-monitor",
    name: "Fintech Sector Monitor (CBN Fintech)",
    language: "Python",
    layer: "Fintech",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "fintech_monitor.py")],
    port: 8126,
    env: {
      FINTECH_MONITOR_PORT: "8126",
      WORKER_DATABASE_URL: DB_URL,
      RELAY_URL,
      CBN_FINTECH_API_BASE_URL: process.env.CBN_FINTECH_API_BASE_URL ?? "https://cbn.gov.ng/fintech/api/v1",
      CBN_FINTECH_API_KEY: process.env.CBN_FINTECH_API_KEY ?? "",
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
    },
    description: "Monitors CBN Fintech regulatory compliance: payment service data localisation, e-money issuer data residency, mobile money operator data sovereignty, open banking API data governance.",
    technology: "Python · FastAPI · PostgreSQL · CBN Fintech API · Kafka",
  },
  // ─── Phase 42: Orphan workers wired ────────────────────────────────────────
  {
    id: "anomaly-alert-dispatcher",
    name: "Anomaly Alert Dispatcher",
    layer: "L6",
    language: "Go",
    command: path.join(BIN_DIR, "anomaly_alert_dispatcher"),
    args: [],
    port: 8200,
    env: { ANOMALY_PORT: "8200", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Dispatches anomaly alerts from ML predictions to WebSocket and notification channels.",
    technology: "Go · PostgreSQL · WebSocket",
  },
  {
    id: "apisix-manager",
    name: "APISIX Manager",
    layer: "Gateway",
    language: "Go",
    command: path.join(BIN_DIR, "apisix_manager"),
    args: [],
    port: 8201,
    env: {
      APISIX_MANAGER_PORT: "8201",
      WORKER_DATABASE_URL: DB_URL,
      WORKER_RELAY_URL: RELAY_URL,
      APISIX_ADMIN_URL: process.env.APISIX_ADMIN_URL ?? "",
      APISIX_ADMIN_KEY: process.env.APISIX_ADMIN_KEY ?? "",
      APISIX_MANAGER_INTERNAL_AUTH_TOKEN: process.env.APISIX_MANAGER_INTERNAL_AUTH_TOKEN ?? "",
    },
    description: "Synchronizes PostgreSQL-authoritative APISIX routes and durable synchronization evidence.",
    technology: "Go · PostgreSQL · APISIX Admin API",
  },
  {
    id: "bgp-live-monitor",
    name: "BGP Live Monitor",
    layer: "L1",
    language: "Go",
    command: path.join(BIN_DIR, "bgp_live_monitor"),
    args: [],
    port: 8202,
    env: { BGP_MONITOR_PORT: "8202", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Live BGP route monitoring with RPKI validation and hijack detection.",
    technology: "Go · BGP · RPKI · PostgreSQL",
  },
  {
    id: "car-pdf-generator",
    name: "CAR PDF Generator",
    layer: "L3",
    language: "Go",
    command: path.join(BIN_DIR, "car_pdf_generator"),
    args: [],
    port: 8203,
    env: { CAR_PDF_PORT: "8203", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Generates Compliance Audit Return (CAR) PDF reports for NDPC submission.",
    technology: "Go · PDF Generation · PostgreSQL",
  },
  {
    id: "dapr-bridge",
    name: "Dapr Bridge",
    layer: "Middleware",
    language: "Go",
    command: path.join(BIN_DIR, "dapr_bridge"),
    args: [],
    port: 8204,
    env: { DAPR_BRIDGE_PORT: "8204", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, DAPR_HTTP_PORT: process.env.DAPR_HTTP_PORT ?? "3500" },
    description: "Bridges NDSEP services to Dapr sidecar for pub/sub, state, and service invocation.",
    technology: "Go · Dapr · gRPC",
  },
  {
    id: "falkordb-kg-worker",
    name: "FalkorDB Knowledge Graph Worker",
    layer: "L6",
    language: "Go",
    command: path.join(BIN_DIR, "falkordb_kg_worker"),
    args: [],
    port: 8205,
    env: { FALKORDB_PORT: "8205", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, FALKORDB_URL: process.env.FALKORDB_URL ?? "redis://localhost:6379" },
    description: "Maintains the NDSEP knowledge graph in FalkorDB for compliance relationship queries.",
    technology: "Go · FalkorDB · Redis · GraphQL",
  },
  {
    id: "fluvio-relay",
    name: "Fluvio Relay",
    layer: "Streaming",
    language: "Go",
    command: path.join(BIN_DIR, "fluvio_relay"),
    args: [],
    port: 8206,
    env: { FLUVIO_RELAY_PORT: "8206", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, FLUVIO_ENDPOINT: process.env.FLUVIO_ENDPOINT ?? "localhost:9003" },
    description: "Relays Fluvio stream events to NDSEP WebSocket and database.",
    technology: "Go · Fluvio · WebSocket",
  },
  {
    id: "middleware-bridge",
    name: "Middleware Bridge",
    layer: "Middleware",
    language: "Go",
    command: path.join(BIN_DIR, "middleware_bridge"),
    args: [],
    port: 8207,
    env: { MIDDLEWARE_BRIDGE_PORT: "8207", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Bridges NDSEP middleware services (Redis, Kafka, Dapr) for health aggregation.",
    technology: "Go · Redis · Kafka · Dapr",
  },
  {
    id: "mojaloop-adapter",
    name: "Mojaloop Adapter",
    layer: "Financial",
    language: "Go",
    command: path.join(BIN_DIR, "mojaloop_adapter"),
    args: [],
    port: 8208,
    env: { MOJALOOP_PORT: "8208", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, MOJALOOP_API_URL: process.env.MOJALOOP_API_URL ?? "http://localhost:3001" },
    description: "Adapts Mojaloop payment hub events for NDSEP financial compliance monitoring.",
    technology: "Go · Mojaloop · REST API · PostgreSQL",
  },
  {
    id: "rag-orchestrator",
    name: "RAG Orchestrator",
    layer: "L6",
    language: "Go",
    command: path.join(BIN_DIR, "rag_orchestrator"),
    args: [],
    port: 8209,
    env: { RAG_PORT: "8209", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, QDRANT_URL: process.env.QDRANT_URL ?? "http://localhost:6333" },
    description: "Orchestrates RAG (Retrieval-Augmented Generation) pipeline for AI compliance advisor.",
    technology: "Go · Qdrant · Ollama · PostgreSQL",
  },
  {
    id: "rss-webhook-server",
    name: "RSS Webhook Server",
    layer: "L4",
    language: "Go",
    command: path.join(BIN_DIR, "rss_webhook_server"),
    args: [],
    port: 8210,
    env: { RSS_WEBHOOK_PORT: "8210", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Serves RSS feeds and webhook endpoints for NDSEP regulatory intelligence.",
    technology: "Go · RSS · Webhooks · PostgreSQL",
  },
  {
    id: "webhook-delivery",
    name: "Webhook Delivery",
    layer: "L4",
    language: "Go",
    command: path.join(BIN_DIR, "webhook_delivery"),
    args: [],
    port: 8211,
    env: { WEBHOOK_DELIVERY_PORT: "8211", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Delivers outbound webhooks to registered organisation endpoints with retry logic.",
    technology: "Go · HTTP · PostgreSQL · Redis",
  },
  // ─── Python orphan workers ──────────────────────────────────────────────────
  {
    id: "ai-governance-scorer",
    name: "AI Governance Scorer",
    layer: "L6",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "ai_governance_scorer.py")],
    port: 8212,
    env: { AI_GOV_SCORER_PORT: "8212", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Scores AI systems against NDPA AI governance framework and fairness metrics.",
    technology: "Python · scikit-learn · PostgreSQL · FastAPI",
  },
  {
    id: "art-adversarial-worker",
    name: "ART Adversarial Robustness Worker",
    layer: "L6",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "art_adversarial_worker.py")],
    port: 8213,
    env: { ART_PORT: "8213", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Tests AI models for adversarial robustness using IBM ART framework.",
    technology: "Python · IBM ART · PyTorch · FastAPI",
  },
  {
    id: "cocoindex-etl-worker",
    name: "CocoIndex ETL Worker",
    layer: "L2",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "cocoindex_etl_worker.py")],
    port: 8214,
    env: { COCOINDEX_PORT: "8214", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "ETL pipeline for COCO dataset indexing and compliance data transformation.",
    technology: "Python · CocoIndex · PostgreSQL · FastAPI",
  },
  {
    id: "compliance-analytics",
    name: "Compliance Analytics",
    layer: "L3",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "compliance_analytics.py")],
    port: 8215,
    env: { COMPLIANCE_ANALYTICS_PORT: "8215", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Advanced compliance analytics: trend analysis, sector benchmarking, predictive scoring.",
    technology: "Python · pandas · scikit-learn · FastAPI",
  },
  {
    id: "dapr-state-bridge",
    name: "Dapr State Bridge",
    layer: "Middleware",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "dapr_state_bridge.py")],
    port: 8216,
    env: { DAPR_STATE_PORT: "8216", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, DAPR_HTTP_PORT: process.env.DAPR_HTTP_PORT ?? "3500" },
    description: "Bridges Dapr state store operations to NDSEP compliance data.",
    technology: "Python · Dapr · Redis · FastAPI",
  },
  {
    id: "dpia-engine",
    name: "DPIA Engine",
    layer: "L3",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "dpia_engine.py")],
    port: 8217,
    env: { DPIA_PORT: "8217", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Automated DPIA risk scoring and recommendations for NDPA Article 35 compliance.",
    technology: "Python · NLP · PostgreSQL · FastAPI",
  },
  {
    id: "dpo-report-engine",
    name: "DPO Report Engine",
    layer: "L3",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "dpo_report_engine.py")],
    port: 8218,
    env: { DPO_REPORT_PORT: "8218", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Generates DPO quarterly reports, NDPC submissions, and board-level compliance summaries.",
    technology: "Python · ReportLab · PostgreSQL · FastAPI",
  },
  {
    id: "dsar-deadline-tracker",
    name: "DSAR Deadline Tracker",
    layer: "L3",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "dsar_deadline_tracker.py")],
    port: 8219,
    env: { DSAR_DEADLINE_PORT: "8219", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Tracks DSAR deadlines and triggers escalation alerts for overdue requests.",
    technology: "Python · APScheduler · PostgreSQL · FastAPI",
  },
  {
    id: "epr-kgqa-worker",
    name: "EPR KGQA Worker",
    layer: "L6",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "epr_kgqa_worker.py")],
    port: 8220,
    env: { EPR_KGQA_PORT: "8220", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Knowledge Graph Question Answering for EPR compliance using FalkorDB and LLM.",
    technology: "Python · FalkorDB · LLM · FastAPI",
  },
  {
    id: "fluvio-consumer",
    name: "Fluvio Consumer",
    layer: "Streaming",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "fluvio_consumer.py")],
    port: 8221,
    env: { FLUVIO_CONSUMER_PORT: "8221", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, FLUVIO_ENDPOINT: process.env.FLUVIO_ENDPOINT ?? "localhost:9003" },
    description: "Consumes Fluvio stream topics and persists compliance events to PostgreSQL.",
    technology: "Python · Fluvio · PostgreSQL · FastAPI",
  },
  {
    id: "middleware-audit-aggregator",
    name: "Middleware Audit Aggregator",
    layer: "L4",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "middleware_audit_aggregator.py")],
    port: 8222,
    env: { MIDDLEWARE_AUDIT_PORT: "8222", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Aggregates audit logs from all middleware services into unified compliance timeline.",
    technology: "Python · PostgreSQL · Redis · FastAPI",
  },
  {
    id: "ml-feature-store",
    name: "ML Feature Store",
    layer: "L6",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "ml_feature_store.py")],
    port: 8223,
    env: { ML_FEATURE_STORE_PORT: "8223", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" },
    description: "Feature store for ML models: feature engineering, versioning, and serving.",
    technology: "Python · Redis · PostgreSQL · FastAPI",
  },
  {
    id: "ollama-llm-worker",
    name: "Ollama LLM Worker",
    layer: "L6",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "ollama_llm_worker.py")],
    port: 8224,
    env: { OLLAMA_PORT: "8224", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434" },
    description: "Local LLM inference via Ollama for privacy-preserving AI compliance analysis.",
    technology: "Python · Ollama · LangChain · FastAPI",
  },
  {
    id: "opensearch-query-service",
    name: "OpenSearch Query Service",
    layer: "L4",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "opensearch_query_service.py")],
    port: 8225,
    env: { OPENSEARCH_QUERY_PORT: "8225", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, OPENSEARCH_URL: process.env.OPENSEARCH_URL ?? "http://localhost:9200" },
    description: "Full-text search and analytics over NDSEP compliance data via OpenSearch.",
    technology: "Python · OpenSearch · PostgreSQL · FastAPI",
  },
  {
    id: "permify-rbac-sync",
    name: "Permify RBAC Sync",
    layer: "Security",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "permify_rbac_sync.py")],
    port: 8226,
    env: { PERMIFY_SYNC_PORT: "8226", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, PERMIFY_URL: process.env.PERMIFY_URL ?? "http://localhost:3476" },
    description: "Syncs NDSEP user roles and permissions to Permify for real-time PBAC enforcement.",
    technology: "Python · Permify · PostgreSQL · FastAPI",
  },
  {
    id: "qdrant-vector-worker",
    name: "Qdrant Vector Worker",
    layer: "L6",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "qdrant_vector_worker.py")],
    port: 8227,
    env: { QDRANT_WORKER_PORT: "8227", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, QDRANT_URL: process.env.QDRANT_URL ?? "http://localhost:6333" },
    description: "Indexes compliance documents and policies in Qdrant for semantic search.",
    technology: "Python · Qdrant · sentence-transformers · FastAPI",
  },
  {
    id: "ropa-generator",
    name: "ROPA Generator",
    layer: "L3",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "ropa_generator.py")],
    port: 8228,
    env: { ROPA_PORT: "8228", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Generates ROPA (Record of Processing Activities) reports for NDPA Article 43 compliance.",
    technology: "Python · ReportLab · PostgreSQL · FastAPI",
  },
  {
    id: "sector-benchmarking",
    name: "Sector Benchmarking",
    layer: "L3",
    language: "Python",
    command: "python3.11",
    args: [path.join(PYTHON_DIR, "sector_benchmarking.py")],
    port: 8229,
    env: { SECTOR_BENCH_PORT: "8229", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Cross-sector compliance benchmarking: percentile rankings, gap analysis, peer comparison.",
    technology: "Python · pandas · PostgreSQL · FastAPI",
  },
  // ─── Rust orphan workers ────────────────────────────────────────────────────
  {
    id: "keycloak-validator",
    name: "Keycloak Validator",
    layer: "Security",
    language: "Rust",
    command: path.join(BIN_DIR, "keycloak_validator"),
    args: [],
    port: 8230,
    env: { KEYCLOAK_VALIDATOR_PORT: "8230", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, KEYCLOAK_URL: process.env.KEYCLOAK_URL ?? "http://localhost:8080" },
    description: "Validates Keycloak JWT tokens and syncs realm roles to NDSEP PBAC engine.",
    technology: "Rust · Keycloak · JWT · Actix-web",
  },
  {
    id: "lakehouse-writer",
    name: "Lakehouse Writer",
    layer: "L2",
    language: "Rust",
    command: path.join(BIN_DIR, "lakehouse_writer"),
    args: [],
    port: 8231,
    env: { LAKEHOUSE_WRITER_PORT: "8231", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "High-throughput writer for Delta Lake / Iceberg tables in the NDSEP data lakehouse.",
    technology: "Rust · Delta Lake · Apache Arrow · Actix-web",
  },
  {
    id: "middleware-cache",
    name: "Middleware Cache",
    layer: "Middleware",
    language: "Rust",
    command: path.join(BIN_DIR, "middleware_cache"),
    args: [],
    port: 8232,
    env: { MIDDLEWARE_CACHE_PORT: "8232", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" },
    description: "High-performance middleware cache layer using Redis for compliance query acceleration.",
    technology: "Rust · Redis · Actix-web",
  },
  {
    id: "opensearch-indexer",
    name: "OpenSearch Indexer",
    layer: "L4",
    language: "Rust",
    command: path.join(BIN_DIR, "opensearch_indexer"),
    args: [],
    port: 8233,
    env: { OPENSEARCH_INDEXER_PORT: "8233", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, OPENSEARCH_URL: process.env.OPENSEARCH_URL ?? "http://localhost:9200" },
    description: "Indexes NDSEP compliance events and audit logs into OpenSearch for full-text search.",
    technology: "Rust · OpenSearch · PostgreSQL · Actix-web",
  },
  {
    id: "portability-exporter",
    name: "Portability Exporter",
    layer: "L3",
    language: "Rust",
    command: path.join(BIN_DIR, "portability_exporter"),
    args: [],
    port: 8234,
    env: { PORTABILITY_PORT: "8234", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Exports citizen data in machine-readable formats (JSON, CSV, XML) for NDPA data portability rights.",
    technology: "Rust · PostgreSQL · Actix-web",
  },
  {
    id: "vector-cache",
    name: "Vector Cache",
    layer: "L6",
    language: "Rust",
    command: path.join(BIN_DIR, "vector_cache"),
    args: [],
    port: 8235,
    env: { VECTOR_CACHE_PORT: "8235", WORKER_DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, QDRANT_URL: process.env.QDRANT_URL ?? "http://localhost:6333" },
    description: "Caches vector embeddings for fast semantic search over compliance documents.",
    technology: "Rust · Qdrant · Redis · Actix-web",
  },
  {
    id: "lakehouse-analytics",
    name: "Lakehouse Analytics Engine",
    layer: "L7",
    language: "Python",
    command: "python3",
    args: [path.join(PYTHON_DIR, "lakehouse_analytics_engine.py")],
    port: 8140,
    env: { LAKEHOUSE_PORT: "8140", DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL },
    description: "Production lakehouse: DuckDB + Parquet ETL from PostgreSQL, materialized views, feature serving for ML.",
    technology: "Python · DuckDB · PyArrow · Parquet · FastAPI",
  },
  {
    id: "ml-production-engine",
    name: "ML Production Engine",
    layer: "L7",
    language: "Python",
    command: "python3",
    args: [path.join(PYTHON_DIR, "ml_production_engine.py")],
    port: 8085,
    env: { ML_WORKER_PORT: "8085", DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, LAKEHOUSE_URL: "http://localhost:8140" },
    description: "XGBoost breach prediction, LSTM violation forecasting, IsolationForest anomaly detection, SHAP explanations.",
    technology: "Python · XGBoost · scikit-learn · SHAP · FastAPI",
  },
  {
    id: "gnn-compliance-engine",
    name: "GNN Compliance Engine",
    layer: "L7",
    language: "Python",
    command: "python3",
    args: [path.join(PYTHON_DIR, "gnn_compliance_engine.py")],
    port: 8216,
    env: { GNN_PORT: "8216", DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL, LAKEHOUSE_URL: "http://localhost:8140" },
    description: "GraphSAGE GNN with learned weights, link prediction, compliance graph embeddings for downstream ML.",
    technology: "Python · numpy · scipy · scikit-learn · FastAPI",
  },
  {
    id: "ray-ml-engine",
    name: "Ray ML/DL/GNN Engine",
    layer: "L7",
    language: "Python",
    command: "python3",
    args: [path.join(PYTHON_DIR, "ray_ml_engine.py")],
    port: 8250,
    env: {
      RAY_ML_PORT: "8250", DATABASE_URL: DB_URL, WORKER_RELAY_URL: RELAY_URL,
      LAKEHOUSE_URL: "http://localhost:8140",
      CONTINUOUS_TRAINING_ENABLED: process.env.CONTINUOUS_TRAINING_ENABLED ?? "false",
      RETRAIN_INTERVAL: process.env.RETRAIN_INTERVAL ?? "21600",
      DRIFT_CHECK_INTERVAL: process.env.DRIFT_CHECK_INTERVAL ?? "3600",
      DRIFT_THRESHOLD_KS: process.env.DRIFT_THRESHOLD_KS ?? "0.15",
      DRIFT_THRESHOLD_PSI: process.env.DRIFT_THRESHOLD_PSI ?? "0.2",
      CHAMPION_THRESHOLD: process.env.CHAMPION_THRESHOLD ?? "0.01",
    },
    description: "Real PyTorch ML/DL/GNN engine with continuous training: GraphSAGE GNN, LSTM, Autoencoder, XGBoost+SHAP. Data drift detection (KS-test/PSI), champion/challenger model promotion, feedback loop, scheduled auto-retraining. Ray distributed training. Lakehouse/DuckDB integration.",
    technology: "Python · PyTorch · Ray · XGBoost · SHAP · DuckDB · SciPy · FastAPI",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Process Supervisor
// ─────────────────────────────────────────────────────────────────────────────

interface WorkerState {
  def: WorkerDef;
  process: ChildProcess | null;
  status: "starting" | "running" | "crashed" | "stopped";
  startedAt: Date | null;
  restarts: number;
  lastError: string | null;
  eventsProcessed: number;
}

const workerStates = new Map<string, WorkerState>();
let broadcastFn: ((event: string, data: unknown) => void) | null = null;

export function setBroadcastFn(fn: (event: string, data: unknown) => void) {
  broadcastFn = fn;
}

function broadcast(event: string, data: unknown) {
  if (broadcastFn) {
    broadcastFn(event, data);
  }
}

function spawnWorker(def: WorkerDef, restartCount = 0) {
  const state = workerStates.get(def.id)!;
  state.status = "starting";
  state.startedAt = new Date();

  // Unset PYTHONHOME to prevent Python 3.13 uv env from conflicting with python3.11
  const baseEnv = { ...process.env };
  if (def.language === "Python") {
    delete baseEnv.PYTHONHOME;
    delete baseEnv.PYTHONPATH;
  }
  const env = { ...baseEnv, ...def.env };
  const proc = spawn(def.command, def.args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  state.process = proc;
  state.status = "running";
  state.restarts = restartCount;

  logger.info(
    `[Workers] Started ${def.name} (${def.language}) PID=${proc.pid} port=${def.port}`
  );

  broadcast("worker_started", {
    workerId: def.id,
    workerName: def.name,
    layer: def.layer,
    language: def.language,
    pid: proc.pid,
    port: def.port,
    timestamp: new Date().toISOString(),
  });

  // Log stdout
  proc.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    lines.forEach((line) => {
      if (line.trim()) {
        logger.info(`[${def.id}] ${line}`);
      }
    });
  });

  // Log stderr
  proc.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    lines.forEach((line) => {
      if (line.trim()) {
        logger.error(`[${def.id}] ERR: ${line}`);
      }
    });
  });

  // Handle spawn errors (e.g. binary not found) — prevents uncaught exception crash
  proc.on("error", (err: NodeJS.ErrnoException) => {
    const st = workerStates.get(def.id);
    if (st) { st.status = "crashed"; st.process = null; st.lastError = (err instanceof Error ? err.message : String(err)); }
    if (err.code === "ENOENT") {
      logger.warn(`[Workers] ${def.name}: binary not found at ${def.command} — skipping`);
      return; // Do not restart if binary doesn't exist
    }
    logger.error(`[Workers] ${def.name} spawn error: ${(err instanceof Error ? err.message : String(err))}`);
  });

  // Handle exit with auto-restart
  proc.on("exit", (code, signal) => {
    const st = workerStates.get(def.id)!;
    st.status = "crashed";
    st.process = null;
    st.lastError = `Exited with code=${code} signal=${signal}`;

    logger.error(`[Workers] ${def.name} exited (code=${code}). Restarting in ${Math.min(30, 5 * (restartCount + 1))}s...`);

    broadcast("worker_crashed", {
      workerId: def.id,
      workerName: def.name,
      code,
      signal,
      restarts: restartCount + 1,
      timestamp: new Date().toISOString(),
    });

    // Exponential backoff restart (max 30s)
    const delay = Math.min(30000, 5000 * (restartCount + 1));
    setTimeout(() => {
      const currentState = workerStates.get(def.id);
      if (currentState && currentState.status !== "stopped") {
        spawnWorker(def, restartCount + 1);
      }
    }, delay);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

function bootstrapPythonDeps() {
  const requirementsPath = path.join(PYTHON_DIR, "requirements.txt");
  try {
    // execSync imported at module top level
    const baseEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "PYTHONHOME" && k !== "PYTHONPATH") baseEnv[k] = v;
    }
    execSync(`pip3 install -r "${requirementsPath}" --quiet 2>&1`, { env: baseEnv, stdio: "pipe" });
    logger.info("[Workers] Python dependencies installed from requirements.txt");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg.slice(0, 200) }, "[Workers] pip install warning (non-fatal)");
  }
}

export function startAllWorkers() {
  logger.info("[Workers] Starting all NDSEP background workers...");
  bootstrapPythonDeps();

  for (const def of WORKER_DEFS) {
    workerStates.set(def.id, {
      def,
      process: null,
      status: "starting",
      startedAt: null,
      restarts: 0,
      lastError: null,
      eventsProcessed: 0,
    });
    // Stagger starts by 2s to avoid DB connection storms
    const idx = WORKER_DEFS.indexOf(def);
    setTimeout(() => spawnWorker(def), idx * 2000);
  }
}

export function stopAllWorkers() {
  logger.info("[Workers] Stopping all workers...");
  for (const id of Array.from(workerStates.keys())) {
    const state = workerStates.get(id)!;
    state.status = "stopped";
    if (state.process) {
      state.process.kill("SIGTERM");
      logger.info(`[Workers] Sent SIGTERM to ${id}`);
    }
  }
}

export function getWorkerStatuses(): object[] {
  return Array.from(workerStates.values() as Iterable<WorkerState>).map((s) => ({
    id: s.def.id,
    name: s.def.name,
    layer: s.def.layer,
    language: s.def.language,
    status: s.status,
    port: s.def.port,
    pid: s.process?.pid ?? null,
    startedAt: s.startedAt,
    restarts: s.restarts,
    lastError: s.lastError,
    description: s.def.description,
    technology: s.def.technology,
  }));
}

export async function getWorkerMetrics(workerId: string): Promise<object | null> {
  const state = workerStates.get(workerId);
  if (!state || state.status !== "running") return null;

  try {
    const resp = await fetch(`http://localhost:${state.def.port}/metrics`);
    if (resp.ok) return await resp.json();
  } catch {
    // Worker not ready yet
  }
  return null;
}

export function restartWorker(workerId: string): boolean {
  const state = workerStates.get(workerId);
  if (!state) return false;
  if (state.process) {
    state.process.kill("SIGTERM");
  }
  state.status = "starting";
  state.lastError = null;
  setTimeout(() => spawnWorker(state.def, 0), 1000);
  return true;
}
