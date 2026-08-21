import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FolderOpen, Upload, FileText, Trash2, Search, Shield, Database } from "lucide-react";

const DOC_TYPES = ["ropa", "dpia", "privacy_policy", "consent_form", "audit_report", "training_record", "breach_notification", "dpo_appointment", "data_sharing_agreement", "retention_policy"];

export default function DocumentVault() {
  const [search, setSearch] = useState("");
  const [docType, setDocType] = useState<string>("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [form, setForm] = useState({ orgId: 1, docType: "ropa", fileName: "", description: "" });

  const { data: docs = [], refetch } = trpc.documentVault.list.useQuery({ docType: docType || undefined, limit: 100 });
  const { data: stats } = trpc.documentVault.getStats.useQuery();
  const uploadMut = trpc.documentVault.upload.useMutation({
    onSuccess: (d) => { toast.success(`Document uploaded: ${d.docId}`); setUploadOpen(false); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteMut = trpc.documentVault.delete.useMutation({
    onSuccess: () => { toast.success("Document deleted"); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const filtered = docs.filter((d: any) =>
    !search || String(d.file_name || "").toLowerCase().includes(search.toLowerCase()) ||
    String(d.org_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const statCards = [
    { label: "Total Documents", value: String(stats?.total_docs ?? 0), icon: FileText, color: "text-blue-400" },
    { label: "Organizations", value: String(stats?.orgs_with_docs ?? 0), icon: Database, color: "text-green-400" },
    { label: "Active Documents", value: String(stats?.active_docs ?? 0), icon: Shield, color: "text-emerald-400" },
    { label: "Total Size", value: `${Math.round(Number(stats?.total_size_bytes ?? 0) / 1048576)} MB`, icon: FolderOpen, color: "text-purple-400" },
  ];

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><FolderOpen className="w-6 h-6 text-blue-400" /> Document Vault</h1>
            <p className="text-muted-foreground text-sm mt-1">Secure storage for all NDPA compliance documents</p>
          </div>
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700"><Upload className="w-4 h-4 mr-2" /> Upload Document</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border text-foreground">
              <DialogHeader><DialogTitle>Upload Compliance Document</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Document Type</Label>
                  <Select value={form.docType} onValueChange={v => setForm(f => ({ ...f, docType: v }))}>
                    <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-muted border-border">{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ").toUpperCase()}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>File Name</Label><Input className="bg-muted border-border" value={form.fileName} onChange={e => setForm(f => ({ ...f, fileName: e.target.value }))} placeholder="document.pdf" /></div>
                <div><Label>Description</Label><Input className="bg-muted border-border" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description..." /></div>
                <Button className="w-full bg-blue-600 hover:bg-blue-700" disabled={!form.fileName} onClick={() => uploadMut.mutate({ orgId: form.orgId, docType: form.docType, fileName: form.fileName, fileSize: 102400, mimeType: "application/pdf", description: form.description })}>
                  {uploadMut.isPending ? "Uploading..." : "Upload Document"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statCards.map(s => (
            <Card key={s.label} className="bg-card border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <s.icon className={`w-8 h-8 ${s.color}`} />
                <div><p className="text-2xl font-bold text-foreground">{s.value}</p><p className="text-xs text-muted-foreground">{s.label}</p></div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9 bg-muted border-border text-foreground" placeholder="Search documents..." value={search} onChange={e => setSearch(e.target.value)} /></div>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="w-48 bg-muted border-border text-foreground"><SelectValue placeholder="All Types" /></SelectTrigger>
                <SelectContent className="bg-muted border-border">
                  <SelectItem value="all">All Types</SelectItem>
                  {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ").toUpperCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Document</th><th className="text-left py-2 px-3">Organization</th>
                  <th className="text-left py-2 px-3">Type</th><th className="text-left py-2 px-3">Size</th>
                  <th className="text-left py-2 px-3">Uploaded</th><th className="text-left py-2 px-3">Status</th>
                  <th className="text-left py-2 px-3">Actions</th>
                </tr></thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No documents found</td></tr>
                  ) : filtered.map((d: any) => (
                    <tr key={d.document_id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 px-3"><div className="flex items-center gap-2"><FileText className="w-4 h-4 text-blue-400" /><span className="text-foreground font-medium">{d.file_name}</span></div></td>
                      <td className="py-2 px-3 text-muted-foreground">{d.org_name ?? "—"}</td>
                      <td className="py-2 px-3"><Badge variant="outline" className="text-xs border-border text-muted-foreground">{String(d.document_type ?? "").replace(/_/g, " ").toUpperCase()}</Badge></td>
                      <td className="py-2 px-3 text-muted-foreground">{Math.round(Number(d.file_size ?? 0) / 1024)} KB</td>
                      <td className="py-2 px-3 text-muted-foreground">{d.uploaded_at ? new Date(String(d.uploaded_at)).toLocaleDateString("en-NG") : "—"}</td>
                      <td className="py-2 px-3"><Badge className={d.status === "active" ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>{String(d.status ?? "active")}</Badge></td>
                      <td className="py-2 px-3">
                        <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => deleteMut.mutate({ docId: String(d.document_id) })}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
