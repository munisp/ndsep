// Package main implements the NDSEP Digital Twin V2 — production-grade
// multi-government policy simulation engine with real-time cause-and-effect
// analysis across Nigerian and international regulatory jurisdictions.
//
// Architecture:
//   Go service (port 8175) — API gateway + simulation orchestration + DB persistence
//   Rust Monte Carlo (port 8177) — high-perf stochastic simulations
//   Rust Agent-Based Model (port 8178) — per-org agent simulation
//   Rust System Dynamics (port 8179) — causal loop / stock-and-flow
//   Python ML Prediction (port 8176) — XGBoost breach prediction + economic modeling
//
// Middleware integration: PostgreSQL, Kafka, Redis, Dapr, Temporal, OpenSearch,
// Fluvio, TigerBeetle, Lakehouse, APISIX, OpenAppSec, Keycloak, Permify, Mojaloop
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

// ── Types ───────────────────────────────────────────────────────────────────

type Jurisdiction struct {
	ID                int     `json:"id"`
	Code              string  `json:"code"`
	Name              string  `json:"name"`
	Region            string  `json:"region"`
	DataProtectionAct string  `json:"data_protection_act"`
	Regulator         string  `json:"regulator"`
	AdequacyStatus    string  `json:"adequacy_status"`
	PopulationM       float64 `json:"population_millions"`
	GdpBillions       float64 `json:"gdp_usd_billions"`
	DigitalEconomyPct float64 `json:"digital_economy_pct"`
}

type SectorModel struct {
	ID             int      `json:"id"`
	JurisdictionID int      `json:"jurisdiction_id"`
	Jurisdiction   string   `json:"jurisdiction"`
	Sector         string   `json:"sector"`
	Organizations  int      `json:"organizations"`
	AvgCompliance  float64  `json:"avg_compliance"`
	BreachRate     float64  `json:"breach_rate"`
	AvgPenalty     float64  `json:"avg_penalty_local"`
	AvgBudgetUSD   float64  `json:"avg_budget_usd"`
	StaffCountAvg  int      `json:"staff_count_avg"`
	TechMaturity   float64  `json:"tech_maturity"`
	DataVolumeGB   float64  `json:"data_volume_gb"`
	CrossBorderPct float64  `json:"cross_border_pct"`
	RiskFactors    []string `json:"risk_factors"`
}

type Policy struct {
	ID             int                    `json:"id"`
	JurisdictionID int                    `json:"jurisdiction_id"`
	Jurisdiction   string                 `json:"jurisdiction"`
	Code           string                 `json:"code"`
	Name           string                 `json:"name"`
	Category       string                 `json:"category"`
	Status         string                 `json:"status"`
	EffectiveDate  string                 `json:"effective_date"`
	Rules          []map[string]interface{} `json:"rules"`
	Parameters     map[string]float64     `json:"parameters"`
}

type DataFlow struct {
	Source      string  `json:"source"`
	Destination string  `json:"destination"`
	Volume      float64 `json:"volume_gb_per_month"`
	Encrypted   bool    `json:"encrypted"`
	CrossBorder bool    `json:"cross_border"`
	Compliant   bool    `json:"compliant"`
	Sector      string  `json:"sector"`
}

type SimulationRequest struct {
	Scenario       string             `json:"scenario"`
	Parameters     map[string]float64 `json:"parameters"`
	Duration       int                `json:"duration_months"`
	Jurisdictions  []string           `json:"jurisdictions"`
	PolicyIDs      []int              `json:"policy_ids"`
	Type           string             `json:"type"`
	Iterations     int                `json:"iterations"`
	SandboxID      string             `json:"sandbox_id"`
	CounterfactualYear int            `json:"counterfactual_year"`
}

type SimulationResult struct {
	SimulationID      string                       `json:"simulation_id"`
	ScenarioID        string                       `json:"scenario_id"`
	Scenario          string                       `json:"scenario"`
	Type              string                       `json:"type"`
	Duration          int                          `json:"duration_months"`
	Jurisdictions     []string                     `json:"jurisdictions"`
	Timeline          []TimelinePoint              `json:"timeline"`
	JurisdictionResults map[string]JurisdictionResult `json:"jurisdiction_results"`
	SectorImpacts     map[string]SectorImpact      `json:"sector_impacts"`
	PolicyImpacts     []PolicyImpact               `json:"policy_impacts"`
	MonteCarloStats   *MonteCarloStats             `json:"monte_carlo_stats,omitempty"`
	EconomicImpact    *EconomicImpact              `json:"economic_impact,omitempty"`
	OverallCompliance float64                      `json:"overall_compliance_change"`
	PenaltyDelta      float64                      `json:"penalty_delta_ngn"`
	BreachDelta       float64                      `json:"breach_delta_percent"`
	Recommendations   []string                     `json:"recommendations"`
	RustEngines       *RustEngineResults           `json:"rust_engines,omitempty"`
	SimulatedAt       string                       `json:"simulated_at"`
	DurationMs        int64                        `json:"duration_ms"`
}

type RustEngineResults struct {
	MonteCarloUsed     bool             `json:"monte_carlo_used"`
	ABMUsed            bool             `json:"abm_used"`
	SystemDynamicsUsed bool             `json:"system_dynamics_used"`
	MonteCarloResult   *RustMCResponse  `json:"monte_carlo,omitempty"`
	ABMResult          *RustABMResponse `json:"abm,omitempty"`
	SDResult           *RustSDResponse  `json:"system_dynamics,omitempty"`
	Errors             []string         `json:"errors,omitempty"`
}

type JurisdictionResult struct {
	Code             string                  `json:"code"`
	Name             string                  `json:"name"`
	ComplianceDelta  float64                 `json:"compliance_delta"`
	BreachDelta      float64                 `json:"breach_delta_percent"`
	PenaltyDelta     float64                 `json:"penalty_delta_local"`
	GdpImpactPct     float64                 `json:"gdp_impact_pct"`
	SectorImpacts    map[string]SectorImpact `json:"sector_impacts"`
}

type TimelinePoint struct {
	Month            int     `json:"month"`
	AvgCompliance    float64 `json:"avg_compliance"`
	TotalPenalties   float64 `json:"total_penalties_ngn"`
	BreachCount      int     `json:"breach_count"`
	CrossBorderFlows int     `json:"cross_border_flows"`
	GdpImpactPct     float64 `json:"gdp_impact_pct"`
	FdiConfidence    float64 `json:"fdi_confidence"`
	InsuranceCostIdx float64 `json:"insurance_cost_idx"`
}

type SectorImpact struct {
	Sector          string  `json:"sector"`
	Jurisdiction    string  `json:"jurisdiction,omitempty"`
	ComplianceDelta float64 `json:"compliance_delta"`
	PenaltyDelta    float64 `json:"penalty_delta_ngn"`
	BreachDelta     float64 `json:"breach_delta_percent"`
	CostBenefitRatio float64 `json:"cost_benefit_ratio"`
	RiskLevel       string  `json:"risk_level"`
}

type PolicyImpact struct {
	PolicyCode       string  `json:"policy_code"`
	PolicyName       string  `json:"policy_name"`
	Jurisdiction     string  `json:"jurisdiction"`
	ComplianceDelta  float64 `json:"compliance_delta"`
	BreachDelta      float64 `json:"breach_delta_percent"`
	PenaltyDelta     float64 `json:"penalty_delta_local"`
	EffectivenessScore float64 `json:"effectiveness_score"`
	SensitivityRank  int     `json:"sensitivity_rank"`
}

type MonteCarloStats struct {
	Iterations int                          `json:"iterations"`
	Metrics    map[string]ConfidenceInterval `json:"metrics"`
}

type ConfidenceInterval struct {
	P5     float64 `json:"p5"`
	P25    float64 `json:"p25"`
	P50    float64 `json:"p50"`
	P75    float64 `json:"p75"`
	P95    float64 `json:"p95"`
	Mean   float64 `json:"mean"`
	StdDev float64 `json:"std_dev"`
}

type EconomicImpact struct {
	GdpImpactPct             float64 `json:"gdp_impact_pct"`
	FdiConfidenceChange      float64 `json:"fdi_confidence_change"`
	InsuranceCostChangeIdx   float64 `json:"insurance_cost_change_idx"`
	ComplianceCostMillions   float64 `json:"compliance_cost_millions_usd"`
	BreachCostAvoidedMillions float64 `json:"breach_cost_avoided_millions_usd"`
	NetEconomicBenefit       float64 `json:"net_economic_benefit_millions_usd"`
}

type BreachPrediction struct {
	OrgID            int      `json:"org_id"`
	OrgName          string   `json:"org_name"`
	Sector           string   `json:"sector"`
	Jurisdiction     string   `json:"jurisdiction"`
	Probability30d   float64  `json:"probability_30d"`
	Probability90d   float64  `json:"probability_90d"`
	TopRiskFactors   []string `json:"top_risk_factors"`
	RecommendedAction string  `json:"recommended_action"`
	ModelSource      string   `json:"model_source"`
}

type EcosystemState struct {
	Jurisdictions []Jurisdiction `json:"jurisdictions"`
	Sectors       []SectorModel  `json:"sectors"`
	DataFlows     []DataFlow     `json:"data_flows"`
	TotalOrgs     int            `json:"total_organizations"`
	AvgScore      float64        `json:"avg_compliance_score"`
	TotalFlows    int            `json:"total_data_flows"`
	CrossBorder   int            `json:"cross_border_flows"`
	Policies      []Policy       `json:"policies"`
	UpdatedAt     string         `json:"updated_at"`
}

type SandboxInfo struct {
	SandboxID      string    `json:"sandbox_id"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	PoliciesApplied []string `json:"policies_applied"`
	Status         string    `json:"status"`
	CreatedAt      string    `json:"created_at"`
}

type PolicyConflict struct {
	PolicyA     string `json:"policy_a"`
	PolicyB     string `json:"policy_b"`
	ConflictType string `json:"conflict_type"`
	Description string `json:"description"`
	Resolution  string `json:"resolution"`
}

// ── Digital Twin Engine ─────────────────────────────────────────────────────

type DigitalTwin struct {
	mu           sync.RWMutex
	db           *sql.DB
	dataFlows    []DataFlow
	history      []SimulationResult

	// Middleware endpoints
	kafkaURL     string
	redisURL     string
	temporalURL  string
	daprURL      string
	fluvioURL    string
	opensearchURL string
	tigerbeetleURL string
	lakehouseURL string
	monteCarloURL string
	agentModelURL string
	sysDynURL    string
	mlPredURL    string
}

func NewDigitalTwin(db *sql.DB) *DigitalTwin {
	return &DigitalTwin{
		db:           db,
		dataFlows:    generateDataFlows(),
		kafkaURL:     envOr("KAFKA_URL", "localhost:9092"),
		redisURL:     envOr("REDIS_URL", "localhost:6379"),
		temporalURL:  envOr("TEMPORAL_URL", "localhost:7233"),
		daprURL:      envOr("DAPR_URL", "http://localhost:3500"),
		fluvioURL:    envOr("FLUVIO_URL", "localhost:9003"),
		opensearchURL: envOr("OPENSEARCH_URL", "http://localhost:9200"),
		tigerbeetleURL: envOr("TIGERBEETLE_URL", "localhost:3000"),
		lakehouseURL: envOr("LAKEHOUSE_URL", "http://localhost:8150"),
		monteCarloURL: envOr("MONTE_CARLO_URL", "http://localhost:8177"),
		agentModelURL: envOr("AGENT_MODEL_URL", "http://localhost:8178"),
		sysDynURL:    envOr("SYSTEM_DYNAMICS_URL", "http://localhost:8179"),
		mlPredURL:    envOr("ML_PREDICTION_URL", "http://localhost:8176"),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Rust Engine Integration (Circuit Breaker + HTTP Client) ─────────────────

var rustHTTPClient = &http.Client{Timeout: 30 * time.Second}

type rustServiceStatus struct {
	available    bool
	lastChecked  time.Time
	failures     int
	circuitOpen  bool
}

var (
	rustServiceMu     sync.RWMutex
	rustServiceHealth = map[string]*rustServiceStatus{}
)

func isRustServiceAvailable(url string) bool {
	rustServiceMu.RLock()
	status, exists := rustServiceHealth[url]
	rustServiceMu.RUnlock()

	if exists && status.circuitOpen && time.Since(status.lastChecked) < 30*time.Second {
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", url+"/health", nil)
	resp, err := rustHTTPClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		rustServiceMu.Lock()
		if !exists {
			rustServiceHealth[url] = &rustServiceStatus{}
			status = rustServiceHealth[url]
		}
		status.failures++
		status.lastChecked = time.Now()
		if status.failures >= 3 {
			status.circuitOpen = true
		}
		status.available = false
		rustServiceMu.Unlock()
		return false
	}
	if resp.Body != nil {
		resp.Body.Close()
	}

	rustServiceMu.Lock()
	if !exists {
		rustServiceHealth[url] = &rustServiceStatus{}
		status = rustServiceHealth[url]
	}
	status.available = true
	status.failures = 0
	status.circuitOpen = false
	status.lastChecked = time.Now()
	rustServiceMu.Unlock()
	return true
}

// RustMCRequest maps Go sector data to the Rust Monte Carlo engine's expected input
type RustMCRequest struct {
	Sectors             []RustSectorInput `json:"sectors"`
	Iterations          int               `json:"iterations"`
	DurationMonths      int               `json:"duration_months"`
	BreachSLAHours      float64           `json:"breach_sla_hours"`
	PenaltyMultiplier   float64           `json:"penalty_multiplier"`
	ComplianceThreshold float64           `json:"compliance_threshold"`
}

type RustSectorInput struct {
	Sector         string  `json:"sector"`
	Jurisdiction   string  `json:"jurisdiction"`
	Organizations  int     `json:"organizations"`
	AvgCompliance  float64 `json:"avg_compliance"`
	BreachRate     float64 `json:"breach_rate"`
	AvgPenaltyLocal float64 `json:"avg_penalty_local"`
	AvgBudgetUSD   float64 `json:"avg_budget_usd"`
	StaffCountAvg  int     `json:"staff_count_avg"`
	TechMaturity   float64 `json:"tech_maturity"`
}

type RustMCResponse struct {
	Iterations    int                   `json:"iterations"`
	DurationMonths int                  `json:"duration_months"`
	Compliance    RustCI                `json:"compliance"`
	BreachDelta   RustCI                `json:"breach_delta"`
	PenaltyDelta  RustCI                `json:"penalty_delta"`
	GdpImpact     RustCI                `json:"gdp_impact"`
	PerSector     []RustSectorMCResult  `json:"per_sector"`
	Timeline      []RustTimelineCI      `json:"timeline"`
	DurationMs    int64                 `json:"duration_ms"`
}

type RustCI struct {
	P5     float64 `json:"p5"`
	P25    float64 `json:"p25"`
	P50    float64 `json:"p50"`
	P75    float64 `json:"p75"`
	P95    float64 `json:"p95"`
	Mean   float64 `json:"mean"`
	StdDev float64 `json:"std_dev"`
}

type RustSectorMCResult struct {
	Sector       string `json:"sector"`
	Jurisdiction string `json:"jurisdiction"`
	Compliance   RustCI `json:"compliance"`
	BreachDelta  RustCI `json:"breach_delta"`
	PenaltyDelta RustCI `json:"penalty_delta"`
}

type RustTimelineCI struct {
	Month       int    `json:"month"`
	Compliance  RustCI `json:"compliance"`
	BreachCount RustCI `json:"breach_count"`
	Penalties   RustCI `json:"penalties"`
}

// RustABMRequest maps Go data to the Rust Agent-Based Model engine
type RustABMRequest struct {
	Agents             []RustAgent `json:"agents"`
	DurationMonths     int         `json:"duration_months"`
	BreachSLAHours     float64     `json:"breach_sla_hours"`
	PenaltyMultiplier  float64     `json:"penalty_multiplier"`
	ComplianceThreshold float64    `json:"compliance_threshold"`
	PeerPressureWeight *float64    `json:"peer_pressure_weight,omitempty"`
	NetworkEffects     *bool       `json:"network_effects,omitempty"`
}

type RustAgent struct {
	ID              int     `json:"id"`
	Name            string  `json:"name"`
	Sector          string  `json:"sector"`
	Jurisdiction    string  `json:"jurisdiction"`
	ComplianceScore float64 `json:"compliance_score"`
	SecurityBudget  float64 `json:"security_budget"`
	InfosecStaff    int     `json:"infosec_staff"`
	TechMaturity    float64 `json:"tech_maturity"`
	RiskAppetite    float64 `json:"risk_appetite"`
	BreachHistory   int     `json:"breach_history"`
	DataVolumeGB    float64 `json:"data_volume_gb"`
	CrossBorder     bool    `json:"cross_border"`
}

type RustABMResponse struct {
	Agents       []json.RawMessage `json:"agents"`
	Aggregate    json.RawMessage   `json:"aggregate"`
	Interactions []json.RawMessage `json:"interactions"`
	DurationMs   int64             `json:"duration_ms"`
}

// RustSDRequest maps Go data to the Rust System Dynamics engine
type RustSDRequest struct {
	InitialStocks  RustStocks      `json:"initial_stocks"`
	DurationMonths int             `json:"duration_months"`
	PolicyParams   RustPolicyParams `json:"policy_params"`
	Jurisdiction   string          `json:"jurisdiction,omitempty"`
}

type RustStocks struct {
	ComplianceLevel      float64 `json:"compliance_level"`
	BreachRate           float64 `json:"breach_rate"`
	PenaltyPool          float64 `json:"penalty_pool"`
	ComplianceInvestment float64 `json:"compliance_investment"`
	PublicTrust          float64 `json:"public_trust"`
	RegulatoryCapacity   float64 `json:"regulatory_capacity"`
	DataEconomyGrowth    float64 `json:"data_economy_growth"`
	CrossBorderVolume    float64 `json:"cross_border_volume"`
	FdiConfidence        float64 `json:"fdi_confidence"`
	InsuranceCostIndex   float64 `json:"insurance_cost_index"`
}

type RustPolicyParams struct {
	BreachSLAHours           float64 `json:"breach_sla_hours"`
	PenaltyMultiplier        float64 `json:"penalty_multiplier"`
	EnforcementBudgetIncrease float64 `json:"enforcement_budget_increase"`
	AwarenessCampaign        bool    `json:"awareness_campaign"`
	MandatoryAudit           bool    `json:"mandatory_audit"`
	CrossBorderRestriction   float64 `json:"cross_border_restriction"`
}

type RustSDResponse struct {
	Jurisdiction string            `json:"jurisdiction"`
	Timeline     []json.RawMessage `json:"timeline"`
	CausalLoops  []json.RawMessage `json:"causal_loops"`
	Equilibrium  json.RawMessage   `json:"equilibrium"`
	Sensitivity  []json.RawMessage `json:"sensitivity"`
	DurationMs   int64             `json:"duration_ms"`
}

func sectorsToRustInputs(sectors []SectorModel) []RustSectorInput {
	out := make([]RustSectorInput, len(sectors))
	for i, s := range sectors {
		out[i] = RustSectorInput{
			Sector:         s.Sector,
			Jurisdiction:   s.Jurisdiction,
			Organizations:  s.Organizations,
			AvgCompliance:  s.AvgCompliance,
			BreachRate:     s.BreachRate,
			AvgPenaltyLocal: s.AvgPenalty,
			AvgBudgetUSD:   s.AvgBudgetUSD,
			StaffCountAvg:  s.StaffCountAvg,
			TechMaturity:   s.TechMaturity,
		}
	}
	return out
}

func sectorsToRustAgents(sectors []SectorModel) []RustAgent {
	agents := make([]RustAgent, 0, len(sectors)*3)
	id := 1
	for _, s := range sectors {
		count := 3
		if s.Organizations > 10 {
			count = 5
		}
		for j := 0; j < count; j++ {
			agents = append(agents, RustAgent{
				ID:              id,
				Name:            fmt.Sprintf("%s-Org-%d", s.Sector, id),
				Sector:          s.Sector,
				Jurisdiction:    s.Jurisdiction,
				ComplianceScore: s.AvgCompliance + float64(j)*0.5 - 1.0,
				SecurityBudget:  s.AvgBudgetUSD * (0.8 + float64(j)*0.1),
				InfosecStaff:    s.StaffCountAvg + j - 1,
				TechMaturity:    s.TechMaturity,
				RiskAppetite:    5.0 + float64(j)*0.5,
				BreachHistory:   int(s.BreachRate * float64(s.Organizations) * 0.1),
				DataVolumeGB:    s.DataVolumeGB,
				CrossBorder:     s.CrossBorderPct > 0.1,
			})
			id++
		}
	}
	return agents
}

func sectorsToRustStocks(sectors []SectorModel) RustStocks {
	if len(sectors) == 0 {
		return RustStocks{ComplianceLevel: 65, BreachRate: 0.15, PenaltyPool: 500000, ComplianceInvestment: 50000, PublicTrust: 60, RegulatoryCapacity: 45, DataEconomyGrowth: 3.5, CrossBorderVolume: 5000, FdiConfidence: 55, InsuranceCostIndex: 100}
	}
	totalOrgs := 0
	totalComp := 0.0
	totalBreach := 0.0
	totalBudget := 0.0
	totalVolume := 0.0
	for _, s := range sectors {
		totalOrgs += s.Organizations
		totalComp += s.AvgCompliance * float64(s.Organizations)
		totalBreach += s.BreachRate
		totalBudget += s.AvgBudgetUSD * float64(s.Organizations)
		totalVolume += s.DataVolumeGB
	}
	avgComp := totalComp / float64(totalOrgs)
	avgBreach := totalBreach / float64(len(sectors))
	return RustStocks{
		ComplianceLevel:      round2(avgComp),
		BreachRate:           round4f(avgBreach),
		PenaltyPool:          round2(avgBreach * 5000000),
		ComplianceInvestment: round2(totalBudget * 0.15),
		PublicTrust:          round2(avgComp * 0.85),
		RegulatoryCapacity:   45.0,
		DataEconomyGrowth:    3.5,
		CrossBorderVolume:    round2(totalVolume),
		FdiConfidence:        round2(avgComp * 0.75),
		InsuranceCostIndex:   round2(100 + (avgBreach-0.1)*50),
	}
}

func round4f(v float64) float64 { return math.Round(v*10000) / 10000 }

func (dt *DigitalTwin) callRustMonteCarlo(sectors []SectorModel, iterations, duration int, sla, penMult, compThreshold float64) (*RustMCResponse, error) {
	if !isRustServiceAvailable(dt.monteCarloURL) {
		return nil, fmt.Errorf("rust monte carlo service unavailable at %s", dt.monteCarloURL)
	}
	reqBody := RustMCRequest{
		Sectors:             sectorsToRustInputs(sectors),
		Iterations:          iterations,
		DurationMonths:      duration,
		BreachSLAHours:      sla,
		PenaltyMultiplier:   penMult,
		ComplianceThreshold: compThreshold,
	}
	body, _ := json.Marshal(reqBody)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", dt.monteCarloURL+"/api/v1/monte-carlo/run", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := rustHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("monte carlo call failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("monte carlo returned %d: %s", resp.StatusCode, string(respBody))
	}
	var result RustMCResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("monte carlo decode failed: %w", err)
	}
	return &result, nil
}

func (dt *DigitalTwin) callRustABM(sectors []SectorModel, duration int, sla, penMult, compThreshold float64) (*RustABMResponse, error) {
	if !isRustServiceAvailable(dt.agentModelURL) {
		return nil, fmt.Errorf("rust ABM service unavailable at %s", dt.agentModelURL)
	}
	peerWeight := 0.3
	networkEffects := true
	reqBody := RustABMRequest{
		Agents:              sectorsToRustAgents(sectors),
		DurationMonths:      duration,
		BreachSLAHours:      sla,
		PenaltyMultiplier:   penMult,
		ComplianceThreshold: compThreshold,
		PeerPressureWeight:  &peerWeight,
		NetworkEffects:      &networkEffects,
	}
	body, _ := json.Marshal(reqBody)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", dt.agentModelURL+"/api/v1/agent-sim/run", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := rustHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ABM call failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ABM returned %d: %s", resp.StatusCode, string(respBody))
	}
	var result RustABMResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("ABM decode failed: %w", err)
	}
	return &result, nil
}

func (dt *DigitalTwin) callRustSystemDynamics(sectors []SectorModel, jCode string, duration int, sla, penMult float64) (*RustSDResponse, error) {
	if !isRustServiceAvailable(dt.sysDynURL) {
		return nil, fmt.Errorf("rust system dynamics service unavailable at %s", dt.sysDynURL)
	}
	reqBody := RustSDRequest{
		InitialStocks:  sectorsToRustStocks(sectors),
		DurationMonths: duration,
		PolicyParams: RustPolicyParams{
			BreachSLAHours:            sla,
			PenaltyMultiplier:         penMult,
			EnforcementBudgetIncrease: 10.0,
			AwarenessCampaign:         true,
			MandatoryAudit:            penMult > 1.5,
			CrossBorderRestriction:    0.1,
		},
		Jurisdiction: jCode,
	}
	body, _ := json.Marshal(reqBody)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", dt.sysDynURL+"/api/v1/system-dynamics/run", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := rustHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("system dynamics call failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("system dynamics returned %d: %s", resp.StatusCode, string(respBody))
	}
	var result RustSDResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("system dynamics decode failed: %w", err)
	}
	return &result, nil
}

func rustCItoGoCI(rc RustCI) ConfidenceInterval {
	return ConfidenceInterval{P5: rc.P5, P25: rc.P25, P50: rc.P50, P75: rc.P75, P95: rc.P95, Mean: rc.Mean, StdDev: rc.StdDev}
}

func generateDataFlows() []DataFlow {
	return []DataFlow{
		{Source: "Lagos", Destination: "Abuja", Volume: 450.0, Encrypted: true, CrossBorder: false, Compliant: true, Sector: "Banking"},
		{Source: "Lagos", Destination: "London", Volume: 120.0, Encrypted: true, CrossBorder: true, Compliant: true, Sector: "Banking"},
		{Source: "Kano", Destination: "Lagos", Volume: 280.0, Encrypted: true, CrossBorder: false, Compliant: true, Sector: "Telecom"},
		{Source: "Lagos", Destination: "Dublin", Volume: 85.0, Encrypted: true, CrossBorder: true, Compliant: false, Sector: "Telecom"},
		{Source: "Abuja", Destination: "Geneva", Volume: 30.0, Encrypted: true, CrossBorder: true, Compliant: true, Sector: "Healthcare"},
		{Source: "Port Harcourt", Destination: "Lagos", Volume: 65.0, Encrypted: false, CrossBorder: false, Compliant: false, Sector: "Energy"},
		{Source: "Lagos", Destination: "Accra", Volume: 40.0, Encrypted: true, CrossBorder: true, Compliant: true, Sector: "Insurance"},
		{Source: "Ibadan", Destination: "Lagos", Volume: 180.0, Encrypted: true, CrossBorder: false, Compliant: true, Sector: "Education"},
		{Source: "Accra", Destination: "Lagos", Volume: 35.0, Encrypted: true, CrossBorder: true, Compliant: true, Sector: "Banking"},
		{Source: "Nairobi", Destination: "Lagos", Volume: 25.0, Encrypted: true, CrossBorder: true, Compliant: true, Sector: "Telecom"},
		{Source: "Johannesburg", Destination: "London", Volume: 200.0, Encrypted: true, CrossBorder: true, Compliant: true, Sector: "Banking"},
		{Source: "Cape Town", Destination: "Frankfurt", Volume: 95.0, Encrypted: true, CrossBorder: true, Compliant: true, Sector: "Insurance"},
	}
}

// ── DB Operations ───────────────────────────────────────────────────────────

func (dt *DigitalTwin) loadJurisdictions(ctx context.Context) ([]Jurisdiction, error) {
	rows, err := dt.db.QueryContext(ctx, `SELECT id, code, name, region, COALESCE(data_protection_act,''), COALESCE(regulator,''), COALESCE(adequacy_status,'none'), COALESCE(population_millions,0), COALESCE(gdp_usd_billions,0), COALESCE(digital_economy_pct,0) FROM dt_jurisdictions ORDER BY code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Jurisdiction
	for rows.Next() {
		var j Jurisdiction
		if err := rows.Scan(&j.ID, &j.Code, &j.Name, &j.Region, &j.DataProtectionAct, &j.Regulator, &j.AdequacyStatus, &j.PopulationM, &j.GdpBillions, &j.DigitalEconomyPct); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, nil
}

func (dt *DigitalTwin) loadSectorModels(ctx context.Context, jurisdictions []string) ([]SectorModel, error) {
	query := `SELECT sm.id, sm.jurisdiction_id, j.code, sm.sector, sm.organizations, sm.avg_compliance, sm.breach_rate, COALESCE(sm.avg_penalty_local,0), COALESCE(sm.avg_budget_usd,0), COALESCE(sm.staff_count_avg,0), COALESCE(sm.tech_maturity,5), COALESCE(sm.data_volume_gb,0), COALESCE(sm.cross_border_pct,0), COALESCE(sm.risk_factors,'[]') FROM dt_sector_models sm JOIN dt_jurisdictions j ON j.id = sm.jurisdiction_id`
	if len(jurisdictions) > 0 {
		placeholders := make([]string, len(jurisdictions))
		for i := range jurisdictions {
			placeholders[i] = fmt.Sprintf("$%d", i+1)
		}
		query += " WHERE j.code IN (" + strings.Join(placeholders, ",") + ")"
	}
	query += " ORDER BY j.code, sm.sector"

	args := make([]interface{}, len(jurisdictions))
	for i, j := range jurisdictions {
		args[i] = j
	}

	rows, err := dt.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SectorModel
	for rows.Next() {
		var s SectorModel
		var rfJSON string
		if err := rows.Scan(&s.ID, &s.JurisdictionID, &s.Jurisdiction, &s.Sector, &s.Organizations, &s.AvgCompliance, &s.BreachRate, &s.AvgPenalty, &s.AvgBudgetUSD, &s.StaffCountAvg, &s.TechMaturity, &s.DataVolumeGB, &s.CrossBorderPct, &rfJSON); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(rfJSON), &s.RiskFactors)
		out = append(out, s)
	}
	return out, nil
}

func (dt *DigitalTwin) loadPolicies(ctx context.Context, jurisdictions []string) ([]Policy, error) {
	query := `SELECT p.id, p.jurisdiction_id, j.code, p.code, p.name, p.category, p.status, COALESCE(p.effective_date::text,''), p.rules, p.parameters FROM dt_policies p JOIN dt_jurisdictions j ON j.id = p.jurisdiction_id`
	if len(jurisdictions) > 0 {
		placeholders := make([]string, len(jurisdictions))
		for i := range jurisdictions {
			placeholders[i] = fmt.Sprintf("$%d", i+1)
		}
		query += " WHERE j.code IN (" + strings.Join(placeholders, ",") + ")"
	}
	query += " ORDER BY j.code, p.code"

	args := make([]interface{}, len(jurisdictions))
	for i, j := range jurisdictions {
		args[i] = j
	}

	rows, err := dt.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Policy
	for rows.Next() {
		var p Policy
		var rulesJSON, paramsJSON string
		if err := rows.Scan(&p.ID, &p.JurisdictionID, &p.Jurisdiction, &p.Code, &p.Name, &p.Category, &p.Status, &p.EffectiveDate, &rulesJSON, &paramsJSON); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(rulesJSON), &p.Rules)
		json.Unmarshal([]byte(paramsJSON), &p.Parameters)
		out = append(out, p)
	}
	return out, nil
}

func (dt *DigitalTwin) persistSimulation(ctx context.Context, req SimulationRequest, result SimulationResult) {
	jurisdictionsJSON, _ := json.Marshal(result.Jurisdictions)
	policiesJSON, _ := json.Marshal(req.PolicyIDs)
	paramsJSON, _ := json.Marshal(req.Parameters)

	_, err := dt.db.ExecContext(ctx,
		`INSERT INTO dt_simulations (simulation_id, name, type, jurisdictions, policies, parameters, duration_months, iterations, status, started_at, completed_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9, NOW(), 'api')`,
		result.SimulationID, req.Scenario, result.Type, string(jurisdictionsJSON), string(policiesJSON), string(paramsJSON), req.Duration, req.Iterations, result.SimulatedAt)
	if err != nil {
		log.Printf("persist simulation: %v", err)
	}

	for _, point := range result.Timeline {
		for _, j := range result.Jurisdictions {
			sectorJSON, _ := json.Marshal(result.JurisdictionResults[j].SectorImpacts)
			dt.db.ExecContext(ctx,
				`INSERT INTO dt_simulation_results (simulation_id, jurisdiction, month, iteration, avg_compliance, breach_count, total_penalties_local, cross_border_flows, gdp_impact_pct, fdi_confidence, insurance_cost_idx, sector_data) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11)`,
				result.SimulationID, j, point.Month, point.AvgCompliance, point.BreachCount, point.TotalPenalties, point.CrossBorderFlows, point.GdpImpactPct, point.FdiConfidence, point.InsuranceCostIdx, string(sectorJSON))
		}
	}

	for _, pi := range result.PolicyImpacts {
		dt.db.ExecContext(ctx,
			`INSERT INTO dt_policy_impacts (simulation_id, jurisdiction, sector, compliance_delta, breach_delta_pct, penalty_delta_local, effectiveness_score, sensitivity_rank) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			result.SimulationID, pi.Jurisdiction, pi.PolicyCode, pi.ComplianceDelta, pi.BreachDelta, pi.PenaltyDelta, pi.EffectivenessScore, pi.SensitivityRank)
	}
}

// ── Simulation Engine ───────────────────────────────────────────────────────

func (dt *DigitalTwin) Simulate(ctx context.Context, req SimulationRequest) SimulationResult {
	start := time.Now()

	if len(req.Jurisdictions) == 0 {
		req.Jurisdictions = []string{"NG"}
	}
	if req.Duration == 0 {
		req.Duration = 12
	}
	if req.Iterations == 0 {
		req.Iterations = 1
	}
	simType := req.Type
	if simType == "" {
		if req.Iterations > 1 {
			simType = "monte_carlo"
		} else if req.CounterfactualYear > 0 {
			simType = "counterfactual"
		} else if req.SandboxID != "" {
			simType = "sandbox"
		} else {
			simType = "scenario"
		}
	}

	simID := fmt.Sprintf("sim_%s", uuid.New().String()[:12])

	sectors, _ := dt.loadSectorModels(ctx, req.Jurisdictions)
	policies, _ := dt.loadPolicies(ctx, req.Jurisdictions)

	slaChange := req.Parameters["breach_sla_hours"]
	penaltyMultiplier := req.Parameters["penalty_multiplier"]
	complianceThreshold := req.Parameters["compliance_threshold"]
	if slaChange == 0 {
		slaChange = 72
	}
	if penaltyMultiplier == 0 {
		penaltyMultiplier = 1.0
	}
	if complianceThreshold == 0 {
		complianceThreshold = 70.0
	}

	// Apply policy parameters if specific policies requested
	for _, pid := range req.PolicyIDs {
		for _, pol := range policies {
			if pol.ID == pid {
				if v, ok := pol.Parameters["breach_sla_hours"]; ok {
					slaChange = v
				}
				if v, ok := pol.Parameters["penalty_multiplier"]; ok {
					penaltyMultiplier = v
				}
				if v, ok := pol.Parameters["compliance_threshold"]; ok {
					complianceThreshold = v
				}
			}
		}
	}

	result := SimulationResult{
		SimulationID:        simID,
		ScenarioID:          simID,
		Scenario:            req.Scenario,
		Type:                simType,
		Duration:            req.Duration,
		Jurisdictions:       req.Jurisdictions,
		JurisdictionResults: make(map[string]JurisdictionResult),
		SectorImpacts:       make(map[string]SectorImpact),
		SimulatedAt:         time.Now().UTC().Format(time.RFC3339),
	}

	// Run simulation for each jurisdiction
	for _, jCode := range req.Jurisdictions {
		jSectors := filterSectors(sectors, jCode)
		if len(jSectors) == 0 {
			continue
		}
		jResult := dt.simulateJurisdiction(jCode, jSectors, req.Duration, slaChange, penaltyMultiplier, complianceThreshold, req.Iterations)
		result.JurisdictionResults[jCode] = jResult

		for key, si := range jResult.SectorImpacts {
			result.SectorImpacts[jCode+"_"+key] = si
		}
	}

	// Aggregate timeline across jurisdictions (primary = first)
	primaryJCode := req.Jurisdictions[0]
	primarySectors := filterSectors(sectors, primaryJCode)
	result.Timeline = dt.buildTimeline(primarySectors, req.Duration, slaChange, penaltyMultiplier, req.Iterations)

	// Monte Carlo stats if iterations > 1
	if req.Iterations > 1 {
		result.MonteCarloStats = dt.runMonteCarlo(primarySectors, req.Duration, slaChange, penaltyMultiplier, req.Iterations)
	}

	// ── Rust Engine Integration (try advanced engines, fall back to Go) ──
	rustResults := &RustEngineResults{}
	hasRustResults := false

	// Rust Monte Carlo: use when iterations > 1 for statistically rigorous CI
	if req.Iterations > 1 {
		mcResp, err := dt.callRustMonteCarlo(sectors, req.Iterations, req.Duration, slaChange, penaltyMultiplier, complianceThreshold)
		if err != nil {
			log.Printf("[rust-mc] Falling back to Go: %v", err)
			rustResults.Errors = append(rustResults.Errors, fmt.Sprintf("monte_carlo: %v", err))
		} else {
			rustResults.MonteCarloUsed = true
			rustResults.MonteCarloResult = mcResp
			hasRustResults = true
			// Enhance Go MC stats with Rust's more accurate CI
			result.MonteCarloStats = &MonteCarloStats{
				Iterations: mcResp.Iterations,
				Metrics: map[string]ConfidenceInterval{
					"compliance_delta": rustCItoGoCI(mcResp.Compliance),
					"breach_delta_pct": rustCItoGoCI(mcResp.BreachDelta),
					"penalty_delta":    rustCItoGoCI(mcResp.PenaltyDelta),
					"gdp_impact":       rustCItoGoCI(mcResp.GdpImpact),
				},
			}
			log.Printf("[rust-mc] %d iterations in %dms (Rayon-parallelized)", mcResp.Iterations, mcResp.DurationMs)
		}
	}

	// Rust ABM: always try for richer per-org simulation
	abmResp, abmErr := dt.callRustABM(primarySectors, req.Duration, slaChange, penaltyMultiplier, complianceThreshold)
	if abmErr != nil {
		log.Printf("[rust-abm] Falling back to Go: %v", abmErr)
		rustResults.Errors = append(rustResults.Errors, fmt.Sprintf("abm: %v", abmErr))
	} else {
		rustResults.ABMUsed = true
		rustResults.ABMResult = abmResp
		hasRustResults = true
		log.Printf("[rust-abm] %d agents simulated in %dms", len(abmResp.Agents), abmResp.DurationMs)
	}

	// Rust System Dynamics: run for causal feedback loop analysis
	sdResp, sdErr := dt.callRustSystemDynamics(primarySectors, primaryJCode, req.Duration, slaChange, penaltyMultiplier)
	if sdErr != nil {
		log.Printf("[rust-sd] Falling back to Go: %v", sdErr)
		rustResults.Errors = append(rustResults.Errors, fmt.Sprintf("system_dynamics: %v", sdErr))
	} else {
		rustResults.SystemDynamicsUsed = true
		rustResults.SDResult = sdResp
		hasRustResults = true
		log.Printf("[rust-sd] %s jurisdiction, %d months in %dms", sdResp.Jurisdiction, len(sdResp.Timeline), sdResp.DurationMs)
	}

	if hasRustResults {
		result.RustEngines = rustResults
	}

	// Economic impact calculation
	result.EconomicImpact = dt.calcEconomicImpact(ctx, primarySectors, req.Duration, penaltyMultiplier, slaChange)

	// Policy impacts
	for _, pid := range req.PolicyIDs {
		for _, pol := range policies {
			if pol.ID == pid {
				pi := PolicyImpact{
					PolicyCode:  pol.Code,
					PolicyName:  pol.Name,
					Jurisdiction: pol.Jurisdiction,
				}
				if jr, ok := result.JurisdictionResults[pol.Jurisdiction]; ok {
					pi.ComplianceDelta = jr.ComplianceDelta
					pi.BreachDelta = jr.BreachDelta
					pi.PenaltyDelta = jr.PenaltyDelta
					pi.EffectivenessScore = math.Min(100, math.Abs(jr.ComplianceDelta)*10)
				}
				result.PolicyImpacts = append(result.PolicyImpacts, pi)
			}
		}
	}

	// Overall metrics from primary jurisdiction
	if jr, ok := result.JurisdictionResults[primaryJCode]; ok {
		result.OverallCompliance = jr.ComplianceDelta
		result.PenaltyDelta = jr.PenaltyDelta
		result.BreachDelta = jr.BreachDelta
	}

	// Recommendations
	result.Recommendations = dt.generateRecommendations(result, complianceThreshold, slaChange)

	result.DurationMs = time.Since(start).Milliseconds()

	// Persist to DB
	go dt.persistSimulation(ctx, req, result)

	// Publish events (best-effort)
	go dt.publishEvent("digital-twin.simulations", map[string]interface{}{
		"event":         "simulation.completed",
		"simulation_id": simID,
		"type":          simType,
		"jurisdictions": req.Jurisdictions,
		"duration_ms":   result.DurationMs,
	})

	dt.mu.Lock()
	dt.history = append(dt.history, result)
	dt.mu.Unlock()

	return result
}

func filterSectors(sectors []SectorModel, jCode string) []SectorModel {
	var out []SectorModel
	for _, s := range sectors {
		if s.Jurisdiction == jCode {
			out = append(out, s)
		}
	}
	return out
}

func (dt *DigitalTwin) simulateJurisdiction(jCode string, sectors []SectorModel, duration int, sla, penMult, compThreshold float64, iterations int) JurisdictionResult {
	r := rand.New(rand.NewSource(time.Now().UnixNano()))

	compDeltas := make([]float64, 0, iterations)
	breachDeltas := make([]float64, 0, iterations)
	penDeltas := make([]float64, 0, iterations)

	for iter := 0; iter < iterations; iter++ {
		totalCompDelta := 0.0
		totalBreachDelta := 0.0
		totalPenDelta := 0.0

		for _, sector := range sectors {
			improvement := (100 - sector.AvgCompliance) * 0.02 * penMult * float64(duration)
			budgetFactor := math.Log10(math.Max(1, sector.AvgBudgetUSD/10000)) * 0.1
			staffFactor := math.Min(0.3, float64(sector.StaffCountAvg)*0.02)
			techFactor := sector.TechMaturity * 0.05
			noise := r.NormFloat64() * 2.0

			compDelta := improvement*(1+budgetFactor+staffFactor+techFactor) + noise
			compDelta = math.Min(compDelta, 100-sector.AvgCompliance)

			slaFactor := 72.0 / sla
			breachDelta := -sector.BreachRate * 0.1 * float64(duration) * slaFactor * (1 + techFactor)
			breachNoise := r.NormFloat64() * 0.5
			breachDelta += breachNoise

			penDelta := sector.AvgPenalty * (penMult - 1) * float64(sector.Organizations) * sector.BreachRate

			totalCompDelta += compDelta * float64(sector.Organizations)
			totalBreachDelta += breachDelta
			totalPenDelta += penDelta
		}

		totalOrgs := 0
		for _, s := range sectors {
			totalOrgs += s.Organizations
		}
		if totalOrgs > 0 {
			compDeltas = append(compDeltas, totalCompDelta/float64(totalOrgs))
		}
		breachDeltas = append(breachDeltas, totalBreachDelta/float64(len(sectors)))
		penDeltas = append(penDeltas, totalPenDelta)
	}

	// Average across iterations
	avgComp := mean(compDeltas)
	avgBreach := mean(breachDeltas)
	avgPen := mean(penDeltas)

	jr := JurisdictionResult{
		Code:            jCode,
		ComplianceDelta: round2(avgComp),
		BreachDelta:     round2(avgBreach * 100),
		PenaltyDelta:    round2(avgPen),
		SectorImpacts:   make(map[string]SectorImpact),
	}

	for _, sector := range sectors {
		compDelta := (100 - sector.AvgCompliance) * 0.02 * float64(duration) * penMult
		slaFactor := 72.0 / sla
		breachDelta := -sector.BreachRate * 0.1 * float64(duration) * slaFactor
		penDelta := sector.AvgPenalty * (penMult - 1) * float64(sector.Organizations) * sector.BreachRate

		compCost := sector.AvgBudgetUSD * 0.15 * penMult
		breachCostAvoided := math.Abs(breachDelta) * sector.AvgPenalty * float64(sector.Organizations)
		cbRatio := 0.0
		if compCost > 0 {
			cbRatio = breachCostAvoided / compCost
		}

		riskLevel := "low"
		if sector.AvgCompliance+compDelta < compThreshold {
			riskLevel = "critical"
		} else if compDelta < 5 {
			riskLevel = "high"
		} else if compDelta < 10 {
			riskLevel = "medium"
		}

		jr.SectorImpacts[sector.Sector] = SectorImpact{
			Sector:           sector.Sector,
			Jurisdiction:     jCode,
			ComplianceDelta:  round2(compDelta),
			PenaltyDelta:     round2(penDelta),
			BreachDelta:      round2(breachDelta * 100),
			CostBenefitRatio: round2(cbRatio),
			RiskLevel:        riskLevel,
		}
	}

	return jr
}

func (dt *DigitalTwin) buildTimeline(sectors []SectorModel, duration int, sla, penMult float64, iterations int) []TimelinePoint {
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	var timeline []TimelinePoint

	for month := 1; month <= duration; month++ {
		point := TimelinePoint{Month: month}
		totalScore := 0.0

		for _, sector := range sectors {
			improvement := (100 - sector.AvgCompliance) * 0.02 * penMult
			budgetFactor := math.Log10(math.Max(1, sector.AvgBudgetUSD/10000)) * 0.1
			noise := r.NormFloat64() * 1.5
			newScore := math.Min(100, sector.AvgCompliance+improvement*float64(month)*(1+budgetFactor)+noise)
			totalScore += newScore * float64(sector.Organizations)

			slaFactor := 72.0 / sla
			breachReduction := (1 - sector.BreachRate) * 0.01 * slaFactor * float64(month)
			point.BreachCount += int(math.Max(0, float64(sector.Organizations)*sector.BreachRate*(1-breachReduction)))
			point.TotalPenalties += sector.AvgPenalty * penMult * float64(point.BreachCount)
		}

		totalOrgs := 0
		for _, s := range sectors {
			totalOrgs += s.Organizations
		}
		if totalOrgs > 0 {
			point.AvgCompliance = round2(totalScore / float64(totalOrgs))
		}
		point.CrossBorderFlows = 4380 + month*50

		// Economic indicators per month
		point.GdpImpactPct = round3(-0.01 * float64(point.BreachCount) / math.Max(1, float64(totalOrgs)))
		point.FdiConfidence = round2(math.Min(100, 65+float64(month)*0.5*(penMult)))
		point.InsuranceCostIdx = round2(100 - float64(month)*0.3*penMult)

		timeline = append(timeline, point)
	}
	return timeline
}

func (dt *DigitalTwin) runMonteCarlo(sectors []SectorModel, duration int, sla, penMult float64, iterations int) *MonteCarloStats {
	if iterations < 10 {
		iterations = 100
	}

	compResults := make([]float64, iterations)
	breachResults := make([]float64, iterations)
	penResults := make([]float64, iterations)

	for i := 0; i < iterations; i++ {
		r := rand.New(rand.NewSource(time.Now().UnixNano() + int64(i)))
		totalComp := 0.0
		totalBreach := 0.0
		totalPen := 0.0
		totalOrgs := 0

		for _, sector := range sectors {
			improvement := (100 - sector.AvgCompliance) * 0.02 * penMult * float64(duration)
			budgetNoise := r.NormFloat64() * 0.15
			staffNoise := r.NormFloat64() * 0.1
			techNoise := r.NormFloat64() * 0.1
			marketShock := 0.0
			if r.Float64() < 0.05 {
				marketShock = r.NormFloat64() * 5
			}
			compDelta := improvement * (1 + budgetNoise + staffNoise + techNoise) + marketShock

			slaFactor := 72.0 / sla
			breachBase := -sector.BreachRate * 0.1 * float64(duration) * slaFactor
			breachNoise := r.NormFloat64() * sector.BreachRate * 0.3
			breachDelta := breachBase + breachNoise

			penDelta := sector.AvgPenalty * (penMult - 1) * float64(sector.Organizations) * math.Max(0, sector.BreachRate+breachDelta)

			totalComp += compDelta * float64(sector.Organizations)
			totalBreach += breachDelta
			totalPen += penDelta
			totalOrgs += sector.Organizations
		}

		if totalOrgs > 0 {
			compResults[i] = totalComp / float64(totalOrgs)
		}
		breachResults[i] = totalBreach / float64(len(sectors)) * 100
		penResults[i] = totalPen
	}

	return &MonteCarloStats{
		Iterations: iterations,
		Metrics: map[string]ConfidenceInterval{
			"compliance_delta": calcCI(compResults),
			"breach_delta_pct": calcCI(breachResults),
			"penalty_delta":    calcCI(penResults),
		},
	}
}

func (dt *DigitalTwin) calcEconomicImpact(ctx context.Context, sectors []SectorModel, duration int, penMult, sla float64) *EconomicImpact {
	totalOrgs := 0
	totalBudget := 0.0
	totalBreachCost := 0.0
	for _, s := range sectors {
		totalOrgs += s.Organizations
		totalBudget += s.AvgBudgetUSD * float64(s.Organizations)
		totalBreachCost += s.AvgPenalty * s.BreachRate * float64(s.Organizations)
	}

	complianceCost := totalBudget * 0.15 * penMult / 1e6
	slaFactor := 72.0 / sla
	breachReduction := 0.1 * float64(duration) * slaFactor * penMult
	breachCostAvoided := totalBreachCost * math.Min(1, breachReduction) / 1e6

	gdpImpact := (breachCostAvoided - complianceCost) * 0.001
	fdiChange := math.Min(15, penMult*3+slaFactor*2)
	insuranceChange := -math.Min(20, breachReduction*10)

	return &EconomicImpact{
		GdpImpactPct:              round3(gdpImpact),
		FdiConfidenceChange:       round2(fdiChange),
		InsuranceCostChangeIdx:    round2(insuranceChange),
		ComplianceCostMillions:    round2(complianceCost),
		BreachCostAvoidedMillions: round2(breachCostAvoided),
		NetEconomicBenefit:        round2(breachCostAvoided - complianceCost),
	}
}

func (dt *DigitalTwin) generateRecommendations(result SimulationResult, threshold, sla float64) []string {
	var recs []string
	for key, impact := range result.SectorImpacts {
		if impact.RiskLevel == "critical" {
			recs = append(recs, fmt.Sprintf("URGENT: %s needs immediate intervention — compliance below %.0f%% threshold", key, threshold))
		}
		if impact.BreachDelta > 0 {
			recs = append(recs, fmt.Sprintf("%s: Breach rate increasing — recommend mandatory security audit", key))
		}
		if impact.CostBenefitRatio > 3 {
			recs = append(recs, fmt.Sprintf("%s: High ROI (%.1fx) — enforcement investment is cost-effective", key, impact.CostBenefitRatio))
		}
	}
	if sla < 72 {
		recs = append(recs, "Tighter breach SLA will require additional notification infrastructure investment")
	}
	if result.EconomicImpact != nil && result.EconomicImpact.NetEconomicBenefit > 0 {
		recs = append(recs, fmt.Sprintf("Net economic benefit: $%.1fM — policy changes are economically positive", result.EconomicImpact.NetEconomicBenefit))
	}
	if len(result.Jurisdictions) > 1 {
		recs = append(recs, "Cross-jurisdiction policy harmonization could reduce compliance costs by 15-25%%")
	}
	return recs
}

func (dt *DigitalTwin) publishEvent(topic string, payload map[string]interface{}) {
	data, _ := json.Marshal(payload)
	// Dapr pub/sub (best-effort)
	resp, err := http.Post(dt.daprURL+"/v1.0/publish/ndsep-pubsub/"+topic, "application/json", strings.NewReader(string(data)))
	if err == nil {
		resp.Body.Close()
	}
}

// ── Breach Prediction ───────────────────────────────────────────────────────

func (dt *DigitalTwin) PredictBreaches(ctx context.Context, jurisdictions []string, orgCount int) []BreachPrediction {
	if len(jurisdictions) == 0 {
		jurisdictions = []string{"NG"}
	}

	// Try ML service first
	mlPredictions := dt.tryMLPrediction(jurisdictions)
	if len(mlPredictions) > 0 {
		return mlPredictions
	}

	// Fallback: heuristic based on DB data
	sectors, _ := dt.loadSectorModels(ctx, jurisdictions)
	if len(sectors) == 0 {
		return nil
	}

	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	predictions := make([]BreachPrediction, 0, orgCount)

	for i := 0; i < orgCount; i++ {
		sector := sectors[i%len(sectors)]
		base30d := sector.BreachRate / 12.0
		base90d := sector.BreachRate / 4.0
		compFactor := (100 - sector.AvgCompliance) / 100.0
		budgetFactor := 1.0 / math.Max(1, math.Log10(math.Max(1, sector.AvgBudgetUSD/1000)))
		noise := r.Float64() * 0.05

		p30 := math.Min(1.0, base30d*(1+compFactor)*budgetFactor+noise)
		p90 := math.Min(1.0, base90d*(1+compFactor)*budgetFactor+noise*2)

		action := "Continue monitoring"
		if p30 > 0.05 {
			action = "Schedule compliance audit"
		}
		if p30 > 0.1 {
			action = "Immediate security assessment required"
		}

		predictions = append(predictions, BreachPrediction{
			OrgID:             1000 + i,
			OrgName:           fmt.Sprintf("Org-%s-%s-%d", sector.Jurisdiction, sector.Sector[:3], i),
			Sector:            sector.Sector,
			Jurisdiction:      sector.Jurisdiction,
			Probability30d:    round2(p30 * 100),
			Probability90d:    round2(p90 * 100),
			TopRiskFactors:    sector.RiskFactors,
			RecommendedAction: action,
			ModelSource:       "heuristic_v2",
		})
	}
	return predictions
}

func (dt *DigitalTwin) tryMLPrediction(jurisdictions []string) []BreachPrediction {
	jParam := strings.Join(jurisdictions, ",")
	resp, err := http.Get(dt.mlPredURL + "/api/v1/predict?jurisdictions=" + jParam)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil
	}
	var result struct {
		Predictions []BreachPrediction `json:"predictions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil
	}
	return result.Predictions
}

// ── Policy Engine ───────────────────────────────────────────────────────────

func (dt *DigitalTwin) ComposePolicies(ctx context.Context, policyIDs []int) ([]Policy, []PolicyConflict) {
	var policies []Policy
	for _, pid := range policyIDs {
		row := dt.db.QueryRowContext(ctx, `SELECT p.id, p.jurisdiction_id, j.code, p.code, p.name, p.category, p.status, COALESCE(p.effective_date::text,''), p.rules, p.parameters FROM dt_policies p JOIN dt_jurisdictions j ON j.id = p.jurisdiction_id WHERE p.id = $1`, pid)
		var p Policy
		var rulesJSON, paramsJSON string
		if err := row.Scan(&p.ID, &p.JurisdictionID, &p.Jurisdiction, &p.Code, &p.Name, &p.Category, &p.Status, &p.EffectiveDate, &rulesJSON, &paramsJSON); err != nil {
			continue
		}
		json.Unmarshal([]byte(rulesJSON), &p.Rules)
		json.Unmarshal([]byte(paramsJSON), &p.Parameters)
		policies = append(policies, p)
	}

	// Detect conflicts
	var conflicts []PolicyConflict
	for i := 0; i < len(policies); i++ {
		for j := i + 1; j < len(policies); j++ {
			a, b := policies[i], policies[j]
			if a.Category == b.Category {
				slaA := a.Parameters["breach_sla_hours"]
				slaB := b.Parameters["breach_sla_hours"]
				if slaA > 0 && slaB > 0 && slaA != slaB {
					conflicts = append(conflicts, PolicyConflict{
						PolicyA:      a.Code,
						PolicyB:      b.Code,
						ConflictType: "parameter_conflict",
						Description:  fmt.Sprintf("Conflicting breach SLA: %s requires %.0fh, %s requires %.0fh", a.Code, slaA, b.Code, slaB),
						Resolution:   fmt.Sprintf("Stricter SLA (%.0fh from %s) takes precedence", math.Min(slaA, slaB), a.Code),
					})
				}
				penA := a.Parameters["penalty_multiplier"]
				penB := b.Parameters["penalty_multiplier"]
				if penA > 0 && penB > 0 && penA != penB {
					conflicts = append(conflicts, PolicyConflict{
						PolicyA:      a.Code,
						PolicyB:      b.Code,
						ConflictType: "parameter_conflict",
						Description:  fmt.Sprintf("Conflicting penalty multipliers: %s=%.1fx, %s=%.1fx", a.Code, penA, b.Code, penB),
						Resolution:   fmt.Sprintf("Higher multiplier (%.1fx) applies; combined effect may compound", math.Max(penA, penB)),
					})
				}
			}
		}
	}
	return policies, conflicts
}

// ── Sandbox ─────────────────────────────────────────────────────────────────

func (dt *DigitalTwin) CreateSandbox(ctx context.Context, name, description string, policyIDs []int) (*SandboxInfo, error) {
	sID := fmt.Sprintf("sandbox_%s", uuid.New().String()[:12])

	sectors, _ := dt.loadSectorModels(ctx, nil)
	snapshot, _ := json.Marshal(sectors)
	policiesJSON, _ := json.Marshal(policyIDs)

	_, err := dt.db.ExecContext(ctx,
		`INSERT INTO dt_sandboxes (sandbox_id, name, description, base_snapshot, policies_applied, status, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, 'active', 'api', NOW() + INTERVAL '7 days')`,
		sID, name, description, string(snapshot), string(policiesJSON))
	if err != nil {
		return nil, err
	}

	return &SandboxInfo{
		SandboxID: sID,
		Name:      name,
		Description: description,
		Status:    "active",
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (dt *DigitalTwin) ListSandboxes(ctx context.Context) ([]SandboxInfo, error) {
	rows, err := dt.db.QueryContext(ctx, `SELECT sandbox_id, name, COALESCE(description,''), COALESCE(policies_applied,'[]'), status, created_at FROM dt_sandboxes WHERE status = 'active' ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SandboxInfo
	for rows.Next() {
		var s SandboxInfo
		var polJSON string
		var createdAt time.Time
		if err := rows.Scan(&s.SandboxID, &s.Name, &s.Description, &polJSON, &s.Status, &createdAt); err != nil {
			continue
		}
		json.Unmarshal([]byte(polJSON), &s.PoliciesApplied)
		s.CreatedAt = createdAt.Format(time.RFC3339)
		out = append(out, s)
	}
	return out, nil
}

// ── Counterfactual Analysis ─────────────────────────────────────────────────

func (dt *DigitalTwin) RunCounterfactual(ctx context.Context, req SimulationRequest) map[string]SimulationResult {
	results := make(map[string]SimulationResult)

	// Baseline: current policy
	baseReq := req
	baseReq.Type = "counterfactual_baseline"
	baseReq.Iterations = 1
	results["actual"] = dt.Simulate(ctx, baseReq)

	// Counterfactual: with proposed changes
	cfReq := req
	cfReq.Type = "counterfactual"
	results["counterfactual"] = dt.Simulate(ctx, cfReq)

	return results
}

// ── GetState (v2: DB-backed) ────────────────────────────────────────────────

func (dt *DigitalTwin) GetState(ctx context.Context) EcosystemState {
	jurisdictions, _ := dt.loadJurisdictions(ctx)
	sectors, _ := dt.loadSectorModels(ctx, nil)
	policies, _ := dt.loadPolicies(ctx, nil)

	totalOrgs := 0
	totalScore := 0.0
	crossBorder := 0
	for _, s := range sectors {
		totalOrgs += s.Organizations
		totalScore += s.AvgCompliance * float64(s.Organizations)
		crossBorder += int(s.CrossBorderPct * float64(s.Organizations))
	}

	avgScore := 0.0
	if totalOrgs > 0 {
		avgScore = round2(totalScore / float64(totalOrgs))
	}

	return EcosystemState{
		Jurisdictions: jurisdictions,
		Sectors:       sectors,
		DataFlows:     dt.dataFlows,
		TotalOrgs:     totalOrgs,
		AvgScore:      avgScore,
		TotalFlows:    len(dt.dataFlows),
		CrossBorder:   crossBorder,
		Policies:      policies,
		UpdatedAt:     time.Now().UTC().Format(time.RFC3339),
	}
}

// ── History (v2: DB-backed) ─────────────────────────────────────────────────

func (dt *DigitalTwin) GetHistory(ctx context.Context, limit int) []map[string]interface{} {
	if limit == 0 {
		limit = 50
	}
	rows, err := dt.db.QueryContext(ctx, `SELECT simulation_id, name, type, jurisdictions, parameters, duration_months, iterations, status, started_at, completed_at FROM dt_simulations ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		// Fallback to in-memory
		dt.mu.RLock()
		defer dt.mu.RUnlock()
		results := make([]map[string]interface{}, len(dt.history))
		for i, h := range dt.history {
			results[i] = map[string]interface{}{
				"simulation_id":  h.SimulationID,
				"scenario":       h.Scenario,
				"type":           h.Type,
				"jurisdictions":  h.Jurisdictions,
				"duration_months": h.Duration,
				"compliance_change": h.OverallCompliance,
				"breach_delta":   h.BreachDelta,
				"penalty_delta":  h.PenaltyDelta,
				"simulated_at":   h.SimulatedAt,
			}
		}
		return results
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var simID, name, simType, jurisdictionsJSON, paramsJSON, status string
		var durationMonths, iterations int
		var startedAt, completedAt sql.NullTime
		if err := rows.Scan(&simID, &name, &simType, &jurisdictionsJSON, &paramsJSON, &durationMonths, &iterations, &status, &startedAt, &completedAt); err != nil {
			continue
		}
		entry := map[string]interface{}{
			"simulation_id":  simID,
			"scenario":       name,
			"type":           simType,
			"duration_months": durationMonths,
			"iterations":     iterations,
			"status":         status,
		}
		var jurisdictions []string
		json.Unmarshal([]byte(jurisdictionsJSON), &jurisdictions)
		entry["jurisdictions"] = jurisdictions
		if startedAt.Valid {
			entry["simulated_at"] = startedAt.Time.Format(time.RFC3339)
		}
		results = append(results, entry)
	}
	return results
}

// ── Math Helpers ────────────────────────────────────────────────────────────

func mean(vals []float64) float64 {
	if len(vals) == 0 {
		return 0
	}
	sum := 0.0
	for _, v := range vals {
		sum += v
	}
	return sum / float64(len(vals))
}

func stddev(vals []float64) float64 {
	m := mean(vals)
	sum := 0.0
	for _, v := range vals {
		sum += (v - m) * (v - m)
	}
	return math.Sqrt(sum / float64(len(vals)))
}

func percentile(vals []float64, p float64) float64 {
	if len(vals) == 0 {
		return 0
	}
	sorted := make([]float64, len(vals))
	copy(sorted, vals)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j] < sorted[i] {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	idx := p / 100.0 * float64(len(sorted)-1)
	lo := int(math.Floor(idx))
	hi := int(math.Ceil(idx))
	if lo == hi || hi >= len(sorted) {
		return sorted[lo]
	}
	frac := idx - float64(lo)
	return sorted[lo]*(1-frac) + sorted[hi]*frac
}

func calcCI(vals []float64) ConfidenceInterval {
	return ConfidenceInterval{
		P5:     round2(percentile(vals, 5)),
		P25:    round2(percentile(vals, 25)),
		P50:    round2(percentile(vals, 50)),
		P75:    round2(percentile(vals, 75)),
		P95:    round2(percentile(vals, 95)),
		Mean:   round2(mean(vals)),
		StdDev: round2(stddev(vals)),
	}
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func round3(v float64) float64 {
	return math.Round(v*1000) / 1000
}

// ── HTTP Handlers ───────────────────────────────────────────────────────────

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db?sslmode=disable"
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("DB connect: %v", err)
	}
	if err := db.Ping(); err != nil {
		log.Printf("WARN: DB ping failed (running without persistence): %v", err)
		db = nil
	}

	var dt *DigitalTwin
	if db != nil {
		dt = NewDigitalTwin(db)
	} else {
		dt = NewDigitalTwin(nil)
	}

	mux := http.NewServeMux()
	ctx := context.Background()

	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		dbOK := dt.db != nil && dt.db.Ping() == nil
		mcAvail := isRustServiceAvailable(dt.monteCarloURL)
		abmAvail := isRustServiceAvailable(dt.agentModelURL)
		sdAvail := isRustServiceAvailable(dt.sysDynURL)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":         "healthy",
			"service":        "digital-twin-v2",
			"version":        "2.1.0",
			"db_connected":   dbOK,
			"features":       []string{"multi_jurisdiction", "policy_engine", "monte_carlo", "counterfactual", "sandbox", "economic_impact", "rust_monte_carlo", "rust_abm", "rust_system_dynamics"},
			"rust_engines": map[string]interface{}{
				"monte_carlo":     map[string]interface{}{"url": dt.monteCarloURL, "available": mcAvail},
				"agent_model":     map[string]interface{}{"url": dt.agentModelURL, "available": abmAvail},
				"system_dynamics": map[string]interface{}{"url": dt.sysDynURL, "available": sdAvail},
			},
			"ollama": map[string]interface{}{"integrated": true, "model": "qwen2.5"},
		})
	})

	// ── Ecosystem State (v2) ────────────────────────────────────────────
	mux.HandleFunc("/api/v1/twin/state", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(dt.GetState(ctx))
	})

	// ── Simulate (v2: multi-jurisdiction, Monte Carlo, policy composition) ─
	mux.HandleFunc("/api/v1/twin/simulate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		var req SimulationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		result := dt.Simulate(ctx, req)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})

	// ── Monte Carlo ─────────────────────────────────────────────────────
	mux.HandleFunc("/api/v1/twin/monte-carlo", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		var req SimulationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if req.Iterations < 100 {
			req.Iterations = 1000
		}
		req.Type = "monte_carlo"
		result := dt.Simulate(ctx, req)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})

	// ── Breach Predictions ──────────────────────────────────────────────
	mux.HandleFunc("/api/v1/twin/predict-breaches", func(w http.ResponseWriter, r *http.Request) {
		jurisdictions := []string{"NG"}
		if jParam := r.URL.Query().Get("jurisdictions"); jParam != "" {
			jurisdictions = strings.Split(jParam, ",")
		}
		count := 30
		if cParam := r.URL.Query().Get("count"); cParam != "" {
			if c, err := strconv.Atoi(cParam); err == nil {
				count = c
			}
		}
		predictions := dt.PredictBreaches(ctx, jurisdictions, count)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"predictions": predictions,
			"total":       len(predictions),
			"jurisdictions": jurisdictions,
			"model_source":  "heuristic_v2",
		})
	})

	// ── History ─────────────────────────────────────────────────────────
	mux.HandleFunc("/api/v1/twin/history", func(w http.ResponseWriter, r *http.Request) {
		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if v, err := strconv.Atoi(l); err == nil {
				limit = v
			}
		}
		history := dt.GetHistory(ctx, limit)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"simulations": history,
			"total":       len(history),
		})
	})

	// ── Jurisdictions ───────────────────────────────────────────────────
	mux.HandleFunc("/api/v1/twin/jurisdictions", func(w http.ResponseWriter, _ *http.Request) {
		jurisdictions, _ := dt.loadJurisdictions(ctx)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"jurisdictions": jurisdictions,
			"total":         len(jurisdictions),
		})
	})

	// ── Policies ────────────────────────────────────────────────────────
	mux.HandleFunc("/api/v1/twin/policies", func(w http.ResponseWriter, r *http.Request) {
		jurisdictions := []string{}
		if jParam := r.URL.Query().Get("jurisdictions"); jParam != "" {
			jurisdictions = strings.Split(jParam, ",")
		}
		policies, _ := dt.loadPolicies(ctx, jurisdictions)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"policies": policies,
			"total":    len(policies),
		})
	})

	// ── Policy Composition ──────────────────────────────────────────────
	mux.HandleFunc("/api/v1/twin/policies/compose", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			PolicyIDs []int `json:"policy_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		policies, conflicts := dt.ComposePolicies(ctx, req.PolicyIDs)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"policies":  policies,
			"conflicts": conflicts,
			"total":     len(policies),
		})
	})

	// ── Counterfactual Analysis ─────────────────────────────────────────
	mux.HandleFunc("/api/v1/twin/counterfactual", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		var req SimulationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		results := dt.RunCounterfactual(ctx, req)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(results)
	})

	// ── Sandbox Management ──────────────────────────────────────────────
	mux.HandleFunc("/api/v1/twin/sandboxes", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			sandboxes, _ := dt.ListSandboxes(ctx)
			json.NewEncoder(w).Encode(map[string]interface{}{"sandboxes": sandboxes, "total": len(sandboxes)})
		case "POST":
			var req struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				PolicyIDs   []int  `json:"policy_ids"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			sb, err := dt.CreateSandbox(ctx, req.Name, req.Description, req.PolicyIDs)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(sb)
		default:
			http.Error(w, "GET or POST only", http.StatusMethodNotAllowed)
		}
	})

	// ── Economic Indicators ─────────────────────────────────────────────
	mux.HandleFunc("/api/v1/twin/economics", func(w http.ResponseWriter, r *http.Request) {
		jurisdiction := r.URL.Query().Get("jurisdiction")
		if jurisdiction == "" {
			jurisdiction = "NG"
		}
		rows, err := dt.db.QueryContext(ctx, `SELECT jurisdiction, year, quarter, gdp_usd_billions, digital_economy_usd_billions, fdi_inflow_usd_billions, cyber_insurance_premium_idx, data_breach_cost_avg_usd, compliance_spending_usd_millions, cross_border_trade_volume_usd_billions FROM dt_economic_indicators WHERE jurisdiction = $1 ORDER BY year, quarter`, jurisdiction)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"indicators": []interface{}{}, "error": err.Error()})
			return
		}
		defer rows.Close()

		type EconIndicator struct {
			Jurisdiction string  `json:"jurisdiction"`
			Year         int     `json:"year"`
			Quarter      int     `json:"quarter"`
			GDP          float64 `json:"gdp_usd_billions"`
			DigitalEcon  float64 `json:"digital_economy_usd_billions"`
			FDI          float64 `json:"fdi_inflow_usd_billions"`
			InsuranceIdx float64 `json:"cyber_insurance_premium_idx"`
			BreachCost   float64 `json:"data_breach_cost_avg_usd"`
			CompSpending float64 `json:"compliance_spending_usd_millions"`
			CrossBorder  float64 `json:"cross_border_trade_volume_usd_billions"`
		}

		var indicators []EconIndicator
		for rows.Next() {
			var e EconIndicator
			rows.Scan(&e.Jurisdiction, &e.Year, &e.Quarter, &e.GDP, &e.DigitalEcon, &e.FDI, &e.InsuranceIdx, &e.BreachCost, &e.CompSpending, &e.CrossBorder)
			indicators = append(indicators, e)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"indicators": indicators, "total": len(indicators)})
	})

	// ── Bilateral Agreements ────────────────────────────────────────────
	mux.HandleFunc("/api/v1/twin/agreements", func(w http.ResponseWriter, _ *http.Request) {
		rows, err := dt.db.QueryContext(ctx, `SELECT jurisdiction_a, jurisdiction_b, agreement_type, status, COALESCE(signed_date::text,''), provisions, impact_on_flows FROM dt_bilateral_agreements ORDER BY jurisdiction_a, jurisdiction_b`)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"agreements": []interface{}{}})
			return
		}
		defer rows.Close()

		type Agreement struct {
			JurisdictionA string                 `json:"jurisdiction_a"`
			JurisdictionB string                 `json:"jurisdiction_b"`
			Type          string                 `json:"agreement_type"`
			Status        string                 `json:"status"`
			SignedDate    string                 `json:"signed_date"`
			Provisions    map[string]interface{} `json:"provisions"`
			ImpactOnFlows float64                `json:"impact_on_flows"`
		}

		var agreements []Agreement
		for rows.Next() {
			var a Agreement
			var provJSON string
			rows.Scan(&a.JurisdictionA, &a.JurisdictionB, &a.Type, &a.Status, &a.SignedDate, &provJSON, &a.ImpactOnFlows)
			json.Unmarshal([]byte(provJSON), &a.Provisions)
			agreements = append(agreements, a)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"agreements": agreements, "total": len(agreements)})
	})

	// ── Create/Update Policy ────────────────────────────────────────────
	mux.HandleFunc("/api/v1/twin/policies/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		body, _ := io.ReadAll(r.Body)
		var req struct {
			JurisdictionCode string                   `json:"jurisdiction_code"`
			Code             string                   `json:"code"`
			Name             string                   `json:"name"`
			Category         string                   `json:"category"`
			Status           string                   `json:"status"`
			EffectiveDate    string                   `json:"effective_date"`
			Rules            []map[string]interface{} `json:"rules"`
			Parameters       map[string]float64       `json:"parameters"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		rulesJSON, _ := json.Marshal(req.Rules)
		paramsJSON, _ := json.Marshal(req.Parameters)

		var id int
		err := dt.db.QueryRowContext(ctx,
			`INSERT INTO dt_policies (jurisdiction_id, code, name, category, status, effective_date, rules, parameters) VALUES ((SELECT id FROM dt_jurisdictions WHERE code=$1), $2, $3, $4, $5, $6::date, $7, $8) RETURNING id`,
			req.JurisdictionCode, req.Code, req.Name, req.Category, req.Status, req.EffectiveDate, string(rulesJSON), string(paramsJSON)).Scan(&id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "code": req.Code, "status": "created"})
	})

	port := os.Getenv("DIGITAL_TWIN_PORT")
	if port == "" {
		port = "8175"
	}
	addr := ":" + port
	log.Printf("Digital Twin V2 service listening on %s (multi-jurisdiction, policy engine, Monte Carlo, sandbox)", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
