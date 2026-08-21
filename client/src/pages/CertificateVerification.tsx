import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Award, Search, Plus, CheckCircle, XCircle, Shield } from "lucide-react";

const CERT_TYPES = ["ndpa_compliance", "dpco_registration", "sector_compliance", "dpo_certification", "audit_clearance"];

export default function CertificateVerification() {
  const [verifyNum, setVerifyNum] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [form, setForm] = useState({ orgId: 1, certType: "ndpa_compliance", notes: "" });

  const { data: certs = [], refetch } = trpc.certVerification.list.useQuery({});
  const verifyQuery = trpc.certVerification.verify.useQuery({ certNumber: verifyNum }, { enabled: verifyNum.length > 10 });
  const issueMut = trpc.certVerification.issue.useMutation({
    onSuccess: (d) => { toast.success(`Certificate issued: ${d.certNumber}`); setIssueOpen(false); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Award className="w-6 h-6 text-amber-400" /> Compliance Certificates</h1>
            <p className="text-muted-foreground text-sm mt-1">Issue, verify, and manage NDPA compliance certificates</p>
          </div>
          <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
            <DialogTrigger asChild>
              <Button className="bg-amber-600 hover:bg-amber-700"><Plus className="w-4 h-4 mr-2" /> Issue Certificate</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border text-foreground">
              <DialogHeader><DialogTitle>Issue Compliance Certificate</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Certificate Type</Label>
                  <Select value={form.certType} onValueChange={v => setForm(f => ({ ...f, certType: v }))}>
                    <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-muted border-border">{CERT_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ").toUpperCase()}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Notes</Label><Input className="bg-muted border-border" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." /></div>
                <Button className="w-full bg-amber-600 hover:bg-amber-700" disabled={issueMut.isPending} onClick={() => issueMut.mutate({ orgId: form.orgId, certType: form.certType, notes: form.notes })}>
                  {issueMut.isPending ? "Issuing..." : "Issue Certificate"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Verification Tool */}
        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-foreground flex items-center gap-2"><Search className="w-5 h-5 text-amber-400" /> Certificate Verification</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <Input className="bg-muted border-border text-foreground flex-1" placeholder="Enter certificate number (e.g. NDSEP-NDPA-...)" value={verifyNum} onChange={e => setVerifyNum(e.target.value)} />
            </div>
            {verifyNum.length > 10 && verifyQuery.data && (
              <div className={`mt-4 p-4 rounded-lg border ${verifyQuery.data.valid ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                <div className="flex items-center gap-2 mb-2">
                  {verifyQuery.data.valid ? <CheckCircle className="w-5 h-5 text-green-400" /> : <XCircle className="w-5 h-5 text-red-400" />}
                  <span className={`font-bold ${verifyQuery.data.valid ? "text-green-400" : "text-red-400"}`}>
                    {verifyQuery.data.valid ? "VALID CERTIFICATE" : "INVALID / EXPIRED"}
                  </span>
                </div>
                {verifyQuery.data.valid && (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-muted-foreground">Organization:</span> <span className="text-foreground">{String(verifyQuery.data.orgName ?? "—")}</span></div>
                    <div><span className="text-muted-foreground">Sector:</span> <span className="text-foreground">{String(verifyQuery.data.sector ?? "—")}</span></div>
                    <div><span className="text-muted-foreground">Issued:</span> <span className="text-foreground">{verifyQuery.data.issuedAt ? new Date(String(verifyQuery.data.issuedAt)).toLocaleDateString("en-NG") : "—"}</span></div>
                    <div><span className="text-muted-foreground">Expires:</span> <span className="text-foreground">{verifyQuery.data.expiresAt ? new Date(String(verifyQuery.data.expiresAt)).toLocaleDateString("en-NG") : "—"}</span></div>
                    <div className="col-span-2"><span className="text-muted-foreground">Issuer:</span> <span className="text-foreground">{String(verifyQuery.data.issuer ?? "—")}</span></div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-foreground">Issued Certificates</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Certificate Number</th><th className="text-left py-2 px-3">Organization</th>
                  <th className="text-left py-2 px-3">Type</th><th className="text-left py-2 px-3">Issued</th>
                  <th className="text-left py-2 px-3">Expires</th><th className="text-left py-2 px-3">Status</th>
                </tr></thead>
                <tbody>
                  {(certs as any[]).length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No certificates issued yet</td></tr>
                  ) : (certs as any[]).map((c: any) => {
                    const isExpired = c.expires_at && new Date(String(c.expires_at)) < new Date();
                    return (
                      <tr key={c.cert_number} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2 px-3"><code className="text-xs text-amber-400">{String(c.cert_number ?? "").slice(0, 30)}...</code></td>
                        <td className="py-2 px-3 text-foreground">{c.org_name ?? "—"}</td>
                        <td className="py-2 px-3"><Badge variant="outline" className="text-xs border-border text-muted-foreground">{String(c.cert_type ?? "").replace(/_/g, " ").toUpperCase()}</Badge></td>
                        <td className="py-2 px-3 text-muted-foreground">{c.issued_at ? new Date(String(c.issued_at)).toLocaleDateString("en-NG") : "—"}</td>
                        <td className="py-2 px-3 text-muted-foreground">{c.expires_at ? new Date(String(c.expires_at)).toLocaleDateString("en-NG") : "Never"}</td>
                        <td className="py-2 px-3">
                          <Badge className={isExpired ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-green-500/20 text-green-400 border-green-500/30"}>
                            {isExpired ? "expired" : String(c.status ?? "active")}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
