from fastapi import FastAPI
from pydantic import BaseModel
from datetime import datetime, timezone

app = FastAPI(title="Compliance Intelligence Service")


class PermitCaseInput(BaseModel):
    case_id: str
    sector: str
    stage: str
    obligations_due: int
    agency_count: int
    priority: str


@app.get("/health")
def health():
    return {
        "service": "python-compliance-api",
        "language": "python",
        "middleware": ["lakehouse", "redis"],
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/score")
def score_case(case: PermitCaseInput):
    priority_weight = {"routine": 0.2, "elevated": 0.5, "critical": 0.85}.get(case.priority, 0.3)
    stage_weight = {
        "intake": 0.15,
        "spatial_clearance": 0.25,
        "technical_review": 0.4,
        "environmental_review": 0.6,
        "agency_coordination": 0.75,
        "payment_pending": 0.55,
        "approval": 0.5,
        "issued": 0.25,
        "active_monitoring": 0.45,
    }.get(case.stage, 0.3)

    score = round(min(1.0, priority_weight + stage_weight + (case.obligations_due * 0.08) + (case.agency_count * 0.04)), 2)
    risk_band = "critical" if score >= 0.9 else "high" if score >= 0.7 else "moderate" if score >= 0.45 else "low"

    return {
        "caseId": case.case_id,
        "sector": case.sector,
        "complianceScore": score,
        "riskBand": risk_band,
        "recommendedAction": "Escalate cross-agency review" if risk_band in {"critical", "high"} else "Continue standard monitoring",
    }
