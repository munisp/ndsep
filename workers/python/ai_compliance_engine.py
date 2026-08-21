"""
NDSEP AI-Native Compliance Engine — LLM-powered regulatory reasoning.

Provides:
- Natural language compliance queries against NDPA 2023
- Automated DPIA generation from data catalog metadata
- AI-assisted gap analysis
- Regulatory change impact analysis
- Compliance recommendation engine

Uses Ollama (Llama 3.1) for local inference with Nigerian data residency.
"""

import os
import json
import logging
import hashlib
import time
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import httpx

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ai-compliance-engine")

app = FastAPI(
    title="NDSEP AI Compliance Engine",
    version="1.0.0",
    description="LLM-powered regulatory reasoning for NDPA 2023 compliance",
)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
DB_URL = os.getenv("WORKER_DATABASE_URL", "")
MODEL = os.getenv("COMPLIANCE_MODEL", "qwen2.5:1.5b")

# ── NDPA 2023 Knowledge Base ────────────────────────────────────────────────

NDPA_SECTIONS = {
    "part1": {
        "title": "Preliminary Provisions",
        "articles": {
            "1": "Short title and commencement",
            "2": "Objectives of the Act",
            "3": "Scope of application",
            "4": "Interpretation",
        },
    },
    "part2": {
        "title": "Nigeria Data Protection Commission",
        "articles": {
            "5": "Establishment of the Commission",
            "6": "Functions of the Commission",
            "7": "Powers of the Commission",
            "8": "Governing Council composition",
        },
    },
    "part3": {
        "title": "Principles of Data Processing",
        "articles": {
            "24": "Lawfulness of processing",
            "25": "Lawful basis for processing",
            "26": "Consent requirements",
            "27": "Processing of sensitive personal data",
            "28": "Rights of data subjects",
            "29": "Right of access",
            "30": "Right to rectification",
            "31": "Right to erasure",
            "32": "Right to data portability",
            "33": "Right to object",
            "34": "Automated individual decision-making",
        },
    },
    "part4": {
        "title": "Transfer of Personal Data",
        "articles": {
            "40": "Cross-border transfer requirements",
            "41": "Adequacy determination",
            "42": "Appropriate safeguards",
            "43": "Binding corporate rules",
            "44": "Derogations for specific situations",
        },
    },
    "part5": {
        "title": "Data Protection Officer",
        "articles": {
            "45": "Designation of DPO",
            "46": "Position of DPO",
            "47": "Tasks of DPO",
        },
    },
    "part6": {
        "title": "Data Breach Notification",
        "articles": {
            "48": "Notification to the Commission (72 hours)",
            "49": "Notification to data subjects",
            "50": "Record of breaches",
        },
    },
    "part7": {
        "title": "Enforcement and Remedies",
        "articles": {
            "51": "Administrative fines",
            "52": "Maximum penalties (2% turnover or ₦10M)",
            "53": "Compliance notices",
            "54": "Enforcement notices",
        },
    },
    "part8": {
        "title": "Data Protection Impact Assessment",
        "articles": {
            "55": "DPIA requirements",
            "56": "Prior consultation",
        },
    },
}


def get_ndpa_context() -> str:
    """Build NDPA reference text for LLM context."""
    lines = ["# Nigeria Data Protection Act 2023 (NDPA)\n"]
    for part_key, part in NDPA_SECTIONS.items():
        lines.append(f"\n## {part['title']}")
        for art_num, art_title in part["articles"].items():
            lines.append(f"- Article {art_num}: {art_title}")
    return "\n".join(lines)


NDPA_CONTEXT = get_ndpa_context()

# ── Ollama Client ───────────────────────────────────────────────────────────


async def llm_generate(prompt: str, system: str = "", temperature: float = 0.3) -> str:
    """Call Ollama for LLM inference."""
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "system": system or "You are an expert on the Nigeria Data Protection Act 2023 (NDPA). Answer accurately based on the Act.",
        "stream": False,
        "options": {"temperature": temperature, "num_predict": 2048},
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{OLLAMA_URL}/api/generate", json=payload)
            response = resp.json().get("response")
            if not isinstance(response, str) or not response.strip():
                raise RuntimeError("Ollama returned no usable inference output")
            return response
    except Exception as e:
        log.error(f"Ollama inference unavailable: {e}")
        raise RuntimeError("AI compliance inference is unavailable") from e


# ── API Endpoints ───────────────────────────────────────────────────────────


class ComplianceQuery(BaseModel):
    question: str
    org_context: dict[str, Any] | None = None


class DPIARequest(BaseModel):
    org_name: str
    processing_activity: str
    data_categories: list[str]
    data_subjects: list[str]
    purpose: str
    legal_basis: str
    cross_border: bool = False
    automated_decision: bool = False


class GapAnalysisRequest(BaseModel):
    org_name: str
    sector: str
    current_policies: list[str]
    data_categories: list[str]
    has_dpo: bool = False
    has_breach_plan: bool = False
    has_consent_mechanism: bool = False
    has_dpia: bool = False
    cross_border_transfers: bool = False


class ImpactAnalysisRequest(BaseModel):
    regulatory_change: str
    affected_articles: list[str]
    org_sectors: list[str] | None = None


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "ai-compliance-engine", "model": MODEL}


@app.post("/api/v1/compliance/query")
async def compliance_query(req: ComplianceQuery):
    """Natural language compliance query against NDPA 2023."""
    system = f"""You are an expert compliance advisor for the Nigeria Data Protection Act 2023.
Answer questions accurately and cite specific articles.

{NDPA_CONTEXT}

If org context is provided, tailor your response to that organization's situation."""

    prompt = req.question
    if req.org_context:
        prompt += f"\n\nOrganization context: {json.dumps(req.org_context)}"

    response = await llm_generate(prompt, system)

    return {
        "query": req.question,
        "response": response,
        "model": MODEL,
        "timestamp": datetime.utcnow().isoformat(),
        "confidence": 0.85 if "Article" in response else 0.65,
    }


@app.post("/api/v1/compliance/dpia/generate")
async def generate_dpia(req: DPIARequest):
    """Auto-generate a Data Protection Impact Assessment."""
    risk_factors = []
    risk_score = 0.0

    if req.cross_border:
        risk_factors.append({"factor": "Cross-border data transfer", "articles": ["40", "41", "42"], "risk": "high"})
        risk_score += 25.0
    if req.automated_decision:
        risk_factors.append({"factor": "Automated decision-making", "articles": ["34"], "risk": "high"})
        risk_score += 20.0
    if "health" in [c.lower() for c in req.data_categories] or "biometric" in [c.lower() for c in req.data_categories]:
        risk_factors.append({"factor": "Sensitive personal data processing", "articles": ["27"], "risk": "high"})
        risk_score += 20.0
    if "children" in [s.lower() for s in req.data_subjects]:
        risk_factors.append({"factor": "Processing of children's data", "articles": ["26"], "risk": "critical"})
        risk_score += 30.0
    if len(req.data_categories) > 5:
        risk_factors.append({"factor": "Large-scale data processing", "articles": ["55"], "risk": "medium"})
        risk_score += 10.0

    risk_score = min(risk_score + 20.0, 100.0)  # baseline risk
    risk_level = "critical" if risk_score >= 75 else "high" if risk_score >= 50 else "medium" if risk_score >= 25 else "low"

    # Generate detailed assessment via LLM
    system = f"You are generating a DPIA under NDPA Article 55. Be thorough and cite articles.\n\n{NDPA_CONTEXT}"
    prompt = f"""Generate a Data Protection Impact Assessment for:
Organization: {req.org_name}
Processing Activity: {req.processing_activity}
Data Categories: {', '.join(req.data_categories)}
Data Subjects: {', '.join(req.data_subjects)}
Purpose: {req.purpose}
Legal Basis: {req.legal_basis}
Cross-border: {req.cross_border}
Automated Decision-making: {req.automated_decision}

Include: necessity assessment, risk assessment, mitigation measures, and recommendations."""

    assessment = await llm_generate(prompt, system, temperature=0.2)

    mitigations = []
    for rf in risk_factors:
        if rf["risk"] == "critical":
            mitigations.append(f"MANDATORY: Prior consultation with NDPC required (Article 56) for {rf['factor']}")
        elif rf["risk"] == "high":
            mitigations.append(f"Implement additional safeguards for {rf['factor']} per Articles {', '.join(rf['articles'])}")
        else:
            mitigations.append(f"Document controls for {rf['factor']}")

    return {
        "dpia_id": hashlib.sha256(f"{req.org_name}:{req.processing_activity}:{time.time()}".encode()).hexdigest()[:16],
        "org_name": req.org_name,
        "processing_activity": req.processing_activity,
        "risk_score": round(risk_score, 1),
        "risk_level": risk_level,
        "risk_factors": risk_factors,
        "mitigations": mitigations,
        "assessment": assessment,
        "prior_consultation_required": risk_score >= 75,
        "articles_referenced": list({a for rf in risk_factors for a in rf["articles"]}),
        "generated_at": datetime.utcnow().isoformat(),
        "model": MODEL,
    }


@app.post("/api/v1/compliance/gap-analysis")
async def gap_analysis(req: GapAnalysisRequest):
    """AI-assisted compliance gap analysis."""
    gaps = []
    compliance_score = 100.0

    if not req.has_dpo:
        gaps.append({
            "gap": "No Data Protection Officer designated",
            "severity": "critical",
            "articles": ["45", "46", "47"],
            "recommendation": "Appoint a qualified DPO. Must have expert knowledge of data protection law and practices.",
            "deadline": "Immediate",
        })
        compliance_score -= 20.0

    if not req.has_breach_plan:
        gaps.append({
            "gap": "No breach notification plan",
            "severity": "critical",
            "articles": ["48", "49", "50"],
            "recommendation": "Establish a breach response plan with 72-hour notification capability to NDPC.",
            "deadline": "30 days",
        })
        compliance_score -= 15.0

    if not req.has_consent_mechanism:
        gaps.append({
            "gap": "No consent management mechanism",
            "severity": "high",
            "articles": ["25", "26"],
            "recommendation": "Implement consent collection, storage, and withdrawal mechanisms. Consent must be freely given, specific, informed, and unambiguous.",
            "deadline": "60 days",
        })
        compliance_score -= 15.0

    if not req.has_dpia and ("health" in [c.lower() for c in req.data_categories] or req.cross_border_transfers):
        gaps.append({
            "gap": "DPIA not conducted for high-risk processing",
            "severity": "high",
            "articles": ["55", "56"],
            "recommendation": "Conduct a Data Protection Impact Assessment before processing begins.",
            "deadline": "Before processing",
        })
        compliance_score -= 10.0

    if req.cross_border_transfers:
        gaps.append({
            "gap": "Cross-border transfer safeguards needed",
            "severity": "high",
            "articles": ["40", "41", "42", "43"],
            "recommendation": "Verify adequacy determination or implement appropriate safeguards (BCRs, SCCs).",
            "deadline": "Before transfer",
        })
        compliance_score -= 10.0

    # Sector-specific gaps
    sector_lower = req.sector.lower()
    if sector_lower in ("banking", "finance", "fintech"):
        gaps.append({
            "gap": "CBN data protection guidelines alignment needed",
            "severity": "medium",
            "articles": ["24", "27"],
            "recommendation": "Align with CBN Guidelines on Information Security and Consumer Protection.",
            "deadline": "90 days",
        })
        compliance_score -= 5.0
    elif sector_lower in ("telecom", "telecommunications"):
        gaps.append({
            "gap": "NCC consumer data protection requirements",
            "severity": "medium",
            "articles": ["24", "28"],
            "recommendation": "Comply with NCC Consumer Code of Practice for data handling.",
            "deadline": "90 days",
        })
        compliance_score -= 5.0
    elif sector_lower == "healthcare":
        gaps.append({
            "gap": "Health data requires enhanced protection",
            "severity": "high",
            "articles": ["27"],
            "recommendation": "Implement explicit consent for health data processing with enhanced security measures.",
            "deadline": "30 days",
        })
        compliance_score -= 10.0

    compliance_score = max(compliance_score, 0.0)

    # Get LLM-enhanced recommendations
    system = f"You are a compliance advisor for NDPA 2023.\n\n{NDPA_CONTEXT}"
    prompt = f"""Provide specific remediation steps for {req.org_name} ({req.sector} sector) with these compliance gaps:
{json.dumps([g['gap'] for g in gaps], indent=2)}

Current policies: {', '.join(req.current_policies) if req.current_policies else 'None documented'}
Data categories: {', '.join(req.data_categories)}"""

    recommendations = await llm_generate(prompt, system)

    return {
        "org_name": req.org_name,
        "sector": req.sector,
        "compliance_score": round(compliance_score, 1),
        "total_gaps": len(gaps),
        "critical_gaps": len([g for g in gaps if g["severity"] == "critical"]),
        "high_gaps": len([g for g in gaps if g["severity"] == "high"]),
        "gaps": gaps,
        "ai_recommendations": recommendations,
        "articles_affected": list({a for g in gaps for a in g["articles"]}),
        "analyzed_at": datetime.utcnow().isoformat(),
    }


@app.post("/api/v1/compliance/impact-analysis")
async def impact_analysis(req: ImpactAnalysisRequest):
    """Analyze impact of regulatory changes on organizations."""
    system = f"""You are analyzing the impact of regulatory changes on Nigerian organizations under NDPA 2023.
Provide specific, actionable guidance.

{NDPA_CONTEXT}"""

    prompt = f"""Analyze the impact of the following regulatory change:
Change: {req.regulatory_change}
Affected Articles: {', '.join(req.affected_articles)}
Target Sectors: {', '.join(req.org_sectors) if req.org_sectors else 'All sectors'}

Provide:
1. Summary of the change
2. Impact level (critical/high/medium/low) per sector
3. Required actions for affected organizations
4. Implementation timeline recommendation
5. Resources needed"""

    analysis = await llm_generate(prompt, system, temperature=0.2)

    sectors_impacted = req.org_sectors or ["banking", "telecom", "healthcare", "insurance", "energy", "education"]

    return {
        "regulatory_change": req.regulatory_change,
        "affected_articles": req.affected_articles,
        "sectors_impacted": sectors_impacted,
        "analysis": analysis,
        "analyzed_at": datetime.utcnow().isoformat(),
        "model": MODEL,
    }


@app.get("/api/v1/compliance/ndpa/sections")
async def ndpa_sections():
    """Return the full NDPA 2023 section index."""
    return {"sections": NDPA_SECTIONS, "total_articles": sum(len(p["articles"]) for p in NDPA_SECTIONS.values())}


@app.get("/api/v1/compliance/ndpa/article/{article_number}")
async def ndpa_article(article_number: str):
    """Get details for a specific NDPA article."""
    for part in NDPA_SECTIONS.values():
        if article_number in part["articles"]:
            return {
                "article": article_number,
                "title": part["articles"][article_number],
                "part": part["title"],
            }
    raise HTTPException(status_code=404, detail=f"Article {article_number} not found")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_COMPLIANCE_PORT", "8155"))
    uvicorn.run(app, host="0.0.0.0", port=port)
