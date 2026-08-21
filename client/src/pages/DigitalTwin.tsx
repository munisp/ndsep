import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Activity, Globe, Shield, AlertTriangle, TrendingUp, TrendingDown,
  Building2, Zap, Play, BarChart3, Target, Clock, Layers, FlaskConical,
  Scale, GitCompare, Landmark, DollarSign, Network, Boxes,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

// ── Pre-built Nigerian regulatory scenarios ─────────────────────────────────

const SCENARIOS = [
  {
    id: "sla_tighten",
    name: "Tighten Breach Notification SLA",
    description: "NDPC proposes reducing breach notification window from 72 to 24 hours, aligned with EU GDPR standards. What happens to compliance rates and penalties?",
    realWorldContext: "In March 2025, NDPC issued a directive requiring faster breach reporting after the Flutterwave cross-border data leak exposed 8,500 records. This scenario simulates the impact of enforcing the new timeline across all sectors.",
    defaults: { breach_sla_hours: 24, penalty_multiplier: 1.0, compliance_threshold: 70 },
    duration: 12,
  },
  {
    id: "double_penalties",
    name: "Double Enforcement Penalties",
    description: "NITDA doubles maximum fines for non-compliance from ₦10M to ₦20M per violation, with sector-specific multipliers for banking and telecom.",
    realWorldContext: "Following the MTN Nigeria SIM swap fraud breach affecting 450 subscribers, the National Assembly proposed increasing NDPA penalties to match the scale of harm. This scenario models the deterrent effect on breach rates and compliance investment.",
    defaults: { breach_sla_hours: 72, penalty_multiplier: 2.0, compliance_threshold: 70 },
    duration: 12,
  },
  {
    id: "education_crackdown",
    name: "Education Sector Compliance Crackdown",
    description: "NDPC mandates that all EdTech platforms processing children's data must achieve 75% compliance within 6 months or face license suspension.",
    realWorldContext: "With 60 EdTech organizations scoring only 55.2% average compliance and an 18% annual breach rate — the highest of any sector — student data is the most vulnerable. This scenario simulates targeted enforcement on education.",
    defaults: { breach_sla_hours: 48, penalty_multiplier: 3.0, compliance_threshold: 75 },
    duration: 6,
  },
];

const JURISDICTION_NAMES: Record<string, string> = {
  NG: "Nigeria", GH: "Ghana", KE: "Kenya", ZA: "South Africa",
  EU: "European Union", RW: "Rwanda", SN: "Senegal", TZ: "Tanzania",
};

function formatNGN(amount: number): string {
  if (Math.abs(amount) >= 1_000_000_000) return `₦${(amount / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(amount) >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1_000) return `₦${(amount / 1_000).toFixed(0)}K`;
  return `₦${amount.toFixed(0)}`;
}

function formatUSD(amount: number): string {
  if (Math.abs(amount) >= 1_000) return `$${(amount / 1_000).toFixed(1)}B`;
  return `$${amount.toFixed(1)}M`;
}

function riskBadge(level: string) {
  const colors: Record<string, string> = {
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    low: "bg-green-500/20 text-green-400 border-green-500/30",
  };
  return <Badge className={colors[level] ?? ""}>{level.toUpperCase()}</Badge>;
}

// ── Ecosystem Overview Tab ──────────────────────────────────────────────────

function EcosystemTab() {
  const state = trpc.platformIntelligence.twinState.useQuery();
  const d = state.data as Record<string, unknown> | undefined;
  const sectors = (d?.sectors as Array<Record<string, unknown>>) ?? [];
  const flows = (d?.data_flows as Array<Record<string, unknown>>) ?? [];
  const jurisdictions = (d?.jurisdictions as Array<Record<string, unknown>>) ?? [];
  const policies = (d?.policies as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-blue-400 mb-1"><Building2 className="h-4 w-4" /><span className="text-xs font-medium uppercase tracking-wide">Organizations</span></div>
            <p className="text-3xl font-bold">{d?.total_organizations as number ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">Across {jurisdictions.length} jurisdictions</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-green-400 mb-1"><Shield className="h-4 w-4" /><span className="text-xs font-medium uppercase tracking-wide">Avg Compliance</span></div>
            <p className="text-3xl font-bold">{(d?.avg_compliance_score as number)?.toFixed(1) ?? "—"}%</p>
            <p className="text-xs text-muted-foreground mt-1">Weighted by org count</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-purple-400 mb-1"><Landmark className="h-4 w-4" /><span className="text-xs font-medium uppercase tracking-wide">Jurisdictions</span></div>
            <p className="text-3xl font-bold">{jurisdictions.length || "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">{policies.length} active policies</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-amber-400 mb-1"><Globe className="h-4 w-4" /><span className="text-xs font-medium uppercase tracking-wide">Data Flows</span></div>
            <p className="text-3xl font-bold">{d?.total_data_flows as number ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">{d?.cross_border_flows as number ?? 0} cross-border</p>
          </CardContent>
        </Card>
      </div>

      {/* Jurisdiction Overview */}
      {jurisdictions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><Globe className="h-5 w-5" />Jurisdictions</CardTitle>
            <CardDescription>Regulatory frameworks across {jurisdictions.length} countries</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {jurisdictions.map((j, i) => (
                <Card key={i} className="bg-card/50">
                  <CardContent className="pt-3 pb-2 px-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm">{j.name as string}</span>
                      <Badge variant="outline" className="text-xs">{j.code as string}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{j.data_protection_act as string}</p>
                    <p className="text-xs text-muted-foreground">Regulator: {j.regulator as string}</p>
                    <div className="flex gap-2 mt-1 text-xs">
                      <span>Pop: {(j.population_millions as number)?.toFixed(0)}M</span>
                      <span>GDP: ${(j.gdp_usd_billions as number)?.toFixed(0)}B</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sector Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><BarChart3 className="h-5 w-5" />Sector Compliance Overview</CardTitle>
          <CardDescription>Current compliance scores and breach rates across regulated sectors</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {sectors.map((s, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.sector as string ?? s.name as string}</span>
                    <Badge variant="outline" className="text-xs">{s.organizations as number} orgs</Badge>
                    {(s.jurisdiction as string) && <Badge variant="secondary" className="text-xs">{s.jurisdiction as string}</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">{((s.breach_rate as number ?? s.breach_rate_annual as number ?? 0) * 100).toFixed(0)}% breach rate</span>
                    <span className="font-semibold">{(s.avg_compliance as number ?? s.avg_compliance_score as number ?? 0).toFixed(1)}%</span>
                  </div>
                </div>
                <Progress value={s.avg_compliance as number ?? s.avg_compliance_score as number ?? 0} className="h-2" />
                <div className="flex gap-1.5 flex-wrap">
                  {(s.risk_factors as string[])?.map((rf, j) => (
                    <Badge key={j} variant="secondary" className="text-xs">{rf}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Data Flow Map */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Activity className="h-5 w-5" />Active Data Flows</CardTitle>
          <CardDescription>Real-time data transfer routes — domestic and cross-border</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Volume</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead>Encrypted</TableHead>
                <TableHead>Cross-Border</TableHead>
                <TableHead>Compliant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flows.map((f, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{f.source as string}</TableCell>
                  <TableCell>{f.destination as string}</TableCell>
                  <TableCell>{(f.volume_gb_per_month as number).toFixed(0)} GB/mo</TableCell>
                  <TableCell><Badge variant="outline">{f.sector as string}</Badge></TableCell>
                  <TableCell>{(f.encrypted as boolean) ? <Badge className="bg-green-500/20 text-green-400">Yes</Badge> : <Badge className="bg-red-500/20 text-red-400">No</Badge>}</TableCell>
                  <TableCell>{(f.cross_border as boolean) ? <Badge className="bg-amber-500/20 text-amber-400">Int'l</Badge> : <span className="text-muted-foreground">Domestic</span>}</TableCell>
                  <TableCell>{(f.compliant as boolean) ? <Badge className="bg-green-500/20 text-green-400">Yes</Badge> : <Badge className="bg-red-500/20 text-red-400">Non-Compliant</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Scenario Simulator Tab ──────────────────────────────────────────────────

function SimulatorTab() {
  const [selectedScenario, setSelectedScenario] = useState(0);
  const scenario = SCENARIOS[selectedScenario];
  const [slaHours, setSlaHours] = useState(scenario.defaults.breach_sla_hours);
  const [penaltyMult, setPenaltyMult] = useState(scenario.defaults.penalty_multiplier);
  const [threshold, setThreshold] = useState(scenario.defaults.compliance_threshold);
  const [duration, setDuration] = useState(scenario.duration);
  const [selectedJurisdictions, setSelectedJurisdictions] = useState<string[]>(["NG"]);
  const [iterations, setIterations] = useState(1);

  const simulate = trpc.platformIntelligence.twinSimulate.useMutation();

  const handleSelectScenario = (idx: number) => {
    setSelectedScenario(idx);
    const s = SCENARIOS[idx];
    setSlaHours(s.defaults.breach_sla_hours);
    setPenaltyMult(s.defaults.penalty_multiplier);
    setThreshold(s.defaults.compliance_threshold);
    setDuration(s.duration);
  };

  const toggleJurisdiction = (code: string) => {
    setSelectedJurisdictions(prev =>
      prev.includes(code) ? prev.filter(j => j !== code) : [...prev, code]
    );
  };

  const runSimulation = () => {
    simulate.mutate({
      scenario: scenario.name,
      parameters: { breach_sla_hours: slaHours, penalty_multiplier: penaltyMult, compliance_threshold: threshold },
      durationMonths: duration,
      jurisdictions: selectedJurisdictions,
      iterations,
    });
  };

  const result = simulate.data as Record<string, unknown> | undefined;
  const timeline = (result?.timeline as Array<Record<string, unknown>>) ?? [];
  const impacts = (result?.sector_impacts as Record<string, Record<string, unknown>>) ?? {};
  const recommendations = (result?.recommendations as string[]) ?? [];
  const jurisdictionResults = (result?.jurisdiction_results as Record<string, Record<string, unknown>>) ?? {};
  const economicImpact = result?.economic_impact as Record<string, unknown> | undefined;
  const monteCarloStats = result?.monte_carlo_stats as Record<string, unknown> | undefined;

  const complianceTrend = useMemo(() => {
    if (timeline.length === 0) return null;
    const first = timeline[0].avg_compliance as number;
    const last = timeline[timeline.length - 1].avg_compliance as number;
    return { start: first, end: last, delta: last - first };
  }, [timeline]);

  return (
    <div className="space-y-6">
      {/* Scenario Selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {SCENARIOS.map((s, i) => (
          <Card
            key={s.id}
            className={`cursor-pointer transition-all hover:border-primary/50 ${selectedScenario === i ? "border-primary ring-1 ring-primary/30" : ""}`}
            onClick={() => handleSelectScenario(i)}
          >
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-2">
                {i === 0 ? <Clock className="h-4 w-4 text-blue-400" /> : i === 1 ? <Zap className="h-4 w-4 text-amber-400" /> : <Target className="h-4 w-4 text-red-400" />}
                <span className="font-semibold text-sm">{s.name}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Real-World Context */}
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-sm font-medium text-blue-400 mb-1">Real-World Context</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{scenario.realWorldContext}</p>
        </CardContent>
      </Card>

      {/* Jurisdiction Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Globe className="h-5 w-5" />Jurisdictions</CardTitle>
          <CardDescription>Select which countries to include in the simulation</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(JURISDICTION_NAMES).map(([code, name]) => (
              <Button
                key={code}
                variant={selectedJurisdictions.includes(code) ? "default" : "outline"}
                size="sm"
                onClick={() => toggleJurisdiction(code)}
              >
                {name} ({code})
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Parameter Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Simulation Parameters</CardTitle>
          <CardDescription>Adjust the parameters and run the what-if analysis</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Breach Notification SLA: <span className="text-primary">{slaHours} hours</span></label>
              <Slider value={[slaHours]} onValueChange={(v) => setSlaHours(v[0])} min={6} max={96} step={6} />
              <div className="flex justify-between text-xs text-muted-foreground"><span>6h (strict)</span><span>72h (current NDPA)</span><span>96h (relaxed)</span></div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Penalty Multiplier: <span className="text-primary">{penaltyMult.toFixed(1)}x</span></label>
              <Slider value={[penaltyMult * 10]} onValueChange={(v) => setPenaltyMult(v[0] / 10)} min={5} max={50} step={5} />
              <div className="flex justify-between text-xs text-muted-foreground"><span>0.5x (reduced)</span><span>1x (current)</span><span>5x (severe)</span></div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Compliance Threshold: <span className="text-primary">{threshold}%</span></label>
              <Slider value={[threshold]} onValueChange={(v) => setThreshold(v[0])} min={50} max={95} step={5} />
              <div className="flex justify-between text-xs text-muted-foreground"><span>50% (lenient)</span><span>70% (current)</span><span>95% (strict)</span></div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Simulation Duration: <span className="text-primary">{duration} months</span></label>
              <Slider value={[duration]} onValueChange={(v) => setDuration(v[0])} min={3} max={36} step={3} />
              <div className="flex justify-between text-xs text-muted-foreground"><span>3 months</span><span>12 months</span><span>36 months</span></div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Monte Carlo Iterations: <span className="text-primary">{iterations === 1 ? "Off (deterministic)" : `${iterations} iterations`}</span></label>
              <Slider value={[iterations]} onValueChange={(v) => setIterations(v[0])} min={1} max={1000} step={100} />
              <div className="flex justify-between text-xs text-muted-foreground"><span>1 (single run)</span><span>500</span><span>1000 (full MC)</span></div>
            </div>
          </div>
          <Button onClick={runSimulation} disabled={simulate.isPending} className="w-full" size="lg">
            <Play className="h-4 w-4 mr-2" />
            {simulate.isPending ? "Running Simulation..." : `Run ${iterations > 1 ? "Monte Carlo" : "What-If"} Simulation across ${selectedJurisdictions.length} jurisdiction(s)`}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Compliance Change</p>
                <div className="flex items-center gap-2 mt-1">
                  {complianceTrend && complianceTrend.delta > 0 ? <TrendingUp className="h-5 w-5 text-green-400" /> : <TrendingDown className="h-5 w-5 text-red-400" />}
                  <span className="text-2xl font-bold">{complianceTrend ? (complianceTrend.delta > 0 ? "+" : "") + complianceTrend.delta.toFixed(1) + "%" : "—"}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{complianceTrend ? `${complianceTrend.start.toFixed(1)}% -> ${complianceTrend.end.toFixed(1)}%` : ""}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Penalty Impact</p>
                <p className="text-2xl font-bold mt-1">{formatNGN(result.penalty_delta_ngn as number)}</p>
                <p className="text-xs text-muted-foreground mt-1">Total penalty change</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Breach Change</p>
                <p className="text-2xl font-bold mt-1">{(result.breach_delta_percent as number)?.toFixed(1)}%</p>
                <p className="text-xs text-muted-foreground mt-1">vs baseline rate</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Sim Time</p>
                <p className="text-2xl font-bold mt-1">{result.duration_ms as number ?? 0}ms</p>
                <p className="text-xs text-muted-foreground mt-1">{result.type as string} / {(result.jurisdictions as string[])?.join(", ")}</p>
              </CardContent>
            </Card>
          </div>

          {/* Monte Carlo Stats */}
          {monteCarloStats && (
            <Card className="border-purple-500/20">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Layers className="h-5 w-5 text-purple-400" />Monte Carlo Results ({(monteCarloStats.iterations as number)} iterations)</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric</TableHead>
                      <TableHead>P5 (pessimistic)</TableHead>
                      <TableHead>P25</TableHead>
                      <TableHead>P50 (median)</TableHead>
                      <TableHead>P75</TableHead>
                      <TableHead>P95 (optimistic)</TableHead>
                      <TableHead>Mean</TableHead>
                      <TableHead>Std Dev</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries((monteCarloStats.metrics as Record<string, Record<string, number>>) ?? {}).map(([metric, ci]) => (
                      <TableRow key={metric}>
                        <TableCell className="font-medium">{metric.replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-red-400">{ci.p5?.toFixed(2)}</TableCell>
                        <TableCell>{ci.p25?.toFixed(2)}</TableCell>
                        <TableCell className="font-semibold">{ci.p50?.toFixed(2)}</TableCell>
                        <TableCell>{ci.p75?.toFixed(2)}</TableCell>
                        <TableCell className="text-green-400">{ci.p95?.toFixed(2)}</TableCell>
                        <TableCell>{ci.mean?.toFixed(2)}</TableCell>
                        <TableCell className="text-muted-foreground">{ci.std_dev?.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Economic Impact */}
          {economicImpact && (
            <Card className="border-green-500/20">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><DollarSign className="h-5 w-5 text-green-400" />Economic Impact Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-3 bg-green-500/5 rounded-lg">
                    <p className="text-xs text-muted-foreground">GDP Impact</p>
                    <p className="text-xl font-bold text-green-400">{(economicImpact.gdp_impact_pct as number)?.toFixed(3)}%</p>
                  </div>
                  <div className="text-center p-3 bg-blue-500/5 rounded-lg">
                    <p className="text-xs text-muted-foreground">FDI Confidence</p>
                    <p className="text-xl font-bold text-blue-400">+{(economicImpact.fdi_confidence_change as number)?.toFixed(1)}%</p>
                  </div>
                  <div className="text-center p-3 bg-purple-500/5 rounded-lg">
                    <p className="text-xs text-muted-foreground">Insurance Costs</p>
                    <p className="text-xl font-bold text-purple-400">{(economicImpact.insurance_cost_change_idx as number)?.toFixed(1)}%</p>
                  </div>
                  <div className="text-center p-3 bg-amber-500/5 rounded-lg">
                    <p className="text-xs text-muted-foreground">Net Benefit</p>
                    <p className="text-xl font-bold text-amber-400">${(economicImpact.net_economic_benefit_millions_usd as number)?.toFixed(1)}M</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Jurisdiction Comparison */}
          {Object.keys(jurisdictionResults).length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><GitCompare className="h-5 w-5" />Cross-Jurisdiction Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Jurisdiction</TableHead>
                      <TableHead>Compliance Delta</TableHead>
                      <TableHead>Breach Delta</TableHead>
                      <TableHead>Penalty Delta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(jurisdictionResults).map(([code, jr]) => (
                      <TableRow key={code}>
                        <TableCell className="font-medium">{JURISDICTION_NAMES[code] ?? code}</TableCell>
                        <TableCell className={(jr.compliance_delta as number) > 0 ? "text-green-400" : "text-red-400"}>
                          {(jr.compliance_delta as number) > 0 ? "+" : ""}{(jr.compliance_delta as number)?.toFixed(1)}%
                        </TableCell>
                        <TableCell className={(jr.breach_delta_percent as number) < 0 ? "text-green-400" : "text-red-400"}>
                          {(jr.breach_delta_percent as number)?.toFixed(1)}%
                        </TableCell>
                        <TableCell>{formatNGN(jr.penalty_delta_local as number)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Monthly Timeline</CardTitle>
              <CardDescription>Projected compliance, breaches, and economic indicators month-by-month</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Avg Compliance</TableHead>
                    <TableHead>Breaches</TableHead>
                    <TableHead>Penalties</TableHead>
                    <TableHead>FDI Confidence</TableHead>
                    <TableHead>Insurance Idx</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timeline.map((t, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">Month {t.month as number}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={t.avg_compliance as number} className="h-1.5 w-16" />
                          <span>{(t.avg_compliance as number).toFixed(1)}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={((t.breach_count as number) > 20) ? "destructive" : "secondary"}>
                          {t.breach_count as number}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatNGN(t.total_penalties_ngn as number)}</TableCell>
                      <TableCell>{(t.fdi_confidence as number)?.toFixed(1) ?? "—"}</TableCell>
                      <TableCell>{(t.insurance_cost_idx as number)?.toFixed(1) ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Sector Impacts */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Sector-by-Sector Impact Analysis</CardTitle>
              <CardDescription>How each sector is affected by the policy change</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(impacts).map(([name, impact]) => (
                  <Card key={name} className="bg-card/50">
                    <CardContent className="pt-4 pb-3 px-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-semibold">{name}</span>
                        {riskBadge(impact.risk_level as string)}
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Compliance Delta</span>
                          <span className={((impact.compliance_delta as number) > 0) ? "text-green-400" : "text-red-400"}>
                            {(impact.compliance_delta as number) > 0 ? "+" : ""}{(impact.compliance_delta as number).toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Penalty Delta</span>
                          <span>{formatNGN(impact.penalty_delta_ngn as number)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Breach Delta</span>
                          <span className={((impact.breach_delta_percent as number) < 0) ? "text-green-400" : "text-red-400"}>
                            {(impact.breach_delta_percent as number).toFixed(1)}%
                          </span>
                        </div>
                        {(impact.cost_benefit_ratio as number) > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Cost-Benefit</span>
                            <span className="text-blue-400">{(impact.cost_benefit_ratio as number).toFixed(1)}x ROI</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <Card className="border-amber-500/20">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-400" />AI Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-amber-400 mt-0.5">-</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ── Breach Predictions Tab ──────────────────────────────────────────────────

function PredictionsTab() {
  const predictions = trpc.platformIntelligence.twinPredictBreaches.useQuery();
  const d = predictions.data as Record<string, unknown> | undefined;
  const list = (d?.predictions as Array<Record<string, unknown>>) ?? [];

  const sortedByRisk = useMemo(() => {
    return [...list].sort((a, b) => (b.probability_30d as number) - (a.probability_30d as number));
  }, [list]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="h-5 w-5" />Breach Probability Predictions</CardTitle>
          <CardDescription>ML-generated risk forecast for the next 30 and 90 days across {list.length} organizations. Model: {d?.model_source as string ?? "heuristic_v2"}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>30-Day Risk</TableHead>
                <TableHead>90-Day Risk</TableHead>
                <TableHead>Top Risk Factors</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedByRisk.slice(0, 20).map((p, i) => {
                const p30 = p.probability_30d as number;
                const p90 = p.probability_90d as number;
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{p.org_name as string}</TableCell>
                    <TableCell><Badge variant="outline">{p.sector as string}</Badge></TableCell>
                    <TableCell><Badge variant="secondary" className="text-xs">{(p.jurisdiction as string) ?? "NG"}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={p30} className={`h-1.5 w-12 ${p30 > 5 ? "[&>div]:bg-red-500" : p30 > 2 ? "[&>div]:bg-amber-500" : "[&>div]:bg-green-500"}`} />
                        <span className={`text-sm font-medium ${p30 > 5 ? "text-red-400" : p30 > 2 ? "text-amber-400" : "text-green-400"}`}>{p30.toFixed(1)}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={p90} className={`h-1.5 w-12 ${p90 > 10 ? "[&>div]:bg-red-500" : p90 > 5 ? "[&>div]:bg-amber-500" : "[&>div]:bg-green-500"}`} />
                        <span className="text-sm">{p90.toFixed(1)}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {(p.top_risk_factors as string[])?.slice(0, 2).map((rf, j) => (
                          <Badge key={j} variant="secondary" className="text-xs">{rf}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs ${(p.recommended_action as string).includes("Immediate") || (p.recommended_action as string).includes("CRITICAL") ? "text-red-400 font-medium" : (p.recommended_action as string).includes("Schedule") ? "text-amber-400" : "text-muted-foreground"}`}>
                        {p.recommended_action as string}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Policy Engine Tab ───────────────────────────────────────────────────────

function PolicyEngineTab() {
  const policies = trpc.platformIntelligence.twinPolicies.useQuery();
  const compose = trpc.platformIntelligence.twinPolicyCompose.useMutation();
  const [selectedPolicies, setSelectedPolicies] = useState<number[]>([]);

  const d = policies.data as Record<string, unknown> | undefined;
  const policyList = (d?.policies as Array<Record<string, unknown>>) ?? [];

  const togglePolicy = (id: number) => {
    setSelectedPolicies(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const composeResult = compose.data as Record<string, unknown> | undefined;
  const conflicts = (composeResult?.conflicts as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Scale className="h-5 w-5" />Policy Registry</CardTitle>
          <CardDescription>Select policies to compose and detect conflicts. {policyList.length} policies across multiple jurisdictions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {policyList.map((p, i) => (
              <Card
                key={i}
                className={`cursor-pointer transition-all ${selectedPolicies.includes(p.id as number) ? "border-primary ring-1 ring-primary/30" : "hover:border-primary/30"}`}
                onClick={() => togglePolicy(p.id as number)}
              >
                <CardContent className="pt-3 pb-2 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{p.jurisdiction as string}</Badge>
                      <span className="font-medium text-sm">{p.name as string}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs ${(p.status as string) === "enforced" ? "bg-green-500/20 text-green-400" : (p.status as string) === "proposed" ? "bg-amber-500/20 text-amber-400" : "bg-muted text-muted-foreground"}`}>
                        {p.status as string}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">{p.category as string}</Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Code: {p.code as string} | Effective: {p.effective_date as string || "TBD"}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          {selectedPolicies.length >= 2 && (
            <Button
              className="mt-4 w-full"
              onClick={() => compose.mutate({ policyIds: selectedPolicies })}
              disabled={compose.isPending}
            >
              <Layers className="h-4 w-4 mr-2" />
              {compose.isPending ? "Analyzing..." : `Compose ${selectedPolicies.length} Policies & Detect Conflicts`}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <Card className="border-red-500/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-400" />Policy Conflicts Detected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {conflicts.map((c, i) => (
                <Card key={i} className="bg-red-500/5">
                  <CardContent className="pt-3 pb-2 px-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="bg-red-500/20 text-red-400 text-xs">{c.conflict_type as string}</Badge>
                      <span className="font-medium text-sm">{c.policy_a as string} vs {c.policy_b as string}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{c.description as string}</p>
                    <p className="text-sm text-green-400 mt-1">Resolution: {c.resolution as string}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Counterfactual Analysis Tab ─────────────────────────────────────────────

function CounterfactualTab() {
  const [scenario, setScenario] = useState("What if Nigeria had adopted GDPR in 2020?");
  const [sla, setSla] = useState(72);
  const [penalty, setPenalty] = useState(2.0);
  const [duration, setDuration] = useState(24);
  const [jurisdictions, setJurisdictions] = useState<string[]>(["NG"]);
  const counterfactual = trpc.platformIntelligence.twinCounterfactual.useMutation();

  const result = counterfactual.data as Record<string, Record<string, unknown>> | undefined;
  const actual = result?.actual;
  const cf = result?.counterfactual;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><GitCompare className="h-5 w-5" />Counterfactual Analysis</CardTitle>
          <CardDescription>Compare actual outcomes vs hypothetical: "What would have happened if...?"</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Scenario Description</label>
            <input
              className="w-full px-3 py-2 bg-background border rounded-md text-sm"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Breach SLA: {sla}h</label>
              <Slider value={[sla]} onValueChange={(v) => setSla(v[0])} min={6} max={168} step={6} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Penalty Mult: {penalty.toFixed(1)}x</label>
              <Slider value={[penalty * 10]} onValueChange={(v) => setPenalty(v[0] / 10)} min={5} max={50} step={5} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Duration: {duration} months</label>
              <Slider value={[duration]} onValueChange={(v) => setDuration(v[0])} min={6} max={60} step={6} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(JURISDICTION_NAMES).slice(0, 5).map(([code, name]) => (
              <Button
                key={code}
                variant={jurisdictions.includes(code) ? "default" : "outline"}
                size="sm"
                onClick={() => setJurisdictions(prev => prev.includes(code) ? prev.filter(j => j !== code) : [...prev, code])}
              >
                {name}
              </Button>
            ))}
          </div>
          <Button
            className="w-full"
            onClick={() => counterfactual.mutate({
              scenario, parameters: { breach_sla_hours: sla, penalty_multiplier: penalty, compliance_threshold: 70 },
              durationMonths: duration, jurisdictions,
            })}
            disabled={counterfactual.isPending}
          >
            <GitCompare className="h-4 w-4 mr-2" />
            {counterfactual.isPending ? "Running Analysis..." : "Run Counterfactual Analysis"}
          </Button>
        </CardContent>
      </Card>

      {actual && cf && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Side-by-Side Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>Actual (Baseline)</TableHead>
                  <TableHead>Counterfactual</TableHead>
                  <TableHead>Difference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Compliance Change</TableCell>
                  <TableCell>{(actual.overall_compliance_change as number)?.toFixed(1)}%</TableCell>
                  <TableCell>{(cf.overall_compliance_change as number)?.toFixed(1)}%</TableCell>
                  <TableCell className="text-green-400">
                    {(((cf.overall_compliance_change as number) ?? 0) - ((actual.overall_compliance_change as number) ?? 0)).toFixed(1)}%
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Breach Delta</TableCell>
                  <TableCell>{(actual.breach_delta_percent as number)?.toFixed(1)}%</TableCell>
                  <TableCell>{(cf.breach_delta_percent as number)?.toFixed(1)}%</TableCell>
                  <TableCell className="text-green-400">
                    {(((cf.breach_delta_percent as number) ?? 0) - ((actual.breach_delta_percent as number) ?? 0)).toFixed(1)}%
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Penalty Delta</TableCell>
                  <TableCell>{formatNGN((actual.penalty_delta_ngn as number) ?? 0)}</TableCell>
                  <TableCell>{formatNGN((cf.penalty_delta_ngn as number) ?? 0)}</TableCell>
                  <TableCell>{formatNGN(((cf.penalty_delta_ngn as number) ?? 0) - ((actual.penalty_delta_ngn as number) ?? 0))}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Sandbox Tab ─────────────────────────────────────────────────────────────

function SandboxTab() {
  const sandboxes = trpc.platformIntelligence.twinSandboxes.useQuery();
  const createSandbox = trpc.platformIntelligence.twinSandboxCreate.useMutation();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const d = sandboxes.data as Record<string, unknown> | undefined;
  const list = (d?.sandboxes as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><FlaskConical className="h-5 w-5" />Regulatory Sandbox</CardTitle>
          <CardDescription>Create isolated simulation environments to test policies without affecting production metrics. Each sandbox forks the current state and lets regulators experiment freely.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Sandbox Name</label>
              <input
                className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                placeholder="e.g., ECOWAS Harmonization Test"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <input
                className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                placeholder="Testing ECOWAS-wide breach notification standards..."
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </div>
          </div>
          <Button
            onClick={() => {
              createSandbox.mutate({ name, description: desc });
              setName("");
              setDesc("");
            }}
            disabled={createSandbox.isPending || !name}
          >
            <FlaskConical className="h-4 w-4 mr-2" />
            {createSandbox.isPending ? "Creating..." : "Create Sandbox"}
          </Button>
        </CardContent>
      </Card>

      {list.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Active Sandboxes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {list.map((sb, i) => (
                <Card key={i} className="bg-card/50">
                  <CardContent className="pt-3 pb-2 px-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{sb.name as string}</span>
                      <Badge className={`text-xs ${(sb.status as string) === "active" ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"}`}>
                        {sb.status as string}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{sb.description as string}</p>
                    <p className="text-xs text-muted-foreground">Created: {sb.created_at as string}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {createSandbox.isSuccess && (
        <Card className="border-green-500/20">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-sm text-green-400 font-medium">Sandbox created successfully</p>
            <p className="text-xs text-muted-foreground mt-1">ID: {String((createSandbox.data as Record<string, unknown>)?.sandbox_id ?? "")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Economics Tab ────────────────────────────────────────────────────────────

function EconomicsTab() {
  const [jurisdiction, setJurisdiction] = useState("NG");
  const economics = trpc.platformIntelligence.twinEconomics.useQuery({ jurisdiction });
  const agreements = trpc.platformIntelligence.twinAgreements.useQuery();

  const d = economics.data as Record<string, unknown> | undefined;
  const indicators = (d?.indicators as Array<Record<string, unknown>>) ?? [];
  const agreeData = agreements.data as Record<string, unknown> | undefined;
  const agreeList = (agreeData?.agreements as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {["NG", "GH", "KE", "ZA", "EU"].map(code => (
          <Button
            key={code}
            variant={jurisdiction === code ? "default" : "outline"}
            size="sm"
            onClick={() => setJurisdiction(code)}
          >
            {JURISDICTION_NAMES[code] ?? code}
          </Button>
        ))}
      </div>

      {indicators.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><DollarSign className="h-5 w-5" />Economic Indicators — {JURISDICTION_NAMES[jurisdiction]}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quarter</TableHead>
                  <TableHead>GDP ($B)</TableHead>
                  <TableHead>Digital Economy ($B)</TableHead>
                  <TableHead>FDI Inflow ($B)</TableHead>
                  <TableHead>Insurance Idx</TableHead>
                  <TableHead>Breach Cost Avg ($)</TableHead>
                  <TableHead>Compliance Spending ($M)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {indicators.map((ind, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">Q{ind.quarter as number} {ind.year as number}</TableCell>
                    <TableCell>{(ind.gdp_usd_billions as number)?.toFixed(1)}</TableCell>
                    <TableCell>{(ind.digital_economy_usd_billions as number)?.toFixed(1)}</TableCell>
                    <TableCell>{(ind.fdi_inflow_usd_billions as number)?.toFixed(2)}</TableCell>
                    <TableCell>{(ind.cyber_insurance_premium_idx as number)?.toFixed(1)}</TableCell>
                    <TableCell>${((ind.data_breach_cost_avg_usd as number) / 1000000)?.toFixed(2)}M</TableCell>
                    <TableCell>{(ind.compliance_spending_usd_millions as number)?.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {agreeList.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><Network className="h-5 w-5" />Bilateral Agreements</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Party A</TableHead>
                  <TableHead>Party B</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Impact on Flows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agreeList.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{JURISDICTION_NAMES[a.jurisdiction_a as string] ?? a.jurisdiction_a as string}</TableCell>
                    <TableCell>{JURISDICTION_NAMES[a.jurisdiction_b as string] ?? a.jurisdiction_b as string}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{(a.agreement_type as string).replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${(a.status as string) === "active" ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400"}`}>
                        {a.status as string}
                      </Badge>
                    </TableCell>
                    <TableCell className={(a.impact_on_flows as number) > 0 ? "text-green-400" : ""}>
                      {(a.impact_on_flows as number) > 0 ? "+" : ""}{(a.impact_on_flows as number)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Simulation History Tab ──────────────────────────────────────────────────

function HistoryTab() {
  const history = trpc.platformIntelligence.twinHistory.useQuery();
  const d = history.data as Record<string, unknown> | undefined;
  const sims = (d?.simulations as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Simulation History</CardTitle>
          <CardDescription>Previously run what-if scenarios, Monte Carlo analyses, and counterfactual studies</CardDescription>
        </CardHeader>
        <CardContent>
          {sims.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No simulations run yet. Go to the Scenario Simulator tab to run your first what-if analysis.</p>
          ) : (
            <div className="space-y-4">
              {sims.map((sim, i) => (
                <Card key={i} className="bg-card/50">
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{sim.scenario as string ?? sim.name as string}</span>
                        <Badge variant="secondary" className="text-xs">{sim.type as string}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">{sim.simulated_at as string}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Duration: </span>
                        <span>{sim.duration_months as number} months</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Iterations: </span>
                        <span>{sim.iterations as number ?? 1}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Status: </span>
                        <Badge className="text-xs bg-green-500/20 text-green-400">{sim.status as string}</Badge>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Jurisdictions: </span>
                        <span>{((sim.jurisdictions as string[]) ?? ["NG"]).join(", ")}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function DigitalTwinPage() {
  const [tab, setTab] = useState("ecosystem");

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "NOC", href: "/noc" }, { label: "Digital Twin" }]} className="mb-4" />
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Boxes className="h-8 w-8 text-primary" />
          Digital Twin V2
        </h1>
        <p className="text-muted-foreground mt-1">
          Production-grade multi-government policy simulation engine — model cause-and-effect across 8 jurisdictions, compose policies, run Monte Carlo analyses, and test counterfactual scenarios
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-4 lg:grid-cols-8">
          <TabsTrigger value="ecosystem">Ecosystem</TabsTrigger>
          <TabsTrigger value="simulator">Simulator</TabsTrigger>
          <TabsTrigger value="predictions">Predictions</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="counterfactual">Counterfactual</TabsTrigger>
          <TabsTrigger value="sandbox">Sandbox</TabsTrigger>
          <TabsTrigger value="economics">Economics</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="ecosystem"><EcosystemTab /></TabsContent>
        <TabsContent value="simulator"><SimulatorTab /></TabsContent>
        <TabsContent value="predictions"><PredictionsTab /></TabsContent>
        <TabsContent value="policies"><PolicyEngineTab /></TabsContent>
        <TabsContent value="counterfactual"><CounterfactualTab /></TabsContent>
        <TabsContent value="sandbox"><SandboxTab /></TabsContent>
        <TabsContent value="economics"><EconomicsTab /></TabsContent>
        <TabsContent value="history"><HistoryTab /></TabsContent>
      </Tabs>
    </div>
  );
}
