import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Share2, Plus, CheckCircle, XCircle, Clock, ArrowRight } from "lucide-react";

const SECTORS = ["banking", "telecom", "healthcare", "energy", "insurance", "fintech"];
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  approved: "bg-green-500/20 text-green-400 border-green-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
};

export default function CrossSectorDataSharing() {
  const [requestOpen, setRequestOpen] = useState(false);
  const [form, setForm] = useState({ orgId: 1, sourceSector: "banking", targetSector: "telecom", dataType: "compliance_data", justification: "" });

  const { data: stats = [] } = trpc.crossSectorSharing.getStats.useQuery();
  const { data: shares = [], refetch } = trpc.crossSectorSharing.getSharedData.useQuery({ sourceSector: "banking", targetSector: "telecom", dataType: "compliance_data", limit: 50 });
  const requestMut = trpc.crossSectorSharing.requestShare.useMutation({
    onSuccess: (d) => { toast.success(`Share request submitted: ${d.shareId}`); setRequestOpen(false); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const approveMut = trpc.crossSectorSharing.approve.useMutation({
    onSuccess: (d) => { toast.success(`Request ${d.status}`); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Share2 className="w-6 h-6 text-cyan-400" /> Cross-Sector Data Sharing</h1>
            <p className="text-muted-foreground text-sm mt-1">NDPA Section 52 — Inter-regulatory data sharing framework</p>
          </div>
          <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
            <DialogTrigger asChild>
              <Button className="bg-cyan-600 hover:bg-cyan-700"><Plus className="w-4 h-4 mr-2" /> Request Share</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border text-foreground">
              <DialogHeader><DialogTitle>Request Cross-Sector Data Share</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Source Sector</Label>
                    <Select value={form.sourceSector} onValueChange={v => setForm(f => ({ ...f, sourceSector: v }))}>
                      <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-muted border-border">{SECTORS.map(s => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Target Sector</Label>
                    <Select value={form.targetSector} onValueChange={v => setForm(f => ({ ...f, targetSector: v }))}>
                      <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-muted border-border">{SECTORS.map(s => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>Data Type</Label><Input className="bg-muted border-border" value={form.dataType} onChange={e => setForm(f => ({ ...f, dataType: e.target.value }))} /></div>
                <div><Label>Justification</Label><Input className="bg-muted border-border" value={form.justification} onChange={e => setForm(f => ({ ...f, justification: e.target.value }))} placeholder="Regulatory basis for this request..." /></div>
                <Button className="w-full bg-cyan-600 hover:bg-cyan-700" disabled={requestMut.isPending} onClick={() => requestMut.mutate({ orgId: form.orgId, sourceSector: form.sourceSector, targetSector: form.targetSector, dataType: form.dataType, justification: form.justification, dataElements: ["org_id", "compliance_score", "breach_count"] })}>
                  {requestMut.isPending ? "Submitting..." : "Submit Request"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Sector flow matrix */}
        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-foreground">Sector Data Flow Matrix</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {(stats as any[]).map((s: any, i: number) => (
                <div key={i} className="bg-muted/50 rounded-lg p-3 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="text-xs border-cyan-500/30 text-cyan-400">{String(s.source_sector ?? "").toUpperCase()}</Badge>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                    <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-400">{String(s.target_sector ?? "").toUpperCase()}</Badge>
                  </div>
                  <p className="text-foreground font-bold text-xl">{s.requests ?? 0}</p>
                  <p className="text-xs text-muted-foreground">{s.approved ?? 0} approved</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-foreground">Recent Share Requests</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Share ID</th><th className="text-left py-2 px-3">Flow</th>
                  <th className="text-left py-2 px-3">Data Type</th><th className="text-left py-2 px-3">Requested</th>
                  <th className="text-left py-2 px-3">Status</th><th className="text-left py-2 px-3">Actions</th>
                </tr></thead>
                <tbody>
                  {(shares as any[]).length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No share requests found</td></tr>
                  ) : (shares as any[]).map((s: any) => (
                    <tr key={s.share_id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 px-3"><code className="text-xs text-muted-foreground">{String(s.share_id ?? "").slice(0, 20)}...</code></td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-cyan-400">{String(s.source_sector ?? "").toUpperCase()}</span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <span className="text-purple-400">{String(s.target_sector ?? "").toUpperCase()}</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{s.data_type ?? "—"}</td>
                      <td className="py-2 px-3 text-muted-foreground">{s.requested_at ? new Date(String(s.requested_at)).toLocaleDateString("en-NG") : "—"}</td>
                      <td className="py-2 px-3">
                        <Badge className={STATUS_COLORS[String(s.status ?? "pending")] ?? STATUS_COLORS.pending}>
                          {String(s.status ?? "pending")}
                        </Badge>
                      </td>
                      <td className="py-2 px-3">
                        {s.status === "pending" && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="text-green-400 hover:text-green-300 h-7 px-2" onClick={() => approveMut.mutate({ shareId: String(s.share_id), approved: true })}>
                              <CheckCircle className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-7 px-2" onClick={() => approveMut.mutate({ shareId: String(s.share_id), approved: false })}>
                              <XCircle className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
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
