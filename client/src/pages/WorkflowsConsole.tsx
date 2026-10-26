/**
 * Compliance Workflow Operations Console (round 16, wave 3)
 * ==========================================================
 * Operator console for the `workflows` tRPC router
 * (server/routers/workflows.ts, mounted as `workflows`). Wires all 8
 * procedures:
 *
 *   Lifecycle:  getAvailableActions, executeTransition
 *   NDPA rules: calculatePenalty, calculateComplianceScore, calculateRiskScore,
 *               checkSla, checkRenewalEligibility, checkCrossBorderAdequacy
 *
 * Note: this router fronts the in-process compliance lifecycle engine
 * (server/workflows/complianceLifecycle.ts) and the NDPA business-rules
 * library (server/workflows/businessRules.ts) — not Temporal directly.
 * Temporal workflow definitions/health live under `productionReadiness.*`
 * (see /production-readiness) and live runs under /temporal. Round-12/13
 * scheduled jobs run as Temporal schedules (server/services/round12Schedules,
 * round13Schedules) and are listed in the registry panel for reference.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ArrowRight, Globe, Play, RefreshCw, Scale, ShieldCheck, Timer, Workflow } from "lucide-react";

const wf = trpc.workflows;

/** Mirrors WORKFLOW_MAP keys in server/workflows/complianceLifecycle.ts. */
const ENTITY_TYPES = ["organization", "violation", "breach", "dpia", "dsar"] as const;
/** Mirrors the WorkflowState union in server/workflows/complianceLifecycle.ts. */
const WORKFLOW_STATES = [
  "draft", "submitted", "under_review", "approved", "rejected",
  "investigating", "escalated", "penalty_imposed", "appealed",
  "resolved", "closed", "expired", "suspended",
] as const;

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const DATA_VOLUMES = ["low", "medium", "high", "very_high"] as const;
const SLA_ENTITY_TYPES = ["violation", "breach", "dsar", "appeal"] as const;
const SECTORS = [
  "Banking & Finance", "Fintech", "Healthcare", "Telecommunications",
  "Insurance", "Oil & Gas", "Education", "Manufacturing", "Other",
] as const;

/**
 * Round-12/13 Temporal schedules (workers/temporal/workflows/round12Jobs.ts,
 * round13Jobs.ts — task queue ndsep-main). Reference only: the `workflows`
 * router does not expose schedule CRUD; live runs are under /temporal.
 */
const TEMPORAL_SCHEDULES: Array<{ id: string; job: string; cadence: string }> = [
  { id: "round12-compliance-scan-sweep", job: "compliance_scan_sweep", cadence: "hourly :00" },
  { id: "round12-settlement-default-detection", job: "settlement_default_detection", cadence: "daily 03:05" },
  { id: "round12-fine-reconciliation-batch", job: "fine_reconciliation_batch", cadence: "every 6h" },
  { id: "round12-complaint-surge-sweep", job: "complaint_surge_sweep", cadence: "every 15 min" },
  { id: "round13-hosting-verification-sweep", job: "hosting_verification_sweep", cadence: "daily 04:15" },
  { id: "round13-infrastructure-risk-sweep", job: "infrastructure_risk_sweep", cadence: "every 30 min" },
  { id: "round13-telegram-watch-poll", job: "telegram_watch_poll", cadence: "every 15 min" },
  { id: "round13-osiris-intel-poll", job: "osiris_intel_poll", cadence: "every 15 min" },
];

const URGENCY_STYLES: Record<string, string> = {
  normal: "bg-green-500/20 text-green-300 border-green-500/40",
  warning: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  overdue: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  critical: "bg-red-500/20 text-red-300 border-red-500/40",
};

const RISK_STYLES: Record<string, string> = URGENCY_STYLES;

function ngn(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `₦${n.toLocaleString()}`;
}

export default function WorkflowsConsole() {
  // ── Lifecycle transition explorer ─────────────────────────────────────
  const [entityType, setEntityType] = useState<string>("organization");
  const [entityId, setEntityId] = useState("1");
  const [currentState, setCurrentState] = useState<string>("draft");
  const [metadataJson, setMetadataJson] = useState("");

  const actionsInput = useMemo(
    () => ({ entityType, entityId: Number(entityId) || 0, currentState }),
    [entityType, entityId, currentState],
  );
  const availableActions = wf.getAvailableActions.useQuery(actionsInput, {
    enabled: Number(entityId) > 0,
  });

  const executeTransition = wf.executeTransition.useMutation({
    onSuccess: (r) => {
      if (r?.success) {
        toast.success(`Transition executed: ${currentState} → ${r.newState ?? "?"}.`);
      } else {
        toast.error(r?.error ?? "Transition rejected by the lifecycle engine.");
      }
      availableActions.refetch();
    },
    onError: (e) => toast.error(`Transition failed: ${e.message}`),
  });

  const runTransition = (action: string) => {
    let metadata: Record<string, unknown> | undefined;
    if (metadataJson.trim()) {
      try {
        metadata = JSON.parse(metadataJson);
      } catch {
        toast.error("Metadata is not valid JSON.");
        return;
      }
    }
    executeTransition.mutate({
      entityType,
      entityId: Number(entityId) || 0,
      action,
      ...(metadata ? { metadata } : {}),
    });
  };

  // ── Penalty calculator ────────────────────────────────────────────────
  const [penaltyForm, setPenaltyForm] = useState({
    organizationId: "1",
    violationType: "",
    severity: "medium" as (typeof SEVERITIES)[number],
    affectedRecords: "0",
    isRepeatOffender: false,
    annualTurnover: "",
  });
  const penalty = wf.calculatePenalty.useQuery(
    {
      organizationId: Number(penaltyForm.organizationId) || 0,
      violationType: penaltyForm.violationType || "unspecified",
      severity: penaltyForm.severity,
      affectedRecords: Number(penaltyForm.affectedRecords) || 0,
      isRepeatOffender: penaltyForm.isRepeatOffender,
      ...(penaltyForm.annualTurnover ? { annualTurnover: Number(penaltyForm.annualTurnover) } : {}),
    },
    { enabled: false },
  );

  // ── Compliance score calculator ───────────────────────────────────────
  const [scoreForm, setScoreForm] = useState({
    hasDpo: false,
    hasPrivacyPolicy: false,
    hasConsentMechanism: false,
    hasBreachNotificationProcess: false,
    hasDpia: false,
    hasDataRetentionPolicy: false,
    hasSecurityMeasures: false,
    hasRecordOfProcessing: false,
    openViolations: "0",
    resolvedViolations: "0",
    breachCount: "0",
    lastAuditDate: "",
  });
  const complianceScore = wf.calculateComplianceScore.useQuery(
    {
      hasDpo: scoreForm.hasDpo,
      hasPrivacyPolicy: scoreForm.hasPrivacyPolicy,
      hasConsentMechanism: scoreForm.hasConsentMechanism,
      hasBreachNotificationProcess: scoreForm.hasBreachNotificationProcess,
      hasDpia: scoreForm.hasDpia,
      hasDataRetentionPolicy: scoreForm.hasDataRetentionPolicy,
      hasSecurityMeasures: scoreForm.hasSecurityMeasures,
      hasRecordOfProcessing: scoreForm.hasRecordOfProcessing,
      openViolations: Number(scoreForm.openViolations) || 0,
      resolvedViolations: Number(scoreForm.resolvedViolations) || 0,
      breachCount: Number(scoreForm.breachCount) || 0,
      ...(scoreForm.lastAuditDate ? { lastAuditDate: scoreForm.lastAuditDate } : {}),
    },
    { enabled: false },
  );

  // ── Risk score calculator ─────────────────────────────────────────────
  const [riskForm, setRiskForm] = useState({
    sector: "Other" as string,
    dataVolume: "medium" as (typeof DATA_VOLUMES)[number],
    crossBorderTransfers: false,
    sensitiveData: false,
    automatedDecisions: false,
    previousBreaches: "0",
    complianceScore: "50",
  });
  const riskScore = wf.calculateRiskScore.useQuery(
    {
      sector: riskForm.sector,
      dataVolume: riskForm.dataVolume,
      crossBorderTransfers: riskForm.crossBorderTransfers,
      sensitiveData: riskForm.sensitiveData,
      automatedDecisions: riskForm.automatedDecisions,
      previousBreaches: Number(riskForm.previousBreaches) || 0,
      complianceScore: Number(riskForm.complianceScore) || 0,
    },
    { enabled: false },
  );

  // ── SLA breach check ──────────────────────────────────────────────────
  const [slaForm, setSlaForm] = useState({
    entityType: "violation" as (typeof SLA_ENTITY_TYPES)[number],
    createdAt: new Date(Date.now() - 48 * 3600_000).toISOString().slice(0, 16),
    currentStatus: "submitted",
  });
  const sla = wf.checkSla.useQuery(
    {
      entityType: slaForm.entityType,
      createdAt: new Date(slaForm.createdAt).toISOString(),
      currentStatus: slaForm.currentStatus,
    },
    { enabled: false },
  );

  // ── Renewal eligibility + cross-border adequacy ───────────────────────
  const [renewalOrgId, setRenewalOrgId] = useState("1");
  const renewal = wf.checkRenewalEligibility.useQuery(
    { organizationId: Number(renewalOrgId) || 0 },
    { enabled: false },
  );
  const [country, setCountry] = useState("");
  const adequacy = wf.checkCrossBorderAdequacy.useQuery(
    { destinationCountry: country.trim() },
    { enabled: false },
  );

  const transitionError = executeTransition.error;
  const transitionResult = executeTransition.data;

  const CONTROL_FLAGS: Array<{ key: keyof typeof scoreForm; label: string }> = [
    { key: "hasDpo", label: "DPO appointed" },
    { key: "hasPrivacyPolicy", label: "Privacy policy" },
    { key: "hasConsentMechanism", label: "Consent mechanism" },
    { key: "hasBreachNotificationProcess", label: "Breach notification process" },
    { key: "hasDpia", label: "DPIA completed" },
    { key: "hasDataRetentionPolicy", label: "Data retention policy" },
    { key: "hasSecurityMeasures", label: "Security measures" },
    { key: "hasRecordOfProcessing", label: "Record of processing" },
  ];

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Breadcrumbs items={[{ label: "Workflow Operations" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Workflow className="h-6 w-6" /> Workflow Operations
          </h1>
          <p className="text-muted-foreground text-sm">
            Compliance lifecycle state machines (organization, violation, breach, DPIA, DSAR) and NDPA
            business-rule calculators. Temporal workflow definitions/health: see /production-readiness; live
            runs: /temporal.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => availableActions.refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* ── Schedule registry (reference) ─────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2"><Timer className="h-5 w-5" /> Schedule registry</CardTitle>
          <CardDescription>
            Round-12/13 scheduled jobs dispatched by Temporal (task queue ndsep-main). Reference view — the
            workflows router exposes no schedule CRUD; live run state is on /temporal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Schedule ID</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Cadence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TEMPORAL_SCHEDULES.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.id}</TableCell>
                  <TableCell className="font-mono text-xs">{s.job}</TableCell>
                  <TableCell className="text-sm">{s.cadence}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Lifecycle registry + transition console ───────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Lifecycle transition console</CardTitle>
          <CardDescription>
            State machines registered in the compliance lifecycle engine: organization, violation, breach, dpia,
            dsar. Pick an entity to see the actions available to your role, then execute a transition.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger className="w-44"><SelectValue placeholder="entity type" /></SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="entity id"
              className="w-28 font-mono"
            />
            <Select value={currentState} onValueChange={setCurrentState}>
              <SelectTrigger className="w-44"><SelectValue placeholder="current state" /></SelectTrigger>
              <SelectContent>
                {WORKFLOW_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            placeholder='transition metadata (optional JSON, e.g. {"severity":"high","organizationId":1,"penaltyAmount":5000000})'
            value={metadataJson}
            onChange={(e) => setMetadataJson(e.target.value)}
            rows={2}
            className="font-mono text-xs"
          />

          {availableActions.error && (
            <div className="text-sm text-red-300">Failed to load available actions: {availableActions.error.message}</div>
          )}
          <div className="space-y-2">
            <div className="text-sm font-semibold">Available actions</div>
            {(availableActions.data ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {availableActions.isLoading ? "Loading…" : "No actions available for this role from this state."}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(availableActions.data ?? []).map((a) => (
                  <Button
                    key={a}
                    size="sm"
                    variant="outline"
                    disabled={executeTransition.isPending}
                    onClick={() => runTransition(a)}
                  >
                    <Play className="h-3 w-3 mr-1" /> {a}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {transitionResult && (
            <div className={`rounded border p-3 text-sm space-y-1 ${transitionResult.success ? "border-green-500/40" : "border-red-500/60"}`}>
              <div className="flex items-center gap-2">
                {transitionResult.success ? (
                  <Badge className="bg-green-500/20 text-green-300 border-green-500/40">success</Badge>
                ) : (
                  <Badge className="bg-red-500/20 text-red-300 border-red-500/40">rejected</Badge>
                )}
                {transitionResult.success && transitionResult.newState && (
                  <span className="font-mono text-xs flex items-center gap-1">
                    {currentState} <ArrowRight className="h-3 w-3" /> {transitionResult.newState}
                  </span>
                )}
              </div>
              {transitionResult.error && <div className="text-red-300 text-xs">{transitionResult.error}</div>}
            </div>
          )}
          {transitionError && (
            <div className="text-sm text-red-300">Transition error: {transitionError.message}</div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="penalty">
        <TabsList>
          <TabsTrigger value="penalty"><Scale className="h-4 w-4 mr-1" /> Penalty</TabsTrigger>
          <TabsTrigger value="compliance"><ShieldCheck className="h-4 w-4 mr-1" /> Compliance score</TabsTrigger>
          <TabsTrigger value="risk">Risk score</TabsTrigger>
          <TabsTrigger value="sla"><Timer className="h-4 w-4 mr-1" /> SLA</TabsTrigger>
          <TabsTrigger value="eligibility"><Globe className="h-4 w-4 mr-1" /> Eligibility &amp; adequacy</TabsTrigger>
        </TabsList>

        {/* ── Penalty ─────────────────────────────────────────────────── */}
        <TabsContent value="penalty">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Penalty calculator</CardTitle>
              <CardDescription>NDPA Article 47 — administrative penalties. Severity base × records multiplier × repeat-offender surcharge; capped at 2% of annual turnover.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <Input value={penaltyForm.organizationId} onChange={(e) => setPenaltyForm({ ...penaltyForm, organizationId: e.target.value.replace(/[^0-9]/g, "") })} placeholder="organization id" className="w-36 font-mono" />
                <Input value={penaltyForm.violationType} onChange={(e) => setPenaltyForm({ ...penaltyForm, violationType: e.target.value })} placeholder="violation type" className="w-48" />
                <Select value={penaltyForm.severity} onValueChange={(v) => setPenaltyForm({ ...penaltyForm, severity: v as typeof penaltyForm.severity })}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Input value={penaltyForm.affectedRecords} onChange={(e) => setPenaltyForm({ ...penaltyForm, affectedRecords: e.target.value.replace(/[^0-9]/g, "") })} placeholder="affected records" className="w-36 font-mono" />
                <Input value={penaltyForm.annualTurnover} onChange={(e) => setPenaltyForm({ ...penaltyForm, annualTurnover: e.target.value.replace(/[^0-9]/g, "") })} placeholder="annual turnover (opt)" className="w-44 font-mono" />
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={penaltyForm.isRepeatOffender} onCheckedChange={(c) => setPenaltyForm({ ...penaltyForm, isRepeatOffender: c === true })} />
                  Repeat offender (+50%)
                </label>
                <Button size="sm" disabled={penalty.isFetching} onClick={() => penalty.refetch()}>Calculate</Button>
              </div>
              {penalty.data && (
                <div className="rounded border border-border p-3 text-sm space-y-1">
                  <div className="text-xl font-bold font-mono">{ngn(penalty.data.totalAmount)} <span className="text-xs font-normal text-muted-foreground">{penalty.data.currency}</span></div>
                  <div className="text-xs text-muted-foreground font-mono">{penalty.data.formula}</div>
                  <div className="text-xs text-muted-foreground">{penalty.data.ndpaReference}</div>
                </div>
              )}
              {penalty.error && <div className="text-sm text-red-300">{penalty.error.message}</div>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Compliance score ────────────────────────────────────────── */}
        <TabsContent value="compliance">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Compliance score calculator</CardTitle>
              <CardDescription>Control checklist + violation/breach history → 0–100 score with letter grade.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-4">
                {CONTROL_FLAGS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={scoreForm[c.key] as boolean}
                      onCheckedChange={(v) => setScoreForm({ ...scoreForm, [c.key]: v === true })}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Input value={scoreForm.openViolations} onChange={(e) => setScoreForm({ ...scoreForm, openViolations: e.target.value.replace(/[^0-9]/g, "") })} placeholder="open violations" className="w-36 font-mono" />
                <Input value={scoreForm.resolvedViolations} onChange={(e) => setScoreForm({ ...scoreForm, resolvedViolations: e.target.value.replace(/[^0-9]/g, "") })} placeholder="resolved violations" className="w-40 font-mono" />
                <Input value={scoreForm.breachCount} onChange={(e) => setScoreForm({ ...scoreForm, breachCount: e.target.value.replace(/[^0-9]/g, "") })} placeholder="breach count" className="w-32 font-mono" />
                <Input type="datetime-local" value={scoreForm.lastAuditDate} onChange={(e) => setScoreForm({ ...scoreForm, lastAuditDate: e.target.value })} className="w-56" />
                <Button size="sm" disabled={complianceScore.isFetching} onClick={() => complianceScore.refetch()}>Calculate</Button>
              </div>
              {complianceScore.data && (
                <div className="rounded border border-border p-3 text-sm space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold font-mono">{complianceScore.data.score}/100</span>
                    <Badge className={complianceScore.data.grade === "A" || complianceScore.data.grade === "B" ? "bg-green-500/20 text-green-300 border-green-500/40" : "bg-orange-500/20 text-orange-300 border-orange-500/40"}>
                      Grade {complianceScore.data.grade}
                    </Badge>
                  </div>
                  <Progress value={complianceScore.data.score} />
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Category</TableHead><TableHead>Score</TableHead><TableHead>Status</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {(complianceScore.data.breakdown ?? []).map((b) => (
                        <TableRow key={b.category}>
                          <TableCell className="text-sm">{b.category}</TableCell>
                          <TableCell className="font-mono text-xs">{b.score}/{b.maxScore}</TableCell>
                          <TableCell className="text-xs">{b.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {complianceScore.error && <div className="text-sm text-red-300">{complianceScore.error.message}</div>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Risk score ──────────────────────────────────────────────── */}
        <TabsContent value="risk">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Risk score calculator</CardTitle>
              <CardDescription>Sector, data volume, transfer/processing characteristics and compliance gap → normalized risk score.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <Select value={riskForm.sector} onValueChange={(v) => setRiskForm({ ...riskForm, sector: v })}>
                  <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>{SECTORS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={riskForm.dataVolume} onValueChange={(v) => setRiskForm({ ...riskForm, dataVolume: v as typeof riskForm.dataVolume })}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{DATA_VOLUMES.map((v) => <SelectItem key={v} value={v}>{v.replace("_", " ")}</SelectItem>)}</SelectContent>
                </Select>
                <Input value={riskForm.previousBreaches} onChange={(e) => setRiskForm({ ...riskForm, previousBreaches: e.target.value.replace(/[^0-9]/g, "") })} placeholder="previous breaches" className="w-40 font-mono" />
                <Input value={riskForm.complianceScore} onChange={(e) => setRiskForm({ ...riskForm, complianceScore: e.target.value.replace(/[^0-9]/g, "") })} placeholder="compliance score" className="w-40 font-mono" />
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><Checkbox checked={riskForm.crossBorderTransfers} onCheckedChange={(c) => setRiskForm({ ...riskForm, crossBorderTransfers: c === true })} /> Cross-border transfers</label>
                <label className="flex items-center gap-2"><Checkbox checked={riskForm.sensitiveData} onCheckedChange={(c) => setRiskForm({ ...riskForm, sensitiveData: c === true })} /> Sensitive data</label>
                <label className="flex items-center gap-2"><Checkbox checked={riskForm.automatedDecisions} onCheckedChange={(c) => setRiskForm({ ...riskForm, automatedDecisions: c === true })} /> Automated decisions</label>
                <Button size="sm" disabled={riskScore.isFetching} onClick={() => riskScore.refetch()}>Calculate</Button>
              </div>
              {riskScore.data && (
                <div className="rounded border border-border p-3 text-sm space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold font-mono">{riskScore.data.score}/100</span>
                    <Badge className={RISK_STYLES[riskScore.data.level] ?? ""}>{riskScore.data.level} risk</Badge>
                  </div>
                  <Progress value={riskScore.data.score} />
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Factor</TableHead><TableHead>Impact</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {(riskScore.data.factors ?? []).map((f) => (
                        <TableRow key={f.factor}>
                          <TableCell className="text-sm">{f.factor}</TableCell>
                          <TableCell className="font-mono text-xs">{f.impact}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {riskScore.error && <div className="text-sm text-red-300">{riskScore.error.message}</div>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SLA ─────────────────────────────────────────────────────── */}
        <TabsContent value="sla">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">SLA breach check</CardTitle>
              <CardDescription>Statutory response deadlines per entity type and status (violation 3d/30d, breach 24h/7d, DSAR 2d/30d, appeal 5d/90d).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <Select value={slaForm.entityType} onValueChange={(v) => setSlaForm({ ...slaForm, entityType: v as typeof slaForm.entityType })}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{SLA_ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="datetime-local" value={slaForm.createdAt} onChange={(e) => setSlaForm({ ...slaForm, createdAt: e.target.value })} className="w-56" />
                <Select value={slaForm.currentStatus} onValueChange={(v) => setSlaForm({ ...slaForm, currentStatus: v })}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>{WORKFLOW_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" disabled={sla.isFetching} onClick={() => sla.refetch()}>Check SLA</Button>
              </div>
              {sla.data && (
                <div className="rounded border border-border p-3 text-sm space-y-1">
                  <div className="flex items-center gap-3">
                    {sla.data.breached
                      ? <Badge className="bg-red-500/20 text-red-300 border-red-500/40">SLA BREACHED</Badge>
                      : <Badge className="bg-green-500/20 text-green-300 border-green-500/40">within SLA</Badge>}
                    <Badge className={URGENCY_STYLES[sla.data.urgency] ?? ""}>{sla.data.urgency}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{sla.data.hoursElapsed}h elapsed of {sla.data.slaHours}h deadline.</div>
                  <Progress value={Math.min(100, (sla.data.hoursElapsed / Math.max(1, sla.data.slaHours)) * 100)} />
                </div>
              )}
              {sla.error && <div className="text-sm text-red-300">{sla.error.message}</div>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Renewal eligibility + adequacy ──────────────────────────── */}
        <TabsContent value="eligibility" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">DPCO licence renewal eligibility</CardTitle>
              <CardDescription>Checks outstanding violations/penalties and DPIA requirements for an organization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <Input value={renewalOrgId} onChange={(e) => setRenewalOrgId(e.target.value.replace(/[^0-9]/g, ""))} placeholder="organization id" className="w-40 font-mono" />
                <Button size="sm" disabled={renewal.isFetching || !renewalOrgId} onClick={() => renewal.refetch()}>Check eligibility</Button>
              </div>
              {renewal.data && (
                <div className="rounded border border-border p-3 text-sm space-y-1">
                  <div className="flex items-center gap-3">
                    {renewal.data.eligible
                      ? <Badge className="bg-green-500/20 text-green-300 border-green-500/40">eligible</Badge>
                      : <Badge className="bg-red-500/20 text-red-300 border-red-500/40">not eligible</Badge>}
                    <span className="text-xs text-muted-foreground">
                      outstanding penalties: {renewal.data.outstandingPenalties} · requires DPIA: {String(renewal.data.requiresDpia)}
                    </span>
                  </div>
                  {(renewal.data.reasons ?? []).length > 0 && (
                    <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
                      {(renewal.data.reasons ?? []).map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {renewal.error && <div className="text-sm text-red-300">{renewal.error.message}</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Cross-border transfer adequacy</CardTitle>
              <CardDescription>NDPA Article 28 — is the destination country on the NDPC adequacy list, and which safeguards apply if not.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="destination country" className="w-56" />
                <Button size="sm" disabled={adequacy.isFetching || !country.trim()} onClick={() => adequacy.refetch()}>Check adequacy</Button>
              </div>
              {adequacy.data && (
                <div className="rounded border border-border p-3 text-sm space-y-1">
                  {adequacy.data.adequate
                    ? <Badge className="bg-green-500/20 text-green-300 border-green-500/40">adequate — standard transfer permitted</Badge>
                    : <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/40">not adequate — safeguards required</Badge>}
                  <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5 pt-1">
                    {(adequacy.data.safeguards ?? []).map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                  <div className="text-xs text-muted-foreground">{adequacy.data.ndpaReference}</div>
                </div>
              )}
              {adequacy.error && <div className="text-sm text-red-300">{adequacy.error.message}</div>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
