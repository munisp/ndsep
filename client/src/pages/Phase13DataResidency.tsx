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
import { MapPin, Plus, Search, Trash2, Globe } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default function Phase13DataResidency() {
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    data_category: "", storage_country: "", storage_region: "", provider_name: "",
    provider_type: "", transfer_mechanism: "", volume_gb: "", adequacy_decision: false
  });

  const utils = trpc.useUtils();
  const { data: records, isLoading } = trpc.phase13.dataResidency.list.useQuery({
    search: search || undefined,
    country: countryFilter || undefined,
  });
  const { data: byCountry } = trpc.phase13.dataResidency.getByCountry.useQuery();
  const create = trpc.phase13.dataResidency.create.useMutation({
    onSuccess: () => {
      utils.phase13.dataResidency.list.invalidate();
      utils.phase13.dataResidency.getByCountry.invalidate();
      setOpen(false);
      toast.success("Data residency location added");
      setForm({ data_category: "", storage_country: "", storage_region: "", provider_name: "", provider_type: "", transfer_mechanism: "", volume_gb: "", adequacy_decision: false });
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteRecord = trpc.phase13.dataResidency.delete.useMutation({
    onSuccess: () => { utils.phase13.dataResidency.list.invalidate(); utils.phase13.dataResidency.getByCountry.invalidate(); toast.success("Location deleted"); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const list = (records as any[]) ?? [];
  const countryData = (byCountry as any[]) ?? [];

  const TRANSFER_MECHANISMS = ["standard_contractual_clauses", "binding_corporate_rules", "adequacy_decision", "explicit_consent", "vital_interests", "none"];
  const DATA_CATEGORIES = ["personal_data", "sensitive_personal_data", "financial_data", "health_data", "biometric_data", "children_data", "employee_data"];

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MapPin className="h-6 w-6 text-blue-600" />
              Data Residency Map
            </h1>
            <p className="text-muted-foreground mt-1">Track where Nigerian personal data is stored globally — NDPA Chapter VI</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Location</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add Data Storage Location</DialogTitle></DialogHeader>
              <div className="space-y-3 mt-2">
                <Select value={form.data_category} onValueChange={v => setForm(f => ({ ...f, data_category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Data Category" /></SelectTrigger>
                  <SelectContent>
                    {DATA_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, " ").replace(/\b\w/g, x => x.toUpperCase())}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="Storage Country (e.g. Nigeria, USA)" value={form.storage_country} onChange={e => setForm(f => ({ ...f, storage_country: e.target.value }))} />
                <Input placeholder="Storage Region (e.g. Lagos, us-east-1)" value={form.storage_region} onChange={e => setForm(f => ({ ...f, storage_region: e.target.value }))} />
                <Input placeholder="Provider Name (e.g. AWS, Azure)" value={form.provider_name} onChange={e => setForm(f => ({ ...f, provider_name: e.target.value }))} />
                <Select value={form.provider_type} onValueChange={v => setForm(f => ({ ...f, provider_type: v }))}>
                  <SelectTrigger><SelectValue placeholder="Provider Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cloud">Cloud Provider</SelectItem>
                    <SelectItem value="on_premise">On-Premise</SelectItem>
                    <SelectItem value="colocation">Colocation</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={form.transfer_mechanism} onValueChange={v => setForm(f => ({ ...f, transfer_mechanism: v }))}>
                  <SelectTrigger><SelectValue placeholder="Transfer Mechanism" /></SelectTrigger>
                  <SelectContent>
                    {TRANSFER_MECHANISMS.map(m => <SelectItem key={m} value={m}>{m.replace(/_/g, " ").replace(/\b\w/g, x => x.toUpperCase())}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" placeholder="Volume (GB)" value={form.volume_gb} onChange={e => setForm(f => ({ ...f, volume_gb: e.target.value }))} />
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="adequacy" checked={form.adequacy_decision} onChange={e => setForm(f => ({ ...f, adequacy_decision: e.target.checked }))} className="rounded" />
                  <label htmlFor="adequacy" className="text-sm">Adequacy Decision Exists</label>
                </div>
                <Button className="w-full"
                  onClick={() => create.mutate({
                    data_category: form.data_category,
                    storage_country: form.storage_country,
                    storage_region: form.storage_region || undefined,
                    provider_name: form.provider_name || undefined,
                    provider_type: form.provider_type || undefined,
                    transfer_mechanism: form.transfer_mechanism || undefined,
                    volume_gb: form.volume_gb ? Number(form.volume_gb) : undefined,
                    adequacy_decision: form.adequacy_decision,
                  })}
                  disabled={create.isPending || !form.data_category || !form.storage_country}>
                  {create.isPending ? "Adding..." : "Add Location"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {countryData.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4" />Storage by Country</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {countryData.slice(0, 8).map((c: any) => (
                  <div key={c.storage_country} className="bg-muted/50 rounded-lg p-3">
                    <p className="font-semibold text-sm">{c.storage_country}</p>
                    <p className="text-xs text-muted-foreground">{c.locations} location(s)</p>
                    <p className="text-xs text-muted-foreground">{c.total_volume_gb ? `${Number(c.total_volume_gb).toFixed(0)} GB` : "—"}</p>
                    {c.adequate_locations > 0 && <Badge className="mt-1 text-xs" variant="default">Adequate</Badge>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by data category or provider..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Input placeholder="Filter by country..." className="w-48" value={countryFilter} onChange={e => setCountryFilter(e.target.value)} />
        </div>

        <Card>
          <CardHeader><CardTitle>Storage Locations ({list.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading locations...</div>
            ) : list.length === 0 ? (
              <EmptyState title="No data residency locations" description="No data residency locations have been recorded yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Data Category</th>
                      <th className="text-left py-2 px-3">Country</th>
                      <th className="text-left py-2 px-3">Region</th>
                      <th className="text-left py-2 px-3">Provider</th>
                      <th className="text-left py-2 px-3">Type</th>
                      <th className="text-left py-2 px-3">Volume</th>
                      <th className="text-left py-2 px-3">Transfer Mechanism</th>
                      <th className="text-left py-2 px-3">Adequacy</th>
                      <th className="text-left py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r: any) => (
                      <tr key={r.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">{r.data_category?.replace(/_/g, " ")}</td>
                        <td className="py-2 px-3">{r.storage_country}</td>
                        <td className="py-2 px-3 text-muted-foreground">{r.storage_region ?? "—"}</td>
                        <td className="py-2 px-3">{r.provider_name ?? "—"}</td>
                        <td className="py-2 px-3">{r.provider_type?.replace(/_/g, " ") ?? "—"}</td>
                        <td className="py-2 px-3">{r.volume_gb ? `${r.volume_gb} GB` : "—"}</td>
                        <td className="py-2 px-3">
                          {r.transfer_mechanism ? (
                            <Badge variant={r.transfer_mechanism === "none" ? "destructive" : "secondary"} className="text-xs">
                              {r.transfer_mechanism.replace(/_/g, " ")}
                            </Badge>
                          ) : "—"}
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant={r.adequacy_decision ? "default" : "secondary"}>{r.adequacy_decision ? "Yes" : "No"}</Badge>
                        </td>
                        <td className="py-2 px-3">
                          <Button size="sm" variant="ghost" onClick={() => deleteRecord.mutate({ id: r.id })}>
                            <Trash2 className="h-3 w-3 text-red-600" />
                          </Button>
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
