import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search, Plus, Shield, AlertTriangle, CheckCircle, Globe } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const CATEGORY_COLORS: Record<string, string> = {
  sanctions: "bg-red-500/15 text-red-600 dark:text-red-400",
  pep: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  adverse_media: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  terrorism: "bg-red-500/20 text-red-600 dark:text-red-400",
  fraud: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  corruption: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  money_laundering: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
};

const SOURCES = [
  "ofac_sdn", "un_consolidated", "eu_consolidated", "uk_hmt",
  "cbn_internal", "interpol", "efcc", "nfiu", "local_court",
] as const;

const CATEGORIES = [
  "sanctions", "pep", "adverse_media", "terrorism", "fraud", "corruption", "money_laundering",
] as const;

export default function WatchlistScreening() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false);
  const [screenName, setScreenName] = useState("");
  const [screenResult, setScreenResult] = useState<{ matches: any[]; screeningRef: string; matchCount?: number } | null>(null);
  const [form, setForm] = useState({
    primaryName: "", entityType: "individual" as "individual" | "corporate" | "vessel" | "aircraft",
    source: "cbn_internal" as typeof SOURCES[number],
    category: "sanctions" as typeof CATEGORIES[number],
    nationality: "", passportNumber: "", dateOfBirth: "",
    aliases: "", reason: "",
  });

  const { data: stats } = trpc.banking.watchlist.stats.useQuery();
  const { data, isLoading, refetch } = trpc.banking.watchlist.list.useQuery({
    search: search || undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    isActive: activeFilter !== "all" ? activeFilter === "true" : undefined,
    page,
    limit: 20,
  });

  const addMutation = trpc.banking.watchlist.addEntry.useMutation({
    onSuccess: () => {
      toast.success("Entity added to watchlist");
      setAddOpen(false);
      setForm({ primaryName: "", entityType: "individual", source: "cbn_internal", category: "sanctions", nationality: "", passportNumber: "", dateOfBirth: "", aliases: "", reason: "" });
      refetch();
    },
    onError: (e: { message: string }) => toast.error("Failed to add entity", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const screenMutation = trpc.banking.watchlist.screen.useMutation({
    onSuccess: (result) => {
      setScreenResult(result);
      if ((result.matchCount ?? 0) > 0) {
        toast.error(`${result.matchCount} match(es) found`, { description: "Review matches immediately." });
      } else {
        toast.success("No watchlist matches found");
      }
    },
    onError: (e: { message: string }) => toast.error("Screening failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const delistMutation = trpc.banking.watchlist.delistEntry.useMutation({
    onSuccess: () => { toast.success("Entity delisted"); refetch(); },
    onError: (e: { message: string }) => toast.error("Failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const rows = (data?.rows ?? []) as any[];
  const total = data?.total ?? 0;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Banking", href: "/banking" }, { label: "Watchlist Screening" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Watchlist Screening</h1>
          <p className="text-sm text-muted-foreground mt-1">OFAC / UN / EU Sanctions — PEP & Adverse Media Screening</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={screenOpen} onOpenChange={v => { setScreenOpen(v); if (!v) setScreenResult(null); }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2"><Search className="h-4 w-4" />Screen Entity</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Screen Entity Against Watchlists</DialogTitle></DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-1">
                  <Label>Entity Name *</Label>
                  <Input placeholder="John Doe / Acme Corporation" value={screenName}
                    onChange={e => setScreenName(e.target.value)} />
                </div>
                <Button className="w-full" onClick={() => screenMutation.mutate({ name: screenName })}
                  disabled={!screenName || screenMutation.isPending}>
                  {screenMutation.isPending ? "Screening..." : "Run Screening"}
                </Button>
                {screenResult && (
                  <div className={`p-4 rounded-lg ${(screenResult.matchCount ?? 0) > 0 ? "bg-red-50 border border-red-500/20" : "bg-green-50 border border-green-500/20"}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {(screenResult.matchCount ?? 0) > 0
                        ? <AlertTriangle className="h-5 w-5 text-red-600" />
                        : <CheckCircle className="h-5 w-5 text-green-600" />}
                      <span className={`font-semibold ${(screenResult.matchCount ?? 0) > 0 ? "text-red-700" : "text-green-700"}`}>
                        {(screenResult.matchCount ?? 0) > 0 ? `${screenResult.matchCount} Match(es) Found` : "Clear — No Matches"}
                      </span>
                    </div>
                    {screenResult.matches?.map((m: any, i: number) => (
                      <div key={i} className="text-sm mt-2 p-2 bg-background rounded border">
                        <p className="font-medium">{m.primary_name}</p>
                        <p className="text-xs text-muted-foreground">{m.category} · {m.source} · {m.nationality || "Global"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" />Add to Watchlist</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add Entity to Watchlist</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="col-span-2 space-y-1">
                  <Label>Full Name *</Label>
                  <Input placeholder="John Doe / Acme Corporation" value={form.primaryName}
                    onChange={e => setForm(f => ({ ...f, primaryName: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Entity Type</Label>
                  <Select value={form.entityType} onValueChange={v => setForm(f => ({ ...f, entityType: v as typeof form.entityType }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["individual", "corporate", "vessel", "aircraft"] as const).map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Category</Label>
                  <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v as typeof CATEGORIES[number] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Source List</Label>
                  <Select value={form.source} onValueChange={v => setForm(f => ({ ...f, source: v as typeof SOURCES[number] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SOURCES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ").toUpperCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Nationality (ISO 2)</Label>
                  <Input placeholder="NG" maxLength={2} value={form.nationality}
                    onChange={e => setForm(f => ({ ...f, nationality: e.target.value.toUpperCase() }))} />
                </div>
                <div className="space-y-1">
                  <Label>Passport / ID Number</Label>
                  <Input placeholder="A12345678" value={form.passportNumber}
                    onChange={e => setForm(f => ({ ...f, passportNumber: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Date of Birth</Label>
                  <Input type="date" value={form.dateOfBirth}
                    onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))} />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Aliases (comma-separated)</Label>
                  <Input placeholder="John D., J. Doe" value={form.aliases}
                    onChange={e => setForm(f => ({ ...f, aliases: e.target.value }))} />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Reason for Listing *</Label>
                  <Input placeholder="Minimum 10 characters" value={form.reason}
                    onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => addMutation.mutate({
                    primaryName: form.primaryName,
                    entityType: form.entityType,
                    source: form.source,
                    category: form.category,
                    nationality: form.nationality || undefined,
                    passportNumber: form.passportNumber || undefined,
                    dateOfBirth: form.dateOfBirth || undefined,
                    aliases: form.aliases ? form.aliases.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
                    reason: form.reason,
                  })}
                  disabled={!form.primaryName || !form.reason || addMutation.isPending}
                >
                  {addMutation.isPending ? "Adding..." : "Add Entity"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Entries", value: (stats as any).total, icon: Shield, color: "text-blue-600" },
            { label: "Sanctions", value: (stats as any).sanctions, icon: AlertTriangle, color: "text-red-600" },
            { label: "PEP", value: (stats as any).pep, icon: Globe, color: "text-orange-600" },
            { label: "Active", value: (stats as any).active, icon: CheckCircle, color: "text-green-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <Icon className={`h-8 w-8 ${color}`} />
                  <div>
                    <p className="text-2xl font-bold">{value ?? 0}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name, passport, ID..." className="pl-9"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={categoryFilter} onValueChange={v => { setCategoryFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={activeFilter} onValueChange={v => { setActiveFilter(v); setPage(1); }}>
          <SelectTrigger className="w-32"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Delisted</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b">
                <tr>
                  {["Name", "Entity Type", "Category", "Source", "Nationality", "Passport/ID", "Status", "Listed", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No watchlist entries found</td></tr>
                ) : rows.map((r: any) => (
                  <tr key={r.id} className="hover:bg-muted">
                    <td className="px-4 py-3 font-medium">{r.primary_name}</td>
                    <td className="px-4 py-3 text-xs capitalize">{r.entity_type}</td>
                    <td className="px-4 py-3">
                      <Badge className={CATEGORY_COLORS[r.category] || "bg-muted text-foreground"}>
                        {r.category?.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs uppercase">{r.source?.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-xs">{r.nationality || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.passport_number || "—"}</td>
                    <td className="px-4 py-3">
                      {r.is_active
                        ? <Badge className="bg-red-500/15 text-red-600 dark:text-red-400">Listed</Badge>
                        : <Badge className="bg-muted text-muted-foreground">Delisted</Badge>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.listing_date ? new Date(r.listing_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {r.is_active && (
                        <Button size="sm" variant="ghost" className="text-red-600"
                          onClick={() => delistMutation.mutate({ id: r.id, reason: "Delisted via admin UI" })}>
                          Delist
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > 20 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, total)} of {total}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
