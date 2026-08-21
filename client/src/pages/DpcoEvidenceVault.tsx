import { useState, useRef, useCallback } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Vault, Upload, FileText, Shield, ShieldCheck, ShieldAlert,
  Trash2, Download, Search, CheckCircle, AlertTriangle, Eye,
  Hash, Calendar, User, Tag
} from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const CATEGORIES = [
  { value: "privacy_policy",   label: "Privacy Policy",         color: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  { value: "dpia",             label: "DPIA",                   color: "bg-purple-500/15 text-purple-600 dark:text-purple-400" },
  { value: "training_record",  label: "Training Record",        color: "bg-green-500/15 text-green-600 dark:text-green-400" },
  { value: "ropa",             label: "ROPA",                   color: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400" },
  { value: "dpa_contract",     label: "DPA Contract",           color: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  { value: "breach_report",    label: "Breach Report",          color: "bg-red-500/15 text-red-600 dark:text-red-400" },
  { value: "consent_record",   label: "Consent Record",         color: "bg-teal-500/15 text-teal-600 dark:text-teal-400" },
  { value: "audit_report",     label: "Audit Report",           color: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" },
  { value: "other",            label: "Other",                  color: "bg-muted text-foreground" },
];

function categoryMeta(value: string) {
  return CATEGORIES.find(c => c.value === value) ?? CATEGORIES[CATEGORIES.length - 1];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function computeSha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function TamperBadge({ tampered, verified }: { tampered: boolean; verified: boolean }) {
  if (!verified) return <Badge variant="outline" className="text-xs text-muted-foreground">Unverified</Badge>;
  if (tampered) return <Badge variant="destructive" className="text-xs gap-1"><ShieldAlert className="w-3 h-3" /> Tampered</Badge>;
  return <Badge className="text-xs bg-green-600 gap-1"><ShieldCheck className="w-3 h-3" /> Verified</Badge>;
}

export default function DpcoEvidenceVault() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyItem, setVerifyItem] = useState<any>(null);
  const [verifyHash, setVerifyHash] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploadForm, setUploadForm] = useState({
    category: "other" as string,
    description: "",
    finding_ref: "",
    engagement_id: "",
  });

  const { data, refetch } = trpc.dpco.listEvidence.useQuery({
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    limit: 100,
  });

  const addMutation = trpc.dpco.addEvidence.useMutation({
    onSuccess: (result: any) => {
      if (result.duplicate) {
        toast.warning(result.message);
      } else {
        toast.success("Evidence uploaded and SHA-256 hash recorded");
      }
      setUploadOpen(false);
      setUploadProgress(0);
      setUploading(false);
      refetch();
    },
    onError: (err: any) => {
      toast.error(`Upload failed: ${(err instanceof Error ? err.message : String(err))}`);
      setUploading(false);
    },
  });

  const verifyMutation = trpc.dpco.verifyEvidence.useMutation({
    onSuccess: (result: any) => {
      if (result.tampered) {
        toast.error("⚠️ TAMPER DETECTED — stored hash does not match provided hash");
      } else {
        toast.success("✓ Integrity verified — file is authentic and unmodified");
      }
      setVerifyOpen(false);
      refetch();
    },
    onError: (err: any) => toast.error(`Verification failed: ${(err instanceof Error ? err.message : String(err))}`),
  });

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [tagItem, setTagItem] = useState<any>(null);
  const [tagControls, setTagControls] = useState<string[]>([]);
  const tagMutation = trpc.dpco.tagEvidenceControls.useMutation({
    onSuccess: () => { toast.success("Control tags saved"); setTagItem(null); refetch(); },
    onError: (err: any) => toast.error(`Tag failed: ${(err instanceof Error ? err.message : String(err))}`),
  });

  const NDPA_CONTROLS = [
    "C01","C02","C03","C04","C05","C06","C07","C08","C09","C10",
    "C11","C12","C13","C14","C15"
  ];

  const deleteMutation = trpc.dpco.deleteEvidence.useMutation({
    onSuccess: () => { toast.success("Evidence item deleted"); setDeleteId(null); refetch(); },
    onError: (err: any) => toast.error(`Delete failed: ${(err instanceof Error ? err.message : String(err))}`),
  });

  const handleFileUpload = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error("Please select a file"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("File must be under 10 MB"); return; }

    setUploading(true);
    setUploadProgress(10);

    try {
      // Compute SHA-256 hash client-side
      const sha256Hash = await computeSha256(file);
      setUploadProgress(40);

      // Upload to S3 via server
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", uploadForm.category);

      const uploadRes = await fetch("/api/evidence/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      setUploadProgress(80);

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(errText || "Upload failed");
      }

      const { fileKey, fileUrl } = await uploadRes.json();
      setUploadProgress(90);

      addMutation.mutate({
        file_name: file.name,
        file_key: fileKey,
        file_url: fileUrl,
        file_size_bytes: file.size,
        mime_type: file.type,
        sha256_hash: sha256Hash,
        category: uploadForm.category as any,
        description: uploadForm.description || undefined,
        finding_ref: uploadForm.finding_ref || undefined,
        engagement_id: uploadForm.engagement_id || undefined,
      });
    } catch (err: unknown) {
      toast.error(`Upload failed: ${(err instanceof Error ? err.message : String(err))}`);
      setUploading(false);
      setUploadProgress(0);
    }
  }, [uploadForm, addMutation]);

  const rows = (data?.rows ?? []) as any[];
  const filtered = rows.filter(r =>
    !search ||
    r.file_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.description?.toLowerCase().includes(search.toLowerCase()) ||
    r.finding_ref?.toLowerCase().includes(search.toLowerCase())
  );

  // Stats
  const total = rows.length;
  const verified = rows.filter(r => r.verified_at).length;
  const tampered = rows.filter(r => r.is_tampered).length;
  const totalSize = rows.reduce((s: number, r: any) => s + (r.file_size_bytes ?? 0), 0);

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Dpco Evidence Vault" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Vault className="w-6 h-6 text-indigo-600" />
            Audit Evidence Vault
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tamper-evident S3-backed evidence repository with SHA-256 integrity verification
          </p>
        </div>
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Upload className="w-4 h-4" /> Upload Evidence</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Upload Evidence Document</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Document File <span className="text-red-500">*</span></Label>
                <input ref={fileRef} type="file" accept=".pdf,.docx,.xlsx,.png,.jpg,.zip"
                  className="block w-full text-sm text-muted-foreground mt-1 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer" />
                <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, XLSX, PNG, JPG, ZIP — max 10 MB</p>
              </div>
              <div>
                <Label>Category</Label>
                <Select value={uploadForm.category} onValueChange={v => setUploadForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={uploadForm.description}
                  onChange={e => setUploadForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of this evidence document..."
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Finding Reference</Label>
                  <Input
                    value={uploadForm.finding_ref}
                    onChange={e => setUploadForm(f => ({ ...f, finding_ref: e.target.value }))}
                    placeholder="F-001, CAR-2025-003"
                  />
                </div>
                <div>
                  <Label>Engagement ID</Label>
                  <Input
                    value={uploadForm.engagement_id}
                    onChange={e => setUploadForm(f => ({ ...f, engagement_id: e.target.value }))}
                    placeholder="ENG-001"
                  />
                </div>
              </div>
              {uploading && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Computing SHA-256 hash and uploading...</div>
                  <Progress value={uploadProgress} className="h-2" />
                </div>
              )}
              <div className="bg-blue-50 border border-blue-500/20 rounded p-3 text-xs text-blue-800 flex gap-2">
                <Hash className="w-4 h-4 shrink-0 mt-0.5" />
                SHA-256 hash is computed client-side before upload. The hash is stored immutably and can be used to verify file integrity at any time.
              </div>
              <Button onClick={handleFileUpload} disabled={uploading} className="w-full">
                {uploading ? "Uploading..." : "Upload & Record Hash"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-indigo-600" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Total Documents</span>
            </div>
            <div className="text-3xl font-bold text-indigo-700">{total}</div>
            <div className="text-xs text-muted-foreground">{formatBytes(totalSize)} total size</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-green-600" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Verified</span>
            </div>
            <div className="text-3xl font-bold text-green-700">{verified}</div>
            <div className="text-xs text-muted-foreground">Integrity confirmed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert className="w-4 h-4 text-red-600" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Tamper Alerts</span>
            </div>
            <div className="text-3xl font-bold text-red-700">{tampered}</div>
            <div className="text-xs text-muted-foreground">Hash mismatch detected</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Unverified</span>
            </div>
            <div className="text-3xl font-bold text-foreground">{total - verified}</div>
            <div className="text-xs text-muted-foreground">Pending integrity check</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search file name, description, finding ref..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Evidence Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{filtered.length} Evidence Items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Vault className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No evidence documents yet</p>
              <p className="text-sm">Upload your first document to start building the evidence vault</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Document</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Category</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">SHA-256</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Integrity</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Uploaded</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((item: any) => {
                    const cat = categoryMeta(item.category);
                    const uploadedAt = item.created_at ? new Date(item.created_at).toLocaleDateString("en-NG") : "—";
                    return (
                      <tr key={item.id} className="hover:bg-muted">
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-2">
                            <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                            <div>
                              <div className="font-medium text-foreground max-w-[200px] truncate">{item.file_name}</div>
                              {item.description && <div className="text-xs text-muted-foreground max-w-[200px] truncate">{item.description}</div>}
                              {item.finding_ref && (
                                <div className="flex items-center gap-1 mt-0.5">
                                  <Tag className="w-3 h-3 text-muted-foreground" />
                                  <span className="text-xs text-indigo-600 font-mono">{item.finding_ref}</span>
                                </div>
                              )}
                              <div className="text-xs text-muted-foreground">{formatBytes(item.file_size_bytes ?? 0)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs ${cat.color}`}>{cat.label}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs text-muted-foreground max-w-[120px] truncate" title={item.sha256_hash}>
                            {item.sha256_hash?.slice(0, 16)}...
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <TamperBadge tampered={!!item.is_tampered} verified={!!item.verified_at} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="w-3 h-3" />
                            {uploadedAt}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 px-2 text-xs gap-1"
                              onClick={() => window.open(item.file_url, "_blank")}
                            >
                              <Eye className="w-3 h-3" /> View
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 px-2 text-xs gap-1 text-blue-600"
                              onClick={() => {
                                setVerifyItem(item);
                                setVerifyHash("");
                                setVerifyOpen(true);
                              }}
                            >
                              <ShieldCheck className="w-3 h-3" /> Verify
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 px-2 text-xs gap-1 text-purple-600"
                              onClick={() => {
                                setTagItem(item);
                                const existing = item.control_ids ? JSON.parse(item.control_ids) : [];
                                setTagControls(existing);
                              }}
                            >
                              <Tag className="w-3 h-3" /> Tag
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 px-2 text-xs text-red-600"
                              onClick={() => setDeleteId(String(item.id))}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
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

      {/* Verify Dialog */}
      <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
              Verify File Integrity
            </DialogTitle>
          </DialogHeader>
          {verifyItem && (
            <div className="space-y-4">
              <div className="bg-muted rounded p-3 text-sm">
                <div className="font-medium text-foreground">{verifyItem.file_name}</div>
                <div className="text-xs text-muted-foreground mt-1">Stored SHA-256:</div>
                <div className="font-mono text-xs text-foreground break-all mt-0.5">{verifyItem.sha256_hash}</div>
              </div>
              <div>
                <Label>Provide SHA-256 Hash to Compare</Label>
                <Textarea
                  value={verifyHash}
                  onChange={e => setVerifyHash(e.target.value.trim().toLowerCase())}
                  placeholder="Paste the SHA-256 hash of the file you have on hand..."
                  rows={2}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Compute with: <code className="bg-muted px-1 rounded">sha256sum filename.pdf</code> or <code className="bg-muted px-1 rounded">certutil -hashfile filename.pdf SHA256</code>
                </p>
              </div>
              <Button
                className="w-full"
                disabled={verifyHash.length !== 64 || verifyMutation.isPending}
                onClick={() => verifyMutation.mutate({ id: verifyItem.id, sha256_hash: verifyHash })}
              >
                {verifyMutation.isPending ? "Verifying..." : "Verify Integrity"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Tag Controls Dialog */}
      <Dialog open={!!tagItem} onOpenChange={open => { if (!open) setTagItem(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-purple-600" />
              Tag NDPA Controls
            </DialogTitle>
          </DialogHeader>
          {tagItem && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground font-medium truncate">{tagItem.file_name}</div>
              <div className="text-xs text-muted-foreground">Select which NDPA controls this evidence supports:</div>
              <div className="grid grid-cols-5 gap-2">
                {NDPA_CONTROLS.map(ctrl => (
                  <button
                    key={ctrl}
                    onClick={() => setTagControls(prev =>
                      prev.includes(ctrl) ? prev.filter(c => c !== ctrl) : [...prev, ctrl]
                    )}
                    className={`text-xs font-mono py-1.5 rounded border transition-colors ${
                      tagControls.includes(ctrl)
                        ? "bg-purple-600 text-white border-purple-600"
                        : "bg-muted text-muted-foreground border-border hover:border-purple-400"
                    }`}
                  >
                    {ctrl}
                  </button>
                ))}
              </div>
              {tagControls.length > 0 && (
                <div className="text-xs text-purple-600 font-medium">
                  Selected: {tagControls.join(", ")}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setTagItem(null)}>Cancel</Button>
                <Button
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                  onClick={() => tagMutation.mutate({ evidenceItemId: tagItem.id, controlIds: tagControls })}
                  disabled={tagMutation.isPending}
                >
                  {tagMutation.isPending ? "Saving..." : "Save Tags"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Evidence Item</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this evidence item from the vault. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteId && deleteMutation.mutate({ id: String(deleteId) })} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
