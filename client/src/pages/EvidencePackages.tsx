import React from "react";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Shield, Download, Plus, CheckCircle, ShieldCheck, ShieldAlert, FileJson , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
export default function EvidencePackages() {
  const [showGenerate, setShowGenerate] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<{ contentHash: string; hmacSignature: string } | null>(null);
  const [form, setForm] = useState({ organizationId: "", packageType: "compliance_audit", referenceType: "audit" });

  const { data: packages = [], refetch } = trpc.evidencePackages.list.useQuery({});
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 100 });

  const generateMutation = trpc.evidencePackages.generate.useMutation({
    onSuccess: () => {
      toast.success("Evidence package generated with HMAC-SHA256 signature (Rust signer)");
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.evidencePackages.delete.useMutation({
    onSuccess: () => {
      toast.success("Evidence package deleted successfully");
      setDeleteId(null);
      utils.evidencePackages.list.invalidate().catch(() => {});
    },
    onError: (err) => toast.error(err.message || "Failed to delete evidence package"),
  });
      setShowGenerate(false);
      refetch();
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const { data: verifyResult, isFetching: isVerifying } = trpc.evidencePackages.verify.useQuery(
    verifyTarget ?? { contentHash: "", hmacSignature: "" },
    { enabled: !!verifyTarget?.contentHash }
  );

  const PACKAGE_TYPES = ["compliance_audit", "penalty_evidence", "transfer_approval", "violation_report", "certification"];

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Evidence Packages" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Evidence Packages</h1>
          <p className="text-muted-foreground text-sm mt-1">Tamper-evident, HMAC-SHA256 signed audit evidence packages for regulatory proceedings</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Rust Signer Active</span>
          </div>
          <Button onClick={() => setShowGenerate(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-2" /> Generate Package
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">Total Packages</div>
          <div className="text-2xl font-bold text-foreground">{(packages as any[]).length}</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">Ready</div>
          <div className="text-2xl font-bold text-green-400">{(packages as any[]).filter((p: any) => p.status === "ready").length}</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">Expired</div>
          <div className="text-2xl font-bold text-red-400">{(packages as any[]).filter((p: any) => p.status === "expired").length}</div>
        </div>
      </div>

      {verifyTarget && (
        <div className={`rounded-xl border p-4 flex items-center gap-3 ${isVerifying ? "border-border bg-card" : verifyResult?.valid ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"}`}>
          {isVerifying ? (
            <Shield className="w-5 h-5 text-muted-foreground animate-pulse" />
          ) : verifyResult?.valid ? (
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-red-400" />
          )}
          <div className="flex-1">
            <p className={`text-sm font-medium ${isVerifying ? "text-muted-foreground" : verifyResult?.valid ? "text-emerald-300" : "text-red-300"}`}>
              {isVerifying ? "Verifying signature..." : verifyResult?.valid ? "Signature verified — package is authentic and untampered" : "Signature verification failed — package may be tampered"}
            </p>
            {verifyResult && !isVerifying && (
              <p className="text-xs text-muted-foreground font-mono mt-0.5">Hash: {verifyTarget.contentHash.slice(0, 32)}...</p>
            )}
          </div>
          <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => setVerifyTarget(null)}>Dismiss</Button>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-background/50">
            <tr>{["Package ID", "Type", "Reference", "HMAC Signature", "Status", "Expires", "Actions"].map(h => (
              <th key={h} className="text-left px-4 py-3 text-muted-foreground font-medium">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {(packages as any[]).length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-muted-foreground">
                  <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No evidence packages generated yet</p>
                </td>
              </tr>
            ) : (packages as any[]).map((p: any) => (
              <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-4 py-3 font-mono text-xs text-blue-400">EP-{String(p.id).padStart(6, "0")}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className="text-xs border-border text-muted-foreground">{p.packageType}</Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{p.referenceType || "—"} #{p.referenceId || "—"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-xs truncate">{p.hmacSignature?.slice(0, 20)}...</td>
                <td className="px-4 py-3">
                  <Badge className={`text-xs ${p.status === "ready" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>{p.status}</Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{p.expiresAt ? new Date(p.expiresAt).toLocaleDateString() : "—"}</td>
                <td className="px-4 py-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs border-border"
                    onClick={() => {
                      const payload = {
                        evidence_package_id: `EP-${String(p.id).padStart(6, "0")}`,
                        package_type: p.packageType,
                        organization_id: p.organizationId ?? null,
                        reference_type: p.referenceType ?? null,
                        reference_id: p.referenceId ?? null,
                        status: p.status,
                        content_hash: p.contentHash,
                        hmac_signature: p.hmacSignature,
                        generated_at: p.createdAt,
                        expires_at: p.expiresAt,
                        generator: "ndsep-evidence-signer-v1",
                        platform: "NDSEP National Data Sovereignty Enforcement Platform",
                        verification_endpoint: `${window.location.origin}/api/trpc/evidencePackages.verify`,
                      };
                      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `EP-${String(p.id).padStart(6, "0")}-${p.packageType}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success("Evidence package downloaded as signed JSON");
                    }}
                  >
                    <FileJson className="w-3 h-3 mr-1" /> Download
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs border-emerald-600/50 text-emerald-400 hover:bg-emerald-500/10"
                    onClick={() => setVerifyTarget({ contentHash: p.contentHash, hmacSignature: p.hmacSignature })}
                  >
                    <ShieldCheck className="w-3 h-3 mr-1" /> Verify
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader><DialogTitle>Generate Evidence Package</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Organization</Label>
              <Select value={form.organizationId} onValueChange={v => setForm(p => ({ ...p, organizationId: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue placeholder="Select org..." /></SelectTrigger>
                <SelectContent>
                  {(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Package Type</Label>
              <Select value={form.packageType} onValueChange={v => setForm(p => ({ ...p, packageType: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PACKAGE_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-xs text-blue-300 flex gap-2">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Package will be signed with HMAC-SHA256 by the Rust <code className="font-mono">evidence_signer</code> service (port 8113). The signature can be independently verified against the content hash.</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerate(false)}>Cancel</Button>
            <Button
              onClick={() => generateMutation.mutate({
                organizationId: form.organizationId ? Number(form.organizationId) : undefined,
                packageType: form.packageType,
                referenceType: form.referenceType,
              })}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? "Generating..." : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
