import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowRightLeft, Plus, Search, Bell, Globe } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default function Phase13CrossBorderMonitor() {
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    org_name: "", destination_country: "", data_category: "",
    transfer_mechanism: "", volume_records: "", safeguards: ""
  });

  const utils = trpc.useUtils();
  const { data: transfers, isLoading } = trpc.phase13.crossBorderMonitor.list.useQuery({
    search: search || undefined,
    country: countryFilter === "all" ? undefined : countryFilter || undefined,
    risk_level: riskFilter === "all" ? undefined : riskFilter || undefined,
  });
  const { data: byCountry } = trpc.phase13.crossBorderMonitor.getByCountry.useQuery();
  const create = trpc.phase13.crossBorderMonitor.create.useMutation({
    onSuccess: () => {
      utils.phase13.crossBorderMonitor.list.invalidate();
      utils.phase13.crossBorderMonitor.getByCountry.invalidate();
      setOpen(false);
      toast.success("Cross-border transfer recorded");
      setForm({ org_name: "", destination_country: "", data_category: "", transfer_mechanism: "", volume_records: "", safeguards: "" });
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const notifyNITDA = trpc.phase13.crossBorderMonitor.notifyNITDA.useMutation({
    onSuccess: () => { utils.phase13.crossBorderMonitor.list.invalidate(); toast.success("NITDA notified successfully"); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const list = (transfers as any[]) ?? [];
  const countryData = (byCountry as any[]) ?? [];

  const riskColor: Record<string, string> = {
    critical: "bg-red-500/15 text-red-600 dark:text-red-400",
    high: "text-red-600 bg-red-50 dark:bg-red-950/20",
    medium: "text-orange-600 bg-orange-50 dark:bg-orange-950/20",
    low: "text-green-600 bg-green-50 dark:bg-green-950/20",
  };

  const TRANSFER_MECHANISMS = ["standard_contractual_clauses", "binding_corporate_rules", "adequacy_decision", "explicit_consent", "vital_interests", "none"];

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ArrowRightLeft className="h-6 w-6 text-indigo-600" />
              Cross-Border Transfer Monitor
            </h1>
            <p className="text-muted-foreground mt-1">Track international data transfers — NDPA Chapter VI, NITDA notification requirements</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Record Transfer</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Record Cross-Border Transfer</DialogTitle></DialogHeader>
              <div className="space-y-3 mt-2">
                <Input placeholder="Organization Name" value={form.org_name} onChange={e => setForm(f => ({ ...f, org_name: e.target.value }))} />
                <Input placeholder="Destination Country (e.g. United States, Germany)" value={form.destination_country} onChange={e => setForm(f => ({ ...f, destination_country: e.target.value }))} />
                <Select value={form.data_category} onValueChange={v => setForm(f => ({ ...f, data_category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Data Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="personal_data">Personal Data</SelectItem>
                    <SelectItem value="sensitive_personal_data">Sensitive Personal Data</SelectItem>
                    <SelectItem value="financial_data">Financial Data</SelectItem>
                    <SelectItem value="health_data">Health Data</SelectItem>
                    <SelectItem value="biometric_data">Biometric Data</SelectItem>
                    <SelectItem value="children_data">Children's Data</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={form.transfer_mechanism} onValueChange={v => setForm(f => ({ ...f, transfer_mechanism: v }))}>
                  <SelectTrigger><SelectValue placeholder="Transfer Mechanism" /></SelectTrigger>
                  <SelectContent>
                    {TRANSFER_MECHANISMS.map(m => <SelectItem key={m} value={m}>{m.replace(/_/g, " ").replace(/\b\w/g, x => x.toUpperCase())}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" placeholder="Volume (number of records)" value={form.volume_records} onChange={e => setForm(f => ({ ...f, volume_records: e.target.value }))} />
                <Input placeholder="Safeguards in place" value={form.safeguards} onChange={e => setForm(f => ({ ...f, safeguards: e.target.value }))} />
                <Button className="w-full"
                  onClick={() => create.mutate({
                    org_name: form.org_name,
                    destination_country: form.destination_country,
                    data_category: form.data_category || undefined,
                    transfer_mechanism: form.transfer_mechanism || undefined,
                    volume_records: form.volume_records ? Number(form.volume_records) : undefined,
                    safeguards: form.safeguards || undefined,
                  })}
                  disabled={create.isPending || !form.org_name || !form.destination_country}>
                  {create.isPending ? "Recording..." : "Record Transfer"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {countryData.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4" />Transfers by Destination Country</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {countryData.slice(0, 8).map((c: any) => (
                  <div key={c.destination_country} className="bg-muted/50 rounded-lg p-3">
                    <p className="font-semibold text-sm">{c.destination_country}</p>
                    <p className="text-xs text-muted-foreground">{c.transfer_count} transfer(s)</p>
                    {c.total_records && <p className="text-xs text-muted-foreground">{Number(c.total_records).toLocaleString()} records</p>}
                    {c.unnotified > 0 && <Badge variant="destructive" className="mt-1 text-xs">{c.unnotified} unnotified</Badge>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by organization or country..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Input placeholder="Filter by country..." className="w-44" value={countryFilter} onChange={e => setCountryFilter(e.target.value)} />
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All Risk Levels" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader><CardTitle>Transfer Records ({list.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading transfers...</div>
            ) : list.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No cross-border transfers recorded</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Organization</th>
                      <th className="text-left py-2 px-3">Destination</th>
                      <th className="text-left py-2 px-3">Data Category</th>
                      <th className="text-left py-2 px-3">Mechanism</th>
                      <th className="text-left py-2 px-3">Volume</th>
                      <th className="text-left py-2 px-3">Risk</th>
                      <th className="text-left py-2 px-3">NITDA</th>
                      <th className="text-left py-2 px-3">Date</th>
                      <th className="text-left py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((t: any) => (
                      <tr key={t.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">{t.org_name}</td>
                        <td className="py-2 px-3">{t.destination_country}</td>
                        <td className="py-2 px-3">{t.data_category?.replace(/_/g, " ") ?? "—"}</td>
                        <td className="py-2 px-3">
                          {t.transfer_mechanism ? (
                            <span className="text-xs">{t.transfer_mechanism.replace(/_/g, " ")}</span>
                          ) : "—"}
                        </td>
                        <td className="py-2 px-3">{t.volume_records ? Number(t.volume_records).toLocaleString() : "—"}</td>
                        <td className="py-2 px-3">
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${riskColor[t.risk_level] ?? ""}`}>
                            {t.risk_level ?? "—"}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant={t.nitda_notified ? "default" : "destructive"}>
                            {t.nitda_notified ? "Notified" : "Pending"}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{t.created_at ? new Date(t.created_at).toLocaleDateString() : "—"}</td>
                        <td className="py-2 px-3">
                          {!t.nitda_notified && (
                            <Button size="sm" variant="ghost" title="Notify NITDA" onClick={() => notifyNITDA.mutate({ id: t.id })}>
                              <Bell className="h-3 w-3 text-blue-600" />
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
