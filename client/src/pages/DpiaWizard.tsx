import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { FileSearch, Sparkles, CheckCircle2, AlertTriangle, XCircle, ChevronRight, ChevronLeft, Plus, X } from "lucide-react";
const DATA_CATEGORIES = ["Personal identifiers", "Financial data", "Health data", "Biometric data", "Location data", "Communications", "Behavioural data", "Children's data", "Criminal records"];
const DATA_SUBJECTS = ["Employees", "Customers", "Children", "Patients", "Job applicants", "Website visitors", "Third parties", "Public officials"];
const RISK_LABELS = ["Very Low", "Low", "Moderate", "High", "Very High"];
const RISK_COLORS = ["text-green-400", "text-green-400", "text-yellow-400", "text-orange-400", "text-red-400"];

function ScoreSelector({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="text-muted-foreground mb-2 block">{label}</Label>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`w-10 h-10 rounded-lg border text-sm font-semibold transition-all ${value === v ? "bg-blue-600 border-blue-500 text-foreground" : "bg-card border-border text-muted-foreground hover:border-blue-500"}`}
          >
            {v}
          </button>
        ))}
        <span className={`ml-2 self-center text-sm font-medium ${value ? RISK_COLORS[value - 1] : "text-muted-foreground"}`}>
          {value ? RISK_LABELS[value - 1] : "Not set"}
        </span>
      </div>
    </div>
  );
}

export default function DpiaWizard() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    orgId: 1,
    title: "",
    processingPurpose: "",
    dataCategories: [] as string[],
    dataSubjects: [] as string[],
    necessityScore: 3,
    proportionalityScore: 3,
    riskFactors: [] as any[],
    mitigations: [] as any[],
  });
  const [aiResult, setAiResult] = useState<any>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [newRisk, setNewRisk] = useState("");
  const [newMitigation, setNewMitigation] = useState("");

  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const { data: assessments = [], refetch } = trpc.dpiaWizard.list.useQuery({});

  const aiMutation = trpc.dpiaWizard.aiAnalyse.useMutation({
    onSuccess: (data) => {
      setAiResult(data);
      setForm(p => ({
        ...p,
        necessityScore: data.necessityScore ?? p.necessityScore,
        proportionalityScore: data.proportionalityScore ?? p.proportionalityScore,
        riskFactors: data.riskFactors ?? p.riskFactors,
        mitigations: data.mitigations ?? p.mitigations,
      }));
      toast.success("AI analysis complete");
    },
    onError: (err) => toast.error(err.message),
  });

  const createMutation = trpc.dpiaWizard.create.useMutation({
    onSuccess: (data) => {
      setSavedId(data.id);
      setStep(4);
      refetch();
      toast.success("DPIA assessment saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleCategory = (cat: string) => {
    setForm(p => ({
      ...p,
      dataCategories: p.dataCategories.includes(cat)
        ? p.dataCategories.filter(c => c !== cat)
        : [...p.dataCategories, cat],
    }));
  };

  const toggleSubject = (sub: string) => {
    setForm(p => ({
      ...p,
      dataSubjects: p.dataSubjects.includes(sub)
        ? p.dataSubjects.filter(s => s !== sub)
        : [...p.dataSubjects, sub],
    }));
  };

  const steps = ["Basic Info", "Data Scope", "AI Analysis", "Risk & Mitigations", "Complete"];

  return (
    <>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <FileSearch className="w-7 h-7 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">DPIA Wizard</h1>
            <p className="text-sm text-muted-foreground">Data Protection Impact Assessment — NDPA 2023 Article 28</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${i < step ? "bg-green-600 text-foreground" : i === step ? "bg-blue-600 text-foreground" : "bg-card text-muted-foreground"}`}>
                {i < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-xs ${i === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>{s}</span>
              {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-foreground" />}
            </div>
          ))}
        </div>

        {/* Step 0: Basic Info */}
        {step === 0 && (
          <div className="bg-background border border-border rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-foreground text-lg">Basic Information</h2>
            <div>
              <Label className="text-muted-foreground mb-1.5 block">Assessment Title *</Label>
              <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className="bg-card border-border text-foreground" placeholder="e.g. Customer Analytics Platform DPIA" />
            </div>
            <div>
              <Label className="text-muted-foreground mb-1.5 block">Organisation</Label>
              <select value={form.orgId} onChange={e => setForm(p => ({ ...p, orgId: Number(e.target.value) }))} className="w-full bg-card border border-border text-foreground rounded-md px-3 py-2 text-sm">
                {(orgs as any[]).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-muted-foreground mb-1.5 block">Processing Purpose *</Label>
              <Textarea value={form.processingPurpose} onChange={e => setForm(p => ({ ...p, processingPurpose: e.target.value }))} className="bg-card border-border text-foreground" rows={3} placeholder="Describe the purpose of the data processing activity..." />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => { if (!form.title || !form.processingPurpose) { toast.error("Please fill in all required fields"); return; } setStep(1); }} className="bg-blue-600 hover:bg-blue-700">
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 1: Data Scope */}
        {step === 1 && (
          <div className="bg-background border border-border rounded-xl p-6 space-y-6">
            <h2 className="font-semibold text-foreground text-lg">Data Scope</h2>
            <div>
              <Label className="text-muted-foreground mb-3 block">Data Categories (select all that apply)</Label>
              <div className="flex flex-wrap gap-2">
                {DATA_CATEGORIES.map(cat => (
                  <button key={cat} type="button" onClick={() => toggleCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${form.dataCategories.includes(cat) ? "bg-blue-600 border-blue-500 text-foreground" : "bg-card border-border text-muted-foreground hover:border-blue-500"}`}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground mb-3 block">Data Subjects (select all that apply)</Label>
              <div className="flex flex-wrap gap-2">
                {DATA_SUBJECTS.map(sub => (
                  <button key={sub} type="button" onClick={() => toggleSubject(sub)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${form.dataSubjects.includes(sub) ? "bg-purple-600 border-purple-500 text-foreground" : "bg-card border-border text-muted-foreground hover:border-purple-500"}`}>
                    {sub}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(0)} className="border-border text-muted-foreground"><ChevronLeft className="w-4 h-4 mr-1" /> Back</Button>
              <Button onClick={() => setStep(2)} className="bg-blue-600 hover:bg-blue-700">Next <ChevronRight className="w-4 h-4 ml-1" /></Button>
            </div>
          </div>
        )}

        {/* Step 2: AI Analysis */}
        {step === 2 && (
          <div className="bg-background border border-border rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-foreground text-lg flex items-center gap-2"><Sparkles className="w-5 h-5 text-yellow-400" /> AI Risk Analysis</h2>
            <p className="text-muted-foreground text-sm">Let the AI analyse your DPIA for NDPA 2023 compliance risks and suggest mitigations.</p>
            <div className="bg-card rounded-lg p-4 text-sm space-y-2">
              <div><span className="text-muted-foreground">Title:</span> <span className="text-foreground">{form.title}</span></div>
              <div><span className="text-muted-foreground">Purpose:</span> <span className="text-foreground">{form.processingPurpose}</span></div>
              <div><span className="text-muted-foreground">Data categories:</span> <span className="text-foreground">{form.dataCategories.join(", ") || "None selected"}</span></div>
              <div><span className="text-muted-foreground">Data subjects:</span> <span className="text-foreground">{form.dataSubjects.join(", ") || "None selected"}</span></div>
            </div>
            {aiResult && (
              <div className="bg-card border border-border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-sm">Risk Level:</span>
                  <span className={`font-bold text-sm uppercase ${aiResult.riskLevel === "high" || aiResult.riskLevel === "very_high" ? "text-red-400" : aiResult.riskLevel === "medium" ? "text-yellow-400" : "text-green-400"}`}>{aiResult.riskLevel}</span>
                </div>
                <p className="text-muted-foreground text-sm">{aiResult.summary}</p>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Key Risk Factors ({aiResult.riskFactors?.length ?? 0})</div>
                  {aiResult.riskFactors?.slice(0, 3).map((rf: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground mb-1">
                      <AlertTriangle className="w-3 h-3 text-orange-400 mt-0.5 flex-shrink-0" />
                      {rf.factor} <span className="text-muted-foreground">({rf.ndpaArticle})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)} className="border-border text-muted-foreground"><ChevronLeft className="w-4 h-4 mr-1" /> Back</Button>
              <div className="flex gap-3">
                <Button onClick={() => aiMutation.mutate({ title: form.title, processingPurpose: form.processingPurpose, dataCategories: form.dataCategories, dataSubjects: form.dataSubjects })} disabled={aiMutation.isPending} className="bg-yellow-600 hover:bg-yellow-700">
                  <Sparkles className="w-4 h-4 mr-1" /> {aiMutation.isPending ? "Analysing..." : "Run AI Analysis"}
                </Button>
                <Button onClick={() => setStep(3)} className="bg-blue-600 hover:bg-blue-700">Next <ChevronRight className="w-4 h-4 ml-1" /></Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Risk & Mitigations */}
        {step === 3 && (
          <div className="bg-background border border-border rounded-xl p-6 space-y-6">
            <h2 className="font-semibold text-foreground text-lg">Risk Assessment & Mitigations</h2>
            <ScoreSelector label="Necessity Score (1=Very Low, 5=Very High)" value={form.necessityScore} onChange={v => setForm(p => ({ ...p, necessityScore: v }))} />
            <ScoreSelector label="Proportionality Score (1=Very Low, 5=Very High)" value={form.proportionalityScore} onChange={v => setForm(p => ({ ...p, proportionalityScore: v }))} />
            <div>
              <Label className="text-muted-foreground mb-2 block">Risk Factors</Label>
              <div className="space-y-2 mb-2">
                {form.riskFactors.map((rf: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 bg-card rounded-lg px-3 py-2 text-sm">
                    <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                    <span className="text-muted-foreground flex-1">{rf.factor ?? rf}</span>
                    <button aria-label="Remove" onClick={() => setForm(p => ({ ...p, riskFactors: p.riskFactors.filter((_, j) => j !== i) }))} className="text-muted-foreground hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input value={newRisk} onChange={e => setNewRisk(e.target.value)} className="bg-card border-border text-foreground text-sm" placeholder="Add a risk factor..." onKeyDown={e => { if (e.key === "Enter") { if (newRisk.trim()) { setForm(p => ({ ...p, riskFactors: [...p.riskFactors, { factor: newRisk.trim(), severity: "medium", ndpaArticle: "Art. 28" }] })); setNewRisk(""); } } }} />
                <Button type="button" size="sm" onClick={() => { if (newRisk.trim()) { setForm(p => ({ ...p, riskFactors: [...p.riskFactors, { factor: newRisk.trim(), severity: "medium", ndpaArticle: "Art. 28" }] })); setNewRisk(""); } }} className="bg-muted hover:bg-muted/50"><Plus className="w-4 h-4" /></Button>
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground mb-2 block">Mitigations</Label>
              <div className="space-y-2 mb-2">
                {form.mitigations.map((m: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 bg-card rounded-lg px-3 py-2 text-sm">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                    <span className="text-muted-foreground flex-1">{m.action ?? m}</span>
                    <button aria-label="Remove" onClick={() => setForm(p => ({ ...p, mitigations: p.mitigations.filter((_, j) => j !== i) }))} className="text-muted-foreground hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input value={newMitigation} onChange={e => setNewMitigation(e.target.value)} className="bg-card border-border text-foreground text-sm" placeholder="Add a mitigation action..." onKeyDown={e => { if (e.key === "Enter") { if (newMitigation.trim()) { setForm(p => ({ ...p, mitigations: [...p.mitigations, { action: newMitigation.trim(), priority: "medium" }] })); setNewMitigation(""); } } }} />
                <Button type="button" size="sm" onClick={() => { if (newMitigation.trim()) { setForm(p => ({ ...p, mitigations: [...p.mitigations, { action: newMitigation.trim(), priority: "medium" }] })); setNewMitigation(""); } }} className="bg-muted hover:bg-muted/50"><Plus className="w-4 h-4" /></Button>
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)} className="border-border text-muted-foreground"><ChevronLeft className="w-4 h-4 mr-1" /> Back</Button>
              <Button onClick={() => createMutation.mutate({ orgId: form.orgId, title: form.title, processingPurpose: form.processingPurpose, dataCategories: form.dataCategories, dataSubjects: form.dataSubjects, necessityScore: form.necessityScore, proportionalityScore: form.proportionalityScore, riskFactors: form.riskFactors, mitigations: form.mitigations })} disabled={createMutation.isPending} className="bg-green-600 hover:bg-green-700">
                {createMutation.isPending ? "Saving..." : "Save DPIA"} <CheckCircle2 className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === 4 && (
          <div className="text-center py-10">
            <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-foreground mb-2">DPIA Saved</h2>
            <p className="text-muted-foreground mb-6">Your Data Protection Impact Assessment has been recorded (ID: {savedId}).</p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => { setStep(0); setForm({ orgId: 1, title: "", processingPurpose: "", dataCategories: [], dataSubjects: [], necessityScore: 3, proportionalityScore: 3, riskFactors: [], mitigations: [] }); setAiResult(null); setSavedId(null); }} className="bg-blue-600 hover:bg-blue-700">New Assessment</Button>
            </div>
          </div>
        )}

        {/* Existing assessments */}
        {(assessments as any[]).length > 0 && step === 0 && (
          <div className="mt-8">
            <h3 className="text-foreground font-semibold mb-3">Recent Assessments</h3>
            <div className="space-y-2">
              {(assessments as any[]).slice(0, 5).map((a: any) => (
                <div key={a.id} className="bg-background border border-border rounded-lg px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-foreground text-sm font-medium">{a.title}</div>
                    <div className="text-muted-foreground text-xs">{a.created_by_name} · {new Date(a.created_at).toLocaleDateString()}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${a.risk_level === "high" ? "bg-red-900/40 text-red-400" : a.risk_level === "medium" ? "bg-yellow-900/40 text-yellow-400" : "bg-green-900/40 text-green-400"}`}>
                    {a.risk_level}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
