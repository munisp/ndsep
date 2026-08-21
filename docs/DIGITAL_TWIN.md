# Digital Twin — Nigeria's Data Ecosystem

## Overview

The NDSEP Digital Twin creates a virtual replica of Nigeria's entire data protection ecosystem — every sector, every data flow, every compliance score — so regulators can run "what-if" scenarios before implementing real policy changes.

**Service:** Go microservice on port 8175
**Source:** `workers/go/cmd/digital_twin/main.go` (365 lines)
**Client:** Platform Intelligence page → "Digital Twin" tab
**tRPC Routes:** `platformIntelligence.twinState`, `platformIntelligence.twinSimulate`, `platformIntelligence.twinPredictBreaches`

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    NDSEP Client                          │
│  Platform Intelligence → Digital Twin Tab                │
│  - Ecosystem state visualization                         │
│  - Simulation parameter controls                         │
│  - Breach prediction dashboard                           │
└──────────────────────┬──────────────────────────────────┘
                       │ tRPC
┌──────────────────────▼──────────────────────────────────┐
│                  NDSEP Server                            │
│  platformIntelligence router                             │
│  - twinState       → GET /api/v1/twin/state              │
│  - twinSimulate    → POST /api/v1/twin/simulate          │
│  - twinPredictBreaches → GET /api/v1/twin/predict-breaches│
│  - twinHistory     → GET /api/v1/twin/history            │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────────┐
│            Digital Twin Engine (Go :8175)                 │
│                                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  │
│  │ Sector Model │  │ Data Flow Map │  │  Simulation  │  │
│  │ 6 sectors    │  │ 8 major flows │  │    Engine     │  │
│  │ 198 orgs     │  │ Internal +    │  │ Monte Carlo  │  │
│  │ Risk factors │  │ Cross-border  │  │ Forecasting  │  │
│  └──────────────┘  └───────────────┘  └──────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │           Breach Prediction Engine                │    │
│  │  - Base rate from sector historical data          │    │
│  │  - Compliance score weighting                     │    │
│  │  - 30-day and 90-day probability windows          │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

## How It Works

### 1. Ecosystem State Model

The twin maintains a live model of Nigeria's data ecosystem:

| Sector | Organizations | Avg Compliance | Cross-Border Flows | Annual Breach Rate |
|--------|--------------|----------------|--------------------|--------------------|
| Banking | 45 | 78.5% | 890 | 12% |
| Telecom | 12 | 72.3% | 2,300 | 8% |
| Healthcare | 28 | 65.1% | 340 | 15% |
| Insurance | 35 | 70.8% | 280 | 9% |
| Energy | 18 | 68.9% | 120 | 6% |
| Education | 60 | 55.2% | 450 | 18% |

Plus 8 major data flow routes (Lagos↔Abuja, Lagos↔London, Kano↔Lagos, etc.) with volume, encryption status, and compliance flags.

### 2. Simulation Engine

Accepts three parameters:
- **`breach_sla_hours`** — Breach notification deadline (current NDPA: 72 hours)
- **`penalty_multiplier`** — Enforcement penalty scaling factor
- **`compliance_threshold`** — Minimum acceptable compliance score

The engine runs a month-by-month Monte Carlo simulation:

1. **Compliance trajectory**: Each sector improves at a rate proportional to `(100 - current_score) × 0.02 × penalty_multiplier` with Gaussian noise
2. **Breach forecasting**: Tighter SLAs reduce breach rates via `72 / sla_hours` pressure factor
3. **Penalty projection**: Penalties scale with breach count × sector average × multiplier
4. **Cross-border growth**: Data flows increase ~50/month (reflecting Nigeria's digital economy growth)

### 3. Breach Prediction

For each organization, the engine calculates:
- **30-day breach probability**: `base_rate/12 × (1 + compliance_gap/100) + noise`
- **90-day breach probability**: `base_rate/4 × (1 + compliance_gap/100) + noise×2`
- **Recommended action**: Based on probability thresholds (>10% = immediate assessment, >5% = schedule audit)

---

## Real-Life Scenarios

### Scenario 1: NDPC Tightens Breach Notification from 72 to 48 Hours

**Context:** The NDPC is considering reducing the breach notification window from 72 hours (NDPA Section 39) to 48 hours to align with EU GDPR-like standards.

**Simulation Request:**
```json
{
  "scenario": "tighter_breach_sla",
  "parameters": {
    "breach_sla_hours": 48,
    "penalty_multiplier": 1.5,
    "compliance_threshold": 75
  },
  "duration_months": 12
}
```

**What happens in the twin:**

1. The `slaFactor` becomes `72/48 = 1.5×` — organizations face 50% more pressure
2. Month-by-month simulation shows:
   - **Banking** (78.5% → ~85%): Already above threshold, breach rate drops 15%. Low risk.
   - **Education** (55.2% → ~62%): Still below 75% threshold after 12 months. Flagged as **critical**.
   - **Healthcare** (65.1% → ~72%): Borderline — the twin recommends mandatory security audits.
3. Penalty projection: 1.5× multiplier means N2.9M average Insurance penalty becomes N4.35M
4. The twin generates recommendations:
   - "URGENT: Education sector needs immediate intervention — compliance below threshold"
   - "Tighter breach SLA will require additional notification infrastructure investment"

**Decision:** NDPC can see that Education and Healthcare sectors aren't ready for 48-hour SLA. Phased rollout: Banking and Telecom first, Education given 18-month grace period.

---

### Scenario 2: Doubling Enforcement Penalties for Non-Compliance

**Context:** CBN is proposing that financial penalties for data protection violations should double to deter negligence, particularly after the Dangote S3 exposure incident (N150M).

**Simulation Request:**
```json
{
  "scenario": "doubled_penalties",
  "parameters": {
    "breach_sla_hours": 72,
    "penalty_multiplier": 2.0,
    "compliance_threshold": 70
  },
  "duration_months": 24
}
```

**What happens in the twin:**

1. Compliance improvement accelerates: `improvement = gap × 0.02 × 2.0` — organizations invest more in compliance when penalties are steeper
2. Over 24 months:
   - **Banking**: 78.5% → ~91% — Strong response, breach rate drops significantly
   - **Telecom**: 72.3% → ~85% — Meaningful improvement driven by penalty fear
   - **Energy**: 68.9% → ~82% — SCADA/IoT security investments increase
   - **Education**: 55.2% → ~70% — Still barely at threshold; limited budgets mean slower improvement
3. Total penalty revenue projection increases, but actual penalties collected may decrease as compliance improves — the twin models this crossover point
4. Sector impacts show risk levels: Education remains "high" even at month 24

**Decision:** Doubling penalties works for well-resourced sectors (Banking, Telecom, Energy) but creates an unfunded mandate for Education. NDPC could pair penalty increases with a compliance assistance fund for underfunded sectors.

---

### Scenario 3: Predicting the Next Major Breach

**Context:** After 5 breach incidents in the seeded data (unauthorized access, S3 exposure, API key exposure, SIM swap, insider threat), NDPC wants to predict which organizations are most likely to experience a breach in the next 30-90 days.

**Breach Prediction Request:**
```
GET /api/v1/twin/predict-breaches
```

**What the twin returns (sample predictions for 30 organizations):**

| Org | Sector | 30-Day Probability | 90-Day Probability | Recommended Action |
|-----|--------|-------------------:|-------------------:|-------------------|
| Org-Hea-2 | Healthcare | 3.12% | 8.45% | Immediate security assessment |
| Org-Edu-5 | Education | 4.28% | 11.8% | Immediate security assessment |
| Org-Ban-0 | Banking | 1.05% | 3.52% | Schedule compliance audit |
| Org-Tel-3 | Telecom | 0.82% | 2.89% | Continue monitoring |
| Org-Ene-4 | Energy | 0.65% | 2.10% | Continue monitoring |

**How probabilities are calculated:**

For Healthcare (65.1% compliance, 15% annual breach rate):
- `base_30d = 0.15 / 12 = 0.0125` (1.25% base monthly probability)
- `compliance_factor = (100 - 65.1) / 100 = 0.349` (34.9% compliance gap)
- `probability_30d = 0.0125 × (1 + 0.349) + noise ≈ 1.69% + noise`

Healthcare and Education have the highest probabilities because:
- Healthcare: Highest sector breach rate (15%) + legacy systems + interoperability gaps
- Education: Lowest compliance score (55.2%) + highest breach rate (18%) + low security budgets

**Decision:** NDPC issues targeted compliance notices to Healthcare and Education organizations, requiring security assessments within 30 days for those above the 3% threshold.

---

## API Reference

### GET /api/v1/twin/state
Returns the current ecosystem model — all sectors, data flows, aggregate statistics.

### POST /api/v1/twin/simulate
Run a what-if simulation. Body:
```json
{
  "scenario": "string — descriptive name",
  "parameters": {
    "breach_sla_hours": 72,
    "penalty_multiplier": 1.0,
    "compliance_threshold": 70.0
  },
  "duration_months": 12
}
```

### GET /api/v1/twin/predict-breaches
Returns breach probability predictions for 30 organizations across all sectors.

### GET /api/v1/twin/history
Returns all previously run simulations.

## Integration with NDSEP Platform

The digital twin is integrated at three levels:

1. **Data Source:** Sector models are initialized from the same compliance scores, breach incidents, and enforcement data stored in the NDSEP PostgreSQL database (154 tables)
2. **NOC Integration:** The NOC AI Agent's Reasoning Engine can trigger digital twin simulations when it detects patterns that match historical breach scenarios
3. **Feature Flags:** The `digital_twin_simulation` feature flag controls access (currently enabled at 100% rollout for admin and auditor roles)
