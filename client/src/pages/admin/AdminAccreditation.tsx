import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Search, Eye, CheckCircle, XCircle, AlertCircle, Clock,
  ChevronRight, Building2, Users, FileText, ShieldCheck,
  Award, Calendar, ExternalLink, RefreshCw, Ban, Gavel, Download
} from "lucide-react";

const REVIEW_CHECKLIST = [
  { key: "legal_incorporation_verified", label: "Legal incorporation documents verified" },
  { key: "rc_number_valid", label: "RC number validated with CAC registry" },
  { key: "lead_auditor_qualifications_met", label: "Lead auditor qualifications meet minimum standard (≥2 certified)" },
  { key: "audit_methodology_adequate", label: "Audit methodology covers all 15 NDPA control domains" },
  { key: "indemnity_insurance_sufficient", label: "Professional indemnity insurance ≥ ₦50M confirmed" },
  { key: "conflict_of_interest_clear", label: "No material conflict of interest identified" },
  { key: "financial_statements_reviewed", label: "Financial statements reviewed (last 2 years)" },
  { key: "independence_confirmed", label: "Organisational independence from prospective clients confirmed" },
  { key: "no_outstanding_sanctions", label: "No outstanding sanctions from NDPC, CAC, or professional bodies" },
  { key: "fee_payment_confirmed", label: "Application fee payment confirmed" },
];

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  info_requested: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  under_review: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  competency_scheduled: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  approved: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  conditionally_approved: "bg-teal-500/20 text-teal-300 border-teal-500/30",
  rejected: "bg-red-500/20 text-red-300 border-red-500/30",
  suspended: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  revoked: "bg-red-700/20 text-red-400 border-red-700/30",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", submitted: "Submitted", info_requested: "Info Requested",
  under_review: "Under Review", competency_scheduled: "Competency Scheduled",
  approved: "Approved", conditionally_approved: "Conditionally Approved",
  rejected: "Rejected", suspended: "Suspended", revoked: "Revoked",
};

function CertificateDownloadButton({ applicationId, dpcoName }: { applicationId: number; dpcoName: string }) {
  const generateCert = trpc.accreditation.generateCertificate.useMutation({
    onSuccess: (cert) => {
      // Build a printable certificate HTML and open in new tab
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>NDPC DPCO Accreditation Certificate</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;500;600&display=swap');
  body { margin: 0; padding: 40px; background: #f8f9fa; font-family: 'Inter', sans-serif; }
  .cert { max-width: 800px; margin: 0 auto; background: white; border: 3px solid #065f46; border-radius: 12px; padding: 60px; text-align: center; }
  .seal { width: 80px; height: 80px; background: #065f46; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; color: white; font-size: 32px; }
  .title { font-family: 'Playfair Display', serif; font-size: 28px; color: #065f46; margin: 0 0 8px; }
  .subtitle { font-size: 14px; color: #6b7280; margin-bottom: 30px; }
  .divider { border: none; border-top: 2px solid #d1fae5; margin: 24px 0; }
  .dpco-name { font-size: 24px; font-weight: 700; color: #111827; margin: 16px 0; }
  .detail { font-size: 13px; color: #374151; margin: 6px 0; }
  .licence { font-size: 16px; font-weight: 600; color: #065f46; font-family: monospace; background: #ecfdf5; padding: 8px 20px; border-radius: 6px; display: inline-block; margin: 12px 0; }
  .footer { margin-top: 40px; font-size: 11px; color: #9ca3af; }
  .signatory { margin-top: 30px; }
  .sig-line { border-top: 1px solid #374151; width: 200px; margin: 0 auto 6px; }
  @media print { body { background: white; padding: 0; } }
</style>
</head>
<body>
<div class="cert">
  <div class="seal">✓</div>
  <h1 class="title">Nigeria Data Protection Commission</h1>
  <p class="subtitle">CERTIFICATE OF ACCREDITATION</p>
  <p class="subtitle">This is to certify that</p>
  <hr class="divider" />
  <p class="dpco-name">${cert.dpcoName}</p>
  <p class="detail">has been duly accredited as a <strong>Data Protection Compliance Organisation (DPCO)</strong></p>
  <p class="detail">under the Nigeria Data Protection Act 2023 (NDPA 2023) Section 33</p>
  <hr class="divider" />
  <p class="licence">${cert.certNumber}</p>
  <p class="detail">RC Number: ${cert.rcNumber ?? 'N/A'}</p>
  <p class="detail">Sectors: ${cert.sectors ?? 'General'}</p>
  <p class="detail">Date Issued: <strong>${cert.issuedDate}</strong></p>
  <p class="detail">Valid Until: <strong>${cert.expiryDate}</strong></p>
  <div class="signatory">
    <div class="sig-line"></div>
    <p class="detail"><strong>${cert.signatoryName}</strong></p>
    <p class="detail" style="font-size:11px;color:#9ca3af;">Nigeria Data Protection Commission</p>
  </div>
  <div class="footer">
    <p>Verify this certificate at: ${cert.verifyUrl}</p>
    <p>This certificate is issued under the authority of the NDPC and is subject to annual renewal.</p>
  </div>
</div>
<script>window.onload = () => window.print();</script>
</body>
</html>`;
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      toast.success(`Certificate generated for ${dpcoName}`);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => generateCert.mutate({ applicationId })}
      disabled={generateCert.isPending}
      className="border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 gap-1 text-xs"
    >
      <Download className="w-3.5 h-3.5" />
      {generateCert.isPending ? "Generating..." : "Download Certificate"}
    </Button>
  );
}

export default function AdminAccreditation() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Decision modal state
  const [showDecision, setShowDecision] = useState(false);
  const [decisionType, setDecisionType] = useState<"approved" | "conditionally_approved" | "rejected">("approved");
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionConditions, setDecisionConditions] = useState("");

  // Info request modal
  const [showInfoRequest, setShowInfoRequest] = useState(false);
  const [infoNote, setInfoNote] = useState("");

  // Suspend/revoke modal
  const [showSuspend, setShowSuspend] = useState(false);
  const [showRevoke, setShowRevoke] = useState(false);
  const [sanctionReason, setSanctionReason] = useState("");

  // Competency scheduling
  const [showCompetency, setShowCompetency] = useState(false);
  const [competencyDate, setCompetencyDate] = useState("");

  const { data: listData, refetch: refetchList } = trpc.accreditation.adminListApplications.useQuery({
    status: statusFilter || undefined,
    search: search || undefined,
    limit: 100,
  });

  const { data: stats } = trpc.accreditation.adminGetStats.useQuery();

  const { data: detail, refetch: refetchDetail } = trpc.accreditation.adminGetApplication.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId }
  );

  const startReview = trpc.accreditation.adminStartReview.useMutation({
    onSuccess: () => { toast.success("Review started"); refetchDetail(); refetchList(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const updateChecklist = trpc.accreditation.adminUpdateChecklist.useMutation({
    onSuccess: () => refetchDetail(),
  });

  const requestInfo = trpc.accreditation.adminRequestInfo.useMutation({
    onSuccess: () => { toast.success("Information request sent"); setShowInfoRequest(false); setInfoNote(""); refetchDetail(); refetchList(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const scheduleCompetency = trpc.accreditation.adminScheduleCompetency.useMutation({
    onSuccess: () => { toast.success("Competency assessment scheduled"); setShowCompetency(false); refetchDetail(); refetchList(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const makeDecision = trpc.accreditation.adminMakeDecision.useMutation({
    onSuccess: (data) => {
      toast.success(`Application ${decisionType.replace("_", " ")}. Licence: ${data.licenceNumber ?? "N/A"}`);
      setShowDecision(false); setDecisionReason(""); setDecisionConditions("");
      refetchDetail(); refetchList();
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const suspend = trpc.accreditation.adminSuspend.useMutation({
    onSuccess: () => { toast.success("DPCO suspended"); setShowSuspend(false); setSanctionReason(""); refetchDetail(); refetchList(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const revoke = trpc.accreditation.adminRevoke.useMutation({
    onSuccess: () => { toast.success("DPCO accreditation revoked"); setShowRevoke(false); setSanctionReason(""); refetchDetail(); refetchList(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const checklist: Record<string, boolean> = (detail as any)?.review_checklist ?? {};
  const checklistProgress = REVIEW_CHECKLIST.filter(k => checklist[k.key]).length;

  const handleChecklistToggle = (key: string) => {
    if (!selectedId) return;
    const updated = { ...checklist, [key]: !checklist[key] };
    updateChecklist.mutate({ id: selectedId, checklist: updated });
  };

  const rows = listData?.rows ?? [];

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      {/* Left panel — application list */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Accreditation Applications
          </h2>
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-card rounded p-2 text-center">
                <p className="text-lg font-bold text-foreground">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
              <div className="bg-blue-500/10 rounded p-2 text-center">
                <p className="text-lg font-bold text-blue-300">{(stats.byStatus["submitted"] ?? 0) + (stats.byStatus["under_review"] ?? 0)}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
              <div className="bg-emerald-500/10 rounded p-2 text-center">
                <p className="text-lg font-bold text-emerald-300">{stats.activeDpcos}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </div>
          )}
          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search applications..."
              className="pl-8 h-8 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="w-full h-8 text-xs bg-card border border-border rounded px-2 text-muted-foreground">
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 && (
            <div className="p-6 text-center text-muted-foreground text-sm">No applications found</div>
          )}
          {rows.map((row: any) => (
            <button key={row.id} onClick={() => setSelectedId(row.id)}
              className={`w-full text-left p-3 border-b border-border hover:bg-card/50 transition-colors ${selectedId === row.id ? "bg-card" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{row.org_name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{row.reference_token}</p>
                </div>
                <Badge className={`text-xs shrink-0 border ${STATUS_BADGE[row.status] ?? "bg-muted text-muted-foreground"}`}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {row.submitted_at ? new Date(row.submitted_at).toLocaleDateString("en-NG") : "Draft"}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Right panel — detail view */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {!selectedId && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select an application to review</p>
            </div>
          </div>
        )}

        {detail && (
          <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{(detail as any).org_name}</h2>
                <p className="text-xs font-mono text-muted-foreground">{(detail as any).reference_token}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={`text-xs border ${STATUS_BADGE[(detail as any).status] ?? ""}`}>
                  {STATUS_LABELS[(detail as any).status] ?? (detail as any).status}
                </Badge>
                {(detail as any).status === "submitted" && (
                  <Button size="sm" onClick={() => startReview.mutate({ id: detail.id })}
                    disabled={startReview.isPending}
                    className="bg-purple-600 hover:bg-purple-700 text-foreground h-7 text-xs gap-1">
                    <Eye className="w-3 h-3" /> Start Review
                  </Button>
                )}
              </div>
            </div>

            {/* Entity info */}
            <div className="bg-background border border-border rounded-lg p-4">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> Entity Details
              </h3>
              <div className="grid grid-cols-3 gap-3 text-sm">
                {[
                  ["RC Number", (detail as any).rc_number],
                  ["CAC Number", (detail as any).cac_number ?? "—"],
                  ["Tax ID", (detail as any).tax_id ?? "—"],
                  ["Email", (detail as any).email],
                  ["Phone", (detail as any).phone ?? "—"],
                  ["Website", (detail as any).website ?? "—"],
                  ["Application Type", (detail as any).application_type],
                  ["Submitted", (detail as any).submitted_at ? new Date((detail as any).submitted_at).toLocaleDateString("en-NG") : "—"],
                  ["Sectors", ((detail as any).sectors ?? []).join(", ") || "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-muted-foreground text-xs">{k}</p>
                    <p className="text-foreground text-sm truncate">{v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-muted-foreground text-xs mb-1">Address</p>
                <p className="text-foreground text-sm">{(detail as any).address}</p>
              </div>
            </div>

            {/* Lead auditors */}
            <div className="bg-background border border-border rounded-lg p-4">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Lead Auditors
              </h3>
              <div className="space-y-2">
                {((detail as any).lead_auditors ?? []).map((a: any, i: number) => (
                  <div key={i} className="flex items-start justify-between bg-card rounded p-2.5">
                    <div>
                      <p className="text-sm font-medium text-foreground">{a.name}</p>
                      <p className="text-xs text-muted-foreground">{a.email}</p>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end max-w-48">
                      {(a.certifications ?? []).map((c: string) => (
                        <span key={c} className="text-xs bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">{c}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Documents */}
            <div className="bg-background border border-border rounded-lg p-4">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Submitted Documents
              </h3>
              <div className="space-y-2">
                {[
                  ["Certificate of Incorporation", (detail as any).incorporation_doc_url],
                  ["Financial Statements", (detail as any).financial_statements_url],
                  ["Indemnity Insurance", (detail as any).indemnity_insurance_url],
                  ["Audit Methodology", (detail as any).audit_methodology_url],
                ].map(([label, url]) => (
                  <div key={label} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                    <span className="text-sm text-muted-foreground">{label}</span>
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="sm" className="text-emerald-400 hover:text-emerald-300 h-6 gap-1 text-xs">
                          <ExternalLink className="w-3 h-3" /> View
                        </Button>
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not submitted</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Review checklist */}
            {["under_review", "competency_scheduled", "info_requested"].includes((detail as any).status) && (
              <div className="bg-background border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5" /> Review Checklist
                  </h3>
                  <span className="text-xs text-muted-foreground">{checklistProgress}/{REVIEW_CHECKLIST.length} complete</span>
                </div>
                <div className="w-full bg-card rounded-full h-1.5 mb-3">
                  <div className="bg-emerald-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${(checklistProgress / REVIEW_CHECKLIST.length) * 100}%` }} />
                </div>
                <div className="space-y-2">
                  {REVIEW_CHECKLIST.map(item => (
                    <div key={item.key} className="flex items-center gap-2.5 cursor-pointer"
                      onClick={() => handleChecklistToggle(item.key)}>
                      <Checkbox checked={!!checklist[item.key]} className="border-border shrink-0" />
                      <span className={`text-sm ${checklist[item.key] ? "text-muted-foreground" : "text-muted-foreground"}`}>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Decision info (if decided) */}
            {(detail as any).decision && (
              <div className={`border rounded-lg p-4 ${
                (detail as any).decision === "approved" || (detail as any).decision === "conditionally_approved"
                  ? "bg-emerald-500/10 border-emerald-500/30"
                  : "bg-red-500/10 border-red-500/30"
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <Award className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-medium text-foreground">Decision: {STATUS_LABELS[(detail as any).decision]}</h3>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {(detail as any).decision_at ? new Date((detail as any).decision_at).toLocaleDateString("en-NG") : ""}
                  </span>
                </div>
                {(detail as any).issued_licence_number && (
                  <p className="text-sm text-foreground mb-1">Licence: <span className="font-mono font-bold text-emerald-400">{(detail as any).issued_licence_number}</span></p>
                )}
                {(detail as any).decision_reason && <p className="text-sm text-muted-foreground">{(detail as any).decision_reason}</p>}
                {(detail as any).conditions && <p className="text-sm text-amber-300 mt-1">Conditions: {(detail as any).conditions}</p>}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              {["under_review", "info_requested", "competency_scheduled"].includes((detail as any).status) && (
                <>
                  <Button size="sm" onClick={() => { setDecisionType("approved"); setShowDecision(true); }}
                    className="bg-emerald-600 hover:bg-emerald-700 text-foreground gap-1 text-xs">
                    <CheckCircle className="w-3.5 h-3.5" /> Approve
                  </Button>
                  <Button size="sm" onClick={() => { setDecisionType("conditionally_approved"); setShowDecision(true); }}
                    className="bg-teal-600 hover:bg-teal-700 text-foreground gap-1 text-xs">
                    <CheckCircle className="w-3.5 h-3.5" /> Conditional Approval
                  </Button>
                  <Button size="sm" onClick={() => { setDecisionType("rejected"); setShowDecision(true); }}
                    className="bg-red-700 hover:bg-red-800 text-foreground gap-1 text-xs">
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowInfoRequest(true)}
                    className="border-amber-500/50 text-amber-300 hover:bg-amber-500/10 gap-1 text-xs">
                    <AlertCircle className="w-3.5 h-3.5" /> Request Info
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowCompetency(true)}
                    className="border-indigo-500/50 text-indigo-300 hover:bg-indigo-500/10 gap-1 text-xs">
                    <Calendar className="w-3.5 h-3.5" /> Schedule Competency
                  </Button>
                </>
              )}
              {(detail as any).status === "approved" && (
                <>
                  <CertificateDownloadButton applicationId={(detail as any).id} dpcoName={(detail as any).org_name} />
                  <Button size="sm" variant="outline" onClick={() => setShowSuspend(true)}
                    className="border-orange-500/50 text-orange-300 hover:bg-orange-500/10 gap-1 text-xs">
                    <Ban className="w-3.5 h-3.5" /> Suspend
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowRevoke(true)}
                    className="border-red-500/50 text-red-300 hover:bg-red-500/10 gap-1 text-xs">
                    <Gavel className="w-3.5 h-3.5" /> Revoke
                  </Button>
                </>
              )}
              {(detail as any).status === "suspended" && (
                <Button size="sm" variant="outline" onClick={() => setShowRevoke(true)}
                  className="border-red-500/50 text-red-300 hover:bg-red-500/10 gap-1 text-xs">
                  <Gavel className="w-3.5 h-3.5" /> Revoke
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Decision modal */}
      {showDecision && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-foreground mb-1">
              {decisionType === "approved" ? "Approve Application" :
               decisionType === "conditionally_approved" ? "Conditional Approval" : "Reject Application"}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">This action will be recorded and the applicant will be notified.</p>
            <div className="space-y-3">
              <div>
                <Label className="text-muted-foreground text-xs mb-1 block">Decision Reason <span className="text-red-400">*</span></Label>
                <Textarea value={decisionReason} onChange={e => setDecisionReason(e.target.value)}
                  placeholder="Provide a clear reason for this decision..."
                  className="bg-card border-border text-foreground placeholder:text-muted-foreground resize-none text-sm" rows={3} />
              </div>
              {decisionType === "conditionally_approved" && (
                <div>
                  <Label className="text-muted-foreground text-xs mb-1 block">Conditions</Label>
                  <Textarea value={decisionConditions} onChange={e => setDecisionConditions(e.target.value)}
                    placeholder="Specify conditions that must be met..."
                    className="bg-card border-border text-foreground placeholder:text-muted-foreground resize-none text-sm" rows={2} />
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="ghost" onClick={() => setShowDecision(false)} className="flex-1 text-muted-foreground">Cancel</Button>
              <Button onClick={() => makeDecision.mutate({ id: selectedId!, decision: decisionType, reason: decisionReason, conditions: decisionConditions || undefined })}
                disabled={!decisionReason || makeDecision.isPending}
                className={`flex-1 text-foreground ${decisionType === "rejected" ? "bg-red-700 hover:bg-red-800" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                {makeDecision.isPending ? "Processing..." : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Info request modal */}
      {showInfoRequest && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-foreground mb-4">Request Additional Information</h3>
            <Textarea value={infoNote} onChange={e => setInfoNote(e.target.value)}
              placeholder="Describe what additional information or documents are required..."
              className="bg-card border-border text-foreground placeholder:text-muted-foreground resize-none text-sm" rows={4} />
            <div className="flex gap-2 mt-4">
              <Button variant="ghost" onClick={() => setShowInfoRequest(false)} className="flex-1 text-muted-foreground">Cancel</Button>
              <Button onClick={() => requestInfo.mutate({ id: selectedId!, note: infoNote })}
                disabled={infoNote.length < 10 || requestInfo.isPending}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-foreground">
                {requestInfo.isPending ? "Sending..." : "Send Request"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Competency scheduling modal */}
      {showCompetency && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-foreground mb-4">Schedule Competency Assessment</h3>
            <Input type="datetime-local" value={competencyDate} onChange={e => setCompetencyDate(e.target.value)}
              className="bg-card border-border text-foreground" />
            <div className="flex gap-2 mt-4">
              <Button variant="ghost" onClick={() => setShowCompetency(false)} className="flex-1 text-muted-foreground">Cancel</Button>
              <Button onClick={() => scheduleCompetency.mutate({ id: selectedId!, scheduledAt: competencyDate })}
                disabled={!competencyDate || scheduleCompetency.isPending}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-foreground">
                Schedule
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Suspend modal */}
      {showSuspend && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-foreground mb-1">Suspend DPCO Accreditation</h3>
            <p className="text-xs text-amber-400 mb-4">This will prevent the DPCO from filing new CARs until the suspension is lifted.</p>
            <Textarea value={sanctionReason} onChange={e => setSanctionReason(e.target.value)}
              placeholder="State the grounds for suspension..."
              className="bg-card border-border text-foreground placeholder:text-muted-foreground resize-none text-sm" rows={3} />
            <div className="flex gap-2 mt-4">
              <Button variant="ghost" onClick={() => setShowSuspend(false)} className="flex-1 text-muted-foreground">Cancel</Button>
              <Button onClick={() => suspend.mutate({ id: selectedId!, reason: sanctionReason })}
                disabled={sanctionReason.length < 5 || suspend.isPending}
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-foreground">
                {suspend.isPending ? "Processing..." : "Suspend"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke modal */}
      {showRevoke && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-foreground mb-1">Revoke DPCO Accreditation</h3>
            <p className="text-xs text-red-400 mb-4">This is irreversible. The DPCO will be removed from the public registry immediately.</p>
            <Textarea value={sanctionReason} onChange={e => setSanctionReason(e.target.value)}
              placeholder="State the grounds for revocation..."
              className="bg-card border-border text-foreground placeholder:text-muted-foreground resize-none text-sm" rows={3} />
            <div className="flex gap-2 mt-4">
              <Button variant="ghost" onClick={() => setShowRevoke(false)} className="flex-1 text-muted-foreground">Cancel</Button>
              <Button onClick={() => revoke.mutate({ id: selectedId!, reason: sanctionReason })}
                disabled={sanctionReason.length < 5 || revoke.isPending}
                className="flex-1 bg-red-700 hover:bg-red-800 text-foreground">
                {revoke.isPending ? "Processing..." : "Revoke Accreditation"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
