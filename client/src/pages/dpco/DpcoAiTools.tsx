import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, FileText, TrendingUp, Loader2, CheckCircle, AlertTriangle, XCircle, Minus, Sparkles, Copy, RefreshCw } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SubscriptionGate } from "@/components/SubscriptionGate";

const RATING_CONFIG: Record<string, { label: string; color: string; icon: any; iconColor: string }> = {
  compliant: { label: "Compliant", color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", icon: CheckCircle, iconColor: "text-emerald-600" },
  partially_compliant: { label: "Partial", color: "bg-amber-500/20 text-amber-300 border-amber-500/30", icon: AlertTriangle, iconColor: "text-amber-400" },
  non_compliant: { label: "Non-Compliant", color: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30", icon: XCircle, iconColor: "text-red-600" },
  not_applicable: { label: "N/A", color: "bg-muted-foreground/20 text-muted-foreground border-border", icon: Minus, iconColor: "text-muted-foreground" },
};

const RISK_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  low: { label: "Low Risk", color: "text-emerald-600", bg: "bg-emerald-500/10 border-emerald-500/20" },
  medium: { label: "Medium Risk", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  high: { label: "High Risk", color: "text-orange-600", bg: "bg-orange-500/10 border-orange-500/20" },
  critical: { label: "Critical Risk", color: "text-red-600", bg: "bg-red-500/10 border-red-500/20" },
};

const ALL_CONTROLS = ["C01","C02","C03","C04","C05","C06","C07","C08","C09","C10","C11","C12","C13","C14","C15"];

function DpcoAiToolsInner() {
  const [gapEngagementId, setGapEngagementId] = useState("");
  const [gapOrgName, setGapOrgName] = useState("");
  const [gapSector, setGapSector] = useState("");
  const [gapEvidenceText, setGapEvidenceText] = useState("");

  const [carEngagementId, setCarEngagementId] = useState("");
  const [carOrgName, setCarOrgName] = useState("");
  const [carSector, setCarSector] = useState("");
  const [carAuditPeriod, setCarAuditPeriod] = useState("");
  const [carAuditorName, setCarAuditorName] = useState("");
  const [carDpcoName, setCarDpcoName] = useState("");
  const [carScore, setCarScore] = useState("75");
  const [carRatings, setCarRatings] = useState<Array<{ controlId: string; rating: string; notes?: string }>>([]);

  const [riskOrgId, setRiskOrgId] = useState("");
  const [riskOrgName, setRiskOrgName] = useState("");
  const [riskSector, setRiskSector] = useState("");
  const [riskLastScore, setRiskLastScore] = useState("");
  const [riskDaysSince, setRiskDaysSince] = useState("");
  const [riskOpenFindings, setRiskOpenFindings] = useState("");
  const [riskBreachCount, setRiskBreachCount] = useState("");

  const gapMutation = trpc.dpcoAi.runGapAnalysis.useMutation({
    onSuccess: () => toast.success("AI Gap Analysis complete"),
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const carMutation = trpc.dpcoAi.generateCarNarrative.useMutation({
    onSuccess: () => toast.success("CAR Narrative generated"),
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const riskMutation = trpc.dpcoAi.predictClientRisk.useMutation({
    onSuccess: () => toast.success("Risk prediction complete"),
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); toast.success("Copied"); };

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <Breadcrumbs items={[{ label: "DPCO Portal", href: "/dpco" }, { label: "AI Audit Tools" }]} />

      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background/60">
        <div className="w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
          <Brain className="w-4 h-4 text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI Audit Tools</h1>
          <p className="text-xs text-muted-foreground">NDPA 2023 · Powered by NDSEP Intelligence Engine</p>
        </div>
        <Badge className="ml-auto bg-violet-500/20 text-violet-300 border-violet-500/30 text-xs">
          <Sparkles className="w-3 h-3 mr-1" /> AI-Powered
        </Badge>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <Tabs defaultValue="gap" className="h-full">
          <TabsList className="w-full rounded-none border-b border-border bg-muted/30 h-10 px-4 justify-start gap-1">
            <TabsTrigger value="gap" className="text-xs data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-300">
              <Brain className="w-3 h-3 mr-1.5" /> Gap Analysis
            </TabsTrigger>
            <TabsTrigger value="car" className="text-xs data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-300">
              <FileText className="w-3 h-3 mr-1.5" /> CAR Narrative
            </TabsTrigger>
            <TabsTrigger value="risk" className="text-xs data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-300">
              <TrendingUp className="w-3 h-3 mr-1.5" /> Risk Prediction
            </TabsTrigger>
          </TabsList>

          <TabsContent value="gap" className="p-6 space-y-5 mt-0">
            <div className="bg-background/60 border border-border rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                <Brain className="w-4 h-4 text-violet-400" /> AI-Powered Gap Analysis
              </h2>
              <p className="text-xs text-muted-foreground">Paste evidence document text. The AI assesses all 15 NDPA 2023 controls and generates a pre-filled rating sheet.</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Engagement ID</Label>
                  <Input value={gapEngagementId} onChange={e => setGapEngagementId(e.target.value)} placeholder="e.g. 42" className="h-8 text-xs bg-card border-border" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Organisation Name</Label>
                  <Input value={gapOrgName} onChange={e => setGapOrgName(e.target.value)} placeholder="e.g. MTN Nigeria" className="h-8 text-xs bg-card border-border" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Sector</Label>
                  <Input value={gapSector} onChange={e => setGapSector(e.target.value)} placeholder="e.g. Telecommunications" className="h-8 text-xs bg-card border-border" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Evidence Text</Label>
                <Textarea value={gapEvidenceText} onChange={e => setGapEvidenceText(e.target.value)}
                  placeholder="Paste privacy policy, ROPA, training records, DPA agreements, breach procedures..."
                  className="min-h-[140px] text-xs bg-card border-border resize-none" />
                <p className="text-xs text-muted-foreground">{gapEvidenceText.length.toLocaleString()} / 50,000 chars</p>
              </div>
              <Button onClick={() => gapMutation.mutate({ engagementId: parseInt(gapEngagementId)||0, organisationName: gapOrgName, sector: gapSector, evidenceText: gapEvidenceText })}
                disabled={gapMutation.isPending || !gapEvidenceText || !gapOrgName}
                className="bg-violet-600 hover:bg-violet-500 text-white text-xs h-8">
                {gapMutation.isPending ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Analysing...</> : <><Sparkles className="w-3 h-3 mr-1.5" />Run AI Gap Analysis</>}
              </Button>
            </div>
            {gapMutation.data && (
              <div className="space-y-3">
                <div className="bg-background/60 border border-violet-500/20 rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Overall Score</p>
                    <p className={`text-3xl font-bold ${gapMutation.data.overallScore >= 70 ? "text-emerald-600" : gapMutation.data.overallScore >= 50 ? "text-amber-400" : "text-red-600"}`}>
                      {gapMutation.data.overallScore.toFixed(0)}<span className="text-sm text-muted-foreground">/100</span>
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground max-w-md">{gapMutation.data.executiveSummary}</p>
                </div>
                <div className="space-y-2">
                  {gapMutation.data.ratings.map((r: any) => {
                    const cfg = RATING_CONFIG[r.rating] || RATING_CONFIG.not_applicable;
                    const Icon = cfg.icon;
                    return (
                      <div key={r.controlId} className="bg-background/60 border border-border rounded-lg p-3 flex gap-3">
                        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.iconColor}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-muted-foreground">{r.controlId}</span>
                            <Badge className={`text-[10px] px-1.5 py-0 border ${cfg.color}`}>{cfg.label}</Badge>
                            <span className="text-xs text-muted-foreground ml-auto">Confidence: {(r.confidence*100).toFixed(0)}%</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{r.rationale}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="car" className="p-6 space-y-5 mt-0">
            <div className="bg-background/60 border border-border rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                <FileText className="w-4 h-4 text-violet-400" /> CAR Narrative Generator
              </h2>
              <p className="text-xs text-muted-foreground">Generate a complete NDPC-ready Compliance Audit Return narrative from control ratings.</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Engagement ID", val: carEngagementId, set: setCarEngagementId, ph: "e.g. 42" },
                  { label: "Organisation Name", val: carOrgName, set: setCarOrgName, ph: "e.g. MTN Nigeria" },
                  { label: "Sector", val: carSector, set: setCarSector, ph: "e.g. Telecoms" },
                  { label: "Audit Period", val: carAuditPeriod, set: setCarAuditPeriod, ph: "Jan 2025 – Dec 2025" },
                  { label: "Lead Auditor", val: carAuditorName, set: setCarAuditorName, ph: "e.g. Adaeze Okonkwo" },
                  { label: "DPCO Name", val: carDpcoName, set: setCarDpcoName, ph: "e.g. DataGuard Ltd" },
                  { label: "Compliance Score (0–100)", val: carScore, set: setCarScore, ph: "75" },
                ].map(f => (
                  <div key={f.label} className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">{f.label}</Label>
                    <Input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph} className="h-8 text-xs bg-card border-border" />
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Control Ratings ({carRatings.length}/15)</Label>
                  <Button variant="ghost" size="sm" onClick={() => setCarRatings(ALL_CONTROLS.map(id => ({ controlId: id, rating: "not_applicable", notes: "" })))}
                    className="text-xs h-6 text-violet-400 hover:text-violet-300">
                    <RefreshCw className="w-3 h-3 mr-1" /> Load All 15
                  </Button>
                </div>
                {carRatings.length > 0 && (
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                    {carRatings.map((r, i) => (
                      <div key={r.controlId} className="flex items-center gap-2 bg-card rounded px-2 py-1">
                        <span className="text-xs font-mono text-muted-foreground w-8">{r.controlId}</span>
                        <select value={r.rating} onChange={e => { const u=[...carRatings]; u[i]={...u[i],rating:e.target.value}; setCarRatings(u); }}
                          className="text-xs bg-muted border border-input rounded px-1 py-0.5 text-foreground flex-1">
                          <option value="compliant">Compliant</option>
                          <option value="partially_compliant">Partially Compliant</option>
                          <option value="non_compliant">Non-Compliant</option>
                          <option value="not_applicable">Not Applicable</option>
                        </select>
                        <input value={r.notes||""} onChange={e => { const u=[...carRatings]; u[i]={...u[i],notes:e.target.value}; setCarRatings(u); }}
                          placeholder="Notes..." className="text-xs bg-muted border border-input rounded px-1.5 py-0.5 text-foreground w-36" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Button onClick={() => carMutation.mutate({ engagementId: parseInt(carEngagementId)||0, organisationName: carOrgName, sector: carSector, auditPeriod: carAuditPeriod, leadAuditorName: carAuditorName, dpcoName: carDpcoName, controlRatings: carRatings, overallComplianceScore: parseFloat(carScore)||75 })}
                disabled={carMutation.isPending || !carOrgName || carRatings.length===0}
                className="bg-violet-600 hover:bg-violet-500 text-white text-xs h-8">
                {carMutation.isPending ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Generating...</> : <><Sparkles className="w-3 h-3 mr-1.5" />Generate CAR Narrative</>}
              </Button>
            </div>
            {carMutation.data && (
              <div className="space-y-3">
                {Object.entries({ "Executive Summary": carMutation.data.narrative.executiveSummary, "Scope & Methodology": carMutation.data.narrative.scopeAndMethodology, "Key Findings": carMutation.data.narrative.keyFindings, "Recommendations": carMutation.data.narrative.recommendations, "Auditor's Declaration": carMutation.data.narrative.auditorDeclaration }).map(([section, content]) => (
                  <div key={section} className="bg-background/60 border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-semibold text-foreground">{section}</h3>
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(content as string)} className="h-6 w-6 p-0" aria-label="Copy text-muted-foreground hover:text-foreground"><Copy className="w-3 h-3" /></Button>
                    </div>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{content as string}</p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="risk" className="p-6 space-y-5 mt-0">
            <div className="bg-background/60 border border-border rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-violet-400" /> Client Risk Prediction
              </h2>
              <p className="text-xs text-muted-foreground">Generate an AI-powered DCPMI risk score, audit priority, and estimated regulatory exposure for any client.</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Organisation ID", val: riskOrgId, set: setRiskOrgId, ph: "e.g. 12" },
                  { label: "Organisation Name", val: riskOrgName, set: setRiskOrgName, ph: "e.g. Zenith Bank" },
                  { label: "Sector", val: riskSector, set: setRiskSector, ph: "e.g. Financial Services" },
                  { label: "Last Audit Score (0–100)", val: riskLastScore, set: setRiskLastScore, ph: "e.g. 68" },
                  { label: "Days Since Last Audit", val: riskDaysSince, set: setRiskDaysSince, ph: "e.g. 365" },
                  { label: "Open Findings", val: riskOpenFindings, set: setRiskOpenFindings, ph: "e.g. 4" },
                  { label: "Breach Count (12m)", val: riskBreachCount, set: setRiskBreachCount, ph: "e.g. 1" },
                ].map(f => (
                  <div key={f.label} className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">{f.label}</Label>
                    <Input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph} className="h-8 text-xs bg-card border-border" />
                  </div>
                ))}
              </div>
              <Button onClick={() => riskMutation.mutate({ organisationId: parseInt(riskOrgId)||0, organisationName: riskOrgName, sector: riskSector, lastAuditScore: riskLastScore?parseFloat(riskLastScore):undefined, daysSinceLastAudit: riskDaysSince?parseInt(riskDaysSince):undefined, openFindings: riskOpenFindings?parseInt(riskOpenFindings):undefined, breachCount12m: riskBreachCount?parseInt(riskBreachCount):undefined })}
                disabled={riskMutation.isPending || !riskOrgName || !riskSector}
                className="bg-violet-600 hover:bg-violet-500 text-white text-xs h-8">
                {riskMutation.isPending ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Predicting...</> : <><Sparkles className="w-3 h-3 mr-1.5" />Predict Risk Profile</>}
              </Button>
            </div>
            {riskMutation.data && (() => {
              const p = riskMutation.data.prediction;
              const cfg = RISK_CONFIG[p.riskLevel] || RISK_CONFIG.medium;
              return (
                <div className={`border rounded-lg p-5 ${cfg.bg}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">DCPMI Risk Score</p>
                      <p className={`text-4xl font-bold ${cfg.color}`}>{p.riskScore.toFixed(0)}<span className="text-sm text-muted-foreground">/100</span></p>
                    </div>
                    <div className="text-right">
                      <Badge className={`text-sm px-3 py-1 border ${cfg.bg} ${cfg.color}`}>{cfg.label}</Badge>
                      <p className="text-xs text-muted-foreground mt-1">Priority: <span className="text-foreground font-medium capitalize">{p.auditPriority}</span></p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Primary Risk Factors</p>
                      <ul className="space-y-1">{p.primaryRiskFactors.map((f: string, i: number) => <li key={i} className="text-xs text-foreground flex gap-1.5"><span className="text-muted-foreground">▸</span>{f}</li>)}</ul>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Mitigation Actions</p>
                      <ul className="space-y-1">{p.mitigationActions.map((a: string, i: number) => <li key={i} className="text-xs text-foreground flex gap-1.5"><span className="text-emerald-600">✓</span>{a}</li>)}</ul>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-border/50 grid grid-cols-2 gap-4">
                    <div><p className="text-xs text-muted-foreground">Recommended Frequency</p><p className="text-xs text-foreground font-medium">{p.recommendedAuditFrequency}</p></div>
                    <div><p className="text-xs text-muted-foreground">DCPMI Exposure Estimate</p><p className="text-xs text-foreground font-medium">{p.dcpmiExposureEstimate}</p></div>
                  </div>
                </div>
              );
            })()}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default function DpcoAiTools() {
  return (
    <SubscriptionGate requiredTier="professional" featureName="AI Audit Tools">
      <DpcoAiToolsInner />
    </SubscriptionGate>
  );
}
