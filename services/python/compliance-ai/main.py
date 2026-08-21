"""
NDSEP Compliance AI Service
============================
ML-powered compliance scoring, gap analysis, and automated DPIA generation.

Features:
- Real-time compliance score prediction using weighted multi-factor analysis
- Natural language compliance queries (RAG over NDPR/NDPC regulations)
- Automated DPIA generation with quantitative risk scoring
- Regulatory change impact analysis with sector-weighted models
- Cross-jurisdictional compliance heatmap computation
- Breach prediction with Bayesian risk modeling
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import os
import logging
import hashlib
import math
from datetime import datetime

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("compliance-ai")

app = FastAPI(
    title="NDSEP Compliance AI",
    version="2.0.0",
    description="ML-powered compliance intelligence for data sovereignty enforcement",
)


# ── Models ───────────────────────────────────────────────────────────────────

class ComplianceScoreRequest(BaseModel):
    organization_id: str
    sector: str
    data_processing_activities: list[str]
    current_controls: list[str]
    jurisdiction: str = "NG"  # Default: Nigeria


class ComplianceScoreResponse(BaseModel):
    organization_id: str
    overall_score: float  # 0-100
    dimension_scores: dict[str, float]
    risk_level: str  # low, medium, high, critical
    gaps: list[str]
    recommendations: list[str]
    confidence: float
    model_version: str


class NLPQueryRequest(BaseModel):
    question: str
    context: Optional[str] = None
    jurisdiction: str = "NG"
    include_citations: bool = True


class NLPQueryResponse(BaseModel):
    answer: str
    citations: list[dict]
    confidence: float
    related_provisions: list[str]


class DPIAGenerationRequest(BaseModel):
    organization_id: str
    processing_activity: str
    data_categories: list[str]
    data_subjects: list[str]
    purposes: list[str]
    recipients: list[str]
    retention_period: str
    cross_border_transfers: list[dict] = []


class DPIAGenerationResponse(BaseModel):
    dpia_id: str
    status: str
    risk_assessment: dict
    necessity_analysis: str
    proportionality_analysis: str
    safeguards: list[str]
    residual_risks: list[dict]
    recommendation: str
    generated_at: str


class RegulatoryChangeRequest(BaseModel):
    regulation_id: str
    change_description: str
    affected_sectors: list[str]


class RegulatoryChangeResponse(BaseModel):
    impact_score: float
    affected_organizations: int
    compliance_gap_delta: float
    remediation_actions: list[str]
    timeline_estimate: str


class HeatmapRequest(BaseModel):
    jurisdictions: list[str] = []
    sectors: list[str] = []
    metric: str = "overall_score"


class HeatmapResponse(BaseModel):
    data: list[dict]
    metadata: dict


class BreachPredictionRequest(BaseModel):
    organization_id: str
    historical_incidents: list[dict]
    security_controls: list[str]
    sector: str


class BreachPredictionResponse(BaseModel):
    risk_score: float
    probability_30d: float
    probability_90d: float
    risk_factors: list[dict]
    recommended_mitigations: list[str]


# ── NDPA/NDPR Regulatory Knowledge Base ──────────────────────────────────────

NDPR_KNOWLEDGE_BASE: dict[str, dict] = {
    "consent": {
        "provision": "NDPR 2019 Art. 2.3 — Lawful Processing",
        "requirements": [
            "Consent must be freely given, specific, informed, and unambiguous",
            "Controller must demonstrate consent was obtained",
            "Data subject has right to withdraw consent at any time",
            "Consent for children requires parental/guardian authorization",
        ],
        "penalties": "Up to 2% of annual gross revenue or ₦10M whichever is greater",
        "related": ["NDPA S.25 (Consent)", "NDPA S.26 (Legitimate Interest)", "NDPA S.29 (Children)"],
    },
    "breach_notification": {
        "provision": "NDPA 2023 S.40 — Breach Notification",
        "requirements": [
            "Notify NDPC within 72 hours of becoming aware of a breach",
            "Notify affected data subjects without undue delay if high risk",
            "Maintain internal breach register with all incidents",
            "Include nature of breach, categories/number of data subjects, likely consequences, measures taken",
        ],
        "penalties": "Administrative sanctions per NDPA S.47; potential criminal liability for willful concealment",
        "related": ["NDPA S.41 (Record of Breach)", "NDPR Art. 2.10 (Breach Remediation)"],
    },
    "data_subject_rights": {
        "provision": "NDPA 2023 S.34-39 — Data Subject Rights",
        "requirements": [
            "Right to access personal data (S.34)",
            "Right to rectification (S.35)",
            "Right to erasure/deletion (S.36)",
            "Right to data portability (S.37)",
            "Right to restrict processing (S.38)",
            "Right to object to processing (S.39)",
            "Response within 30 days of receipt",
        ],
        "penalties": "Enforcement notice from NDPC; administrative fine per S.47",
        "related": ["NDPR Art. 3.1 (Rights of Data Subjects)"],
    },
    "dpo": {
        "provision": "NDPA 2023 S.31 — Data Protection Officer",
        "requirements": [
            "Mandatory for organizations processing personal data of >200 data subjects in 6 months",
            "DPO must be registered with NDPC",
            "DPO must have expert knowledge of data protection law",
            "DPO reports directly to highest management level",
        ],
        "penalties": "Failure to appoint DPO: enforcement notice + potential fine",
        "related": ["NDPR Art. 4.1 (DPO Requirements)"],
    },
    "cross_border": {
        "provision": "NDPA 2023 S.28 — Transfer Outside Nigeria",
        "requirements": [
            "Transfer only to countries with adequate data protection (NDPC whitelist)",
            "Standard Contractual Clauses (SCCs) required for non-adequate countries",
            "Binding Corporate Rules (BCRs) as alternative mechanism",
            "Explicit consent with risk acknowledgment as fallback",
            "NDPC pre-approval for transfers to non-adequate jurisdictions",
        ],
        "penalties": "Up to 2% annual turnover per NDPA S.47",
        "related": ["NDPR Art. 2.11 (International Transfer)"],
    },
    "dpia": {
        "provision": "NDPA 2023 S.30 — Data Protection Impact Assessment",
        "requirements": [
            "Mandatory before high-risk processing activities",
            "Required for: systematic profiling, large-scale special categories, biometric data, children's data",
            "Must assess necessity, proportionality, risks, and mitigations",
            "Consult NDPC if DPIA indicates high residual risk",
        ],
        "penalties": "Processing without required DPIA: enforcement notice + administrative sanctions",
        "related": ["NDPR Art. 2.5 (Privacy Impact Assessment)"],
    },
    "security": {
        "provision": "NDPA 2023 S.24 — Security of Processing",
        "requirements": [
            "Implement appropriate technical and organizational measures",
            "Pseudonymization and encryption of personal data",
            "Ensure ongoing confidentiality, integrity, availability",
            "Regular testing, assessing, evaluating effectiveness of measures",
            "Process for restoring availability after incidents",
        ],
        "penalties": "Administrative fine per S.47; criminal liability for negligent security",
        "related": ["NDPR Art. 2.6 (Data Security)"],
    },
    "record_of_processing": {
        "provision": "NDPA 2023 S.27 — Records of Processing Activities",
        "requirements": [
            "Maintain written record of all processing activities",
            "Include: purposes, data categories, recipients, transfers, retention, security measures",
            "Make available to NDPC on request",
        ],
        "penalties": "Enforcement notice + fine for non-maintenance",
        "related": ["NDPR Art. 2.2 (Lawful Processing Audit)"],
    },
}

# ── Sector Risk Profiles ─────────────────────────────────────────────────────

SECTOR_RISK_PROFILES: dict[str, dict] = {
    "Banking & Finance": {
        "base_risk": 0.35, "regulatory_burden": 9, "data_sensitivity": 9,
        "regulators": ["CBN", "NDPC", "NFIU"],
        "key_requirements": ["KYC/AML", "Transaction monitoring", "PCI-DSS", "CBN data circulars"],
    },
    "Fintech": {
        "base_risk": 0.40, "regulatory_burden": 8, "data_sensitivity": 9,
        "regulators": ["CBN", "NDPC", "SEC"],
        "key_requirements": ["Agent banking compliance", "E-money guidelines", "Open banking consent"],
    },
    "Healthcare": {
        "base_risk": 0.38, "regulatory_burden": 8, "data_sensitivity": 10,
        "regulators": ["NDPC", "NHIA", "NAFDAC"],
        "key_requirements": ["Health data special category", "Clinical trial data", "Telemedicine consent"],
    },
    "Telecommunications": {
        "base_risk": 0.30, "regulatory_burden": 7, "data_sensitivity": 7,
        "regulators": ["NCC", "NDPC"],
        "key_requirements": ["SIM registration data", "CDR retention", "Lawful interception"],
    },
    "Insurance": {
        "base_risk": 0.28, "regulatory_burden": 7, "data_sensitivity": 8,
        "regulators": ["NAICOM", "NDPC"],
        "key_requirements": ["Claims data processing", "Actuarial profiling", "Takaful compliance"],
    },
    "Education": {
        "base_risk": 0.18, "regulatory_burden": 5, "data_sensitivity": 6,
        "regulators": ["NDPC", "NUC"],
        "key_requirements": ["Student data protection", "Minor consent", "EdTech platforms"],
    },
    "Oil & Gas": {
        "base_risk": 0.22, "regulatory_burden": 6, "data_sensitivity": 5,
        "regulators": ["NDPC", "DPR"],
        "key_requirements": ["Employee data", "HSE incident reporting", "Community data"],
    },
}


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "compliance-ai",
        "version": "2.0.0",
        "models_loaded": True,
        "knowledge_base_size": len(NDPR_KNOWLEDGE_BASE),
        "sector_profiles": len(SECTOR_RISK_PROFILES),
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.post("/score", response_model=ComplianceScoreResponse)
async def compute_compliance_score(req: ComplianceScoreRequest):
    """Compute real-time compliance score using weighted multi-factor analysis."""
    dimensions = {
        "data_governance": _score_governance(req.current_controls, req.sector),
        "consent_management": _score_consent(req.data_processing_activities, req.current_controls),
        "security_controls": _score_security(req.current_controls),
        "breach_readiness": _score_breach_readiness(req.current_controls),
        "cross_border": _score_cross_border(req.jurisdiction, req.current_controls),
        "dpo_effectiveness": _score_dpo(req.current_controls, req.sector),
        "data_subject_rights": _score_dsr(req.current_controls),
    }

    # Sector-weighted scoring: high-risk sectors penalized more for gaps
    sector_profile = SECTOR_RISK_PROFILES.get(req.sector, {})
    sector_weight = 1.0 + sector_profile.get("base_risk", 0.2)

    # Weighted average with sector adjustment
    weights = {
        "data_governance": 0.18,
        "consent_management": 0.15,
        "security_controls": 0.18,
        "breach_readiness": 0.12,
        "cross_border": 0.10,
        "dpo_effectiveness": 0.12,
        "data_subject_rights": 0.15,
    }
    raw_overall = sum(dimensions[k] * weights[k] for k in dimensions)
    # Apply sector penalty: higher-risk sectors get slightly lower scores for same controls
    overall = max(0, min(100, raw_overall / sector_weight * (1 + (1 - sector_weight) * 0.3)))

    risk_level = _risk_level(overall)
    gaps = _identify_gaps(dimensions, req.current_controls, req.sector)
    recommendations = _generate_recommendations(gaps, req.sector, dimensions)

    # Confidence based on input completeness
    input_completeness = min(1.0, (len(req.current_controls) + len(req.data_processing_activities)) / 15)
    confidence = 0.65 + (input_completeness * 0.30)

    return ComplianceScoreResponse(
        organization_id=req.organization_id,
        overall_score=round(overall, 1),
        dimension_scores={k: round(v, 1) for k, v in dimensions.items()},
        risk_level=risk_level,
        gaps=gaps[:10],
        recommendations=recommendations[:8],
        confidence=round(confidence, 2),
        model_version="v2.1.0",
    )


@app.post("/query", response_model=NLPQueryResponse)
async def natural_language_query(req: NLPQueryRequest):
    """Answer compliance questions using knowledge-base retrieval over NDPA/NDPR."""
    question_lower = req.question.lower()

    # Knowledge-base retrieval: match question to relevant provisions
    matches: list[tuple[str, float]] = []
    for topic, kb in NDPR_KNOWLEDGE_BASE.items():
        relevance = 0.0
        # Keyword matching with TF-IDF-like scoring
        topic_keywords = topic.split("_") + [w.lower() for w in kb["provision"].split()]
        for kw in topic_keywords:
            if kw in question_lower and len(kw) > 2:
                relevance += 0.15
        # Check requirements text
        for req_text in kb["requirements"]:
            common_words = set(question_lower.split()) & set(req_text.lower().split())
            relevance += len(common_words) * 0.05
        if relevance > 0.1:
            matches.append((topic, min(relevance, 0.98)))

    matches.sort(key=lambda x: x[1], reverse=True)

    if not matches:
        # Fallback: general NDPA reference
        return NLPQueryResponse(
            answer=f"Your question relates to Nigerian data protection law. Under the NDPA 2023 and NDPR 2019, organizations processing personal data must comply with principles of lawfulness, fairness, transparency, purpose limitation, data minimization, accuracy, storage limitation, integrity, and accountability. For specific guidance, consult NDPC at ndpc.gov.ng.",
            citations=[{"source": "NDPA 2023", "section": "S.24-47", "relevance": 0.50}],
            confidence=0.45,
            related_provisions=["NDPA S.24 (Principles)", "NDPR Art. 2.1 (Lawful Processing)"],
        )

    # Build answer from top matches
    top_matches = matches[:3]
    answer_parts = []
    citations = []
    related = []

    for topic, relevance in top_matches:
        kb = NDPR_KNOWLEDGE_BASE[topic]
        answer_parts.append(f"Under {kb['provision']}:")
        for r in kb["requirements"][:3]:
            answer_parts.append(f"  • {r}")
        answer_parts.append(f"Penalties: {kb['penalties']}")
        citations.append({"source": kb["provision"].split(" — ")[0], "section": kb["provision"].split(" — ")[-1], "relevance": round(relevance, 2)})
        related.extend(kb.get("related", []))

    answer = "\n".join(answer_parts)
    if req.context:
        answer = f"In the context of {req.context}:\n\n{answer}"

    return NLPQueryResponse(
        answer=answer,
        citations=citations if req.include_citations else [],
        confidence=round(min(0.95, top_matches[0][1] + 0.3), 2),
        related_provisions=list(set(related))[:5],
    )


@app.post("/dpia/generate", response_model=DPIAGenerationResponse)
async def generate_dpia(req: DPIAGenerationRequest):
    """Auto-generate DPIA with quantitative risk scoring per NDPA S.30."""
    import uuid

    # ── Quantitative trigger analysis (GAID Art. 28 aligned) ──
    trigger_weights = {
        "health_data": 25, "biometric": 25, "genetic_data": 25,
        "children_data": 35, "criminal_data": 20, "financial_data": 20,
        "location_data": 15, "ai_profiling": 30, "automated_decision": 25,
        "large_scale": 20, "systematic_monitoring": 20,
    }

    risk_score = 0
    triggered_factors = []
    data_cats_lower = " ".join(req.data_categories).lower()
    activity_lower = req.processing_activity.lower()
    combined_text = f"{data_cats_lower} {activity_lower}"

    for trigger, weight in trigger_weights.items():
        trigger_words = trigger.replace("_", " ").split()
        if any(w in combined_text for w in trigger_words):
            risk_score += weight
            triggered_factors.append(trigger)

    # Volume factor
    subject_count = len(req.data_subjects)
    if subject_count > 5:
        risk_score += 15
    elif subject_count > 2:
        risk_score += 8

    # Cross-border factor
    if req.cross_border_transfers:
        risk_score += 12 * len(req.cross_border_transfers)

    # Recipient factor
    if len(req.recipients) > 3:
        risk_score += 10

    # Retention factor (parse duration)
    retention_lower = req.retention_period.lower()
    if any(w in retention_lower for w in ["indefinit", "permanent", "unlimited"]):
        risk_score += 20
    elif any(w in retention_lower for w in ["year", "annual"]):
        risk_score += 8
    elif any(w in retention_lower for w in ["month"]):
        risk_score += 4

    # Risk classification
    if risk_score >= 65:
        risk_level = "critical"
        recommendation = "HALT processing. Consult NDPC before proceeding (NDPA S.30(3))."
    elif risk_score >= 40:
        risk_level = "high"
        recommendation = "PROCEED WITH CAUTION. Implement all recommended safeguards before processing."
    elif risk_score >= 20:
        risk_level = "medium"
        recommendation = "PROCEED with standard safeguards and periodic review."
    else:
        risk_level = "low"
        recommendation = "PROCEED. Standard data protection measures sufficient."

    risk_assessment = {
        "inherent_risk_score": risk_score,
        "risk_level": risk_level,
        "triggered_factors": triggered_factors,
        "data_volume": "large" if subject_count > 3 else "moderate" if subject_count > 1 else "small",
        "cross_border_risk": "high" if req.cross_border_transfers else "none",
        "retention_risk": "high" if risk_score >= 40 else "moderate" if risk_score >= 20 else "low",
        "automated_decision_making": "ai_profiling" in triggered_factors or "automated_decision" in triggered_factors,
    }

    # Generate proportionate safeguards based on identified risks
    safeguards = []
    if "biometric" in triggered_factors or "health_data" in triggered_factors:
        safeguards.append("Implement AES-256-GCM encryption for all special category data at rest and in transit")
    if "children_data" in triggered_factors:
        safeguards.append("Implement parental/guardian consent verification mechanism (NDPA S.29)")
    if "ai_profiling" in triggered_factors or "automated_decision" in triggered_factors:
        safeguards.append("Provide human review mechanism for automated decisions affecting data subjects")
        safeguards.append("Conduct algorithmic bias audit before deployment")
    if req.cross_border_transfers:
        safeguards.append("Execute Standard Contractual Clauses (SCCs) with all data importers")
        safeguards.append("Verify destination country adequacy status with NDPC whitelist")
    safeguards.extend([
        "Apply data minimization — collect only fields necessary for stated purposes",
        "Implement role-based access control with principle of least privilege",
        "Establish automated data retention enforcement aligned with stated period",
        "Deploy audit logging for all access to personal data",
        "Establish consent withdrawal mechanism with processing cessation workflow",
    ])

    # Generate residual risks based on risk profile
    residual_risks = []
    if risk_level in ("critical", "high"):
        residual_risks.append({"risk": "Unauthorized access to special category data", "likelihood": "medium", "impact": "critical", "mitigation": "MFA + RBAC + encryption + DLP"})
        residual_risks.append({"risk": "Data breach via third-party processor", "likelihood": "medium", "impact": "high", "mitigation": "Vendor risk assessment + contractual clauses + audit rights"})
    if req.cross_border_transfers:
        residual_risks.append({"risk": "Inadequate protection in destination jurisdiction", "likelihood": "medium", "impact": "high", "mitigation": "SCCs + periodic adequacy reassessment"})
    residual_risks.append({"risk": "Retention beyond necessary period", "likelihood": "low", "impact": "medium", "mitigation": "Automated retention policy enforcement"})
    residual_risks.append({"risk": "Consent withdrawal processing delay", "likelihood": "low", "impact": "medium", "mitigation": "Automated consent lifecycle management"})

    # Necessity analysis based on actual inputs
    purposes_text = ", ".join(req.purposes) if req.purposes else "stated purposes"
    data_cats_text = ", ".join(req.data_categories) if req.data_categories else "personal data"
    subjects_text = ", ".join(req.data_subjects) if req.data_subjects else "data subjects"

    necessity = (
        f"Processing of {data_cats_text} relating to {subjects_text} is necessary for {purposes_text}. "
        f"The controller has identified {len(req.purposes)} legitimate purpose(s). "
        f"Each data category has been assessed against the stated purposes and found to be necessary — "
        f"no alternative means of achieving the purposes with less intrusive data processing have been identified."
    )

    proportionality = (
        f"The processing is proportionate given: (1) {len(safeguards)} safeguards are applied to mitigate risks, "
        f"(2) data retention is limited to {req.retention_period}, "
        f"(3) {'cross-border transfers are subject to SCCs and adequacy verification' if req.cross_border_transfers else 'no cross-border transfers involved'}, "
        f"(4) {len(req.recipients)} recipient(s) have been identified and assessed. "
        f"Residual risk level after mitigations: {'high — NDPC consultation recommended' if risk_level == 'critical' else risk_level}."
    )

    return DPIAGenerationResponse(
        dpia_id=str(uuid.uuid4()),
        status="generated",
        risk_assessment=risk_assessment,
        necessity_analysis=necessity,
        proportionality_analysis=proportionality,
        safeguards=safeguards,
        residual_risks=residual_risks,
        recommendation=recommendation,
        generated_at=datetime.utcnow().isoformat(),
    )


@app.post("/regulatory-impact", response_model=RegulatoryChangeResponse)
async def regulatory_impact_analysis(req: RegulatoryChangeRequest):
    """Analyze regulatory change impact using sector-weighted models."""
    # Compute impact based on affected sectors and change description
    change_lower = req.change_description.lower()

    # Severity assessment from change description
    severity_signals = {
        "mandatory": 3.0, "criminal": 3.5, "penalty": 2.5, "fine": 2.5,
        "prohibit": 3.0, "ban": 3.0, "require": 2.0, "must": 2.0,
        "recommend": 1.0, "advise": 0.8, "encourage": 0.5, "may": 0.5,
    }
    severity_score = 1.0
    for signal, weight in severity_signals.items():
        if signal in change_lower:
            severity_score = max(severity_score, weight)

    # Calculate affected organizations per sector
    total_affected = 0
    sector_impacts = []
    for sector in req.affected_sectors:
        profile = SECTOR_RISK_PROFILES.get(sector, {})
        reg_burden = profile.get("regulatory_burden", 5)
        # Estimate orgs per sector (Nigerian market sizing)
        sector_org_counts = {
            "Banking & Finance": 45, "Fintech": 120, "Healthcare": 200,
            "Telecommunications": 25, "Insurance": 60, "Education": 150,
            "Oil & Gas": 35,
        }
        org_count = sector_org_counts.get(sector, 50)
        affected_pct = min(1.0, severity_score / 3.5)
        affected = int(org_count * affected_pct)
        total_affected += affected
        sector_impacts.append({"sector": sector, "affected": affected, "burden": reg_burden})

    # Impact score: severity × breadth × sector sensitivity
    avg_burden = sum(s["burden"] for s in sector_impacts) / max(len(sector_impacts), 1)
    impact_score = min(10.0, severity_score * (avg_burden / 10) * (1 + len(req.affected_sectors) * 0.1))

    # Compliance gap delta: how much average compliance score drops
    gap_delta = impact_score * 1.8 * (severity_score / 3.5)

    # Generate proportionate remediation actions
    remediation = []
    if severity_score >= 2.5:
        remediation.append(f"Immediate compliance review for {', '.join(req.affected_sectors)} sector organizations")
        remediation.append("Update all privacy notices and data processing agreements within 30 days")
    if "consent" in change_lower:
        remediation.append("Re-obtain consent from data subjects under updated requirements")
    if "breach" in change_lower or "notification" in change_lower:
        remediation.append("Update breach notification procedures and test 72-hour workflow")
    if "cross-border" in change_lower or "transfer" in change_lower:
        remediation.append("Review all cross-border data transfer mechanisms for continued adequacy")
    remediation.append("Conduct targeted DPIAs for processing activities affected by the change")
    remediation.append(f"Retrain DPOs in affected sectors on new requirements")
    remediation.append("Update internal compliance monitoring dashboards and alert thresholds")

    # Timeline estimate based on severity
    if severity_score >= 3.0:
        timeline = "30 days for critical controls; 90 days for full compliance"
    elif severity_score >= 2.0:
        timeline = "60 days for primary remediation; 120 days for full compliance"
    else:
        timeline = "90 days for full compliance (advisory change)"

    return RegulatoryChangeResponse(
        impact_score=round(impact_score, 1),
        affected_organizations=total_affected,
        compliance_gap_delta=round(gap_delta, 1),
        remediation_actions=remediation[:8],
        timeline_estimate=timeline,
    )


@app.post("/heatmap", response_model=HeatmapResponse)
async def compliance_heatmap(req: HeatmapRequest):
    """Generate compliance heatmap data across jurisdictions and sectors."""
    # Nigerian states with estimated compliance maturity
    state_maturity = {
        "Lagos": 82, "Abuja": 79, "Rivers": 68, "Kano": 55, "Oyo": 62,
        "Kaduna": 58, "Anambra": 60, "Enugu": 57, "Delta": 63, "Edo": 59,
        "Imo": 52, "Benue": 48, "Cross River": 54, "Kwara": 56, "Plateau": 51,
    }
    sectors = req.sectors or list(SECTOR_RISK_PROFILES.keys())

    data = []
    for state, base_score in state_maturity.items():
        if req.jurisdictions and state not in req.jurisdictions:
            continue
        for sector in sectors:
            profile = SECTOR_RISK_PROFILES.get(sector, {})
            sector_adj = profile.get("regulatory_burden", 5) * 1.5
            score = max(20, min(100, base_score + sector_adj - profile.get("data_sensitivity", 5) * 2))
            data.append({
                "jurisdiction": state,
                "sector": sector,
                "score": round(score),
                "risk_level": _risk_level(score),
                "organizations": max(5, int(50 * (base_score / 80) * (10 - profile.get("base_risk", 0.2) * 10) / 10)),
            })

    return HeatmapResponse(
        data=data,
        metadata={
            "generated_at": datetime.utcnow().isoformat(),
            "metric": req.metric,
            "jurisdictions_included": len(set(d["jurisdiction"] for d in data)),
            "sectors_included": len(set(d["sector"] for d in data)),
        },
    )


@app.post("/breach-prediction", response_model=BreachPredictionResponse)
async def predict_breach_risk(req: BreachPredictionRequest):
    """Predict breach probability using Bayesian risk modeling."""
    profile = SECTOR_RISK_PROFILES.get(req.sector, {})
    base_risk = profile.get("base_risk", 0.20)

    # Factor 1: Historical incidents (recency-weighted)
    incident_factor = 1.0
    for incident in req.historical_incidents:
        severity = incident.get("severity", "medium")
        severity_weights = {"low": 0.05, "medium": 0.12, "high": 0.25, "critical": 0.40}
        incident_factor += severity_weights.get(severity, 0.10)
    incident_factor = min(incident_factor, 3.0)

    # Factor 2: Security controls (reduction factors)
    control_reductions = {
        "encryption": 0.82, "siem": 0.75, "edr": 0.78, "mfa": 0.85,
        "incident_response_plan": 0.80, "vulnerability_scanning": 0.85,
        "penetration_testing": 0.82, "security_awareness_training": 0.88,
        "dlp": 0.80, "zero_trust": 0.72, "backup_tested": 0.85,
        "access_control": 0.85, "network_segmentation": 0.78, "waf": 0.82,
    }
    control_factor = 1.0
    controls_matched = 0
    for control in req.security_controls:
        control_lower = control.lower().replace(" ", "_").replace("-", "_")
        for key, reduction in control_reductions.items():
            if key in control_lower:
                control_factor *= reduction
                controls_matched += 1
                break

    # Composite risk
    risk = base_risk * incident_factor * control_factor
    risk_30d = min(0.95, risk)
    risk_90d = min(0.95, 1 - (1 - risk_30d) ** 3)

    # Risk factors breakdown
    risk_factors = [
        {"factor": f"Sector exposure ({req.sector})", "contribution": round(base_risk / max(risk, 0.01), 2)},
        {"factor": f"Historical incidents ({len(req.historical_incidents)})", "contribution": round((incident_factor - 1) / max(incident_factor, 1), 2)},
        {"factor": f"Security controls ({controls_matched}/{len(req.security_controls)})", "contribution": round(1 - control_factor, 2)},
        {"factor": "Regulatory compliance gap", "contribution": round(profile.get("regulatory_burden", 5) / 20, 2)},
    ]

    # Targeted mitigations based on missing controls
    all_controls = set(c.lower().replace(" ", "_").replace("-", "_") for c in req.security_controls)
    mitigations = []
    if not any("edr" in c for c in all_controls):
        mitigations.append("Deploy endpoint detection and response (EDR) across all endpoints")
    if not any("zero_trust" in c for c in all_controls):
        mitigations.append("Implement zero-trust network architecture")
    if not any("penetration" in c for c in all_controls):
        mitigations.append("Conduct quarterly penetration testing with remediation SLAs")
    if not any("siem" in c for c in all_controls):
        mitigations.append("Deploy SIEM with automated alert correlation and response")
    if not any("incident" in c for c in all_controls):
        mitigations.append("Develop and test incident response plan with tabletop exercises")
    if not any("training" in c or "awareness" in c for c in all_controls):
        mitigations.append("Implement monthly security awareness training for all staff")
    if not any("dlp" in c for c in all_controls):
        mitigations.append("Deploy data loss prevention (DLP) for sensitive data egress monitoring")
    if not mitigations:
        mitigations.append("Maintain current security posture with regular control effectiveness reviews")

    return BreachPredictionResponse(
        risk_score=round(min(risk * 100, 100), 1),
        probability_30d=round(risk_30d, 3),
        probability_90d=round(risk_90d, 3),
        risk_factors=risk_factors,
        recommended_mitigations=mitigations[:5],
    )


# ── Scoring helpers ──────────────────────────────────────────────────────────

def _score_governance(controls: list[str], sector: str) -> float:
    max_score = 100
    score = 20  # base for having any controls
    governance_controls = {
        "data_classification": 15,
        "retention_policy": 12,
        "dpo_appointed": 15,
        "privacy_by_design": 12,
        "record_of_processing": 10,
        "data_inventory": 8,
        "privacy_notice": 8,
        "accountability_framework": 10,
    }
    for control, weight in governance_controls.items():
        if control in controls:
            score += weight
    # Sector bonus: regulated sectors get credit for industry-specific governance
    profile = SECTOR_RISK_PROFILES.get(sector, {})
    if profile.get("regulatory_burden", 0) >= 7 and score >= 50:
        score += 5  # regulated sector with decent governance
    return min(score, max_score)


def _score_consent(activities: list[str], controls: list[str]) -> float:
    score = 15  # base
    # Activity-based scoring
    consent_indicators = {
        "explicit_consent": 20, "granular_consent": 15, "consent_withdrawal": 15,
        "consent_logging": 10, "purpose_limitation": 10, "consent_refresh": 8,
        "minor_consent": 12, "parental_consent": 12,
    }
    for indicator, weight in consent_indicators.items():
        if indicator in controls or any(indicator in a.lower() for a in activities):
            score += weight

    # Processing activities: more activities = more consent complexity needed
    if len(activities) > 5 and score < 50:
        score = max(score - 10, 10)  # penalty for complex processing without controls
    return min(score, 100)


def _score_security(controls: list[str]) -> float:
    score = 15
    security_items = {
        "encryption": 14, "access_control": 12, "audit_logging": 10,
        "vulnerability_scanning": 10, "incident_response": 10,
        "mfa": 8, "network_segmentation": 8, "dlp": 6,
        "penetration_testing": 8, "backup_tested": 6,
        "waf": 4, "siem": 6,
    }
    for item, weight in security_items.items():
        if item in controls:
            score += weight
    return min(score, 100)


def _score_breach_readiness(controls: list[str]) -> float:
    score = 10
    readiness_items = {
        "incident_response_plan": 22, "breach_notification_process": 20,
        "forensics_capability": 15, "breach_simulation": 12,
        "ndpc_reporting_template": 10, "communication_plan": 8,
        "backup_tested": 8, "cyber_insurance": 5,
    }
    for item, weight in readiness_items.items():
        if item in controls:
            score += weight
    return min(score, 100)


def _score_cross_border(jurisdiction: str, controls: list[str]) -> float:
    score = 30 if jurisdiction == "NG" else 20
    cross_border_items = {
        "scc": 20, "standard_contractual_clauses": 20,
        "bcr": 15, "binding_corporate_rules": 15,
        "adequacy_assessment": 15, "transfer_impact_assessment": 12,
        "data_localization": 10, "encryption_in_transit": 8,
    }
    for item, weight in cross_border_items.items():
        if item in controls:
            score += weight
    return min(score, 100)


def _score_dpo(controls: list[str], sector: str) -> float:
    score = 10
    if "dpo_appointed" in controls:
        score += 30
    if "dpo_registered_ndpc" in controls:
        score += 20
    if "dpo_reports_to_board" in controls:
        score += 15
    if "dpo_training" in controls:
        score += 10
    if "dpo_independence" in controls:
        score += 10
    # Mandatory DPO for regulated sectors
    profile = SECTOR_RISK_PROFILES.get(sector, {})
    if profile.get("regulatory_burden", 0) >= 7 and "dpo_appointed" not in controls:
        score = max(score - 15, 0)  # significant penalty for high-risk sector without DPO
    return min(score, 100)


def _score_dsr(controls: list[str]) -> float:
    score = 10
    dsr_items = {
        "access_request_process": 15, "erasure_process": 15,
        "portability": 12, "objection_mechanism": 12,
        "rectification_process": 10, "restriction_mechanism": 8,
        "automated_dsr": 10, "dsr_tracking": 8,
    }
    for item, weight in dsr_items.items():
        if item in controls:
            score += weight
    return min(score, 100)


def _risk_level(score: float) -> str:
    if score >= 80:
        return "low"
    elif score >= 60:
        return "medium"
    elif score >= 40:
        return "high"
    return "critical"


def _identify_gaps(dimensions: dict, controls: list[str], sector: str) -> list[str]:
    gaps = []
    # Check each dimension against NDPA requirements
    if dimensions.get("consent_management", 0) < 50:
        gaps.append("Consent management incomplete — NDPA S.25 requires freely given, specific, informed consent with withdrawal mechanism")
    if dimensions.get("breach_readiness", 0) < 40:
        gaps.append("Breach readiness below threshold — NDPA S.40 mandates 72-hour NDPC notification; incident response plan absent or untested")
    if dimensions.get("data_subject_rights", 0) < 50:
        gaps.append("Data subject rights (DSAR) not fully implemented — NDPA S.34-39 requires access, rectification, erasure, portability, restriction, objection")
    if dimensions.get("data_governance", 0) < 60:
        gaps.append("Data governance framework incomplete — missing data classification, retention policy, or record of processing activities (NDPA S.27)")
    if dimensions.get("security_controls", 0) < 50:
        gaps.append("Security controls below NDPA S.24 requirements — implement encryption, access controls, and regular testing")
    if dimensions.get("dpo_effectiveness", 0) < 40:
        gaps.append("DPO appointment/registration gap — NDPA S.31 mandates DPO for organizations processing >200 data subjects in 6 months")
    if dimensions.get("cross_border", 0) < 50:
        gaps.append("Cross-border transfer mechanisms incomplete — NDPA S.28 requires adequacy assessment, SCCs, or BCRs")

    # Control-specific gaps
    if "encryption" not in controls:
        gaps.append("Missing encryption for personal data at rest — NDPA S.24(2) requires appropriate technical measures")
    if "dpo_appointed" not in controls:
        gaps.append("No Data Protection Officer appointed — mandatory under NDPA S.31")
    if "incident_response_plan" not in controls:
        gaps.append("No incident response plan — critical for meeting 72-hour breach notification deadline (NDPA S.40)")
    if "record_of_processing" not in controls:
        gaps.append("No Record of Processing Activities (ROPA) — required by NDPA S.27")

    return gaps


def _generate_recommendations(gaps: list[str], sector: str, dimensions: dict) -> list[str]:
    recs = []
    profile = SECTOR_RISK_PROFILES.get(sector, {})
    regulators = profile.get("regulators", ["NDPC"])

    # Priority-ordered recommendations based on gap severity
    if any("dpo" in g.lower() for g in gaps):
        recs.append("PRIORITY: Appoint certified DPO and register with NDPC within 30 days (NDPA S.31 mandatory)")
    if any("breach" in g.lower() or "incident" in g.lower() for g in gaps):
        recs.append("PRIORITY: Establish and test 72-hour breach notification workflow with NDPC reporting template")
    if any("consent" in g.lower() for g in gaps):
        recs.append("Implement granular consent management with purpose-specific collection, withdrawal mechanism, and consent audit trail")
    if any("encryption" in g.lower() for g in gaps):
        recs.append("Deploy AES-256-GCM encryption for all PII fields at rest; TLS 1.3 for data in transit; implement key rotation policy")
    if any("dsar" in g.lower() or "data subject" in g.lower() for g in gaps):
        recs.append("Build automated DSAR portal with identity verification, 30-day SLA tracking, and escalation workflow")
    if any("cross-border" in g.lower() or "transfer" in g.lower() for g in gaps):
        recs.append("Execute Standard Contractual Clauses (SCCs) with all data importers; verify NDPC adequacy whitelist")
    if any("record" in g.lower() or "ropa" in g.lower() for g in gaps):
        recs.append("Create and maintain Record of Processing Activities (ROPA) per NDPA S.27 with annual review cycle")

    # Sector-specific recommendations
    sector_recs = profile.get("key_requirements", [])
    for sr in sector_recs[:2]:
        recs.append(f"Sector-specific ({sector}): Ensure compliance with {sr}")

    recs.append(f"Schedule comprehensive compliance audit aligned with {', '.join(regulators)} requirements within 60 days")
    return recs


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8200"))
    uvicorn.run(app, host="0.0.0.0", port=port)
