import React from "react";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, Plus, AlertTriangle, CheckCircle, Clock, FileSearch, CheckCircle2, XCircle, Send, ListChecks , Trash2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const RISK_COLORS: Record<string, string> = {
  low: "bg-green-500/20 text-green-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  high: "bg-orange-500/20 text-orange-400",
  critical: "bg-red-500/20 text-red-400",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted0/20 text-muted-foreground",
  under_review: "bg-blue-500/20 text-blue-400",
  approved: "bg-green-500/20 text-green-400",
  rejected: "bg-red-500/20 text-red-400",
};

const LEGAL_BASES = [
  "Adequacy Decision",
  "Standard Contractual Clauses (SCCs)",
  "Binding Corporate Rules (BCRs)",
  "Explicit Consent",
  "Vital Interests",
  "Public Interest",
  "Legitimate Interests",
];

const DATA_CATEGORIES = [
  "Personal Data",
  "Sensitive Personal Data",
  "Financial Data",
  "Health Data",
  "Biometric Data",
  "Government Records",
  "Communications Data",
  "Location Data",
];

const COUNTRIES = [
  "Nigeria", "Ghana", "Kenya", "South Africa", "Egypt",
  "USA", "UK", "EU (GDPR)", "Germany", "France",
  "China", "India", "UAE", "Singapore", "Brazil",
];

type TabKey = "all" | "pending" | "approved" | "rejected";

export default function TiaAssessments() {
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [form, setForm] = useState({
    organizationId: "",
    destinationCountry: "",
    legalBasis: "",
    riskLevel: "medium" as "low" | "medium" | "high" | "critical",
    tiaDocument: "",
    safeguards: "",
  });

  const [reviewTarget, setReviewTarget] = useState<{ id: number; action: "approve" | "reject" } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";

  const { data: assessments = [], refetch } = trpc.tia.list.useQuery({});
  const { data: stats } = trpc.tia.stats.useQuery();
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 100 });

  const submitMutation = trpc.tia.submit.useMutation({
    onSuccess: () => { toast.success("TIA submitted for review"); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const approveMutation = trpc.tia.approve.useMutation({
    onSuccess: () => { toast.success("TIA approved — email notification sent"); setReviewTarget(null); setReviewNote(""); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const rejectMutation = trpc.tia.reject.useMutation({
    onSuccess: () => { toast.success("TIA rejected — email notification sent"); setReviewTarget(null); setReviewNote(""); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const createMutation = trpc.tia.create.useMutation({
    onSuccess: () => {
      toast.success("TIA assessment created successfully");
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.tia.delete.useMutation({
    onSuccess: () => {
      toast.success("Tia assessment deleted successfully");
      setDeleteId(null);
      utils.tia.list.invalidate().catch(() => {});
    },
    onError: (err) => toast.error(err.message || "Failed to delete TIA assessment"),
  });
      setShowCreate(false);
      setForm({ organizationId: "", destinationCountry: "", legalBasis: "", riskLevel: "medium", tiaDocument: "", safeguards: "" });
      setSelectedCategories([]);
      refetch();
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Tia Assessments" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Transfer Impact Assessments</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Evaluate cross-border data transfer risks and legal compliance before approving transfers
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" /> New TIA
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">Total Assessments</div>
          <div className="text-2xl font-bold text-foreground">{(stats as any)?.total ?? 0}</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">High / Critical Risk</div>
          <div className="text-2xl font-bold text-red-400">{(stats as any)?.high_risk ?? 0}</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">Approved</div>
          <div className="text-2xl font-bold text-green-400">{(stats as any)?.approved ?? 0}</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">Pending Review</div>
          <div className="text-2xl font-bold text-yellow-400">{(stats as any)?.pending ?? 0}</div>
        </div>
      </div>

      {/* Tab Navigation */}
      {(() => {
        const allList = assessments as any[];
        const pendingList = allList.filter((a: any) => a.status === "submitted");
        const approvedList = allList.filter((a: any) => a.status === "approved");
        const rejectedList = allList.filter((a: any) => a.status === "rejected");
        const tabs: { key: TabKey; label: string; count: number; color: string }[] = [
          { key: "all", label: "All Assessments", count: allList.length, color: "text-muted-foreground" },
          { key: "pending", label: "Pending Review", count: pendingList.length, color: "text-yellow-400" },
          { key: "approved", label: "Approved", count: approvedList.length, color: "text-green-400" },
          { key: "rejected", label: "Rejected", count: rejectedList.length, color: "text-red-400" },
        ];
        const visibleList = activeTab === "all" ? allList : activeTab === "pending" ? pendingList : activeTab === "approved" ? approvedList : rejectedList;
        return (
          <>
            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-border">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? `border-blue-500 ${tab.color}`
                      : "border-transparent text-muted-foreground hover:text-muted-foreground"
                  }`}
                >
                  {tab.key === "pending" && <ListChecks className="w-3.5 h-3.5" />}
                  {tab.label}
                  {tab.count > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      activeTab === tab.key ? "bg-blue-500/20 text-blue-300" : "bg-muted text-muted-foreground"
                    }`}>{tab.count}</span>
                  )}
                </button>
              ))}
              {activeTab === "pending" && isAdmin && pendingList.length > 1 && (
                <div className="ml-auto pr-2">
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-xs"
                    onClick={() => {
                      // Bulk approve all pending — open confirm
                      if (window.confirm(`Approve all ${pendingList.length} pending TIAs?`)) {
                        pendingList.forEach((a: any) => approveMutation.mutate({ id: a.id }));
                      }
                    }}
                    disabled={approveMutation.isPending}
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Approve All ({pendingList.length})
                  </Button>
                </div>
              )}
            </div>

            {/* TIA Table */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-background/50">
                  <tr>
                    {["ID", "Organization", "Destination", "Data Categories", "Legal Basis", "Risk Level", "Status", "Created", "Actions"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleList.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-muted-foreground">
                        <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p>{activeTab === "pending" ? "No TIAs awaiting review." : activeTab === "all" ? "No TIA assessments yet. Create one to evaluate cross-border transfer risks." : `No ${activeTab} assessments.`}</p>
                      </td>
                    </tr>
                  ) : visibleList.map((a: any) => (
              <tr key={a.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-4 py-3 font-mono text-xs text-blue-400">TIA-{String(a.id).padStart(5, "0")}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{a.organizationId ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  <div className="flex items-center gap-1">
                    <Globe className="w-3 h-3 text-muted-foreground" />
                    {a.destinationCountry}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs">
                  <div className="flex flex-wrap gap-1">
                    {(a.dataCategories ?? []).slice(0, 2).map((c: string) => (
                      <Badge key={c} variant="outline" className="text-[9px] border-border text-muted-foreground">{c}</Badge>
                    ))}
                    {(a.dataCategories ?? []).length > 2 && (
                      <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">+{(a.dataCategories ?? []).length - 2}</Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs max-w-xs truncate">{a.legalBasis}</td>
                <td className="px-4 py-3">
                  <Badge className={`text-xs ${RISK_COLORS[a.riskLevel] ?? "bg-muted0/20 text-muted-foreground"}`}>
                    {a.riskLevel}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge className={`text-xs ${STATUS_COLORS[a.status] ?? "bg-muted0/20 text-muted-foreground"}`}>
                    {a.status?.replace("_", " ")}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {a.status === "draft" && (
                      <Button size="sm" variant="outline" className="text-xs border-blue-600/50 text-blue-400 hover:bg-blue-500/10"
                        onClick={() => submitMutation.mutate({ id: a.id })} disabled={submitMutation.isPending}>
                        <Send className="w-3 h-3 mr-1" /> Submit
                      </Button>
                    )}
                    {a.status === "submitted" && isAdmin && (
                      <>
                        <Button size="sm" variant="outline" className="text-xs border-green-600/50 text-green-400 hover:bg-green-500/10"
                          onClick={() => { setReviewTarget({ id: a.id, action: "approve" }); setReviewNote(""); }}>
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs border-red-600/50 text-red-400 hover:bg-red-500/10"
                          onClick={() => { setReviewTarget({ id: a.id, action: "reject" }); setReviewNote(""); }}>
                          <XCircle className="w-3 h-3 mr-1" /> Reject
                        </Button>
                      </>
                    )}
                  </div>
                </td>
                </tr>
              ))}
              </tbody>
              </table>
            </div>

            {/* Info Banner */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex gap-3">
              <FileSearch className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-300">Transfer Impact Assessment (TIA)</p>
                <p className="text-xs text-blue-400/80 mt-1">
                  A TIA evaluates the legal and technical safeguards in place when transferring personal data to third countries.
                  Required under NDPR Article 43 and GDPR Chapter V. Each assessment must document the legal basis, data categories,
                  destination country's adequacy status, and technical safeguards applied.
                </p>
              </div>
            </div>
          </>
        );
      })()}

      {/* Review Dialog */}
      <Dialog open={!!reviewTarget} onOpenChange={() => setReviewTarget(null)}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader>
            <DialogTitle className={reviewTarget?.action === "approve" ? "text-green-400" : "text-red-400"}>
              {reviewTarget?.action === "approve" ? "Approve" : "Reject"} TIA-{String(reviewTarget?.id ?? 0).padStart(5, "0")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {reviewTarget?.action === "approve"
                ? "Approving this TIA will authorize the cross-border data transfer and notify the organization by email."
                : "Rejecting this TIA will block the transfer and notify the organization with your reason."}
            </p>
            <div>
              <Label>{reviewTarget?.action === "approve" ? "Approval Notes (optional)" : "Rejection Reason (required)"}</Label>
              <Textarea
                className="bg-card border-border mt-1 text-sm"
                rows={3}
                placeholder={reviewTarget?.action === "approve" ? "Any conditions or notes for the organization..." : "Explain why this transfer is not approved..."}
                value={reviewNote}
                onChange={e => setReviewNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>Cancel</Button>
            <Button
              className={reviewTarget?.action === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
              disabled={(reviewTarget?.action === "reject" && !reviewNote) || approveMutation.isPending || rejectMutation.isPending}
              onClick={() => {
                if (!reviewTarget) return;
                if (reviewTarget.action === "approve") {
                  approveMutation.mutate({ id: reviewTarget.id, notes: reviewNote || undefined });
                } else {
                  rejectMutation.mutate({ id: reviewTarget.id, reason: reviewNote });
                }
              }}
            >
              {reviewTarget?.action === "approve" ? "Approve & Notify" : "Reject & Notify"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-lg">
          <DialogHeader><DialogTitle>New Transfer Impact Assessment</DialogTitle></DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <Label>Organization</Label>
              <Select value={form.organizationId} onValueChange={v => setForm(p => ({ ...p, organizationId: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue placeholder="Select organization..." /></SelectTrigger>
                <SelectContent>{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Destination Country</Label>
              <Select value={form.destinationCountry} onValueChange={v => setForm(p => ({ ...p, destinationCountry: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue placeholder="Select destination..." /></SelectTrigger>
                <SelectContent>{COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Legal Basis for Transfer</Label>
              <Select value={form.legalBasis} onValueChange={v => setForm(p => ({ ...p, legalBasis: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue placeholder="Select legal basis..." /></SelectTrigger>
                <SelectContent>{LEGAL_BASES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Risk Level</Label>
              <Select value={form.riskLevel} onValueChange={v => setForm(p => ({ ...p, riskLevel: v as any }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["low", "medium", "high", "critical"].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-2 block">Data Categories</Label>
              <div className="flex flex-wrap gap-2">
                {DATA_CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      selectedCategories.includes(cat)
                        ? "border-blue-500 bg-blue-500/20 text-blue-300"
                        : "border-border text-muted-foreground hover:border-muted-foreground"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Safeguards Applied</Label>
              <Textarea
                className="bg-card border-border mt-1 text-sm"
                rows={2}
                placeholder="Describe technical and organizational safeguards (encryption, pseudonymization, access controls)..."
                value={form.safeguards}
                onChange={e => setForm(p => ({ ...p, safeguards: e.target.value }))}
              />
            </div>
            <div>
              <Label>TIA Document / Notes</Label>
              <Textarea
                className="bg-card border-border mt-1 text-sm"
                rows={3}
                placeholder="Document the assessment findings, risks identified, and mitigation measures..."
                value={form.tiaDocument}
                onChange={e => setForm(p => ({ ...p, tiaDocument: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={!form.organizationId || !form.destinationCountry || !form.legalBasis || createMutation.isPending}
              onClick={() => createMutation.mutate({
                organizationId: Number(form.organizationId),
                destinationCountry: form.destinationCountry,
                legalBasis: form.legalBasis,
                riskLevel: form.riskLevel,
                dataCategories: selectedCategories,
                tiaDocument: form.tiaDocument || undefined,
                safeguards: form.safeguards || undefined,
              })}
            >
              {createMutation.isPending ? "Creating..." : "Create Assessment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
