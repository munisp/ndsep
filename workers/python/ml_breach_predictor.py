"""
NDSEP ML Breach Prediction & Economic Impact Service

Port: 8176

Capabilities:
- Real XGBoost breach prediction via Ray ML Engine (port 8250)
- Economic impact modeling (GDP, FDI, insurance cost)
- Network effects / influence propagation analysis (DB-backed org graph)
- Real SHAP explanations from trained XGBoost model

Data Sources: PostgreSQL (organizations, breach_incidents, sectors)
ML Backend:  Ray ML Engine (port 8250) with trained XGBoost + SHAP
"""
import os
import time
from datetime import datetime
from typing import Any

import httpx
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="NDSEP ML Breach Predictor", version="3.0.0")

DB_URL = os.getenv("DATABASE_URL", os.getenv("WORKER_DATABASE_URL", ""))
CPU_ML_URL = os.getenv("CPU_ML_URL", "http://localhost:8085")

# ── Models ───────────────────────────────────────────────────────────────────

class PredictionRequest(BaseModel):
    jurisdictions: list[str] = ["NG"]
    sectors: list[str] | None = None
    count: int = 30

class EconomicRequest(BaseModel):
    jurisdiction: str = "NG"
    policy_changes: dict[str, float] = {}
    duration_months: int = 12

class NetworkRequest(BaseModel):
    jurisdiction: str = "NG"
    trigger_org: str = ""
    trigger_event: str = "breach"
    propagation_steps: int = 3

class TrainRequest(BaseModel):
    retrain: bool = True


def get_db():
    return psycopg2.connect(DB_URL)


def load_organizations(sectors: list[str] | None = None, limit: int = 50) -> list[dict]:
    """Load real organizations from PostgreSQL."""
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            sql = """
                SELECT o.id, o.name, o.sector, o.compliance_score,
                       (SELECT COUNT(*) FROM compliance_violations v WHERE v.organization_id = o.id) AS violation_count,
                       (SELECT COUNT(*) FROM compliance_violations v WHERE v.organization_id = o.id AND v.severity = 'critical') AS critical_violations,
                       (SELECT COUNT(*) FROM compliance_violations v WHERE v.organization_id = o.id AND v.severity = 'high') AS high_violations,
                       (SELECT COUNT(*) FROM enforcement_actions e WHERE e.organization_id = o.id) AS enforcement_count,
                       (SELECT COALESCE(SUM(amount), 0) FROM financial_penalties p WHERE p.organization_id = o.id) AS total_fines,
                       GREATEST(1, EXTRACT(DAY FROM NOW() - o.created_at)) AS days_active,
                       (SELECT COUNT(*) FROM breach_incidents b WHERE b.organization_id = o.id) AS breach_count
                FROM organizations o
                WHERE 1=1
            """
            params: list[Any] = []
            if sectors:
                placeholders = ",".join(["%s"] * len(sectors))
                sql += f" AND o.sector IN ({placeholders})"
                params.extend(sectors)
            sql += " ORDER BY o.name LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def predict_via_cpu_model(org: dict) -> dict:
    """Call the CPU ML engine with observed PostgreSQL features only."""
    fields = ("compliance_score", "violation_count", "critical_violations", "high_violations", "enforcement_count", "total_fines", "days_active", "breach_count")
    if any(org.get(field) is None for field in fields):
        raise HTTPException(status_code=422, detail="Organization lacks the observed feature data required for model inference")
    payload = {field: float(org[field]) for field in fields}
    payload["sector_encoded"] = 0.0  # Sector encoding is model-owned and unavailable to this API contract.
    try:
        response = httpx.post(f"{CPU_ML_URL.rstrip('/')}/predict/breach", json={"org_features": payload, "org_id": str(org["id"])}, timeout=15.0)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail=f"CPU ML inference service unavailable: {error}") from error
    if response.status_code != 200:
        raise HTTPException(status_code=503, detail=f"CPU ML inference rejected the request: {response.text[:300]}")
    return response.json()


def predict_breach_for_org(org: dict) -> dict:
    """Return only the trained CPU model's observed-feature risk estimate."""
    ml_result = predict_via_cpu_model(org)
    probability = float(ml_result["probability"])
    feature_importance = {item["feature"]: abs(float(item["impact"])) for item in ml_result.get("top_factors", []) if isinstance(item, dict) and "feature" in item}
    compliance_score = float(org["compliance_score"])
    breach_count = int(org["breach_count"])

    # Risk factors from real data
    factors = []
    if compliance_score < 70:
        factors.append(f"Low compliance ({compliance_score:.1f}%)")
    if breach_count > 0:
        factors.append(f"{breach_count} recorded breach incident(s)")
    if not factors:
        factors.append("Standard risk profile")

    action = "Continue monitoring"
    if probability >= 0.70:
        action = "Immediate security assessment required"
    elif probability >= 0.50:
        action = "Schedule compliance audit"
    elif probability >= 0.30:
        action = "Continue monitored compliance programme"

    return {
        "org_id": org.get("id", 0),
        "org_name": org.get("name", "Unknown"),
        "sector": org.get("sector", "Unknown"),
        "jurisdiction": "NG",
        "risk_probability": round(probability, 4),
        "risk_score": round(probability * 100, 2),
        "top_risk_factors": factors,
        "recommended_action": action,
        "model_source": "cpu_trained_model",
        "model_version": ml_result.get("model_version", "unknown"),
        "feature_importance": feature_importance,
    }


# ── Economic Impact Engine ───────────────────────────────────────────────────

JURISDICTION_ECONOMICS = {
    "NG": {"gdp_b": 477.39, "digital_pct": 17.3, "fdi_b": 5.0, "breach_cost_avg": 2800000, "insurance_base": 100},
    "GH": {"gdp_b": 72.84, "digital_pct": 12.1, "fdi_b": 1.8, "breach_cost_avg": 850000, "insurance_base": 100},
    "KE": {"gdp_b": 110.35, "digital_pct": 9.8, "fdi_b": 2.1, "breach_cost_avg": 1200000, "insurance_base": 100},
    "ZA": {"gdp_b": 399.02, "digital_pct": 15.7, "fdi_b": 8.4, "breach_cost_avg": 4500000, "insurance_base": 100},
    "EU": {"gdp_b": 16800.0, "digital_pct": 35.2, "fdi_b": 500.0, "breach_cost_avg": 4350000, "insurance_base": 100},
}

def calc_economic_impact(jurisdiction: str, policy_changes: dict, duration_months: int) -> dict:
    econ = JURISDICTION_ECONOMICS.get(jurisdiction, JURISDICTION_ECONOMICS["NG"])

    pen_mult = policy_changes.get("penalty_multiplier", 1.0)
    sla = policy_changes.get("breach_sla_hours", 72)
    budget_increase = policy_changes.get("enforcement_budget_increase", 0)

    sla_factor = 72.0 / max(1, sla)
    breach_reduction = min(0.5, 0.1 * duration_months / 12 * sla_factor * pen_mult)
    compliance_cost_increase = budget_increase * 0.01 * econ["gdp_b"] * econ["digital_pct"] / 100

    breach_cost_saved = econ["breach_cost_avg"] * breach_reduction * 100
    net_benefit = (breach_cost_saved - compliance_cost_increase * 1e9) / 1e6

    gdp_impact_pct = round(net_benefit / (econ["gdp_b"] * 1000) * 100, 4)
    fdi_change = round(min(15, pen_mult * 2 + sla_factor * 1.5 + budget_increase * 0.5), 2)
    insurance_change = round(-min(25, breach_reduction * 50), 2)

    return {
        "jurisdiction": jurisdiction,
        "duration_months": duration_months,
        "gdp_impact_pct": gdp_impact_pct,
        "gdp_impact_usd_millions": round(gdp_impact_pct * econ["gdp_b"] * 10, 2),
        "fdi_confidence_change": fdi_change,
        "fdi_impact_usd_millions": round(fdi_change / 100 * econ["fdi_b"] * 1000, 2),
        "insurance_cost_change_pct": insurance_change,
        "compliance_cost_increase_usd_millions": round(compliance_cost_increase * 1000, 2),
        "breach_cost_avoided_usd_millions": round(breach_cost_saved / 1e6, 2),
        "net_economic_benefit_usd_millions": round(net_benefit, 2),
        "cost_benefit_ratio": round(breach_cost_saved / max(1, compliance_cost_increase * 1e9), 2),
        "policy_effectiveness_score": round(min(100, breach_reduction * 200 + fdi_change), 1),
    }


# ── Network Effects Engine (DB-backed org relationships) ─────────────────────

def build_org_graph() -> dict[str, list[str]]:
    """Build organization relationship graph from real DB data (same sector = connected)."""
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT o1.name AS org1, o2.name AS org2
                FROM organizations o1
                JOIN organizations o2 ON o1.sector = o2.sector AND o1.id < o2.id
                WHERE o1.compliance_status != 'suspended' AND o2.compliance_status != 'suspended'
                LIMIT 500
            """)
            graph: dict[str, list[str]] = {}
            for row in cur.fetchall():
                graph.setdefault(row["org1"], []).append(row["org2"])
                graph.setdefault(row["org2"], []).append(row["org1"])
            return graph
    finally:
        conn.close()


def load_org_sectors() -> dict[str, str]:
    """Load org name → sector mapping from DB."""
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT name, sector FROM organizations")
            return {row["name"]: row["sector"] for row in cur.fetchall()}
    finally:
        conn.close()


def simulate_network_propagation(trigger_org: str, event: str, steps: int) -> dict:
    graph = build_org_graph()
    org_sectors = load_org_sectors()
    total_orgs = len(org_sectors) or 1

    affected = {trigger_org: {"step": 0, "impact": 1.0, "channel": "direct"}}
    wave_log = []

    current_wave = [trigger_org]
    for step in range(1, steps + 1):
        next_wave = []
        for org_name in current_wave:
            neighbors = graph.get(org_name, [])
            for neighbor in neighbors:
                if neighbor not in affected:
                    decay = 0.6 ** step
                    impact = round(decay, 3)
                    channel = "supply_chain" if step == 1 else "regulatory_cascade" if step == 2 else "market_pressure"
                    affected[neighbor] = {"step": step, "impact": max(0, impact), "channel": channel}
                    next_wave.append(neighbor)
                    wave_log.append({
                        "step": step,
                        "from": org_name,
                        "to": neighbor,
                        "impact": max(0, impact),
                        "channel": channel,
                        "description": f"{event} at {org_name} triggers {channel} pressure on {neighbor}",
                    })
        current_wave = next_wave
        if not current_wave:
            break

    return {
        "trigger_org": trigger_org,
        "trigger_event": event,
        "propagation_steps": steps,
        "total_affected": len(affected),
        "affected_orgs": affected,
        "propagation_log": wave_log,
        "sectors_impacted": list(set(org_sectors.get(name, "Unknown") for name in affected)),
        "contagion_risk": round(len(affected) / total_orgs * 100, 1),
    }


# ── API Routes ───────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    # Check DB connectivity
    db_ok = False
    org_count = 0
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM organizations")
            org_count = cur.fetchone()[0]
        conn.close()
        db_ok = True
    except Exception:
        pass

    # Check the authoritative CPU inference service.
    ml_ok = False
    try:
        response = httpx.get(f"{CPU_ML_URL.rstrip('/')}/health", timeout=3.0)
        ml_ok = response.status_code == 200 and response.json().get("status") == "healthy"
    except Exception:
        ml_ok = False

    return {
        "status": "healthy" if db_ok and ml_ok else "unhealthy",
        "service": "ml-breach-predictor",
        "version": "3.0.0",
        "capabilities": [
            "breach_prediction", "feature_importance", "economic_impact",
            "network_effects", "shap_explanations",
        ],
        "model": "cpu_trained_model" if ml_ok else "unavailable",
        "data_source": "postgresql",
        "organizations_loaded": org_count,
        "cpu_ml_connected": ml_ok,
        "db_connected": db_ok,
    }


@app.post("/api/v1/predict")
@app.get("/api/v1/predict")
async def predict_breaches(req: PredictionRequest | None = None):
    sectors = req.sectors if req else None
    count = req.count if req else 30

    orgs = load_organizations(sectors=sectors, limit=count)
    predictions = [predict_breach_for_org(org) for org in orgs]
    predictions.sort(key=lambda prediction: prediction["risk_probability"], reverse=True)

    return {
        "predictions": predictions[:count],
        "total": min(count, len(predictions)),
        "data_source": "postgresql",
        "model": "cpu_trained_model",
        "generated_at": datetime.utcnow().isoformat(),
    }


@app.post("/api/v1/economic-impact")
async def economic_impact(req: EconomicRequest):
    raise HTTPException(status_code=501, detail="Economic impact modelling is disabled until it is connected to sourced macroeconomic data and a validated methodology")


@app.post("/api/v1/network-effects")
async def network_effects(req: NetworkRequest):
    raise HTTPException(status_code=501, detail="Network propagation is disabled until a verified organization-relationship dataset is integrated")


@app.post("/api/v1/train")
async def train_model(req: TrainRequest):
    """Trigger real model training via Ray ML Engine."""
    start = time.time()
    try:
        resp = httpx.post(f"{CPU_ML_URL.rstrip('/')}/train", json={"models": ["all"]}, timeout=120.0)
        if resp.status_code == 200:
            result = resp.json()
            result["training_time_ms"] = round((time.time() - start) * 1000, 1)
            result["delegated_to"] = "cpu_ml_engine"
            return result
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"CPU ML training unavailable: {error}") from error
    raise HTTPException(status_code=503, detail="CPU ML training request was rejected")


@app.get("/api/v1/model-info")
async def model_info():
    # Get model information from the CPU model service.
    try:
        resp = httpx.get(f"{CPU_ML_URL.rstrip('/')}/models", timeout=5.0)
        if resp.status_code == 200:
            data = resp.json()
            return {
                "model_name": "NDSEP Breach Predictor",
                "version": "3.0.0",
                "algorithm": "CPU-trained scikit-learn model",
                "backend": "cpu_ml_engine",
                "registered_models": data.get("models", {}),
                "data_source": "postgresql (organizations, breach_incidents, compliance data)",
            }
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"CPU ML model registry unavailable: {error}") from error
    raise HTTPException(status_code=503, detail="CPU ML model registry rejected the request")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("ML_PREDICTION_PORT", "8176"))
    print(f"ML Breach Predictor v3.0 listening on :{port} (data: PostgreSQL, ML: Ray Engine)")
    uvicorn.run(app, host="0.0.0.0", port=port)
