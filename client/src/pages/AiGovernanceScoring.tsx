import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Brain, Shield, AlertTriangle, CheckCircle2, XCircle, Plus } from "lucide-react";
const RISK_COLORS: Record<string, string> = {
  low: "text-green-400 bg-green-900/30",
  medium: "text-yellow-400 bg-yellow-900/30",
  high: "text-orange-400 bg-orange-900/30",
  critical: "text-red-400 bg-red-900/30",
};

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-bold ${color}`}>{value}%</span>
      </div>
      <div className="h-2 bg-card rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${value >= 70 ? "bg-green-500" : value >= 50 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export default function AiGovernanceScoring() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    orgId: 1,
    systemName: "",
    systemType: "classification",
    systemDescription: "",
    useCases: [] as string[],
    hasHumanOversight: false,
    hasExplainability: false,
    hasAuditTrail: false,
    hasBiasAssessment: false,
    hasDataGovernance: false,
  });
  const [newUseCase, setNewUseCase] = useState("");

  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const { data: scores = [], refetch } = trpc.aiGovernanceScoring.list.useQuery({});

  const scoreMutation = trpc.aiGovernanceScoring.score.useMutation({
    onSuccess: () => {
      toast.success("AI system scored successfully");
      setShowForm(false);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.systemName || !form.systemDescription || form.useCases.length === 0) {
      toast.error("Please fill in all required fields and add at least one use case.");
      return;
    }
    scoreMutation.mutate(form);
  };

  const toggleCheck = (field: keyof typeof form) => {
    setForm(p => ({ ...p, [field]: !p[field as keyof typeof p] }));
  };

  const checks = [
    { key: "hasHumanOversight", label: "Human oversight mechanism in place" },
    { key: "hasExplainability", label: "System provides explainable decisions" },
    { key: "hasAuditTrail", label: "Full audit trail of decisions" },
    { key: "hasBiasAssessment", label: "Bias and fairness assessment conducted" },
    { key: "hasDataGovernance", label: "Data governance framework applied" },
  ];

  return (
    <>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Brain className="w-7 h-7 text-purple-400" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">AI Governance Scoring</h1>
              <p className="text-sm text-muted-foreground">NDPA 2023 Article 24 — Automated Decision-Making Compliance</p>
            </div>
          </div>
          <Button onClick={() => setShowForm(!showForm)} className="bg-purple-600 hover:bg-purple-700">
            <Plus className="w-4 h-4 mr-1" /> Score New System
          </Button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-background border border-border rounded-xl p-6 mb-6 space-y-5">
            <h2 className="font-semibold text-foreground text-lg">New AI System Assessment</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground mb-1.5 block">System Name *</Label>
                <Input value={form.systemName} onChange={e => setForm(p => ({ ...p, systemName: e.target.value }))} className="bg-card border-border text-foreground" placeholder="e.g. Credit Scoring Engine" />
              </div>
              <div>
                <Label className="text-muted-foreground mb-1.5 block">System Type</Label>
                <select value={form.systemType} onChange={e => setForm(p => ({ ...p, systemType: e.target.value }))} className="w-full bg-card border border-border text-foreground rounded-md px-3 py-2 text-sm">
                  {["classification", "recommendation", "prediction", "generation", "detection", "nlp", "computer_vision", "other"].map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground mb-1.5 block">Organisation</Label>
              <select value={form.orgId} onChange={e => setForm(p => ({ ...p, orgId: Number(e.target.value) }))} className="w-full bg-card border border-border text-foreground rounded-md px-3 py-2 text-sm">
                {(orgs as any[]).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-muted-foreground mb-1.5 block">System Description *</Label>
              <Textarea value={form.systemDescription} onChange={e => setForm(p => ({ ...p, systemDescription: e.target.value }))} className="bg-card border-border text-foreground" rows={3} placeholder="Describe what this AI system does and how it makes decisions..." />
            </div>
            <div>
              <Label className="text-muted-foreground mb-2 block">Use Cases *</Label>
              <div className="flex flex-wrap gap-2 mb-2">
                {form.useCases.map((uc, i) => (
                  <span key={i} className="bg-card border border-border text-muted-foreground text-xs px-2 py-1 rounded-full flex items-center gap-1">
                    {uc}
                    <button aria-label="Close" type="button" onClick={() => setForm(p => ({ ...p, useCases: p.useCases.filter((_, j) => j !== i) }))} className="text-muted-foreground hover:text-red-400"><XCircle className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input value={newUseCase} onChange={e => setNewUseCase(e.target.value)} className="bg-card border-border text-foreground text-sm" placeholder="Add a use case..." onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (newUseCase.trim()) { setForm(p => ({ ...p, useCases: [...p.useCases, newUseCase.trim()] })); setNewUseCase(""); } } }} />
                <Button type="button" size="sm" onClick={() => { if (newUseCase.trim()) { setForm(p => ({ ...p, useCases: [...p.useCases, newUseCase.trim()] })); setNewUseCase(""); } }} className="bg-muted hover:bg-muted/50"><Plus className="w-4 h-4" /></Button>
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground mb-3 block">Governance Checklist</Label>
              <div className="space-y-2">
                {checks.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-3 cursor-pointer group">
                    <div onClick={() => toggleCheck(key as any)} className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${(form as any)[key] ? "bg-green-600 border-green-500" : "bg-card border-border group-hover:border-green-500"}`}>
                      {(form as any)[key] && <CheckCircle2 className="w-3.5 h-3.5 text-foreground" />}
                    </div>
                    <span className="text-muted-foreground text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <Button type="submit" disabled={scoreMutation.isPending} className="bg-purple-600 hover:bg-purple-700">
                {scoreMutation.isPending ? "Scoring..." : "Run Assessment"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="border-border text-muted-foreground">Cancel</Button>
            </div>
          </form>
        )}

        {/* Scores list */}
        <div className="space-y-4">
          {(scores as any[]).length === 0 && !showForm && (
            <div className="text-center py-16 text-muted-foreground">
              <Brain className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No AI systems assessed yet. Click "Score New System" to begin.</p>
            </div>
          )}
          {(scores as any[]).map((s: any) => (
            <div key={s.id} className="bg-background border border-border rounded-xl p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="font-semibold text-foreground text-lg">{s.system_name}</div>
                  <div className="text-muted-foreground text-sm">{s.system_type} · Assessed {new Date(s.assessed_at ?? s.created_at).toLocaleDateString()}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${RISK_COLORS[s.risk_category] ?? "text-muted-foreground bg-card"}`}>
                    {s.risk_category?.toUpperCase()} RISK
                  </span>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-foreground">{s.overall_score}</div>
                    <div className="text-xs text-muted-foreground">Overall Score</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <ScoreBar label="Transparency" value={s.transparency_score ?? 0} color="text-blue-400" />
                <ScoreBar label="Fairness" value={s.fairness_score ?? 0} color="text-green-400" />
                <ScoreBar label="Accountability" value={s.accountability_score ?? 0} color="text-purple-400" />
                <ScoreBar label="Human Oversight" value={s.human_oversight_score ?? 0} color="text-yellow-400" />
              </div>
              <div className="flex items-center gap-3">
                <span className={`flex items-center gap-1 text-xs font-medium ${s.ndpa_article24_compliant ? "text-green-400" : "text-red-400"}`}>
                  {s.ndpa_article24_compliant ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  NDPA Art. 24 {s.ndpa_article24_compliant ? "Compliant" : "Non-Compliant"}
                </span>
                {s.next_review_date && (
                  <span className="text-xs text-muted-foreground">Next review: {new Date(s.next_review_date).toLocaleDateString()}</span>
                )}
              </div>
              {(s.findings as any[])?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="text-xs text-muted-foreground mb-2">Top Findings</div>
                  <div className="space-y-1">
                    {(s.findings as any[]).slice(0, 2).map((f: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <AlertTriangle className="w-3 h-3 text-orange-400 mt-0.5 flex-shrink-0" />
                        {f.issue} <span className="text-muted-foreground ml-1">({f.ndpaArticle})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
