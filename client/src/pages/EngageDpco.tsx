import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Search, Building2, Shield, CheckCircle2, Clock, XCircle,
  ChevronRight, ChevronLeft, Award, Mail, Phone, Globe,
  Calendar, Users, FileText, Loader2, Copy, AlertCircle,
  Star, BadgeCheck, ArrowRight, RefreshCw
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const SECTORS = [
  { value: "bank", label: "Commercial Bank" },
  { value: "telecom", label: "Telecommunications" },
  { value: "healthcare", label: "Healthcare" },
  { value: "government", label: "Government Agency" },
  { value: "fintech", label: "Fintech / Payment" },
  { value: "energy", label: "Energy / Utilities" },
  { value: "insurance", label: "Insurance" },
  { value: "education", label: "Education" },
];

const PROCESSING_ACTIVITIES = [
  "Customer data processing",
  "Employee data management",
  "Marketing & analytics",
  "Payment processing",
  "Health records management",
  "Cross-border data transfers",
  "Automated decision-making",
  "Biometric data processing",
  "Children's data processing",
  "Third-party data sharing",
];

const TIER_COLORS: Record<string, string> = {
  starter: "bg-muted/50 text-muted-foreground border-border",
  professional: "bg-cyan-900/40 text-cyan-300 border-cyan-700",
  enterprise: "bg-violet-900/40 text-violet-300 border-violet-700",
};

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  pending:   { label: "Awaiting Response", icon: Clock,        color: "text-amber-400" },
  accepted:  { label: "Accepted",          icon: CheckCircle2, color: "text-emerald-400" },
  declined:  { label: "Declined",          icon: XCircle,      color: "text-red-400" },
  withdrawn: { label: "Withdrawn",         icon: XCircle,      color: "text-muted-foreground" },
  converted: { label: "Audit Started",     icon: BadgeCheck,   color: "text-cyan-400" },
};

type WizardStep = "browse" | "request" | "submitted" | "track";

export default function EngageDpco() {
  const [step, setStep] = useState<WizardStep>("browse");
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState<string>("");
  const [selectedDpco, setSelectedDpco] = useState<any>(null);
  const [trackToken, setTrackToken] = useState("");
  const [submittedToken, setSubmittedToken] = useState<string | null>(null);

  // Request form state
  const [form, setForm] = useState({
    orgName: "",
    orgSector: "",
    orgCountry: "",
    orgRegistrationNumber: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    auditScope: "",
    preferredStartDate: "",
    estimatedDataSubjects: "",
    processingActivities: [] as string[],
  });

  // Queries
  const dpcosQuery = trpc.dpco.listActiveDpcos.useQuery(
    { search: search || undefined, sector: sectorFilter || undefined, limit: 20 },
    { staleTime: 30_000 }
  );

  const trackQuery = trpc.dpco.getEngagementRequestStatus.useQuery(
    { referenceToken: trackToken },
    { enabled: false }
  );

  const submitMutation = trpc.dpco.submitEngagementRequest.useMutation({
    onSuccess: (data) => {
      setSubmittedToken(data.referenceToken);
      setStep("submitted");
      toast.success("Engagement request submitted", {
        description: `Reference: ${data.referenceToken}`,
      });
    },
    onError: (e) => toast.error("Submission failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const canSubmit = form.orgName && form.contactName && form.contactEmail && selectedDpco;

  const handleToggleActivity = (activity: string) => {
    setForm(f => ({
      ...f,
      processingActivities: f.processingActivities.includes(activity)
        ? f.processingActivities.filter(a => a !== activity)
        : [...f.processingActivities, activity],
    }));
  };

  const handleSubmit = () => {
    if (!selectedDpco) return;
    submitMutation.mutate({
      ...form,
      dpcoOrgId: selectedDpco.id,
      orgSector: form.orgSector || undefined,
      orgCountry: form.orgCountry || undefined,
      orgRegistrationNumber: form.orgRegistrationNumber || undefined,
      contactPhone: form.contactPhone || undefined,
      auditScope: form.auditScope || undefined,
      preferredStartDate: form.preferredStartDate || undefined,
      estimatedDataSubjects: form.estimatedDataSubjects || undefined,
      processingActivities: form.processingActivities.length ? form.processingActivities : undefined,
    });
  };

  const handleTrack = () => {
    if (!trackToken.trim()) return;
    trackQuery.refetch();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Engage Dpco" }]} className="mb-4" />
      {/* Header */}
      <div className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <Shield className="h-4 w-4 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Engage a DPCO</h1>
              <p className="text-xs text-muted-foreground">Find and request a licensed Data Protection Compliance Organisation</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {step !== "track" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setStep("track")}
              >
                <Search className="h-3.5 w-3.5 mr-1.5" />
                Track Request
              </Button>
            )}
            {step !== "browse" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { setStep("browse"); setSelectedDpco(null); }}
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Back to Registry
              </Button>
            )}
          </div>
        </div>

        {/* Progress indicator */}
        {step !== "track" && (
          <div className="max-w-5xl mx-auto px-6 pb-3 flex items-center gap-2">
            {[
              { id: "browse", label: "1. Browse DPCOs" },
              { id: "request", label: "2. Submit Request" },
              { id: "submitted", label: "3. Confirmation" },
            ].map((s, idx) => {
              const isActive = step === s.id;
              const isDone = (step === "request" && idx === 0) || (step === "submitted" && idx < 2);
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <span className={`text-xs font-medium transition-colors ${isActive ? "text-cyan-400" : isDone ? "text-muted-foreground" : "text-muted-foreground"}`}>
                    {s.label}
                  </span>
                  {idx < 2 && <ChevronRight className={`h-3 w-3 ${isDone || isActive ? "text-muted-foreground" : "text-muted-foreground"}`} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* ── Step 1: Browse DPCOs ──────────────────────────────────────────── */}
        {step === "browse" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground mb-1">NDPC-Accredited DPCO Registry</h2>
              <p className="text-sm text-muted-foreground">
                All organisations listed below are licensed by the NDPC under NDPA 2023 §33 to conduct statutory data protection audits.
              </p>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, or licence number…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 bg-background border-border text-foreground placeholder:text-muted-foreground focus:border-cyan-500/50"
                />
              </div>
              <Select value={sectorFilter} onValueChange={setSectorFilter}>
                <SelectTrigger className="w-full sm:w-48 bg-background border-border text-muted-foreground">
                  <SelectValue placeholder="All sectors" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="all">All sectors</SelectItem>
                  {SECTORS.map(s => (
                    <SelectItem key={s.value} value={s.value} className="text-foreground">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* DPCO Cards */}
            {dpcosQuery.isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading registry…
              </div>
            ) : dpcosQuery.data?.rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <Shield className="h-10 w-10 opacity-30" />
                <p className="text-sm">No active DPCOs found matching your criteria.</p>
                {(search || sectorFilter) && (
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setSearch(""); setSectorFilter(""); }}>
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{dpcosQuery.data?.total ?? 0} accredited DPCOs found</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {dpcosQuery.data?.rows.map((dpco: any) => (
                    <div
                      key={dpco.id}
                      className="group border border-border rounded-xl bg-background/50 hover:border-cyan-500/40 hover:bg-background transition-all cursor-pointer p-5"
                      onClick={() => { setSelectedDpco(dpco); setStep("request"); }}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-card border border-border flex items-center justify-center shrink-0">
                            <Building2 className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-foreground group-hover:text-cyan-300 transition-colors">{dpco.name}</h3>
                            <p className="text-xs text-muted-foreground font-mono">{dpco.licence_number}</p>
                          </div>
                        </div>
                        <Badge className={`text-xs border ${TIER_COLORS[dpco.tier] ?? TIER_COLORS.starter} capitalize`}>
                          {dpco.tier}
                        </Badge>
                      </div>

                      {dpco.sectors?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {(dpco.sectors as string[]).slice(0, 4).map((s: string) => (
                            <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-card text-muted-foreground border border-border">{s}</span>
                          ))}
                          {dpco.sectors.length > 4 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-card text-muted-foreground">+{dpco.sectors.length - 4}</span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {dpco.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{dpco.email}</span>}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity">
                          Request Engagement <ArrowRight className="h-3 w-3" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Demo notice if no DPCOs */}
            {!dpcosQuery.isLoading && (dpcosQuery.data?.rows.length ?? 0) === 0 && !search && !sectorFilter && (
              <div className="mt-4 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex items-start gap-3">
                <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-300">Demo Mode</p>
                  <p className="text-xs text-amber-400/70 mt-0.5">
                    No active DPCOs are registered yet. In production, the NDPC populates this registry with accredited firms. You can register DPCOs via the DPCO Registrations admin panel.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Request Form ──────────────────────────────────────────── */}
        {step === "request" && selectedDpco && (
          <div className="space-y-6">
            {/* Selected DPCO summary */}
            <div className="flex items-center gap-4 p-4 rounded-xl border border-cyan-500/30 bg-cyan-500/5">
              <div className="h-12 w-12 rounded-xl bg-card border border-border flex items-center justify-center shrink-0">
                <Building2 className="h-6 w-6 text-cyan-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground mb-0.5">Requesting audit from</p>
                <h3 className="text-base font-semibold text-foreground">{selectedDpco.name}</h3>
                <p className="text-xs text-muted-foreground font-mono">{selectedDpco.licence_number}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground shrink-0"
                onClick={() => { setSelectedDpco(null); setStep("browse"); }}
              >
                Change
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Organisation Details */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-cyan-400" /> Your Organisation
                </h3>
                <div>
                  <Label className="text-xs text-muted-foreground">Organisation Name *</Label>
                  <Input
                    placeholder="e.g. First National Bank of Nigeria"
                    value={form.orgName}
                    onChange={e => setForm(f => ({ ...f, orgName: e.target.value }))}
                    className="mt-1 bg-background border-border text-foreground focus:border-cyan-500/50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Sector</Label>
                    <Select value={form.orgSector} onValueChange={v => setForm(f => ({ ...f, orgSector: v }))}>
                      <SelectTrigger className="mt-1 bg-background border-border text-muted-foreground text-xs">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        {SECTORS.map(s => <SelectItem key={s.value} value={s.value} className="text-foreground text-xs">{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Country</Label>
                    <Input
                      placeholder="Nigeria"
                      value={form.orgCountry}
                      onChange={e => setForm(f => ({ ...f, orgCountry: e.target.value }))}
                      className="mt-1 bg-background border-border text-foreground text-xs focus:border-cyan-500/50"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Registration / Licence Number</Label>
                  <Input
                    placeholder="e.g. CBN/FIN/2024/001"
                    value={form.orgRegistrationNumber}
                    onChange={e => setForm(f => ({ ...f, orgRegistrationNumber: e.target.value }))}
                    className="mt-1 bg-background border-border text-foreground text-xs focus:border-cyan-500/50"
                  />
                </div>
              </div>

              {/* Contact Details */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                  <Mail className="h-4 w-4 text-cyan-400" /> Contact Person
                </h3>
                <div>
                  <Label className="text-xs text-muted-foreground">Compliance Officer / DPO Name *</Label>
                  <Input
                    placeholder="Full name"
                    value={form.contactName}
                    onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))}
                    className="mt-1 bg-background border-border text-foreground focus:border-cyan-500/50"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Email Address *</Label>
                  <Input
                    type="email"
                    placeholder="compliance@organisation.com"
                    value={form.contactEmail}
                    onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
                    className="mt-1 bg-background border-border text-foreground focus:border-cyan-500/50"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Phone Number</Label>
                  <Input
                    placeholder="+234 800 000 0000"
                    value={form.contactPhone}
                    onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))}
                    className="mt-1 bg-background border-border text-foreground text-xs focus:border-cyan-500/50"
                  />
                </div>
              </div>
            </div>

            {/* Audit Scope */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4 text-cyan-400" /> Audit Scope
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Scope Description</Label>
                  <Textarea
                    placeholder="Describe what you need audited — e.g. full NDPA compliance audit covering all 15 controls, or a targeted gap assessment for cross-border transfers…"
                    value={form.auditScope}
                    onChange={e => setForm(f => ({ ...f, auditScope: e.target.value }))}
                    className="mt-1 bg-background border-border text-foreground text-xs focus:border-cyan-500/50 min-h-[100px]"
                  />
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Calendar className="h-3 w-3" /> Preferred Start Date
                    </Label>
                    <Input
                      type="date"
                      value={form.preferredStartDate}
                      onChange={e => setForm(f => ({ ...f, preferredStartDate: e.target.value }))}
                      className="mt-1 bg-background border-border text-foreground text-xs focus:border-cyan-500/50"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Users className="h-3 w-3" /> Estimated Data Subjects
                    </Label>
                    <Select value={form.estimatedDataSubjects} onValueChange={v => setForm(f => ({ ...f, estimatedDataSubjects: v }))}>
                      <SelectTrigger className="mt-1 bg-background border-border text-muted-foreground text-xs">
                        <SelectValue placeholder="Select range…" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        {["Under 1,000", "1,000 – 10,000", "10,000 – 100,000", "100,000 – 1M", "Over 1M"].map(v => (
                          <SelectItem key={v} value={v} className="text-foreground text-xs">{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Processing Activities */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Processing Activities (select all that apply)</Label>
                <div className="flex flex-wrap gap-2">
                  {PROCESSING_ACTIVITIES.map(activity => {
                    const selected = form.processingActivities.includes(activity);
                    return (
                      <button
                        key={activity}
                        onClick={() => handleToggleActivity(activity)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                          selected
                            ? "bg-cyan-500/15 border-cyan-500/50 text-cyan-300"
                            : "bg-background border-border text-muted-foreground hover:border-primary hover:text-muted-foreground"
                        }`}
                      >
                        {selected && <span className="mr-1">✓</span>}{activity}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="flex items-center justify-between pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Your request will be sent to <span className="text-muted-foreground">{selectedDpco.name}</span> for review.
                You will receive a reference token to track the status.
              </p>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || submitMutation.isPending}
                className="bg-cyan-600 hover:bg-cyan-500 text-foreground text-sm px-6"
              >
                {submitMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</>
                ) : (
                  <>Submit Request <ArrowRight className="h-4 w-4 ml-2" /></>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Submitted Confirmation ───────────────────────────────── */}
        {step === "submitted" && submittedToken && (
          <div className="flex flex-col items-center justify-center py-12 max-w-lg mx-auto text-center space-y-6">
            <div className="h-20 w-20 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Request Submitted</h2>
              <p className="text-sm text-muted-foreground">
                Your engagement request has been sent to <span className="text-foreground">{selectedDpco?.name}</span>.
                They will review your request and respond within 5 business days.
              </p>
            </div>

            <div className="w-full bg-background border border-border rounded-xl p-5 text-left space-y-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Reference Token</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono text-cyan-300 bg-card px-3 py-2 rounded-lg border border-border">
                  {submittedToken}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => { navigator.clipboard.writeText(submittedToken); toast.success("Copied to clipboard"); }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Save this token — you will need it to track the status of your request.
              </p>
            </div>

            <div className="w-full bg-background border border-border rounded-xl p-4 text-left">
              <p className="text-xs font-semibold text-muted-foreground mb-3">What happens next?</p>
              <div className="space-y-2.5">
                {[
                  { icon: Clock, text: "The DPCO reviews your request and confirms capacity (typically 1–3 business days)" },
                  { icon: Mail, text: "You will be contacted at your provided email to discuss scope, timeline, and fees" },
                  { icon: FileText, text: "Once agreed, the DPCO registers the formal engagement in NDSEP and the audit pipeline begins" },
                  { icon: Award, text: "Upon completion, the DPCO submits a Compliance Audit Return (CAR) to the NDPC" },
                ].map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2.5">
                    <item.icon className="h-3.5 w-3.5 text-cyan-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-border text-muted-foreground"
                onClick={() => { setStep("track"); setTrackToken(submittedToken); }}
              >
                <Search className="h-3.5 w-3.5 mr-1.5" /> Track This Request
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => { setStep("browse"); setSelectedDpco(null); setSubmittedToken(null); }}
              >
                Submit Another Request
              </Button>
            </div>
          </div>
        )}

        {/* ── Track Request ─────────────────────────────────────────────────── */}
        {step === "track" && (
          <div className="max-w-xl mx-auto space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground mb-1">Track Engagement Request</h2>
              <p className="text-sm text-muted-foreground">
                Enter your reference token to check the status of your DPCO engagement request.
              </p>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="e.g. ENG-M5X9K2-AB3C"
                value={trackToken}
                onChange={e => setTrackToken(e.target.value.toUpperCase())}
                className="bg-background border-border text-foreground font-mono focus:border-cyan-500/50"
                onKeyDown={e => e.key === "Enter" && handleTrack()}
              />
              <Button
                onClick={handleTrack}
                disabled={!trackToken.trim() || trackQuery.isFetching}
                className="bg-cyan-600 hover:bg-cyan-500 text-foreground shrink-0"
              >
                {trackQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {trackQuery.error && (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Request not found. Please check your reference token.
              </div>
            )}

            {trackQuery.data && (() => {
              const req = trackQuery.data as any;
              const statusCfg = STATUS_CONFIG[req.status] ?? STATUS_CONFIG.pending;
              const StatusIcon = statusCfg.icon;
              return (
                <div className="border border-border rounded-xl bg-background/50 overflow-hidden">
                  <div className="p-5 border-b border-border flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Reference</p>
                      <code className="text-sm font-mono text-cyan-300">{req.reference_token}</code>
                    </div>
                    <div className={`flex items-center gap-1.5 text-sm font-medium ${statusCfg.color}`}>
                      <StatusIcon className="h-4 w-4" />
                      {statusCfg.label}
                    </div>
                  </div>
                  <div className="p-5 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Organisation</p>
                      <p className="text-foreground font-medium">{req.org_name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">DPCO</p>
                      <p className="text-foreground font-medium">{req.dpco_name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Contact</p>
                      <p className="text-muted-foreground text-xs">{req.contact_name}</p>
                      <p className="text-muted-foreground text-xs">{req.contact_email}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Submitted</p>
                      <p className="text-muted-foreground text-xs">{new Date(req.created_at).toLocaleDateString()}</p>
                    </div>
                    {req.dpco_response_note && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">DPCO Response</p>
                        <p className="text-muted-foreground text-xs bg-card rounded-lg p-3 border border-border">{req.dpco_response_note}</p>
                      </div>
                    )}
                    {req.audit_scope && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">Audit Scope</p>
                        <p className="text-muted-foreground text-xs">{req.audit_scope}</p>
                      </div>
                    )}
                  </div>
                  <div className="px-5 pb-4 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      onClick={handleTrack}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
