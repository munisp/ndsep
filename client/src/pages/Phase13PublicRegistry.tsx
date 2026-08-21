import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Globe, Plus, Search, Eye, Upload } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

type ComplianceStatus = "compliant" | "partially_compliant" | "non_compliant" | "pending";

export default function Phase13PublicRegistry() {
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    org_id: "", org_name: "", registration_number: "", sector: "",
    compliance_status: "pending" as ComplianceStatus, compliance_score: "0"
  });

  const utils = trpc.useUtils();
  const { data: records, isLoading } = trpc.phase13.publicRegistry.list.useQuery({
    search: search || undefined,
    sector: sector === "all" ? undefined : sector || undefined,
    status: statusFilter === "all" ? undefined : statusFilter || undefined,
  });
  const { data: stats } = trpc.phase13.publicRegistry.getStats.useQuery();
  const upsert = trpc.phase13.publicRegistry.upsert.useMutation({
    onSuccess: () => {
      utils.phase13.publicRegistry.list.invalidate();
      utils.phase13.publicRegistry.getStats.invalidate();
      setOpen(false);
      toast.success("Registry entry saved");
      setForm({ org_id: "", org_name: "", registration_number: "", sector: "", compliance_status: "pending", compliance_score: "0" });
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const publish = trpc.phase13.publicRegistry.publish.useMutation({
    onSuccess: () => { utils.phase13.publicRegistry.list.invalidate(); toast.success("Entry published to public registry"); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const list = (records as any[]) ?? [];
  const statsData = stats as any;

  const statusColor: Record<string, "default" | "secondary" | "destructive"> = {
    compliant: "default",
    partially_compliant: "secondary",
    non_compliant: "destructive",
    pending: "secondary",
  };

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="h-6 w-6 text-teal-600" />
              Public Compliance Registry
            </h1>
            <p className="text-muted-foreground mt-1">Publicly accessible NDPA compliance status for registered organizations</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Entry</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add/Update Registry Entry</DialogTitle></DialogHeader>
              <div className="space-y-3 mt-2">
                <Input placeholder="Organization ID (numeric)" type="number" value={form.org_id} onChange={e => setForm(f => ({ ...f, org_id: e.target.value }))} />
                <Input placeholder="Organization Name" value={form.org_name} onChange={e => setForm(f => ({ ...f, org_name: e.target.value }))} />
                <Input placeholder="Registration Number (RC/BN)" value={form.registration_number} onChange={e => setForm(f => ({ ...f, registration_number: e.target.value }))} />
                <Select value={form.sector} onValueChange={v => setForm(f => ({ ...f, sector: v }))}>
                  <SelectTrigger><SelectValue placeholder="Sector" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="banking">Banking & Finance</SelectItem>
                    <SelectItem value="telecom">Telecommunications</SelectItem>
                    <SelectItem value="healthcare">Healthcare</SelectItem>
                    <SelectItem value="government">Government</SelectItem>
                    <SelectItem value="education">Education</SelectItem>
                    <SelectItem value="retail">Retail</SelectItem>
                    <SelectItem value="insurance">Insurance</SelectItem>
                    <SelectItem value="technology">Technology</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={form.compliance_status} onValueChange={v => setForm(f => ({ ...f, compliance_status: v as ComplianceStatus }))}>
                  <SelectTrigger><SelectValue placeholder="Compliance Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="compliant">Compliant</SelectItem>
                    <SelectItem value="partially_compliant">Partially Compliant</SelectItem>
                    <SelectItem value="non_compliant">Non-Compliant</SelectItem>
                    <SelectItem value="pending">Pending Assessment</SelectItem>
                  </SelectContent>
                </Select>
                <div>
                  <label className="text-sm font-medium">Compliance Score (0–100)</label>
                  <Input type="number" min={0} max={100} value={form.compliance_score} onChange={e => setForm(f => ({ ...f, compliance_score: e.target.value }))} />
                </div>
                <Button className="w-full"
                  onClick={() => upsert.mutate({
                    org_id: Number(form.org_id),
                    org_name: form.org_name,
                    registration_number: form.registration_number || undefined,
                    sector: form.sector || undefined,
                    compliance_status: form.compliance_status,
                    compliance_score: Number(form.compliance_score),
                  })}
                  disabled={upsert.isPending || !form.org_id || !form.org_name}>
                  {upsert.isPending ? "Saving..." : "Save Entry"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { label: "Total Registered", value: statsData?.total_registered ?? "—", color: "text-blue-600" },
            { label: "Compliant", value: statsData?.compliant ?? "—", color: "text-green-600" },
            { label: "Partially Compliant", value: statsData?.partial ?? "—", color: "text-orange-600" },
            { label: "Non-Compliant", value: statsData?.non_compliant ?? "—", color: "text-red-600" },
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
            <Input className="pl-9" placeholder="Search by organization name or registration number..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={sector} onValueChange={setSector}>
            <SelectTrigger className="w-40"><SelectValue placeholder="All Sectors" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sectors</SelectItem>
              <SelectItem value="banking">Banking</SelectItem>
              <SelectItem value="telecom">Telecom</SelectItem>
              <SelectItem value="healthcare">Healthcare</SelectItem>
              <SelectItem value="government">Government</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="compliant">Compliant</SelectItem>
              <SelectItem value="partially_compliant">Partially Compliant</SelectItem>
              <SelectItem value="non_compliant">Non-Compliant</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader><CardTitle>Registry Entries ({list.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading registry...</div>
            ) : list.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No registry entries found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Organization</th>
                      <th className="text-left py-2 px-3">Reg. Number</th>
                      <th className="text-left py-2 px-3">Sector</th>
                      <th className="text-left py-2 px-3">Score</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Last Assessment</th>
                      <th className="text-left py-2 px-3">Published</th>
                      <th className="text-left py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r: any) => (
                      <tr key={r.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">{r.org_name}</td>
                        <td className="py-2 px-3 font-mono text-xs">{r.registration_number ?? "—"}</td>
                        <td className="py-2 px-3">{r.sector ?? "—"}</td>
                        <td className="py-2 px-3">
                          <span className={`font-bold ${Number(r.compliance_score) >= 80 ? "text-green-600" : Number(r.compliance_score) >= 60 ? "text-orange-600" : "text-red-600"}`}>
                            {r.compliance_score ?? 0}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant={statusColor[r.compliance_status] ?? "secondary"}>
                            {r.compliance_status?.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{r.last_assessment_date ? new Date(r.last_assessment_date).toLocaleDateString() : "—"}</td>
                        <td className="py-2 px-3">
                          {r.is_published ? <Badge variant="default">Published</Badge> : <Badge variant="secondary">Draft</Badge>}
                        </td>
                        <td className="py-2 px-3">
                          {!r.is_published && (
                            <Button size="sm" variant="ghost" title="Publish" onClick={() => publish.mutate({ id: r.id })}>
                              <Upload className="h-3 w-3 text-teal-600" />
                            </Button>
                          )}
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
