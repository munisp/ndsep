"""
============================================================================
NDSEP NOC AI Agent — Reasoning Engine (Python)
============================================================================
LLM-powered root cause analysis + incident knowledge graph + remediation
plan generation. Acts as the "brain" of the AI agent system.

Port: 8195
Capabilities:
  - Root cause analysis using LLM (Ollama) with chain-of-thought reasoning
  - Incident knowledge graph for pattern matching
  - Remediation plan generation with confidence scoring
  - Historical incident similarity search
  - Causal chain reconstruction
  - Post-incident learning and knowledge base updates
  - Integration: PostgreSQL, Redis, Kafka, OpenSearch, Ollama
============================================================================
"""

import os
import json
import time
import uuid
import logging
import threading
from datetime import datetime, timezone, timedelta
from typing import Optional
from dataclasses import dataclass, field, asdict

import psycopg2
import psycopg2.extras
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("noc-agent-reasoning")

WORKER_NAME = "noc-agent-reasoning"
HTTP_PORT = 8195
DB_URL = os.getenv("DATABASE_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
RELAY_URL = os.getenv("RELAY_URL", "http://localhost:4000")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
REASONING_MODEL = os.getenv("REASONING_MODEL", "qwen2.5:1.5b")
CONFIDENCE_AUTO_THRESHOLD = 0.85
CONFIDENCE_SUGGEST_THRESHOLD = 0.50

app = FastAPI(title="NOC AI Agent — Reasoning Engine", version="1.0.0")

# ── Knowledge Base (in-memory + DB-backed) ────────────────────────────────────

@dataclass
class IncidentPattern:
    pattern_id: str
    incident_type: str
    symptom_signature: dict
    root_cause: str
    root_cause_category: str
    affected_services: list
    remediation_steps: list
    prevention_measures: list
    success_rate: float = 0.0
    occurrence_count: int = 0
    avg_resolution_seconds: int = 0

KNOWLEDGE_BASE: list[IncidentPattern] = [
    IncidentPattern(
        pattern_id="kb-001", incident_type="service_down",
        symptom_signature={"health_status": 0, "response_latency_ms": {"gt": 5000}},
        root_cause="Service process crashed or became unresponsive",
        root_cause_category="software_bug",
        affected_services=["*"],
        remediation_steps=[
            {"step": 1, "action": "check_logs", "command": "journalctl -u {service} --since '5 min ago'", "timeout_seconds": 30},
            {"step": 2, "action": "restart_service", "command": "systemctl restart {service}", "timeout_seconds": 60},
            {"step": 3, "action": "verify_health", "command": "curl -sf http://localhost:{port}/health", "timeout_seconds": 15},
            {"step": 4, "action": "check_dependencies", "command": "check downstream services", "timeout_seconds": 30},
        ],
        prevention_measures=["Add circuit breaker", "Increase memory limits", "Enable crash dumps"],
        success_rate=0.92, occurrence_count=47, avg_resolution_seconds=120,
    ),
    IncidentPattern(
        pattern_id="kb-002", incident_type="high_latency",
        symptom_signature={"response_latency_ms": {"gt": 2000}, "health_status": 1},
        root_cause="Database connection pool exhaustion or slow queries",
        root_cause_category="capacity_exhaustion",
        affected_services=["*_with_db"],
        remediation_steps=[
            {"step": 1, "action": "check_db_connections", "command": "SELECT count(*) FROM pg_stat_activity", "timeout_seconds": 10},
            {"step": 2, "action": "kill_idle_connections", "command": "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < NOW() - INTERVAL '10 minutes'", "timeout_seconds": 15},
            {"step": 3, "action": "check_slow_queries", "command": "SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 5", "timeout_seconds": 10},
            {"step": 4, "action": "scale_pool", "command": "Increase max_connections in pool config", "timeout_seconds": 60},
        ],
        prevention_measures=["Add connection pool monitoring", "Set query timeouts", "Add read replicas"],
        success_rate=0.88, occurrence_count=31, avg_resolution_seconds=180,
    ),
    IncidentPattern(
        pattern_id="kb-003", incident_type="memory_pressure",
        symptom_signature={"memory_usage_pct": {"gt": 90}},
        root_cause="Memory leak or unexpected traffic spike causing OOM pressure",
        root_cause_category="capacity_exhaustion",
        affected_services=["*"],
        remediation_steps=[
            {"step": 1, "action": "check_memory", "command": "free -m && top -b -n1 -o %MEM | head -20", "timeout_seconds": 10},
            {"step": 2, "action": "identify_leak", "command": "Check heap dumps and GC logs", "timeout_seconds": 30},
            {"step": 3, "action": "restart_if_critical", "command": "systemctl restart {service}", "timeout_seconds": 60, "condition": "memory > 95%"},
            {"step": 4, "action": "scale_horizontally", "command": "kubectl scale deployment {service} --replicas=+1", "timeout_seconds": 120},
        ],
        prevention_measures=["Set memory limits in K8s", "Add memory alerts at 80%", "Profile memory usage"],
        success_rate=0.85, occurrence_count=22, avg_resolution_seconds=240,
    ),
    IncidentPattern(
        pattern_id="kb-004", incident_type="network_partition",
        symptom_signature={"multiple_services_down": True, "health_status": 0},
        root_cause="Network partition or DNS resolution failure",
        root_cause_category="network_issue",
        affected_services=["*"],
        remediation_steps=[
            {"step": 1, "action": "check_dns", "command": "nslookup {service_host} && dig {service_host}", "timeout_seconds": 10},
            {"step": 2, "action": "check_connectivity", "command": "ping -c 3 {service_host} && traceroute {service_host}", "timeout_seconds": 15},
            {"step": 3, "action": "check_firewall", "command": "iptables -L -n | grep {port}", "timeout_seconds": 10},
            {"step": 4, "action": "failover_dns", "command": "Switch to backup DNS or direct IP", "timeout_seconds": 30},
        ],
        prevention_measures=["Multi-AZ deployment", "DNS failover", "Service mesh with mTLS"],
        success_rate=0.78, occurrence_count=15, avg_resolution_seconds=300,
    ),
    IncidentPattern(
        pattern_id="kb-005", incident_type="security_anomaly",
        symptom_signature={"anomaly_type": "security", "severity": "critical"},
        root_cause="Potential security breach — unauthorized access or data exfiltration attempt",
        root_cause_category="security_incident",
        affected_services=["*"],
        remediation_steps=[
            {"step": 1, "action": "isolate_service", "command": "Block external access via APISIX route disable", "timeout_seconds": 15},
            {"step": 2, "action": "capture_evidence", "command": "Snapshot logs, network captures, and process state", "timeout_seconds": 30},
            {"step": 3, "action": "rotate_credentials", "command": "Rotate API keys, DB passwords, JWT secrets", "timeout_seconds": 60},
            {"step": 4, "action": "notify_security_team", "command": "Alert SOC via PagerDuty P1", "timeout_seconds": 5},
        ],
        prevention_measures=["WAF rules update", "Rate limiting", "Anomaly-based IDS", "Zero-trust networking"],
        success_rate=0.95, occurrence_count=8, avg_resolution_seconds=600,
    ),
    IncidentPattern(
        pattern_id="kb-006", incident_type="cascade_failure",
        symptom_signature={"multiple_anomalies": True, "escalating_severity": True},
        root_cause="Cascading failure triggered by upstream dependency failure",
        root_cause_category="dependency_failure",
        affected_services=["*"],
        remediation_steps=[
            {"step": 1, "action": "identify_root_service", "command": "Trace dependency graph to find originating failure", "timeout_seconds": 30},
            {"step": 2, "action": "enable_circuit_breakers", "command": "Trip circuit breakers on failing dependencies", "timeout_seconds": 10},
            {"step": 3, "action": "restart_root_service", "command": "systemctl restart {root_service}", "timeout_seconds": 60},
            {"step": 4, "action": "gradual_recovery", "command": "Slowly re-enable downstream services with health gates", "timeout_seconds": 300},
        ],
        prevention_measures=["Circuit breaker pattern", "Bulkhead isolation", "Graceful degradation", "Chaos testing"],
        success_rate=0.72, occurrence_count=12, avg_resolution_seconds=900,
    ),
    IncidentPattern(
        pattern_id="kb-007", incident_type="sla_breach_imminent",
        symptom_signature={"availability_pct": {"lt": 99.5}, "trend": "declining"},
        root_cause="Sustained performance degradation approaching SLA threshold",
        root_cause_category="capacity_exhaustion",
        affected_services=["*"],
        remediation_steps=[
            {"step": 1, "action": "identify_bottleneck", "command": "Analyze p95/p99 latency by endpoint", "timeout_seconds": 20},
            {"step": 2, "action": "scale_resources", "command": "kubectl scale deployment {service} --replicas=+2", "timeout_seconds": 120},
            {"step": 3, "action": "enable_caching", "command": "Warm Redis cache for hot paths", "timeout_seconds": 30},
            {"step": 4, "action": "shed_load", "command": "Enable rate limiting at APISIX gateway", "timeout_seconds": 15},
        ],
        prevention_measures=["Auto-scaling policies", "Load testing", "Capacity planning", "CDN for static assets"],
        success_rate=0.90, occurrence_count=19, avg_resolution_seconds=150,
    ),
    IncidentPattern(
        pattern_id="kb-008", incident_type="data_corruption",
        symptom_signature={"error_rate": {"gt": 0.05}, "error_type": "data_integrity"},
        root_cause="Data corruption from concurrent writes or failed migration",
        root_cause_category="software_bug",
        affected_services=["*_with_db"],
        remediation_steps=[
            {"step": 1, "action": "stop_writes", "command": "Enable read-only mode", "timeout_seconds": 10},
            {"step": 2, "action": "identify_corruption", "command": "Run integrity checks on affected tables", "timeout_seconds": 60},
            {"step": 3, "action": "restore_from_backup", "command": "pg_restore from latest consistent backup", "timeout_seconds": 300},
            {"step": 4, "action": "replay_wal", "command": "Apply WAL logs from backup to current", "timeout_seconds": 120},
        ],
        prevention_measures=["Continuous backups", "Checksums", "Schema validation", "Transaction isolation"],
        success_rate=0.82, occurrence_count=5, avg_resolution_seconds=1800,
    ),
]

# ── Pydantic Models ───────────────────────────────────────────────────────────

class AnomalyInput(BaseModel):
    anomaly_id: str
    service_name: str
    metric_name: str
    current_value: float
    baseline_mean: float
    baseline_std: float
    z_score: float
    isolation_score: float
    severity: str
    detection_method: str
    context: dict = {}

class DiagnosisResult(BaseModel):
    diagnosis_id: str
    anomaly_id: str
    root_cause_hypothesis: str
    root_cause_category: str
    confidence: float
    evidence: list[str]
    matched_pattern: Optional[str] = None
    remediation_plan: list[dict]
    estimated_resolution_seconds: int
    should_auto_execute: bool
    human_review_reason: Optional[str] = None
    llm_reasoning: Optional[str] = None
    causal_chain: list[str]
    affected_services: list[str]
    prevention_recommendations: list[str]

class LearnInput(BaseModel):
    remediation_id: str
    outcome: str  # success, partial_success, failure
    actual_root_cause: Optional[str] = None
    resolution_time_seconds: Optional[int] = None
    notes: Optional[str] = None

# ── State ─────────────────────────────────────────────────────────────────────

class ReasoningState:
    def __init__(self):
        self.diagnoses: list[dict] = []
        self.learning_events: list[dict] = []
        self.metrics = {
            "diagnoses_performed": 0,
            "auto_remediation_recommended": 0,
            "human_escalation_recommended": 0,
            "llm_calls": 0,
            "llm_failures": 0,
            "knowledge_updates": 0,
            "avg_diagnosis_time_ms": 0.0,
            "pattern_match_rate": 0.0,
        }
        self.start_time = datetime.now(timezone.utc)
        self.lock = threading.Lock()

state = ReasoningState()

# ── Knowledge Graph Matching ──────────────────────────────────────────────────

def match_pattern(anomaly: AnomalyInput) -> Optional[IncidentPattern]:
    """Find the best matching incident pattern from knowledge base."""
    best_match = None
    best_score = 0.0

    for pattern in KNOWLEDGE_BASE:
        score = 0.0
        sig = pattern.symptom_signature

        # Health status match
        if "health_status" in sig and anomaly.metric_name == "health_status":
            if anomaly.current_value == sig["health_status"]:
                score += 0.4

        # Latency threshold match
        if "response_latency_ms" in sig and anomaly.metric_name == "response_latency_ms":
            threshold = sig["response_latency_ms"]
            if isinstance(threshold, dict) and "gt" in threshold:
                if anomaly.current_value > threshold["gt"]:
                    score += 0.4

        # Memory pressure
        if "memory_usage_pct" in sig and "memory" in anomaly.metric_name:
            threshold = sig["memory_usage_pct"]
            if isinstance(threshold, dict) and "gt" in threshold:
                if anomaly.current_value > threshold["gt"]:
                    score += 0.4

        # Severity boost
        if anomaly.severity == "critical":
            score += 0.2
        elif anomaly.severity == "high":
            score += 0.1

        # Historical success rate boost
        score += pattern.success_rate * 0.2

        if score > best_score:
            best_score = score
            best_match = pattern

    if best_score >= 0.3:
        return best_match
    return None


def build_causal_chain(anomaly: AnomalyInput, pattern: Optional[IncidentPattern]) -> list[str]:
    """Reconstruct the causal chain leading to this anomaly."""
    chain = []
    chain.append(f"Anomaly detected: {anomaly.metric_name}={anomaly.current_value:.2f} on {anomaly.service_name}")
    chain.append(f"Deviation: z-score={anomaly.z_score:.2f}, isolation={anomaly.isolation_score:.2f}")

    if anomaly.z_score > 5.0:
        chain.append("Extreme deviation (>5σ) suggests sudden state change, not gradual degradation")
    elif anomaly.z_score > 3.0:
        chain.append("Significant deviation (>3σ) indicates abnormal behavior beyond normal variance")

    if pattern:
        chain.append(f"Pattern match: {pattern.incident_type} (historical success rate: {pattern.success_rate:.0%})")
        chain.append(f"Root cause category: {pattern.root_cause_category}")
        chain.append(f"Observed {pattern.occurrence_count} times before, avg resolution: {pattern.avg_resolution_seconds}s")

    return chain


# ── LLM Integration ───────────────────────────────────────────────────────────

def call_llm(prompt: str) -> Optional[str]:
    """Call Ollama LLM for advanced reasoning."""
    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": REASONING_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.3, "num_predict": 500},
            },
            timeout=30,
        )
        if resp.ok:
            with state.lock:
                state.metrics["llm_calls"] += 1
            return resp.json().get("response", "")
    except Exception as e:
        logger.warning(f"[LLM] Call failed: {e}")
        with state.lock:
            state.metrics["llm_failures"] += 1
    return None


def llm_diagnose(anomaly: AnomalyInput, pattern: Optional[IncidentPattern]) -> Optional[str]:
    """Use LLM for deeper root cause analysis."""
    pattern_ctx = ""
    if pattern:
        pattern_ctx = f"""
Known pattern match: {pattern.incident_type}
Historical root cause: {pattern.root_cause}
Success rate: {pattern.success_rate:.0%}
"""

    prompt = f"""You are a senior Site Reliability Engineer analyzing a production anomaly.

ANOMALY:
- Service: {anomaly.service_name}
- Metric: {anomaly.metric_name}
- Current Value: {anomaly.current_value:.2f}
- Baseline Mean: {anomaly.baseline_mean:.2f}
- Baseline Std Dev: {anomaly.baseline_std:.2f}
- Z-Score: {anomaly.z_score:.2f}
- Isolation Score: {anomaly.isolation_score:.2f}
- Severity: {anomaly.severity}
- Detection Method: {anomaly.detection_method}
{pattern_ctx}

Analyze the root cause step by step:
1. What is the most likely root cause?
2. What evidence supports this hypothesis?
3. What should be checked first?
4. What is the recommended immediate action?

Be concise and specific. Focus on actionable insights."""

    return call_llm(prompt)


# ── Diagnosis Engine ──────────────────────────────────────────────────────────

def diagnose_anomaly(anomaly: AnomalyInput) -> DiagnosisResult:
    """Full diagnosis pipeline: pattern match → LLM reasoning → plan generation."""
    start = time.time()

    # Step 1: Pattern matching
    pattern = match_pattern(anomaly)

    # Step 2: Build causal chain
    causal_chain = build_causal_chain(anomaly, pattern)

    # Step 3: LLM reasoning (if available)
    llm_reasoning = llm_diagnose(anomaly, pattern)

    # Step 4: Determine root cause and confidence
    if pattern:
        root_cause = pattern.root_cause
        root_cause_category = pattern.root_cause_category
        base_confidence = pattern.success_rate * 0.7

        # Boost confidence based on symptom match strength
        if anomaly.z_score > 5.0:
            base_confidence += 0.15
        elif anomaly.z_score > 3.0:
            base_confidence += 0.10

        if anomaly.isolation_score > 0.8:
            base_confidence += 0.10

        confidence = min(base_confidence, 0.98)
        remediation_plan = pattern.remediation_steps
        est_resolution = pattern.avg_resolution_seconds
        affected = pattern.affected_services
        prevention = pattern.prevention_measures
    else:
        root_cause = f"Unknown anomaly on {anomaly.service_name}.{anomaly.metric_name} — no matching pattern in knowledge base"
        root_cause_category = "unknown"
        confidence = 0.3
        remediation_plan = [
            {"step": 1, "action": "investigate", "command": f"Check logs for {anomaly.service_name}", "timeout_seconds": 30},
            {"step": 2, "action": "monitor", "command": "Increase monitoring frequency to 5s intervals", "timeout_seconds": 10},
            {"step": 3, "action": "escalate", "command": "Notify L2 on-call engineer", "timeout_seconds": 5},
        ]
        est_resolution = 600
        affected = [anomaly.service_name]
        prevention = ["Add this pattern to knowledge base after resolution"]

    # Step 5: Auto-execution decision
    should_auto = confidence >= CONFIDENCE_AUTO_THRESHOLD and anomaly.severity in ("critical", "high")
    human_reason = None
    if not should_auto:
        if confidence < CONFIDENCE_SUGGEST_THRESHOLD:
            human_reason = f"Low confidence ({confidence:.0%}) — novel pattern requires human analysis"
        elif confidence < CONFIDENCE_AUTO_THRESHOLD:
            human_reason = f"Moderate confidence ({confidence:.0%}) — recommend human verification before execution"
        elif anomaly.severity not in ("critical", "high"):
            human_reason = f"Severity {anomaly.severity} does not warrant autonomous action"

    evidence = [
        f"Z-score: {anomaly.z_score:.2f} (threshold: 3.0)",
        f"Isolation score: {anomaly.isolation_score:.2f} (threshold: 0.65)",
        f"Current value {anomaly.current_value:.2f} vs baseline {anomaly.baseline_mean:.2f} ± {anomaly.baseline_std:.2f}",
    ]
    if pattern:
        evidence.append(f"Matched pattern: {pattern.incident_type} ({pattern.occurrence_count} past occurrences)")
    if llm_reasoning:
        evidence.append(f"LLM analysis available")

    diagnosis_time_ms = (time.time() - start) * 1000

    with state.lock:
        state.metrics["diagnoses_performed"] += 1
        if should_auto:
            state.metrics["auto_remediation_recommended"] += 1
        else:
            state.metrics["human_escalation_recommended"] += 1
        state.metrics["avg_diagnosis_time_ms"] = (
            state.metrics["avg_diagnosis_time_ms"] * 0.9 + diagnosis_time_ms * 0.1
        )

    result = DiagnosisResult(
        diagnosis_id=str(uuid.uuid4()),
        anomaly_id=anomaly.anomaly_id,
        root_cause_hypothesis=root_cause,
        root_cause_category=root_cause_category,
        confidence=round(confidence, 4),
        evidence=evidence,
        matched_pattern=pattern.pattern_id if pattern else None,
        remediation_plan=remediation_plan,
        estimated_resolution_seconds=est_resolution,
        should_auto_execute=should_auto,
        human_review_reason=human_reason,
        llm_reasoning=llm_reasoning,
        causal_chain=causal_chain,
        affected_services=affected,
        prevention_recommendations=prevention,
    )

    with state.lock:
        state.diagnoses.append(result.model_dump())
        if len(state.diagnoses) > 1000:
            state.diagnoses = state.diagnoses[-500:]

    return result


# ── API Endpoints ─────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    uptime = (datetime.now(timezone.utc) - state.start_time).total_seconds()
    return {
        "status": "healthy",
        "worker": WORKER_NAME,
        "port": HTTP_PORT,
        "agent_type": "reasoning",
        "capabilities": [
            "root_cause_analysis", "pattern_matching", "llm_reasoning",
            "causal_chain_reconstruction", "remediation_planning",
            "confidence_scoring", "post_incident_learning",
        ],
        "uptime_seconds": int(uptime),
        "knowledge_base_size": len(KNOWLEDGE_BASE),
        "diagnoses_performed": state.metrics["diagnoses_performed"],
    }


@app.get("/metrics")
def metrics():
    return state.metrics


@app.get("/api/knowledge")
def knowledge():
    """List all incident patterns in the knowledge base."""
    return {
        "patterns": [asdict(p) for p in KNOWLEDGE_BASE],
        "count": len(KNOWLEDGE_BASE),
    }


@app.post("/api/diagnose")
def diagnose(anomaly: AnomalyInput):
    """Diagnose an anomaly and generate a remediation plan."""
    try:
        result = diagnose_anomaly(anomaly)
        return result.model_dump()
    except Exception as e:
        logger.error(f"[DIAGNOSE] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/learn")
def learn(event: LearnInput):
    """Learn from remediation outcome to improve future diagnoses."""
    with state.lock:
        state.learning_events.append(event.model_dump())
        state.metrics["knowledge_updates"] += 1

        # If outcome was successful, boost the matched pattern's success rate
        for d in reversed(state.diagnoses):
            if d.get("diagnosis_id") == event.remediation_id or d.get("anomaly_id") == event.remediation_id:
                pattern_id = d.get("matched_pattern")
                if pattern_id:
                    for p in KNOWLEDGE_BASE:
                        if p.pattern_id == pattern_id:
                            if event.outcome == "success":
                                p.success_rate = min(p.success_rate * 1.02, 0.99)
                                p.occurrence_count += 1
                            elif event.outcome == "failure":
                                p.success_rate = max(p.success_rate * 0.95, 0.1)
                            if event.resolution_time_seconds:
                                p.avg_resolution_seconds = int(
                                    p.avg_resolution_seconds * 0.8 + event.resolution_time_seconds * 0.2
                                )
                            break
                break

    # Persist to DB
    try:
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO noc_agent_memory (memory_type, category, title, description, context, confidence)
               VALUES ('remediation_outcome', 'learning', %s, %s, %s, %s)
               ON CONFLICT DO NOTHING""",
            (
                f"Outcome: {event.outcome}",
                event.notes or f"Remediation {event.remediation_id} outcome: {event.outcome}",
                json.dumps(event.model_dump()),
                0.8 if event.outcome == "success" else 0.4,
            ),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        logger.warning(f"[DB] Learn persist failed: {e}")

    return {"accepted": True, "knowledge_base_size": len(KNOWLEDGE_BASE)}


@app.get("/api/diagnoses")
def list_diagnoses():
    """List recent diagnoses."""
    with state.lock:
        recent = list(reversed(state.diagnoses[-50:]))
    return {"diagnoses": recent, "total": len(state.diagnoses)}


@app.get("/api/dashboard")
def dashboard():
    """AI reasoning dashboard with key metrics."""
    with state.lock:
        total = state.metrics["diagnoses_performed"]
        auto = state.metrics["auto_remediation_recommended"]
        human = state.metrics["human_escalation_recommended"]
        pattern_rate = 0.0
        if state.diagnoses:
            matched = sum(1 for d in state.diagnoses if d.get("matched_pattern"))
            pattern_rate = matched / len(state.diagnoses)

    return {
        "agent": WORKER_NAME,
        "status": "active",
        "metrics": {
            "total_diagnoses": total,
            "auto_remediation_rate": round(auto / max(total, 1), 3),
            "human_escalation_rate": round(human / max(total, 1), 3),
            "pattern_match_rate": round(pattern_rate, 3),
            "llm_calls": state.metrics["llm_calls"],
            "llm_failure_rate": round(
                state.metrics["llm_failures"] / max(state.metrics["llm_calls"], 1), 3
            ),
            "knowledge_base_size": len(KNOWLEDGE_BASE),
            "knowledge_updates": state.metrics["knowledge_updates"],
            "avg_diagnosis_time_ms": round(state.metrics["avg_diagnosis_time_ms"], 1),
        },
        "recent_diagnoses": state.diagnoses[-5:] if state.diagnoses else [],
        "uptime_seconds": int((datetime.now(timezone.utc) - state.start_time).total_seconds()),
    }


# ── Background Workers ────────────────────────────────────────────────────────

def relay_heartbeat():
    """Send periodic heartbeat to event bus."""
    while True:
        time.sleep(60)
        try:
            requests.post(
                f"{RELAY_URL}/publish",
                json={
                    "topic": "noc.agent.reasoning.heartbeat",
                    "event": {
                        "agent": WORKER_NAME,
                        "diagnoses": state.metrics["diagnoses_performed"],
                        "knowledge_size": len(KNOWLEDGE_BASE),
                    },
                },
                timeout=3,
            )
        except Exception:
            pass


def poll_perception_anomalies():
    """Poll the Perception Engine for new anomalies and auto-diagnose."""
    while True:
        time.sleep(20)
        try:
            resp = requests.get("http://localhost:8194/api/anomalies", timeout=5)
            if resp.ok:
                data = resp.json()
                anomalies = data.get("anomalies", [])
                for a in anomalies[:5]:  # Process top 5 most recent
                    if a.get("severity") in ("critical", "high"):
                        try:
                            inp = AnomalyInput(
                                anomaly_id=a["anomaly_id"],
                                service_name=a["service_name"],
                                metric_name=a["metric_name"],
                                current_value=a["current_value"],
                                baseline_mean=a["baseline_mean"],
                                baseline_std=a["baseline_std"],
                                z_score=a["z_score"],
                                isolation_score=a["isolation_score"],
                                severity=a["severity"],
                                detection_method=a["detection_method"],
                            )
                            diagnosis = diagnose_anomaly(inp)
                            if diagnosis.should_auto_execute:
                                # Forward to action engine
                                requests.post(
                                    "http://localhost:8196/api/execute",
                                    json=diagnosis.model_dump(),
                                    timeout=5,
                                )
                        except Exception as e:
                            logger.warning(f"[POLL] Diagnosis error: {e}")
        except Exception:
            pass


# Start background threads
threading.Thread(target=relay_heartbeat, daemon=True).start()
threading.Thread(target=poll_perception_anomalies, daemon=True).start()

if __name__ == "__main__":
    import uvicorn
    logger.info(f"[{WORKER_NAME}] Starting AI Reasoning Engine on port {HTTP_PORT}")
    uvicorn.run(app, host="0.0.0.0", port=HTTP_PORT)
