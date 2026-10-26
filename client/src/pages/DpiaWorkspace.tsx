/**
 * DPIA Workspace — unified DPIA surface (Round-12 W3 consolidation)
 * ==================================================================
 * ONE page unifying what were three separate, partially-orphaned pages:
 *   - DpiaWizard               (guided wizard, dpiaWizard.create + aiAnalyse)
 *   - DpiaAssessments          (register list, dpia.create / update / delete)
 *   - PrivacyImpactAssessment  (was wired to phase12.pia.* — retired; the
 *                              canonical DPIA routers are `dpia` + `dpiaWizard`)
 *
 * Tabs:
 *   "Register"      — assessments register backed by the `dpia` router
 *   "Guided wizard" — step-by-step assessment backed by the `dpiaWizard` router
 *
 * The old route components are thin re-exports of this page.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PageSkeleton } from "@/components/SkeletonLoaders";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  ClipboardCheck, Plus, Search, AlertTriangle, Shield, FileText, Trash2,
  FileSearch, Sparkles, CheckCircle2, ChevronRight, ChevronLeft, X,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted/40 text-muted-foreground border-border/30",
  in_review: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  approved: "bg-green-500/20 text-green-400 border-green-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  requires_ndpc_consultation: "bg-purple-500/20 text-primary border-purple-500/30",
};
const RISK_COLORS: Record<string, string> = {
  low: "bg-blue-500/20 text-primary",
  medium: "bg-yellow-500/20 text-yellow-400",
  high: "bg-orange-500/20 text-primary",
  critical: "bg-red-500/20 text-red-400",
};

const DATA_CATEGORIES = ["Personal identifiers", "Financial data", "Health data", "Biometric data", "Location data", "Communications", "Behavioural data", "Children's data", "Criminal records"];
const DATA_SUBJECTS = ["Employees", "Customers", "Children", "Patients", "Job applicants", "Website visitors", "Third parties", "Public officials"];
const RISK_LABELS = ["Very Low", "Low", "Moderate", "High", "Very High"];
const RISK_TEXT_COLORS = ["text-green-400", "text-green-400", "text-yellow-400", "text-orange-400", "text-red-400"];

// ─── Register tab (dpia router) ─────────────────────────────────────────────

function RegisterTab() {
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({
    organizationId: "", title: "", processingDescription: "", triggerCategory: "",
    riskLevel: "medium", dataCategories: "", purposeOfProcessing: "", mitigationMeasures: "",
  });

  const utils = trpc.useUtils();
  const { data: assessments = [], isLoading } = trpc.dpia.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });

  const invalidate = () => { utils.dpia.list.invalidate().catch(() => {}); };
  const createMutation = trpc.dpia.create.useMutation({
    onSuccess: () => { toast.success("DPIA created"); setShowCreate(false); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.dpia.update.useMutation({
    onSuccess: () => { toast.success("DPIA updated"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.dpia.delete.useMutation({
    onSuccess: () => { toast.success("DPIA assessment deleted"); setDeleteId(null); invalidate(); },
    onError: (e) => toast.error(e.message || "Failed to delete DPIA assessment"),
  });

  const rows = assessments as any[];
  const filtered = rows.filter((r: any) => !searchQuery || r.title?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "Total DPIAs", value: rows.length, icon: FileText, color: "text-primary" },
          { label: "In Review", value: rows.filter((a: any) => a.dpia_status === "in_review").length, icon: ClipboardCheck, color: "text-yellow-400" },
          { label: "High Risk", value: rows.filter((a: any) => ["high", "critical"].includes(a.dpia_risk_level)).length, icon: AlertTriangle, color: "text-red-400" },
          { label: "Approved", value: rows.filter((a: any) => a.dpia_status === "approved").length, icon: Shield, color: "text-green-400" },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
            <div className="text-2xl font-bold text-foreground">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search DPIAs..." className="pl-9 bg-background border-border text-foreground" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-background border-border">
            <SelectItem value="all" className="text-foreground">All Status</SelectItem>
            {Object.keys(STATUS_COLORS).map((s) => <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground">
          <Plus className="w-4 h-4 mr-2" />New DPIA
        </Button>
      </div>

      <div className="space-y-3">
        {isLoading ? <PageSkeleton />
        : filtered.length === 0 ? <div className="text-center py-8 text-muted-foreground/70">No DPIA assessments found</div>
        : filtered.map((r: any) => (
          <div key={r.id} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="font-medium text-foreground">{r.title}</div>
                <div className="text-xs text-muted-foreground/70 mt-1">{r.org_name ?? `Org #${r.organization_id}`} &middot; {r.trigger_category}</div>
              </div>
              <div className="flex gap-2">
                <Badge className={`text-xs ${RISK_COLORS[r.dpia_risk_level] ?? ""}`}>{r.dpia_risk_level} risk</Badge>
                <Badge className={`text-xs border ${STATUS_COLORS[r.dpia_status] ?? ""}`}>{r.dpia_status?.replace(/_/g, " ")}</Badge>
              </div>
            </div>
            {r.processing_description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.processing_description}</p>}
            <div className="flex gap-2 mt-3">
              {r.dpia_status === "draft" && (
                <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: r.id, status: "in_review" })}>Submit for Review</Button>
              )}
              {r.dpia_status === "in_review" && (
                <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700" onClick={() => updateMutation.mutate({ id: r.id, status: "approved" })}>Approve</Button>
              )}
              {r.dpia_status === "in_review" && (
                <Button size="sm" className="text-xs bg-primary hover:bg-primary/90" onClick={() => updateMutation.mutate({ id: r.id, status: "requires_ndpc_consultation", ndpcConsultationRequired: true })}>Refer to NDPC</Button>
              )}
              <Button size="sm" variant="ghost" className="text-xs text-red-400 hover:text-red-300 ml-auto" onClick={() => setDeleteId(r.id)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New DPIA Assessment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-sm">Organization *</Label>
                <Select value={form.organizationId} onValueChange={(v) => setForm((p) => ({ ...p, organizationId: v }))}>
                  <SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">Risk Level</Label>
                <Select value={form.riskLevel} onValueChange={(v) => setForm((p) => ({ ...p, riskLevel: v }))}>
                  <SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-background border-border">{["low", "medium", "high", "critical"].map((s) => <SelectItem key={s} value={s} className="text-foreground capitalize">{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Title *</Label><Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div><Label className="text-muted-foreground text-sm">Trigger Category *</Label><Input value={form.triggerCategory} onChange={(e) => setForm((p) => ({ ...p, triggerCategory: e.target.value }))} className="bg-background border-border mt-1 text-foreground" placeholder="e.g. AI profiling, health data, financial services" /></div>
            <div><Label className="text-muted-foreground text-sm">Processing Description *</Label><Textarea value={form.processingDescription} onChange={(e) => setForm((p) => ({ ...p, processingDescription: e.target.value }))} className="bg-background border-border mt-1 text-foreground" rows={3} /></div>
            <div><Label className="text-muted-foreground text-sm">Purpose of Processing</Label><Textarea value={form.purposeOfProcessing} onChange={(e) => setForm((p) => ({ ...p, purposeOfProcessing: e.target.value }))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
            <div><Label className="text-muted-foreground text-sm">Mitigation Measures</Label><Textarea value={form.mitigationMeasures} onChange={(e) => setForm((p) => ({ ...p, mitigationMeasures: e.target.value }))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({
                organizationId: Number(form.organizationId),
                title: form.title,
                processingDescription: form.processingDescription,
                triggerCategory: form.triggerCategory,
                riskLevel: form.riskLevel as any,
                dataCategories: form.dataCategories ? form.dataCategories.split(",").map((s) => s.trim()) : undefined,
                purposeOfProcessing: form.purposeOfProcessing || undefined,
                mitigationMeasures: form.mitigationMeasures || undefined,
              })}
              disabled={!form.organizationId || !form.title || !form.processingDescription || !form.triggerCategory || createMutation.isPending}
              className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Creating..." : "Create DPIA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteId != null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent className="bg-background border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete DPIA assessment?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the assessment from the register.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => { if (deleteId != null) deleteMutation.mutate({ id: deleteId }); }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Guided wizard tab (dpiaWizard router) ──────────────────────────────────

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
        <span className={`ml-2 self-center text-sm font-medium ${value ? RISK_TEXT_COLORS[value - 1] : "text-muted-foreground"}`}>
          {value ? RISK_LABELS[value - 1] : "Not set"}
        </span>
      </div>
    </div>
  );
}

const WIZARD_INITIAL = {
  orgId: 1,
  title: "",
  processingPurpose: "",
  dataCategories: [] as string[],
  dataSubjects: [] as string[],
  necessityScore: 3,
  proportionalityScore: 3,
  riskFactors: [] as any[],
  mitigations: [] as any[],
};

function WizardTab() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(WIZARD_INITIAL);
  const [aiResult, setAiResult] = useState<any>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [newRisk, setNewRisk] = useState("");
  const [newMitigation, setNewMitigation] = useState("");

  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const { data: assessments = [] } = trpc.dpiaWizard.list.useQuery({});

  const aiMutation = trpc.dpiaWizard.aiAnalyse.useMutation({
    onSuccess: (data) => {
      setAiResult(data);
      setForm((p) => ({
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
      toast.success("DPIA assessment saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const toggle = (field: "dataCategories" | "dataSubjects", v: string) =>
    setForm((p) => ({
      ...p,
      [field]: p[field].includes(v) ? p[field].filter((x) => x !== v) : [...p[field], v],
    }));

  const steps = ["Basic Info", "Data Scope", "AI Analysis", "Risk & Mitigations", "Complete"];

  return (
    <div>
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8 flex-wrap">
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
            <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} className="bg-card border-border text-foreground" placeholder="e.g. Customer Analytics Platform DPIA" />
          </div>
          <div>
            <Label className="text-muted-foreground mb-1.5 block">Organisation</Label>
            <select value={form.orgId} onChange={(e) => setForm((p) => ({ ...p, orgId: Number(e.target.value) }))} className="w-full bg-card border border-border text-foreground rounded-md px-3 py-2 text-sm">
              {(orgs as any[]).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-muted-foreground mb-1.5 block">Processing Purpose *</Label>
            <Textarea value={form.processingPurpose} onChange={(e) => setForm((p) => ({ ...p, processingPurpose: e.target.value }))} className="bg-card border-border text-foreground" rows={3} placeholder="Describe the purpose of the data processing activity..." />
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
              {DATA_CATEGORIES.map((cat) => (
                <button key={cat} type="button" onClick={() => toggle("dataCategories", cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${form.dataCategories.includes(cat) ? "bg-blue-600 border-blue-500 text-foreground" : "bg-card border-border text-muted-foreground hover:border-blue-500"}`}>
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-muted-foreground mb-3 block">Data Subjects (select all that apply)</Label>
            <div className="flex flex-wrap gap-2">
              {DATA_SUBJECTS.map((sub) => (
                <button key={sub} type="button" onClick={() => toggle("dataSubjects", sub)}
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
          <h2 className="font-semibold text-foreground text-lg">Risk Assessment &amp; Mitigations</h2>
          <ScoreSelector label="Necessity Score (1=Very Low, 5=Very High)" value={form.necessityScore} onChange={(v) => setForm((p) => ({ ...p, necessityScore: v }))} />
          <ScoreSelector label="Proportionality Score (1=Very Low, 5=Very High)" value={form.proportionalityScore} onChange={(v) => setForm((p) => ({ ...p, proportionalityScore: v }))} />
          <div>
            <Label className="text-muted-foreground mb-2 block">Risk Factors</Label>
            <div className="space-y-2 mb-2">
              {form.riskFactors.map((rf: any, i: number) => (
                <div key={i} className="flex items-center gap-2 bg-card rounded-lg px-3 py-2 text-sm">
                  <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                  <span className="text-muted-foreground flex-1">{rf.factor ?? rf}</span>
                  <button aria-label="Remove" onClick={() => setForm((p) => ({ ...p, riskFactors: p.riskFactors.filter((_, j) => j !== i) }))} className="text-muted-foreground hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={newRisk} onChange={(e) => setNewRisk(e.target.value)} className="bg-card border-border text-foreground text-sm" placeholder="Add a risk factor..." onKeyDown={(e) => { if (e.key === "Enter") { if (newRisk.trim()) { setForm((p) => ({ ...p, riskFactors: [...p.riskFactors, { factor: newRisk.trim(), severity: "medium", ndpaArticle: "Art. 28" }] })); setNewRisk(""); } } }} />
              <Button type="button" size="sm" onClick={() => { if (newRisk.trim()) { setForm((p) => ({ ...p, riskFactors: [...p.riskFactors, { factor: newRisk.trim(), severity: "medium", ndpaArticle: "Art. 28" }] })); setNewRisk(""); } }} className="bg-muted hover:bg-muted/50"><Plus className="w-4 h-4" /></Button>
            </div>
          </div>
          <div>
            <Label className="text-muted-foreground mb-2 block">Mitigations</Label>
            <div className="space-y-2 mb-2">
              {form.mitigations.map((m: any, i: number) => (
                <div key={i} className="flex items-center gap-2 bg-card rounded-lg px-3 py-2 text-sm">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  <span className="text-muted-foreground flex-1">{m.action ?? m}</span>
                  <button aria-label="Remove" onClick={() => setForm((p) => ({ ...p, mitigations: p.mitigations.filter((_, j) => j !== i) }))} className="text-muted-foreground hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={newMitigation} onChange={(e) => setNewMitigation(e.target.value)} className="bg-card border-border text-foreground text-sm" placeholder="Add a mitigation action..." onKeyDown={(e) => { if (e.key === "Enter") { if (newMitigation.trim()) { setForm((p) => ({ ...p, mitigations: [...p.mitigations, { action: newMitigation.trim(), priority: "medium" }] })); setNewMitigation(""); } } }} />
              <Button type="button" size="sm" onClick={() => { if (newMitigation.trim()) { setForm((p) => ({ ...p, mitigations: [...p.mitigations, { action: newMitigation.trim(), priority: "medium" }] })); setNewMitigation(""); } }} className="bg-muted hover:bg-muted/50"><Plus className="w-4 h-4" /></Button>
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
            <Button onClick={() => { setStep(0); setForm(WIZARD_INITIAL); setAiResult(null); setSavedId(null); }} className="bg-blue-600 hover:bg-blue-700">New Assessment</Button>
          </div>
        </div>
      )}

      {/* Recent wizard assessments */}
      {(assessments as any[]).length > 0 && step === 0 && (
        <div className="mt-8">
          <h3 className="text-foreground font-semibold mb-3">Recent Wizard Assessments</h3>
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
  );
}

// ─── Page shell ─────────────────────────────────────────────────────────────

export default function DpiaWorkspace() {
  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "DPIA Workspace" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><FileSearch className="w-5 h-5 text-primary" /></div>
            <div>
              <div className="text-xs text-primary font-mono uppercase tracking-widest">NDPA 2023 Art. 28 / GAID Art. 28</div>
              <h1 className="text-2xl font-bold text-foreground">DPIA Workspace</h1>
            </div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">
            One surface for Data Protection Impact Assessments: the assessments register and the guided
            AI-assisted wizard now live together — no duplicated entry points.
          </p>
        </div>
      </div>
      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">Assessments register</TabsTrigger>
          <TabsTrigger value="wizard">Guided wizard</TabsTrigger>
        </TabsList>
        <TabsContent value="register" className="mt-4"><RegisterTab /></TabsContent>
        <TabsContent value="wizard" className="mt-4"><WizardTab /></TabsContent>
      </Tabs>
    </div>
  );
}
