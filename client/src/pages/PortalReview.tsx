import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  ClipboardCheck, Building2, CheckCircle2, XCircle, ArrowRight,
  Award, Clock, Filter, RefreshCw, Eye, FileText, ChevronDown
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const PHASE_ORDER = ["registration", "asset_inventory", "data_catalog", "self_assessment", "initial_audit", "remediation", "certified"];
const PHASE_LABELS: Record<string, string> = {
  registration: "Registration",
  asset_inventory: "Asset Inventory",
  data_catalog: "Data Catalog",
  self_assessment: "Self Assessment",
  initial_audit: "Initial Audit",
  remediation: "Remediation",
  certified: "Certified",
};
const PHASE_COLORS: Record<string, string> = {
  registration: "#6b7280",
  asset_inventory: "#3b82f6",
  data_catalog: "#8b5cf6",
  self_assessment: "#f59e0b",
  initial_audit: "#f97316",
  remediation: "#ef4444",
  certified: "#10b981",
};

function PhaseProgress({ phase }: { phase: string }) {
  const idx = PHASE_ORDER.indexOf(phase);
  const pct = idx < 0 ? 0 : Math.round(((idx) / (PHASE_ORDER.length - 1)) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-xs mono" style={{ color: PHASE_COLORS[phase] ?? "#6b7280" }}>
          {PHASE_LABELS[phase] ?? phase}
        </span>
        <span className="text-xs mono text-muted-foreground">{pct}%</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

function CertificatePDF({ submission }: { submission: any }) {
  const handleGenerate = () => {
    const certDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const certNumber = `NDSEP-CERT-${submission.id}-${Date.now().toString(36).toUpperCase()}`;
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>NDSEP Compliance Certificate</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;600;700&display=swap');
  body { font-family: 'Inter', sans-serif; margin: 0; padding: 40px; background: #fff; color: #1a1a2e; }
  .cert { border: 3px solid #2563eb; border-radius: 12px; padding: 48px; max-width: 800px; margin: 0 auto; }
  .header { text-align: center; border-bottom: 2px solid #e5e7eb; padding-bottom: 24px; margin-bottom: 32px; }
  .logo { font-family: 'JetBrains Mono', monospace; font-size: 28px; font-weight: 700; color: #2563eb; letter-spacing: 4px; }
  .subtitle { font-size: 12px; color: #6b7280; letter-spacing: 3px; text-transform: uppercase; margin-top: 4px; }
  .title { font-size: 22px; font-weight: 700; margin: 24px 0 8px; color: #1a1a2e; }
  .org-name { font-size: 32px; font-weight: 700; color: #2563eb; margin: 16px 0; }
  .body { text-align: center; }
  .detail { display: flex; justify-content: space-between; margin: 8px 0; padding: 8px 16px; background: #f9fafb; border-radius: 6px; }
  .detail-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; }
  .detail-value { font-size: 13px; font-weight: 600; font-family: 'JetBrains Mono', monospace; }
  .seal { text-align: center; margin: 32px 0; }
  .seal-circle { display: inline-block; width: 100px; height: 100px; border: 4px solid #10b981; border-radius: 50%; line-height: 100px; font-size: 40px; }
  .footer { text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; }
  .cert-number { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #6b7280; margin-top: 8px; }
</style>
</head>
<body>
<div class="cert">
  <div class="header">
    <div class="logo">NDSEP</div>
    <div class="subtitle">National Data Sovereignty Enforcement Platform</div>
  </div>
  <div class="body">
    <div class="title">CERTIFICATE OF DATA SOVEREIGNTY COMPLIANCE</div>
    <p style="color:#6b7280;font-size:14px;">This is to certify that</p>
    <div class="org-name">${submission.orgName ?? submission.org_name ?? "Organization"}</div>
    <p style="color:#374151;font-size:14px;max-width:500px;margin:0 auto 24px;">has successfully completed all phases of the National Data Sovereignty Compliance Program and is hereby certified as compliant with national data residency, security, and governance requirements.</p>
    <div style="max-width:500px;margin:0 auto;">
      <div class="detail"><span class="detail-label">Sector</span><span class="detail-value">${submission.orgSector ?? submission.org_sector ?? "—"}</span></div>
      <div class="detail"><span class="detail-label">Country</span><span class="detail-value">${submission.orgCountry ?? submission.org_country ?? "—"}</span></div>
      <div class="detail"><span class="detail-label">Contact</span><span class="detail-value">${submission.contactName ?? submission.contact_name ?? "—"}</span></div>
      <div class="detail"><span class="detail-label">Self-Assessment Score</span><span class="detail-value">${submission.selfAssessmentScore ?? submission.self_assessment_score ?? "—"}/100</span></div>
      <div class="detail"><span class="detail-label">Certified On</span><span class="detail-value">${certDate}</span></div>
      <div class="detail"><span class="detail-label">Valid Until</span><span class="detail-value">${new Date(Date.now() + 365 * 24 * 3600 * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span></div>
    </div>
    <div class="seal"><div class="seal-circle">✓</div></div>
    <div class="cert-number">Certificate No: ${certNumber}</div>
  </div>
  <div class="footer">
    <p>This certificate is issued by the National Data Sovereignty Enforcement Platform (NDSEP) and is valid for one year from the date of issuance.</p>
    <p>Verify authenticity at: ndsep.gov/verify/${certNumber}</p>
  </div>
</div>
</body>
</html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `NDSEP-Certificate-${(submission.orgName ?? submission.org_name ?? "org").replace(/\s+/g, "-")}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Certificate downloaded as HTML — open in browser to print as PDF");
  };
  return (
    <Button size="sm" variant="outline" onClick={handleGenerate} className="gap-1.5 text-green-600 border-green-600/30 hover:bg-green-600/10">
      <Award className="h-3.5 w-3.5" />
      Download Certificate
    </Button>
  );
}

export default function PortalReview() {
  const utils = trpc.useUtils();
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<"advance" | "reject" | "certify" | null>(null);

  const { data: submissions, isLoading, refetch } = trpc.portal.list.useQuery({
    limit: 100,
    phase: phaseFilter === "all" ? undefined : phaseFilter,
  });
  const { data: stats } = trpc.portal.stats.useQuery();

  const reviewMutation = trpc.portal.review.useMutation({
    onSuccess: (result) => {
      toast.success(`Submission ${pendingDecision === "certify" ? "certified" : pendingDecision === "advance" ? "advanced" : "sent to remediation"} → Phase: ${result.newPhase}`);
      utils.portal.list.invalidate();
      utils.portal.stats.invalidate();
      setReviewDialogOpen(false);
      setSelected(null);
      setReviewNotes("");
      setPendingDecision(null);
    },
    onError: (err) => {
      toast.error(`Review failed: ${err.message}`);
    },
  });

  const filtered = (submissions ?? []).filter((s: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (s.orgName ?? s.org_name ?? "").toLowerCase().includes(q) ||
      (s.orgSector ?? s.org_sector ?? "").toLowerCase().includes(q) ||
      (s.contactEmail ?? s.contact_email ?? "").toLowerCase().includes(q)
    );
  });

  function openReview(sub: any, decision: "advance" | "reject" | "certify") {
    setSelected(sub);
    setPendingDecision(decision);
    setReviewNotes("");
    setReviewDialogOpen(true);
  }

  function confirmReview() {
    if (!selected || !pendingDecision) return;
    reviewMutation.mutate({ id: selected.id, decision: pendingDecision, notes: reviewNotes });
  }

  const phaseGroups = PHASE_ORDER.filter(p => p !== "certified");

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Portal Review" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">REV</span>
            <span className="data-label">Auditor Review Queue</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Portal Review Queue</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">Review and advance organization compliance submissions through certification phases</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Submissions", value: stats?.total ?? 0, color: "#2563eb" },
          { label: "Pending Review", value: (submissions ?? []).filter((s: any) => (s.currentPhase ?? s.current_phase) !== "certified").length, color: "#f59e0b" },
          { label: "Certified", value: stats?.certified ?? 0, color: "#10b981" },
          { label: "In Remediation", value: (submissions ?? []).filter((s: any) => (s.currentPhase ?? s.current_phase) === "remediation").length, color: "#ef4444" },
        ].map(stat => (
          <Card key={stat.label} className="border border-border/60">
            <CardContent className="p-4">
              <p className="data-label">{stat.label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: stat.color }}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center flex-wrap">
        <Input
          placeholder="Search by org, sector, or email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs h-9 mono text-sm"
        />
        <Select value={phaseFilter} onValueChange={setPhaseFilter}>
          <SelectTrigger className="w-48 h-9">
            <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="Filter by phase" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Phases</SelectItem>
            {PHASE_ORDER.map(p => (
              <SelectItem key={p} value={p}>{PHASE_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="data-label text-muted-foreground">{filtered.length} submission{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Submissions Table */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            Compliance Submissions
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground mono text-sm">Loading submissions...</div>
          ) : filtered.length === 0 ? (
            <EmptyState title="No submissions found" description="There are no pending submissions to review" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    <th className="text-left px-4 py-3 data-label font-semibold">Organization</th>
                    <th className="text-left px-4 py-3 data-label font-semibold">Sector</th>
                    <th className="text-left px-4 py-3 data-label font-semibold">Phase Progress</th>
                    <th className="text-left px-4 py-3 data-label font-semibold">Score</th>
                    <th className="text-left px-4 py-3 data-label font-semibold">Contact</th>
                    <th className="text-left px-4 py-3 data-label font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((sub: any) => {
                    const phase = sub.currentPhase ?? sub.current_phase ?? "registration";
                    const isCertified = phase === "certified";
                    const isLastPhase = phase === "initial_audit";
                    return (
                      <tr key={sub.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div>
                              <p className="font-medium text-foreground text-sm">{sub.orgName ?? sub.org_name}</p>
                              <p className="mono text-[10px] text-muted-foreground">{sub.orgCountry ?? sub.org_country}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="mono text-[10px]">{sub.orgSector ?? sub.org_sector}</Badge>
                        </td>
                        <td className="px-4 py-3 min-w-[180px]">
                          <PhaseProgress phase={phase} />
                        </td>
                        <td className="px-4 py-3">
                          <span className="mono text-sm font-semibold" style={{ color: Number(sub.selfAssessmentScore ?? sub.self_assessment_score ?? 0) >= 70 ? "#10b981" : "#f59e0b" }}>
                            {sub.selfAssessmentScore ?? sub.self_assessment_score ?? "—"}/100
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-xs text-foreground">{sub.contactName ?? sub.contact_name}</p>
                            <p className="mono text-[10px] text-muted-foreground">{sub.contactEmail ?? sub.contact_email}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isCertified ? (
                              <CertificatePDF submission={sub} />
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openReview(sub, isLastPhase ? "certify" : "advance")}
                                  className="gap-1 text-blue-600 border-blue-600/30 hover:bg-blue-600/10 h-7 text-xs"
                                >
                                  {isLastPhase ? <Award className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
                                  {isLastPhase ? "Certify" : "Advance"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openReview(sub, "reject")}
                                  className="gap-1 text-red-600 border-red-600/30 hover:bg-red-600/10 h-7 text-xs"
                                >
                                  <XCircle className="h-3 w-3" />
                                  Reject
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pendingDecision === "certify" ? (
                <><Award className="h-5 w-5 text-green-600" /> Certify Organization</>
              ) : pendingDecision === "advance" ? (
                <><ArrowRight className="h-5 w-5 text-blue-600" /> Advance to Next Phase</>
              ) : (
                <><XCircle className="h-5 w-5 text-red-600" /> Send to Remediation</>
              )}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-2">
              <div className="p-3 rounded-lg bg-muted/50 border border-border/60">
                <p className="font-semibold text-sm">{selected.orgName ?? selected.org_name}</p>
                <p className="mono text-xs text-muted-foreground mt-0.5">
                  Current phase: <span style={{ color: PHASE_COLORS[selected.currentPhase ?? selected.current_phase] }}>
                    {PHASE_LABELS[selected.currentPhase ?? selected.current_phase] ?? selected.currentPhase ?? selected.current_phase}
                  </span>
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="data-label">Review Notes</label>
                <Textarea
                  value={reviewNotes}
                  onChange={e => setReviewNotes(e.target.value)}
                  placeholder={pendingDecision === "reject" ? "Describe issues requiring remediation..." : "Optional notes for this review decision..."}
                  rows={3}
                  className="mono text-sm resize-none"
                />
              </div>
              {pendingDecision === "certify" && (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                  <p className="text-xs text-green-600 font-medium">This will mark the organization as fully certified. A compliance certificate will be available for download.</p>
                </div>
              )}
              {pendingDecision === "reject" && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                  <p className="text-xs text-red-600 font-medium">This will move the submission back to the Remediation phase. The organization will need to address issues before re-advancing.</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={confirmReview}
              disabled={reviewMutation.isPending}
              className={pendingDecision === "certify" ? "bg-green-600 hover:bg-green-700" : pendingDecision === "reject" ? "bg-red-600 hover:bg-red-700" : ""}
            >
              {reviewMutation.isPending ? "Processing..." : pendingDecision === "certify" ? "Certify" : pendingDecision === "advance" ? "Advance Phase" : "Send to Remediation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
