import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ShieldAlert, Plus, Search, Edit } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default function Phase13RiskScorecard() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({
    risk_category: "", risk_name: "", likelihood: "3", impact: "3",
    owner: "", mitigation_plan: "", review_date: ""
  });
  const [editForm, setEditForm] = useState({ likelihood: "", impact: "", status: "", mitigation_plan: "", control_effectiveness: "" });

  const utils = trpc.useUtils();
  const { data: records, isLoading } = trpc.phase13.riskScorecard.list.useQuery({
    search: search || undefined,
    risk_category: categoryFilter === "all" ? undefined : categoryFilter || undefined,
    status: statusFilter || undefined,
  });
  const { data: matrix } = trpc.phase13.riskScorecard.getMatrix.useQuery();
  const create = trpc.phase13.riskScorecard.create.useMutation({
    onSuccess: () => {
      utils.phase13.riskScorecard.list.invalidate();
      utils.phase13.riskScorecard.getMatrix.invalidate();
      setOpen(false);
      toast.success("Risk entry created");
      setForm({ risk_category: "", risk_name: "", likelihood: "3", impact: "3", owner: "", mitigation_plan: "", review_date: "" });
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const update = trpc.phase13.riskScorecard.update.useMutation({
    onSuccess: () => {
      utils.phase13.riskScorecard.list.invalidate();
      utils.phase13.riskScorecard.getMatrix.invalidate();
      setEditId(null);
      toast.success("Risk entry updated");
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const list = (records as any[]) ?? [];
  const matrixData = (matrix as any[]) ?? [];

  const riskColor: Record<string, string> = {
    critical: "bg-red-500/15 text-red-600 dark:text-red-400",
    high: "text-red-600 bg-red-50 dark:bg-red-950/20",
    medium: "text-orange-600 bg-orange-50 dark:bg-orange-950/20",
    low: "text-green-600 bg-green-50 dark:bg-green-950/20",
  };

  const RISK_CATEGORIES = ["data_breach", "unauthorized_access", "cross_border_transfer", "consent_failure", "retention_violation", "third_party_risk", "technical_vulnerability", "operational_risk"];

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldAlert className="h-6 w-6 text-orange-600" />
              Risk Scorecard
            </h1>
            <p className="text-muted-foreground mt-1">Likelihood × Impact risk matrix for NDPA compliance risks</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Risk</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add Risk Entry</DialogTitle></DialogHeader>
              <div className="space-y-3 mt-2">
                <Select value={form.risk_category} onValueChange={v => setForm(f => ({ ...f, risk_category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Risk Category" /></SelectTrigger>
                  <SelectContent>
                    {RISK_CATEGORIES.map(c => (
                      <SelectItem key={c} value={c}>{c.replace(/_/g, " ").replace(/\b\w/g, x => x.toUpperCase())}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input placeholder="Risk Name" value={form.risk_name} onChange={e => setForm(f => ({ ...f, risk_name: e.target.value }))} />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">Likelihood (1–5)</label>
                    <Select value={form.likelihood} onValueChange={v => setForm(f => ({ ...f, likelihood: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n} — {["Rare","Unlikely","Possible","Likely","Almost Certain"][n-1]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Impact (1–5)</label>
                    <Select value={form.impact} onValueChange={v => setForm(f => ({ ...f, impact: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n} — {["Negligible","Minor","Moderate","Major","Catastrophic"][n-1]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Input placeholder="Risk Owner" value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} />
                <Input placeholder="Mitigation Plan" value={form.mitigation_plan} onChange={e => setForm(f => ({ ...f, mitigation_plan: e.target.value }))} />
                <Input type="date" placeholder="Review Date" value={form.review_date} onChange={e => setForm(f => ({ ...f, review_date: e.target.value }))} />
                <Button className="w-full"
                  onClick={() => create.mutate({
                    risk_category: form.risk_category,
                    risk_name: form.risk_name,
                    likelihood: Number(form.likelihood),
                    impact: Number(form.impact),
                    owner: form.owner || undefined,
                    mitigation_plan: form.mitigation_plan || undefined,
                    review_date: form.review_date || undefined,
                  })}
                  disabled={create.isPending || !form.risk_category || !form.risk_name}>
                  {create.isPending ? "Creating..." : "Add Risk"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {matrixData.map((m: any) => (
            <Card key={m.risk_level}>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground capitalize">{m.risk_level} Risk</p>
                <p className={`text-2xl font-bold ${riskColor[m.risk_level]?.split(" ")[0] ?? ""}`}>{m.count}</p>
                <p className="text-xs text-muted-foreground">Avg score: {Number(m.avg_score ?? 0).toFixed(1)}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search risks..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All Categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {RISK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="mitigated">Mitigated</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader><CardTitle>Risk Register ({list.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading risk register...</div>
            ) : list.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No risk entries found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Risk Name</th>
                      <th className="text-left py-2 px-3">Category</th>
                      <th className="text-left py-2 px-3">L</th>
                      <th className="text-left py-2 px-3">I</th>
                      <th className="text-left py-2 px-3">Score</th>
                      <th className="text-left py-2 px-3">Level</th>
                      <th className="text-left py-2 px-3">Owner</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r: any) => (
                      <tr key={r.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">{r.risk_name}</td>
                        <td className="py-2 px-3">{r.risk_category?.replace(/_/g, " ")}</td>
                        <td className="py-2 px-3 text-center font-mono">{r.likelihood}</td>
                        <td className="py-2 px-3 text-center font-mono">{r.impact}</td>
                        <td className="py-2 px-3 text-center font-bold">{r.risk_score ?? (r.likelihood * r.impact)}</td>
                        <td className="py-2 px-3">
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${riskColor[r.risk_level] ?? ""}`}>
                            {r.risk_level}
                          </span>
                        </td>
                        <td className="py-2 px-3">{r.owner ?? "—"}</td>
                        <td className="py-2 px-3">
                          <Badge variant={r.status === "mitigated" || r.status === "closed" ? "default" : "secondary"}>
                            {r.status ?? "open"}
                          </Badge>
                        </td>
                        <td className="py-2 px-3">
                          {editId === r.id ? (
                            <div className="flex gap-1 items-center">
                              <Input className="w-16 h-6 text-xs" type="number" min={1} max={5} placeholder="L" value={editForm.likelihood} onChange={e => setEditForm(f => ({ ...f, likelihood: e.target.value }))} />
                              <Input className="w-16 h-6 text-xs" type="number" min={1} max={5} placeholder="I" value={editForm.impact} onChange={e => setEditForm(f => ({ ...f, impact: e.target.value }))} />
                              <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: r.id, likelihood: editForm.likelihood ? Number(editForm.likelihood) : undefined, impact: editForm.impact ? Number(editForm.impact) : undefined, status: editForm.status || undefined })}>Save</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>×</Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => { setEditId(r.id); setEditForm({ likelihood: String(r.likelihood), impact: String(r.impact), status: r.status ?? "open", mitigation_plan: r.mitigation_plan ?? "", control_effectiveness: String(r.control_effectiveness ?? "") }); }}>
                              <Edit className="h-3 w-3" />
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
