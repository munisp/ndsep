/**
 * Certificate Lifecycle Manager
 * Full CRUD for NDPA compliance certificates: issue, renew, revoke, search
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Award, RefreshCw, XCircle, Search, Plus, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

const statusColor: Record<string, string> = {
  active: "bg-green-500/15 text-green-600 dark:text-green-400",
  expired: "bg-red-500/15 text-red-600 dark:text-red-400",
  revoked: "bg-muted text-foreground",
  expiring_soon: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
};

export default function CertificateLifecycle() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [renewOpen, setRenewOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [selectedCert, setSelectedCert] = useState<any>(null);
  const [renewNotes, setRenewNotes] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [issueForm, setIssueForm] = useState({ org_id: "", cert_type: "ndpa_compliance", expires_days: "365" });

  const { data: certs, refetch } = trpc.certLifecycle.list.useQuery({ status: statusFilter === "all" ? undefined : statusFilter as "active" | "expired" | "revoked" | "expiring" | undefined });
  const { data: stats } = trpc.certLifecycle.getExpiryReport.useQuery();

  const renewMut = trpc.certLifecycle.renew.useMutation({
    onSuccess: () => { toast.success("Certificate renewed successfully"); setRenewOpen(false); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const revokeMut = trpc.certLifecycle.revoke.useMutation({
    onSuccess: () => { toast.success("Certificate revoked"); setRevokeOpen(false); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const issueMut = trpc.certLifecycle.renew.useMutation({
    onSuccess: () => { toast.success("Certificate issued"); setIssueOpen(false); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const filtered = (certs ?? []).filter((c: any) =>
    c.cert_number?.toLowerCase().includes(search.toLowerCase()) ||
    c.org_name?.toLowerCase().includes(search.toLowerCase())
  );

  const statsData = stats as any;

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Award className="w-6 h-6 text-blue-600" />
              Certificate Lifecycle Manager
            </h1>
            <p className="text-muted-foreground text-sm mt-1">NDPA compliance certificates — issue, renew, revoke</p>
          </div>
          <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />Issue Certificate</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Issue New Certificate</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Organisation ID</Label>
                  <Input value={issueForm.org_id} onChange={e => setIssueForm(f => ({ ...f, org_id: e.target.value }))} placeholder="e.g. 1" />
                </div>
                <div>
                  <Label>Certificate Type</Label>
                  <Select value={issueForm.cert_type} onValueChange={v => setIssueForm(f => ({ ...f, cert_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ndpa_compliance">NDPA Compliance</SelectItem>
                      <SelectItem value="dpco_accreditation">DPCO Accreditation</SelectItem>
                      <SelectItem value="dpia_approval">DPIA Approval</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Validity (days)</Label>
                  <Input type="number" value={issueForm.expires_days} onChange={e => setIssueForm(f => ({ ...f, expires_days: e.target.value }))} />
                </div>
                <Button className="w-full" onClick={() => issueMut.mutate({ certId: Number(issueForm.org_id), newExpiryDate: new Date(Date.now() + Number(issueForm.expires_days) * 86400000).toISOString(), renewalNotes: issueForm.cert_type })} disabled={issueMut.isPending}>
                  {issueMut.isPending ? "Issuing..." : "Issue Certificate"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Active", value: statsData?.active ?? 0, icon: CheckCircle2, color: "text-green-600" },
            { label: "Expiring Soon", value: statsData?.expiring_soon ?? 0, icon: AlertTriangle, color: "text-yellow-600" },
            { label: "Expired", value: statsData?.expired ?? 0, icon: Clock, color: "text-red-600" },
            { label: "Revoked", value: statsData?.revoked ?? 0, icon: XCircle, color: "text-muted-foreground" },
          ].map(s => (
            <div key={s.label} className="border rounded-lg p-4 flex items-center gap-3">
              <s.icon className={`w-8 h-8 ${s.color}`} />
              <div>
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by cert number or org..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="expiring_soon">Expiring Soon</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="revoked">Revoked</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3 font-medium">Cert Number</th>
                <th className="text-left p-3 font-medium">Organisation</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Issued</th>
                <th className="text-left p-3 font-medium">Expires</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center p-8 text-muted-foreground">No certificates found</td></tr>
              ) : filtered.map((c: any) => (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-mono text-xs">{c.cert_number}</td>
                  <td className="p-3">{c.org_name ?? `Org #${c.org_id}`}</td>
                  <td className="p-3 capitalize">{c.cert_type?.replace(/_/g, ' ')}</td>
                  <td className="p-3">{c.issued_at ? new Date(c.issued_at).toLocaleDateString() : '-'}</td>
                  <td className="p-3">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '-'}</td>
                  <td className="p-3">
                    <Badge className={statusColor[c.status] ?? "bg-muted text-foreground"}>
                      {c.status?.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="p-3 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setSelectedCert(c); setRenewOpen(true); }} disabled={c.status === 'revoked'}>
                      <RefreshCw className="w-3 h-3 mr-1" />Renew
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-600 border-red-500/20" onClick={() => { setSelectedCert(c); setRevokeOpen(true); }} disabled={c.status === 'revoked'}>
                      <XCircle className="w-3 h-3 mr-1" />Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Renew Dialog */}
        <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Renew Certificate</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Renewing: <strong>{selectedCert?.cert_number}</strong></p>
            <div className="space-y-3 mt-2">
              <Label>Renewal Notes</Label>
              <Textarea value={renewNotes} onChange={e => setRenewNotes(e.target.value)} placeholder="Optional notes..." />
              <Button className="w-full" onClick={() => renewMut.mutate({ certId: selectedCert?.id, newExpiryDate: new Date(Date.now() + 365 * 86400000).toISOString(), renewalNotes: renewNotes })} disabled={renewMut.isPending}>
                {renewMut.isPending ? "Renewing..." : "Confirm Renewal"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Revoke Dialog */}
        <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Revoke Certificate</DialogTitle></DialogHeader>
            <p className="text-sm text-destructive">This action cannot be undone. Certificate: <strong>{selectedCert?.cert_number}</strong></p>
            <div className="space-y-3 mt-2">
              <Label>Revocation Reason *</Label>
              <Textarea value={revokeReason} onChange={e => setRevokeReason(e.target.value)} placeholder="State the reason for revocation..." />
              <Button variant="destructive" className="w-full" onClick={() => revokeMut.mutate({ certId: selectedCert?.id, reason: revokeReason })} disabled={revokeMut.isPending || !revokeReason.trim()}>
                {revokeMut.isPending ? "Revoking..." : "Confirm Revocation"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
