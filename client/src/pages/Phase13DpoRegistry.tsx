import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { UserCheck, Plus, Search, CheckCircle, XCircle, Clock } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default function Phase13DpoRegistry() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    organization_id: "", dpo_name: "", dpo_email: "", dpo_phone: "", dpco_name: "", notes: ""
  });

  const utils = trpc.useUtils();
  const { data: records, isLoading } = trpc.phase13.dpoRegistry.list.useQuery({
    search: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter || undefined,
  });
  const { data: stats } = trpc.phase13.dpoRegistry.getStats.useQuery();
  const create = trpc.phase13.dpoRegistry.create.useMutation({
    onSuccess: () => {
      utils.phase13.dpoRegistry.list.invalidate();
      utils.phase13.dpoRegistry.getStats.invalidate();
      setOpen(false);
      toast.success("DPO registered successfully");
      setForm({ organization_id: "", dpo_name: "", dpo_email: "", dpo_phone: "", dpco_name: "", notes: "" });
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const verify = trpc.phase13.dpoRegistry.verify.useMutation({
    onSuccess: () => { utils.phase13.dpoRegistry.list.invalidate(); toast.success("DPO credential status updated"); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const list = (records as any[]) ?? [];
  const statsData = stats as any;

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <UserCheck className="h-6 w-6 text-purple-600" />
              DPO Registry
            </h1>
            <p className="text-muted-foreground mt-1">Data Protection Officer appointment registry — NDPA Section 32</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Register DPO</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Register Data Protection Officer</DialogTitle></DialogHeader>
              <div className="space-y-3 mt-2">
                <Input placeholder="Organization ID (numeric)" type="number" value={form.organization_id} onChange={e => setForm(f => ({ ...f, organization_id: e.target.value }))} />
                <Input placeholder="DPO Full Name" value={form.dpo_name} onChange={e => setForm(f => ({ ...f, dpo_name: e.target.value }))} />
                <Input type="email" placeholder="DPO Email" value={form.dpo_email} onChange={e => setForm(f => ({ ...f, dpo_email: e.target.value }))} />
                <Input placeholder="DPO Phone (optional)" value={form.dpo_phone} onChange={e => setForm(f => ({ ...f, dpo_phone: e.target.value }))} />
                <Input placeholder="DPCO Name (optional)" value={form.dpco_name} onChange={e => setForm(f => ({ ...f, dpco_name: e.target.value }))} />
                <Input placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                <Button className="w-full"
                  onClick={() => create.mutate({
                    organization_id: Number(form.organization_id),
                    dpo_name: form.dpo_name,
                    dpo_email: form.dpo_email,
                    dpo_phone: form.dpo_phone || undefined,
                    dpco_name: form.dpco_name || undefined,
                    notes: form.notes || undefined,
                  })}
                  disabled={create.isPending || !form.organization_id || !form.dpo_name || !form.dpo_email}>
                  {create.isPending ? "Registering..." : "Register DPO"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { label: "Total DPOs", value: statsData?.total ?? "—", color: "text-blue-600" },
            { label: "Verified", value: statsData?.verified ?? "—", color: "text-green-600" },
            { label: "Pending", value: statsData?.pending ?? "—", color: "text-orange-600" },
            { label: "Inactive", value: statsData?.inactive ?? "—", color: "text-red-600" },
          ].map((card) => (
            <Card key={card.label}>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by DPO name or email..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader><CardTitle>DPO Registry ({list.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading DPO registry...</div>
            ) : list.length === 0 ? (
              <EmptyState title="No DPO records found" description="No Data Protection Officers have been registered" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Organization</th>
                      <th className="text-left py-2 px-3">DPO Name</th>
                      <th className="text-left py-2 px-3">Email</th>
                      <th className="text-left py-2 px-3">DPCO</th>
                      <th className="text-left py-2 px-3">Credential Status</th>
                      <th className="text-left py-2 px-3">Appointed</th>
                      <th className="text-left py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r: any) => (
                      <tr key={r.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">{r.org_name ?? `Org #${r.organization_id}`}</td>
                        <td className="py-2 px-3">{r.dpo_name}</td>
                        <td className="py-2 px-3 text-muted-foreground">{r.dpo_email}</td>
                        <td className="py-2 px-3">{r.dpco_name ?? "—"}</td>
                        <td className="py-2 px-3">
                          <Badge variant={r.credential_status === "verified" ? "default" : r.credential_status === "rejected" ? "destructive" : "secondary"}>
                            {r.credential_status ?? "pending"}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{r.appointed_at ? new Date(r.appointed_at).toLocaleDateString() : "—"}</td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" title="Verify" onClick={() => verify.mutate({ id: r.id, credential_status: "verified" })}>
                              <CheckCircle className="h-3 w-3 text-green-600" />
                            </Button>
                            <Button size="sm" variant="ghost" title="Set Pending" onClick={() => verify.mutate({ id: r.id, credential_status: "pending" })}>
                              <Clock className="h-3 w-3 text-orange-500" />
                            </Button>
                            <Button size="sm" variant="ghost" title="Reject" onClick={() => verify.mutate({ id: r.id, credential_status: "rejected" })}>
                              <XCircle className="h-3 w-3 text-red-600" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
