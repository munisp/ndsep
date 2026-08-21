import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowRightLeft, Plus, CheckCircle2, XCircle, Clock, AlertTriangle,
  Globe, Database, Shield, FileText, ChevronDown, ChevronUp, Filter,
  Lock, Unlock, RefreshCw, Eye, Trash2
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const COUNTRIES = [
  "Nigeria", "Ghana", "Kenya", "South Africa", "Egypt", "Ethiopia",
  "Tanzania", "Rwanda", "Senegal", "Côte d'Ivoire", "Cameroon", "Uganda",
  "United States", "United Kingdom", "Germany", "France", "China", "India",
  "Singapore", "United Arab Emirates",
];

const DATA_CLASSIFICATIONS = [
  { value: "tier1_pii", label: "Tier 1 — PII / Personal Data", risk: "critical" },
  { value: "tier2_financial", label: "Tier 2 — Financial Records", risk: "high" },
  { value: "tier3_health", label: "Tier 3 — Health / Medical", risk: "high" },
  { value: "tier4_government", label: "Tier 4 — Government / Classified", risk: "critical" },
  { value: "tier5_public", label: "Tier 5 — Public / Non-Sensitive", risk: "low" },
];

const TRANSFER_METHODS = [
  "SWIFT / Wire Transfer", "API Integration", "SFTP / Encrypted File Transfer",
  "VPN Tunnel", "Direct Database Replication", "Cloud Sync (S3/GCS/Azure)",
  "Physical Media (Encrypted)", "Email (Encrypted)",
];

const ENCRYPTION_METHODS = [
  "AES-256-GCM", "RSA-4096", "TLS 1.3", "PGP/GPG", "ChaCha20-Poly1305", "None",
];

const statusConfig: Record<string, { color: string; icon: any; label: string }> = {
  pending: { color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: Clock, label: "Pending Review" },
  approved: { color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: CheckCircle2, label: "Approved" },
  denied: { color: "bg-red-500/20 text-red-400 border-red-500/30", icon: XCircle, label: "Denied" },
  under_review: { color: "bg-blue-500/20 text-blue-400 border-blue-500/30", icon: Eye, label: "Under Review" },
};

const riskConfig: Record<string, string> = {
  critical: "text-red-400",
  high: "text-orange-400",
  medium: "text-amber-400",
  low: "text-emerald-400",
};

export default function TransferApprovals() {
  const { user } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");

  const [form, setForm] = useState({
    organizationId: 1,
    datasetName: "",
    sourceCountry: "Nigeria",
    destinationCountry: "",
    destinationEntity: "",
    volumeGb: "",
    dataClassification: "tier1_pii",
    businessJustification: "",
    transferMethod: "",
    encryptionMethod: "AES-256-GCM",
  });

  const utils = trpc.useUtils();

  const { data: transfers, isLoading } = trpc.transfers.list.useQuery(
    { limit: 100, status: statusFilter === "all" ? undefined : statusFilter },
    { refetchInterval: 15000 }
  );

  const createMutation = trpc.transfers.create.useMutation({
    onSuccess: () => {
      toast.success("Transfer approval request submitted");
      setShowForm(false);
      setForm({ organizationId: 1, datasetName: "", sourceCountry: "Nigeria", destinationCountry: "", destinationEntity: "", volumeGb: "", dataClassification: "tier1_pii", businessJustification: "", transferMethod: "", encryptionMethod: "AES-256-GCM" });
      utils.transfers.list.invalidate();
    },
    onError: (e) => toast.error(`Submission failed: ${(e instanceof Error ? e.message : String(e))}`),
  });

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const deleteMutation = trpc.transfers.delete.useMutation({
    onSuccess: () => {
      toast.success("Transfer request deleted");
      setDeleteId(null);
      utils.transfers.list.invalidate();
    },
    onError: (e) => toast.error(`Delete failed: ${(e instanceof Error ? e.message : String(e))}`),
  });
  const reviewMutation = trpc.transfers.review.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`Transfer request ${vars.decision}`);
      setReviewId(null);
      setReviewNotes("");
      utils.transfers.list.invalidate();
    },
    onError: (e) => toast.error(`Review failed: ${(e instanceof Error ? e.message : String(e))}`),
  });

  const handleSubmit = () => {
    if (!form.datasetName || !form.destinationCountry || !form.destinationEntity || !form.businessJustification) {
      toast.error("Please fill in all required fields");
      return;
    }
    createMutation.mutate({
      ...form,
      volumeGb: parseFloat(form.volumeGb) || 0,
    });
  };

  const getClassificationRisk = (cls: string) => {
    return DATA_CLASSIFICATIONS.find(d => d.value === cls)?.risk ?? "medium";
  };

  const counts = {
    all: transfers?.length ?? 0,
    pending: transfers?.filter(t => t.status === "pending").length ?? 0,
    approved: transfers?.filter(t => t.status === "approved").length ?? 0,
    denied: transfers?.filter(t => t.status === "denied").length ?? 0,
  };

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Transfer Approvals" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ArrowRightLeft className="w-6 h-6 text-primary" />
            Cross-Border Transfer Approvals
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Pre-approval workflow for cross-border data transfers exceeding 1 GB or containing classified data
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="w-4 h-4" /> New Request
        </Button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "all", label: "All Requests", count: counts.all },
          { key: "pending", label: "Pending", count: counts.pending },
          { key: "approved", label: "Approved", count: counts.approved },
          { key: "denied", label: "Denied", count: counts.denied },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${statusFilter === tab.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          >
            {tab.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${statusFilter === tab.key ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background text-muted-foreground"}`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* New Request Form */}
      {showForm && (
        <Card className="border-primary/30 bg-card/80">
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              New Cross-Border Transfer Request
            </CardTitle>
            <CardDescription>All fields marked * are required. Requests are reviewed within 48 hours.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Dataset Name <span className="text-red-400">*</span></Label>
                <Input value={form.datasetName} onChange={(e) => setForm({ ...form, datasetName: e.target.value })} placeholder="Customer Transaction Records Q1 2026" className="bg-background" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Data Classification <span className="text-red-400">*</span></Label>
                <select value={form.dataClassification} onChange={(e) => setForm({ ...form, dataClassification: e.target.value })} className="w-full h-10 px-3 rounded-md bg-background border border-input text-foreground text-sm">
                  {DATA_CLASSIFICATIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Source Country <span className="text-red-400">*</span></Label>
                <select value={form.sourceCountry} onChange={(e) => setForm({ ...form, sourceCountry: e.target.value })} className="w-full h-10 px-3 rounded-md bg-background border border-input text-foreground text-sm">
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Destination Country <span className="text-red-400">*</span></Label>
                <select value={form.destinationCountry} onChange={(e) => setForm({ ...form, destinationCountry: e.target.value })} className="w-full h-10 px-3 rounded-md bg-background border border-input text-foreground text-sm">
                  <option value="">Select destination...</option>
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Destination Entity <span className="text-red-400">*</span></Label>
                <Input value={form.destinationEntity} onChange={(e) => setForm({ ...form, destinationEntity: e.target.value })} placeholder="International Monetary Fund (IMF)" className="bg-background" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Volume (GB) <span className="text-red-400">*</span></Label>
                <Input type="number" min={0} step={0.1} value={form.volumeGb} onChange={(e) => setForm({ ...form, volumeGb: e.target.value })} placeholder="12.5" className="bg-background" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Transfer Method</Label>
                <select value={form.transferMethod} onChange={(e) => setForm({ ...form, transferMethod: e.target.value })} className="w-full h-10 px-3 rounded-md bg-background border border-input text-foreground text-sm">
                  <option value="">Select method...</option>
                  {TRANSFER_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Encryption Method</Label>
                <select value={form.encryptionMethod} onChange={(e) => setForm({ ...form, encryptionMethod: e.target.value })} className="w-full h-10 px-3 rounded-md bg-background border border-input text-foreground text-sm">
                  {ENCRYPTION_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Business Justification <span className="text-red-400">*</span></Label>
              <Textarea value={form.businessJustification} onChange={(e) => setForm({ ...form, businessJustification: e.target.value })} placeholder="Describe why this cross-border transfer is necessary, the legal basis, and any relevant regulatory exemptions..." className="bg-background min-h-[100px]" />
            </div>
            {(getClassificationRisk(form.dataClassification) === "critical" || parseFloat(form.volumeGb) > 100) && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">
                  {getClassificationRisk(form.dataClassification) === "critical" && "Critical classification data requires Director-level approval and may take up to 5 business days. "}
                  {parseFloat(form.volumeGb) > 100 && "Transfers exceeding 100 GB require additional technical review and DPI inspection."}
                </p>
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transfers List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading requests...
        </div>
      ) : !transfers?.length ? (
        <Card className="border-dashed border-border bg-card/30">
          <CardContent className="py-12 text-center">
            <ArrowRightLeft className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <EmptyState title="No transfer requests" description="There are no pending transfer requests" />
            <p className="text-xs text-muted-foreground mt-1">Submit a new request to begin the approval process</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {transfers.map((t: any) => {
            const status = statusConfig[t.status] ?? statusConfig.pending;
            const StatusIcon = status.icon;
            const risk = getClassificationRisk(t.data_classification);
            const isExpanded = expandedId === t.id;
            return (
              <Card key={t.id} className={`border-border bg-card/80 transition-all ${isExpanded ? "border-primary/30" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="font-semibold text-foreground text-sm truncate">{t.dataset_name}</p>
                        <Badge className={`text-xs ${status.color}`}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {status.label}
                        </Badge>
                        <Badge variant="outline" className={`text-xs ${riskConfig[risk]}`}>
                          {risk.toUpperCase()} RISK
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          {t.source_country} → {t.destination_country}
                        </span>
                        <span className="flex items-center gap-1">
                          <Database className="w-3 h-3" />
                          {t.volume_gb} GB
                        </span>
                        <span className="flex items-center gap-1">
                          {t.encryption_method !== "None" ? <Lock className="w-3 h-3 text-emerald-400" /> : <Unlock className="w-3 h-3 text-red-400" />}
                          {t.encryption_method || "No encryption"}
                        </span>
                        <span>To: {t.destination_entity}</span>
                        <span>{new Date(t.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {user?.role === "admin" && t.status === "pending" && (
                        <>
                          <Button size="sm" variant="outline" className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 h-7 text-xs" onClick={() => { setReviewId(t.id); }}>
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Review
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="outline" className="border-red-800 text-red-400 hover:bg-red-900/30 h-7 w-7 p-0" onClick={() => setDeleteId(t.id)} aria-label="Delete transfer"><Trash2 className="w-3 h-3" /></Button>
                      <button onClick={() => setExpandedId(isExpanded ? null : t.id)} className="text-muted-foreground hover:text-foreground transition-colors" aria-label={isExpanded ? "Collapse" : "Expand"}>
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-border space-y-3">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                        <div><p className="text-xs text-muted-foreground">Classification</p><p className="text-foreground">{DATA_CLASSIFICATIONS.find(d => d.value === t.data_classification)?.label ?? t.data_classification}</p></div>
                        <div><p className="text-xs text-muted-foreground">Transfer Method</p><p className="text-foreground">{t.transfer_method || "Not specified"}</p></div>
                        <div><p className="text-xs text-muted-foreground">Encryption</p><p className="text-foreground">{t.encryption_method || "None"}</p></div>
                        {t.reviewed_at && <div><p className="text-xs text-muted-foreground">Reviewed</p><p className="text-foreground">{new Date(t.reviewed_at).toLocaleString()}</p></div>}
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Business Justification</p>
                        <p className="text-sm text-foreground bg-muted/30 p-3 rounded-lg">{t.business_justification}</p>
                      </div>
                      {t.review_notes && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Review Notes</p>
                          <p className="text-sm text-foreground bg-muted/30 p-3 rounded-lg">{t.review_notes}</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Review Dialog */}
      <Dialog open={reviewId !== null} onOpenChange={(open) => { if (!open) { setReviewId(null); setReviewNotes(""); } }}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" /> Review Transfer Request
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {reviewId && transfers && (
              <div className="bg-muted/30 rounded-lg p-3 text-sm">
                <p className="font-medium text-foreground">{transfers.find((t: any) => t.id === reviewId)?.dataset_name}</p>
                <p className="text-muted-foreground text-xs mt-1">
                  {transfers.find((t: any) => t.id === reviewId)?.source_country} → {transfers.find((t: any) => t.id === reviewId)?.destination_country} · {transfers.find((t: any) => t.id === reviewId)?.volume_gb} GB
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-sm">Review Notes (optional)</Label>
              <Textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Add conditions, requirements, or denial reasons..." className="bg-background min-h-[80px]" />
            </div>
            <div className="flex gap-3">
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => reviewMutation.mutate({ id: reviewId!, decision: "approved", notes: reviewNotes })} disabled={reviewMutation.isPending}>
                <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
              </Button>
              <Button className="flex-1 bg-red-600 hover:bg-red-700" onClick={() => reviewMutation.mutate({ id: reviewId!, decision: "denied", notes: reviewNotes })} disabled={reviewMutation.isPending}>
                <XCircle className="w-4 h-4 mr-2" /> Deny
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-background border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Transfer Request</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">This will permanently delete this transfer approval request. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
