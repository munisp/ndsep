import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { FileCheck, Plus, CheckCircle2, Circle, RefreshCw, Save,
  ArrowRight, Loader2, ChevronRight, ClipboardList, Building2,
  Calendar, User, AlertCircle, TrendingUp, Shield, FileText,
  Inbox, Clock, XCircle, Mail, Phone, CheckCheck
} from "lucide-react";

const AUDIT_STAGES = [
  { key: "initiated",           label: "Initiated",         desc: "Audit engagement opened",                  shortLabel: "Init" },
  { key: "data_mapping",        label: "Data Mapping",      desc: "Identify data flows & assets",             shortLabel: "Map" },
  { key: "gap_assessment",      label: "Gap Assessment",    desc: "Assess against NDPA controls",             shortLabel: "Gap" },
  { key: "fieldwork",           label: "Fieldwork",         desc: "Evidence collection & testing",            shortLabel: "Field" },
  { key: "findings_review",     label: "Findings Review",   desc: "Draft findings & recommendations",         shortLabel: "Find" },
  { key: "management_response", label: "Mgmt Response",     desc: "Client responds to findings",              shortLabel: "Resp" },
  { key: "report_issued",       label: "Report Issued",     desc: "Final audit report delivered",             shortLabel: "Report" },
  { key: "car_filed",           label: "CAR Filed",         desc: "Compliance Audit Return submitted to NDPC", shortLabel: "CAR" },
];

const STAGE_BADGE: Record<string, { bg: string; text: string; dot: string }> = {
  initiated:           { bg: "bg-muted/30",   text: "text-foreground",  dot: "bg-muted-foreground" },
  data_mapping:        { bg: "bg-blue-500/15",    text: "text-blue-600",   dot: "bg-blue-400" },
  gap_assessment:      { bg: "bg-indigo-500/15",  text: "text-indigo-300", dot: "bg-indigo-400" },
  fieldwork:           { bg: "bg-amber-500/15",   text: "text-amber-300",  dot: "bg-amber-400" },
  findings_review:     { bg: "bg-orange-500/15",  text: "text-orange-600", dot: "bg-orange-400" },
  management_response: { bg: "bg-purple-500/15",  text: "text-purple-600", dot: "bg-purple-400" },
  report_issued:       { bg: "bg-cyan-500/15",    text: "text-primary",   dot: "bg-cyan-400" },
  car_filed:           { bg: "bg-emerald-500/15", text: "text-emerald-600",dot: "bg-emerald-400" },
};

const NDPA_CONTROLS = [
  { id: "C01", ref: "§24", title: "Lawful Basis for Processing",                       category: "Lawfulness" },
  { id: "C02", ref: "§25", title: "Data Subject Consent Management",                   category: "Consent" },
  { id: "C03", ref: "§26", title: "Data Minimisation & Purpose Limitation",            category: "Principles" },
  { id: "C04", ref: "§27", title: "Data Subject Rights (Access, Erasure, Portability)", category: "Rights" },
  { id: "C05", ref: "§28", title: "Cross-border Transfer Controls",                    category: "Transfers" },
  { id: "C06", ref: "§32", title: "Staff Training & Awareness",                        category: "Governance" },
  { id: "C07", ref: "§33", title: "DPO Appointment & Independence",                    category: "Governance" },
  { id: "C08", ref: "§35", title: "Data Protection Impact Assessment",                 category: "Risk" },
  { id: "C09", ref: "§40", title: "Breach Detection & 72h NDPC Notification",          category: "Incident" },
  { id: "C10", ref: "§41", title: "Record of Processing Activities (ROPA)",            category: "Records" },
  { id: "C11", ref: "§43", title: "Privacy Notices & Cookie Consent",                  category: "Transparency" },
  { id: "C12", ref: "§44", title: "Annual Compliance Audit Return (CAR)",              category: "Reporting" },
  { id: "C13", ref: "§45", title: "Data Processing Agreements with Processors",        category: "Contracts" },
  { id: "C14", ref: "§46", title: "Data Retention & Secure Disposal",                  category: "Lifecycle" },
  { id: "C15", ref: "§48", title: "Security Measures & Access Controls",               category: "Security" },
];

const RATING_OPTIONS: [string, string, string][] = [
  ["compliant",     "Compliant",     "text-emerald-600"],
  ["partial",       "Partial",       "text-amber-400"],
  ["non_compliant", "Non-Compliant", "text-rose-400"],
  ["not_assessed",  "Not Assessed",  "text-muted-foreground"],
];

const RATING_PILL: Record<string, string> = {
  compliant:     "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30",
  partial:       "bg-amber-500/15   text-amber-300   border border-amber-500/30",
  non_compliant: "bg-rose-500/15    text-rose-300    border border-rose-500/30",
  not_assessed:  "bg-muted/50   text-muted-foreground   border border-input/30",
};

const DEMO_DPCO_ORG_ID = 1;

export default function DpcoAuditWorkspace() {
  const [, navigate] = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState<any>(null);
  const [filterStage, setFilterStage] = useState("all");
  const [activeTab, setActiveTab] = useState<"engagements" | "requests">("engagements");
  const [respondingTo, setRespondingTo] = useState<any>(null);
  const [responseNote, setResponseNote] = useState("");
  const [controlRatings, setControlRatings] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [form, setForm] = useState({
    dpcoOrganisationId: "", organisationId: "", auditYear: new Date().getFullYear().toString(),
    auditType: "annual_car", plannedStartDate: "", plannedEndDate: "", leadAuditor: "", scope: "",
  });

  const { data: incomingRequests, refetch: refetchRequests } = trpc.dpco.listIncomingRequests.useQuery(
    { status: undefined, limit: 50 },
    { staleTime: 30_000 }
  );

  const respondMutation = trpc.dpco.respondToEngagementRequest.useMutation({
    onSuccess: (data: any) => {
      toast.success(data.decision === "accepted" ? "Request accepted" : "Request declined");
      setRespondingTo(null);
      setResponseNote("");
      refetchRequests();
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const pendingCount = (incomingRequests?.rows ?? []).filter((r: any) => r.status === "pending").length;

  // Licence status gate for CAR filing
  const { data: myLicence } = trpc.accreditation.getMyLicence.useQuery();
  const licenceExpiresAt = (myLicence as any)?.licenceExpiresAt;
  const daysUntilExpiry = licenceExpiresAt
    ? Math.ceil((new Date(licenceExpiresAt).getTime() - Date.now()) / 86_400_000)
    : null;
  const licenceExpired = daysUntilExpiry !== null && daysUntilExpiry < 0;
  const licenceExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= 7;
  const carFilingBlocked = licenceExpired || licenceExpiringSoon;

  const { data: audits, isLoading, refetch } = trpc.dpco.listAuditEngagements.useQuery(
    filterStage !== "all" ? { status: filterStage } : undefined
  );
  const { data: dpcoList } = trpc.dpco.listOrganisations.useQuery({ status: "active", limit: 100 });
  const { data: orgList } = trpc.organizations.list.useQuery({ limit: 200 });

  const { data: savedRatings, isLoading: ratingsLoading } = trpc.dpco.getControlRatings.useQuery(
    { engagementId: selectedAudit?.id ?? 0 },
    { enabled: !!selectedAudit?.id }
  );

  useEffect(() => {
    if (savedRatings?.ratings) {
      const map: Record<string, string> = {};
      for (const r of savedRatings.ratings) map[r.control_id] = r.rating;
      setControlRatings(map);
      setIsDirty(false);
    }
  }, [savedRatings]);

  useEffect(() => { setControlRatings({}); setIsDirty(false); }, [selectedAudit?.id]);

  const create = trpc.dpco.upsertAuditEngagement.useMutation({
    onSuccess: () => { toast.success("Audit engagement created"); setShowCreate(false); refetch(); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const advance = trpc.dpco.upsertAuditEngagement.useMutation({
    onSuccess: (updated: any) => { toast.success("Audit stage advanced"); setSelectedAudit(updated); refetch(); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const saveRatings = trpc.dpco.saveControlRatings.useMutation({
    onSuccess: (data: any) => { toast.success(`${data.saved} control ratings saved`); setIsDirty(false); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const handleRatingChange = useCallback((controlId: string, value: string) => {
    setControlRatings(r => ({ ...r, [controlId]: value }));
    setIsDirty(true);
  }, []);

  const handleSaveRatings = () => {
    if (!selectedAudit) return;
    const ratings = NDPA_CONTROLS.map(ctrl => ({
      controlId: ctrl.id, controlRef: `NDPA ${ctrl.ref}`, controlTitle: ctrl.title,
      rating: (controlRatings[ctrl.id] ?? "not_assessed") as any,
    }));
    saveRatings.mutate({ engagementId: selectedAudit.id, dpcoOrgId: selectedAudit.dpco_organisation_id ?? DEMO_DPCO_ORG_ID, ratings });
  };

  const handleGenerateCAR = () => {
    if (!selectedAudit) return;
    const compliant = Object.values(controlRatings).filter(v => v === "compliant").length;
    const score = Math.round((compliant / NDPA_CONTROLS.length) * 100);
    const params = new URLSearchParams({
      engagementId: String(selectedAudit.id),
      clientName: selectedAudit.client_name ?? selectedAudit.org_name ?? "",
      complianceScore: String(selectedAudit.compliance_score ?? score),
      leadAuditor: selectedAudit.lead_auditor ?? "",
      auditType: selectedAudit.audit_type ?? "annual_car",
      findingsCount: String(selectedAudit.findings_count ?? 0),
    });
    navigate(`/car?${params.toString()}`);
  };

  const rows = audits ?? [];
  const stageIdx = (stage: string) => AUDIT_STAGES.findIndex(s => s.key === stage);
  const ratedCount = Object.values(controlRatings).filter(v => v && v !== "not_assessed").length;
  const compliantCount = Object.values(controlRatings).filter(v => v === "compliant").length;
  const partialCount = Object.values(controlRatings).filter(v => v === "partial").length;
  const nonCompliantCount = Object.values(controlRatings).filter(v => v === "non_compliant").length;
  const complianceScore = ratedCount > 0 ? Math.round((compliantCount / NDPA_CONTROLS.length) * 100) : null;

  const currentStage = selectedAudit ? (selectedAudit.current_stage ?? selectedAudit.status) : null;
  const currentStageIdx = currentStage ? stageIdx(currentStage) : -1;
  const nextStage = currentStageIdx >= 0 && currentStageIdx < AUDIT_STAGES.length - 1
    ? AUDIT_STAGES[currentStageIdx + 1] : null;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Audit Workspace</h1>
            <p className="text-xs text-muted-foreground mt-0.5">NDPA 2023 §33 &amp; §44 — End-to-end compliance audit pipeline</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-muted-foreground hover:text-foreground hover:bg-card h-8 px-3">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-primary hover:bg-cyan-500 text-white h-8 px-4 text-xs font-medium">
                <Plus className="w-3.5 h-3.5 mr-1.5" /> New Audit
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-background border-border/60 max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-foreground flex items-center gap-2">
                  <FileCheck className="w-5 h-5 text-primary" /> Initiate Compliance Audit
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <Label className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Conducting DPCO *</Label>
                  <Select value={form.dpcoOrganisationId} onValueChange={v => setForm(f => ({ ...f, dpcoOrganisationId: v }))}>
                    <SelectTrigger className="bg-card border-border text-foreground mt-1.5 h-9">
                      <SelectValue placeholder="Select DPCO" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border max-h-48">
                      {(dpcoList?.rows ?? []).map((d: any) => (
                        <SelectItem key={d.id} value={String(d.id)} className="text-foreground">{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Client Organisation *</Label>
                  <Select value={form.organisationId} onValueChange={v => setForm(f => ({ ...f, organisationId: v }))}>
                    <SelectTrigger className="bg-card border-border text-foreground mt-1.5 h-9">
                      <SelectValue placeholder="Select organisation" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border max-h-48">
                      {((orgList as any)?.organizations ?? []).map((o: any) => (
                        <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Audit Year</Label>
                  <Input type="number" value={form.auditYear} onChange={e => setForm(f => ({ ...f, auditYear: e.target.value }))} className="bg-card border-border text-foreground mt-1.5 h-9" />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Audit Type</Label>
                  <Select value={form.auditType} onValueChange={v => setForm(f => ({ ...f, auditType: v }))}>
                    <SelectTrigger className="bg-card border-border text-foreground mt-1.5 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {[["annual_car","Annual CAR"],["ad_hoc","Ad-hoc"],["initial","Initial Assessment"],["follow_up","Follow-up"]].map(([k,v]) => (
                        <SelectItem key={k} value={k} className="text-foreground">{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {[
                  { label: "Planned Start", key: "plannedStartDate", type: "date" },
                  { label: "Planned End",   key: "plannedEndDate",   type: "date" },
                  { label: "Lead Auditor",  key: "leadAuditor" },
                ].map(({ label, key, type: t }) => (
                  <div key={key}>
                    <Label className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</Label>
                    <Input type={t ?? "text"} value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="bg-card border-border text-foreground mt-1.5 h-9" />
                  </div>
                ))}
                <div className="col-span-2">
                  <Label className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Audit Scope</Label>
                  <textarea value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))} className="w-full bg-card border border-border text-foreground rounded-md px-3 py-2 text-sm mt-1.5 h-20 resize-none focus-visible:outline-none focus:ring-1 focus:ring-cyan-500" placeholder="Describe audit scope..." />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border/60">
                <Button variant="outline" onClick={() => setShowCreate(false)} className="border-input text-foreground hover:bg-card">Cancel</Button>
                <Button className="bg-primary hover:bg-cyan-500 text-white" onClick={() => create.mutate({ ...form, dpcoOrganisationId: Number(form.dpcoOrganisationId), organisationId: Number(form.organisationId), auditYear: Number(form.auditYear) } as any)} disabled={!form.dpcoOrganisationId || !form.organisationId || create.isPending}>
                  {create.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : "Initiate Audit"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── Stage Filter Pills ───────────────────────────────────────── */}
      <div className="px-6 py-3 border-b border-border flex items-center gap-1.5 flex-wrap shrink-0">
        {[{ key: "all", label: "All Stages" }, ...AUDIT_STAGES].map(s => (
          <button
            key={s.key}
            onClick={() => setFilterStage(s.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
              filterStage === s.key
                ? "bg-cyan-500/20 text-primary border border-cyan-500/40"
                : "text-muted-foreground hover:text-foreground hover:bg-card border border-transparent"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Tab Bar ─────────────────────────────────────────────────── */}
      <div className="px-6 flex items-center gap-1 border-b border-border shrink-0 bg-background">
        <button
          onClick={() => setActiveTab("engagements")}
          className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === "engagements"
              ? "border-cyan-500 text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ClipboardList className="w-3.5 h-3.5" /> Engagements
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-card text-muted-foreground text-xs">{rows.length}</span>
        </button>
        <button
          onClick={() => setActiveTab("requests")}
          className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === "requests"
              ? "border-cyan-500 text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Inbox className="w-3.5 h-3.5" /> Incoming Requests
          {pendingCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-semibold">{pendingCount}</span>
          )}
        </button>
      </div>

      {/* ── Main Content ─────────────────────────────────────────────── */}

      {/* ── Incoming Requests Tab ────────────────────────────────────── */}
      {activeTab === "requests" && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Engagement Requests</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Organisations requesting your DPCO audit services via the NDSEP Org Portal</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => refetchRequests()} className="text-muted-foreground hover:text-foreground text-xs">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
              </Button>
            </div>

            {(incomingRequests?.rows ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 rounded-2xl bg-card border border-border flex items-center justify-center mb-4">
                  <Inbox className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground font-medium">No engagement requests yet</p>
                <p className="text-muted-foreground text-sm mt-1 max-w-xs">When regulated organisations submit requests via the Org Portal, they will appear here for your review.</p>
              </div>
            ) : (
              (incomingRequests?.rows ?? []).map((req: any) => {
                const isPending = req.status === "pending";
                const isAccepted = req.status === "accepted";
                const isDeclined = req.status === "declined";
                return (
                  <div key={req.id} className={`rounded-xl border p-5 transition-all ${
                    isPending ? "border-amber-500/30 bg-amber-500/5" :
                    isAccepted ? "border-emerald-500/20 bg-emerald-500/5" :
                    "border-border bg-muted/30"
                  }`}>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-card border border-border flex items-center justify-center shrink-0">
                          <Building2 className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">{req.org_name}</h3>
                          <p className="text-xs text-muted-foreground">{req.org_sector} · {req.org_country}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
                          isPending ? "bg-amber-500/10 text-amber-300 border-amber-500/30" :
                          isAccepted ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" :
                          "bg-muted/40 text-muted-foreground border-input/40"
                        }`}>
                          {isPending && <Clock className="w-3 h-3" />}
                          {isAccepted && <CheckCheck className="w-3 h-3" />}
                          {isDeclined && <XCircle className="w-3 h-3" />}
                          {isPending ? "Pending" : isAccepted ? "Accepted" : isDeclined ? "Declined" : req.status}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">{req.reference_token}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 text-xs">
                      <div>
                        <p className="text-muted-foreground mb-0.5">Contact</p>
                        <p className="text-foreground font-medium">{req.contact_name}</p>
                        <p className="text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" />{req.contact_email}</p>
                        {req.contact_phone && <p className="text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{req.contact_phone}</p>}
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-0.5">Submitted</p>
                        <p className="text-foreground">{new Date(req.created_at).toLocaleDateString()}</p>
                        {req.preferred_start_date && (
                          <p className="text-muted-foreground">Preferred start: {new Date(req.preferred_start_date).toLocaleDateString()}</p>
                        )}
                      </div>
                      {req.estimated_data_subjects && (
                        <div>
                          <p className="text-muted-foreground mb-0.5">Data Subjects</p>
                          <p className="text-foreground">{req.estimated_data_subjects}</p>
                        </div>
                      )}
                    </div>

                    {req.audit_scope && (
                      <div className="mb-4 p-3 rounded-lg bg-card border border-border/40">
                        <p className="text-xs text-muted-foreground mb-1">Audit Scope</p>
                        <p className="text-xs text-foreground">{req.audit_scope}</p>
                      </div>
                    )}

                    {req.dpco_response_note && (
                      <div className="mb-4 p-3 rounded-lg bg-muted/30 border border-border/30">
                        <p className="text-xs text-muted-foreground mb-1">Your Response</p>
                        <p className="text-xs text-muted-foreground">{req.dpco_response_note}</p>
                      </div>
                    )}

                    {isPending && (
                      respondingTo?.id === req.id ? (
                        <div className="space-y-3 pt-3 border-t border-border/40">
                          <Textarea
                            placeholder="Optional message to the organisation (e.g. capacity confirmation, scheduling note, or reason for declining)…"
                            value={responseNote}
                            onChange={e => setResponseNote(e.target.value)}
                            className="bg-background border-border text-foreground text-xs min-h-[80px]"
                          />
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
                              disabled={respondMutation.isPending}
                              onClick={() => respondMutation.mutate({ requestId: req.id, decision: "accepted", responseNote: responseNote || undefined })}
                            >
                              <CheckCheck className="w-3.5 h-3.5 mr-1.5" /> Accept Request
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10 text-xs"
                              disabled={respondMutation.isPending}
                              onClick={() => respondMutation.mutate({ requestId: req.id, decision: "declined", responseNote: responseNote || undefined })}
                            >
                              <XCircle className="w-3.5 h-3.5 mr-1.5" /> Decline
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground text-xs"
                              onClick={() => { setRespondingTo(null); setResponseNote(""); }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="pt-3 border-t border-border/40 flex gap-2">
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
                            onClick={() => { setRespondingTo(req); setResponseNote(""); }}
                          >
                            <CheckCheck className="w-3.5 h-3.5 mr-1.5" /> Respond
                          </Button>
                        </div>
                      )
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === "engagements" && <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Audit List */}
        <div className="w-[340px] shrink-0 border-r border-border flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Engagements</span>
            <span className="text-xs text-muted-foreground">{rows.length} total</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Loading audits…
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <FileCheck className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-muted-foreground text-sm font-medium">No audit engagements</p>
                <p className="text-muted-foreground text-xs mt-1">Initiate your first audit above</p>
              </div>
            ) : rows.map((audit: any) => {
              const idx = stageIdx(audit.current_stage ?? audit.status);
              const stage = audit.current_stage ?? audit.status;
              const badge = STAGE_BADGE[stage] ?? { bg: "bg-muted/40", text: "text-muted-foreground", dot: "bg-muted-foreground" };
              const isSelected = selectedAudit?.id === audit.id;
              return (
                <div
                  key={audit.id}
                  onClick={() => setSelectedAudit(audit)}
                  className={`group rounded-xl border p-4 cursor-pointer transition-all ${
                    isSelected
                      ? "bg-cyan-500/5 border-cyan-500/40 shadow-[0_0_0_1px_rgba(6,182,212,0.15)]"
                      : "bg-background/60 border-border hover:border-border hover:bg-background"
                  }`}
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? "bg-cyan-500/15" : "bg-card"}`}>
                        <Building2 className={`w-4 h-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-foreground font-medium text-sm truncate">
                          {audit.client_name ?? audit.org_name ?? `Org #${audit.client_organisation_id ?? audit.organisation_id}`}
                        </div>
                        <div className="text-muted-foreground text-xs mt-0.5 truncate">
                          {audit.dpco_name ?? `DPCO #${audit.dpco_organisation_id}`} · {audit.audit_year}
                        </div>
                      </div>
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                      {stage?.replace(/_/g, " ")}
                    </span>
                  </div>
                  {/* Progress track */}
                  <div className="flex items-center gap-0.5 mb-2">
                    {AUDIT_STAGES.map((s, i) => (
                      <div
                        key={s.key}
                        title={s.label}
                        className={`h-1 flex-1 rounded-full transition-all ${
                          i < idx ? "bg-emerald-500" : i === idx ? "bg-cyan-400" : "bg-muted/60"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Stage {idx + 1} of {AUDIT_STAGES.length}</span>
                    {audit.lead_auditor && (
                      <span className="text-muted-foreground text-xs flex items-center gap-1">
                        <User className="w-3 h-3" /> {audit.lead_auditor}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Detail Panel */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
          {selectedAudit ? (
            <div className="flex flex-col h-full min-h-0">
              {/* Detail header */}
              <div className="px-6 py-4 border-b border-border shrink-0">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-foreground font-semibold text-base">
                      {selectedAudit.client_name ?? selectedAudit.org_name}
                    </h2>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-muted-foreground text-xs flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> {selectedAudit.dpco_name ?? "DataGuard Ltd"}
                      </span>
                      <span className="text-muted-foreground text-xs flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {selectedAudit.audit_year}
                      </span>
                      {selectedAudit.lead_auditor && (
                        <span className="text-muted-foreground text-xs flex items-center gap-1">
                          <User className="w-3 h-3" /> {selectedAudit.lead_auditor}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {nextStage && (
                      <div className="flex flex-col items-end gap-1">
                        {nextStage.key === "car_filed" && carFilingBlocked && (
                          <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
                            <AlertCircle className="w-3 h-3" />
                            {licenceExpired ? "Licence expired — renew to file CAR" : `Licence expires in ${daysUntilExpiry}d — renew before filing`}
                          </div>
                        )}
                        <Button
                          size="sm"
                          className={nextStage.key === "car_filed" && carFilingBlocked
                            ? "bg-muted text-muted-foreground cursor-not-allowed h-8 px-4 text-xs"
                            : "bg-primary hover:bg-cyan-500 text-white h-8 px-4 text-xs"}
                          onClick={() => {
                            if (nextStage.key === "car_filed" && carFilingBlocked) {
                              toast.error(licenceExpired
                                ? "Your DPCO licence has expired. Renew at DPCO → Licence Renewal before filing a CAR."
                                : `Your licence expires in ${daysUntilExpiry} days. Please renew before filing a CAR.`);
                              return;
                            }
                            advance.mutate({ id: selectedAudit.id, status: nextStage.key } as any);
                          }}
                          disabled={advance.isPending}
                        >
                          {advance.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5 mr-1.5" />}
                          Advance to {nextStage.label}
                        </Button>
                      </div>
                    )}
                    {currentStage === "report_issued" && (
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-500 text-white h-8 px-4 text-xs"
                        onClick={handleGenerateCAR}
                      >
                        <FileText className="w-3.5 h-3.5 mr-1.5" /> Generate CAR
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Two-column body */}
              <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* Stage timeline */}
                <div className="w-44 shrink-0 border-r border-border overflow-y-auto p-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Pipeline</p>
                  <div className="relative">
                    {/* Vertical connector line */}
                    <div className="absolute left-[15px] top-4 bottom-4 w-px bg-card" />
                    <div className="space-y-1">
                      {AUDIT_STAGES.map((s, i) => {
                        const done = i < currentStageIdx;
                        const current = i === currentStageIdx;
                        return (
                          <div key={s.key} className={`flex items-start gap-3 px-1 py-2 rounded-lg transition-colors ${current ? "bg-cyan-500/8" : ""}`}>
                            <div className="relative z-10 shrink-0 mt-0.5">
                              {done ? (
                                <CheckCircle2 className="w-[18px] h-[18px] text-emerald-600" />
                              ) : current ? (
                                <div className="w-[18px] h-[18px] rounded-full border-2 border-cyan-400 bg-cyan-400/20 flex items-center justify-center">
                                  <div className="w-2 h-2 rounded-full bg-cyan-400" />
                                </div>
                              ) : (
                                <Circle className="w-[18px] h-[18px] text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0 pt-0.5">
                              <div className={`text-xs font-medium leading-tight ${
                                done ? "text-muted-foreground" : current ? "text-primary" : "text-muted-foreground"
                              }`}>{s.label}</div>
                              <div className={`text-xs mt-0.5 leading-tight ${done ? "text-muted-foreground" : current ? "text-muted-foreground" : "text-muted-foreground"}`}>
                                {s.desc}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Controls Assessment */}
                <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
                  {/* Controls header */}
                  <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">NDPA Controls Assessment</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Score badge */}
                      {complianceScore !== null && (
                        <div className="flex items-center gap-1.5">
                          <TrendingUp className="w-3.5 h-3.5 text-primary" />
                          <span className={`text-sm font-bold ${complianceScore >= 70 ? "text-emerald-600" : complianceScore >= 40 ? "text-amber-400" : "text-rose-400"}`}>
                            {complianceScore}%
                          </span>
                        </div>
                      )}
                      {isDirty && (
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white h-7 px-3 text-xs" onClick={handleSaveRatings} disabled={saveRatings.isPending}>
                          {saveRatings.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                          Save
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Score summary strip */}
                  {ratedCount > 0 && (
                    <div className="px-5 py-2.5 border-b border-border flex items-center gap-4 bg-muted/30 shrink-0">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-emerald-600 font-medium">{compliantCount}</span>
                        <span className="text-muted-foreground">Compliant</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        <span className="text-amber-400 font-medium">{partialCount}</span>
                        <span className="text-muted-foreground">Partial</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="w-2 h-2 rounded-full bg-rose-400" />
                        <span className="text-rose-400 font-medium">{nonCompliantCount}</span>
                        <span className="text-muted-foreground">Non-Compliant</span>
                      </div>
                      <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                        {ratedCount}/{NDPA_CONTROLS.length} assessed
                        {isDirty && <span className="ml-2 text-amber-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Unsaved</span>}
                      </div>
                    </div>
                  )}

                  {/* Controls table */}
                  <div className="flex-1 overflow-y-auto">
                    {ratingsLoading ? (
                      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading ratings…
                      </div>
                    ) : (
                      <table className="w-full table-fixed text-sm">
                        <colgroup>
                          <col className="w-9" />
                          <col />
                          <col className="w-16" />
                          <col className="w-36" />
                        </colgroup>
                        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                          <tr className="border-b border-border">
                            <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ID</th>
                            <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Control</th>
                            <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ref</th>
                            <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rating</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {NDPA_CONTROLS.map((ctrl, idx) => {
                            const rating = controlRatings[ctrl.id] ?? "not_assessed";
                            return (
                              <tr key={ctrl.id} className={`transition-colors ${idx % 2 === 0 ? "bg-background/20" : ""} hover:bg-muted/20`}>
                                <td className="px-2 py-2.5">
                                  <span className="text-xs font-mono font-semibold text-muted-foreground">{ctrl.id}</span>
                                </td>
                                <td className="px-2 py-2.5">
                                  <div className="text-foreground text-xs font-medium leading-snug">{ctrl.title}</div>
                                  <div className="text-muted-foreground text-xs">{ctrl.category}</div>
                                </td>
                                <td className="px-2 py-2.5">
                                  <span className="text-xs text-muted-foreground font-mono">NDPA {ctrl.ref}</span>
                                </td>
                                <td className="px-2 py-2.5">
                                  <Select value={rating} onValueChange={v => handleRatingChange(ctrl.id, v)}>
                                    <SelectTrigger className={`h-7 w-full text-xs border-0 rounded-full px-2 font-medium focus:ring-1 focus:ring-cyan-500 ${RATING_PILL[rating]}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-card border-border">
                                      {RATING_OPTIONS.map(([k, v, cls]) => (
                                        <SelectItem key={k} value={k} className={`text-xs ${cls}`}>{v}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <div className="w-16 h-16 rounded-2xl bg-card border border-border flex items-center justify-center mb-4">
                <ArrowRight className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground font-medium">Select an engagement</p>
              <p className="text-muted-foreground text-sm mt-1 max-w-xs">Choose an audit from the list to view its pipeline, assess NDPA controls, and advance stages</p>
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}
