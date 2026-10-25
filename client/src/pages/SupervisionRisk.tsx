import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CalendarRange, Gauge, Loader2, Play, RefreshCw, Scale } from "lucide-react";

const BANDS = ["low", "medium", "high", "critical"] as const;
const BAND_COLORS: Record<string, string> = {
  low: "bg-green-500/20 text-green-300 border-green-500/40",
  medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  critical: "bg-red-500/20 text-red-300 border-red-500/40",
};
const FACTOR_KEYS = [
  "complaint_volume", "complaint_surge", "scan_findings",
  "prior_sanctions", "filing_delinquency", "data_volume_class",
] as const;
type FactorKey = (typeof FACTOR_KEYS)[number];

export default function SupervisionRisk() {
  const utils = trpc.useUtils();
  const [band, setBand] = useState<string>("");
  const scores = trpc.supervisionRisk.listRiskScores.useQuery(band ? { band: band as (typeof BANDS)[number] } : undefined);
  const weights = trpc.supervisionRisk.getWeights.useQuery();
  const plans = trpc.supervisionRisk.listPlans.useQuery(undefined);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const planDetail = trpc.supervisionRisk.getPlan.useQuery(
    { planId: selectedPlanId ?? 0 },
    { enabled: selectedPlanId != null }
  );

  const computeAll = trpc.supervisionRisk.computeRiskScores.useMutation({
    onSuccess: (res: any) => { toast.success(`Scored ${res.scored} organisation(s)`); scores.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const updateWeight = trpc.supervisionRisk.updateWeight.useMutation({
    onSuccess: (row: any) => { toast.success(`Weight updated: ${row.key} = ${row.weight}`); weights.refetch(); setWeightDraft(null); },
    onError: (err) => toast.error(err.message),
  });
  const generatePlan = trpc.supervisionRisk.generateAnnualPlan.useMutation({
    onSuccess: (res: any) => {
      toast.success(res.alreadyExisted ? "Plan already exists — loaded" : `Plan generated with ${res.items?.length ?? 0} item(s)`);
      plans.refetch();
      if (res.plan?.id) setSelectedPlanId(res.plan.id);
    },
    onError: (err) => toast.error(err.message),
  });
  const approvePlan = trpc.supervisionRisk.approvePlan.useMutation({
    onSuccess: () => { toast.success("Plan approved"); plans.refetch(); planDetail.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const assignItem = trpc.supervisionRisk.assignPlanItem.useMutation({
    onSuccess: () => { toast.success("Team assigned"); planDetail.refetch(); setAssignFor(null); setAssignTeam(""); },
    onError: (err) => toast.error(err.message),
  });
  const referItem = trpc.supervisionRisk.referToFieldInspection.useMutation({
    onSuccess: (res: any) => { toast.success(res.alreadyReferred ? "Already referred" : `Referred — inspection case ${res.inspectionCaseUuid?.slice(0, 8)}…`); planDetail.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const [weightDraft, setWeightDraft] = useState<FactorKey | null>(null);
  const [weightValue, setWeightValue] = useState("");
  const [genForm, setGenForm] = useState({
    year: new Date().getFullYear() + 1,
    name: "",
    capacityInspectorDays: 200,
    estimatedDaysPerInspection: 5,
    dueStart: `${new Date().getFullYear() + 1}-01-15`,
    dueEnd: `${new Date().getFullYear() + 1}-11-30`,
    minBand: "medium" as (typeof BANDS)[number],
  });
  const [assignFor, setAssignFor] = useState<number | null>(null);
  const [assignTeam, setAssignTeam] = useState("");

  const weightRows: any[] = (weights.data as any)?.weights ?? [];
  const defaults: Record<string, number> = (weights.data as any)?.defaults ?? {};

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Supervision Risk" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Gauge className="h-6 w-6" /> Risk-Based Supervision</h1>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => utils.supervisionRisk.invalidate()}><RefreshCw className="h-4 w-4" /></Button>
          <Button onClick={() => computeAll.mutate({})} disabled={computeAll.isPending}>
            {computeAll.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Score all organisations
          </Button>
        </div>
      </div>

      <Tabs defaultValue="scores">
        <TabsList>
          <TabsTrigger value="scores">Risk scores</TabsTrigger>
          <TabsTrigger value="weights">Factor weights</TabsTrigger>
          <TabsTrigger value="plans">Annual plans</TabsTrigger>
        </TabsList>

        <TabsContent value="scores" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Controller risk scores</CardTitle>
              <CardDescription>Latest composite risk score per controller (0–1), highest first.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Band filter</Label>
                <Select value={band || "all"} onValueChange={(v) => setBand(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All bands</SelectItem>
                    {BANDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Org</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Band</TableHead>
                    <TableHead>Computed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((scores.data as any[]) ?? []).map((s: any) => (
                    <TableRow key={s.id ?? s.org_id}>
                      <TableCell className="font-medium">{s.org_name ?? `Org #${s.org_id}`}</TableCell>
                      <TableCell className="text-right font-mono">{Number(s.score).toFixed(3)}</TableCell>
                      <TableCell><Badge variant="outline" className={BAND_COLORS[s.band] ?? ""}>{s.band}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.computed_at ? new Date(s.computed_at).toLocaleString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {((scores.data as any[]) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No risk scores yet — run “Score all organisations”.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="weights" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Scale className="h-5 w-5" /> Scoring factor weights</CardTitle>
              <CardDescription>Composite score = renormalised weighted sum of normalised factors. Weights must each be in [0, 1].</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Factor</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Default</TableHead>
                    <TableHead>Last updated</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {FACTOR_KEYS.map((k) => {
                    const row = weightRows.find((w) => w.key === k);
                    return (
                      <TableRow key={k}>
                        <TableCell className="font-mono text-sm">{k}</TableCell>
                        <TableCell className="text-right font-mono">{row ? Number(row.weight).toFixed(2) : (defaults[k]?.toFixed(2) ?? "—")}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{defaults[k]?.toFixed(2) ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row?.updated_at ? new Date(row.updated_at).toLocaleString() : "never"}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => { setWeightDraft(k); setWeightValue(String(row?.weight ?? defaults[k] ?? 0)); }}>Edit</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {weightDraft && (
                <div className="border rounded-lg p-4 mt-4 flex flex-wrap gap-3 items-end">
                  <div>
                    <Label htmlFor="sr-weight">New weight for <span className="font-mono">{weightDraft}</span> (0–1)</Label>
                    <Input id="sr-weight" type="number" step="0.01" min="0" max="1" value={weightValue} onChange={(e) => setWeightValue(e.target.value)} className="w-40" />
                  </div>
                  <Button
                    disabled={updateWeight.isPending || weightValue === "" || Number.isNaN(Number(weightValue))}
                    onClick={() => updateWeight.mutate({ key: weightDraft, weight: Number(weightValue) })}
                  >Save</Button>
                  <Button variant="ghost" onClick={() => setWeightDraft(null)}>Cancel</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plans" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><CalendarRange className="h-5 w-5" /> Generate annual supervision plan</CardTitle>
              <CardDescription>Risk-ranked inspection schedule under a hard inspector-days capacity constraint.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                <div>
                  <Label>Year</Label>
                  <Input type="number" value={genForm.year} onChange={(e) => setGenForm({ ...genForm, year: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Plan name (optional)</Label>
                  <Input value={genForm.name} onChange={(e) => setGenForm({ ...genForm, name: e.target.value })} placeholder={`${genForm.year} Annual Supervision Plan`} />
                </div>
                <div>
                  <Label>Capacity (inspector-days)</Label>
                  <Input type="number" value={genForm.capacityInspectorDays} onChange={(e) => setGenForm({ ...genForm, capacityInspectorDays: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Days per inspection</Label>
                  <Input type="number" value={genForm.estimatedDaysPerInspection} onChange={(e) => setGenForm({ ...genForm, estimatedDaysPerInspection: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Due start</Label>
                  <Input type="date" value={genForm.dueStart} onChange={(e) => setGenForm({ ...genForm, dueStart: e.target.value })} />
                </div>
                <div>
                  <Label>Due end</Label>
                  <Input type="date" value={genForm.dueEnd} onChange={(e) => setGenForm({ ...genForm, dueEnd: e.target.value })} />
                </div>
                <div>
                  <Label>Minimum band</Label>
                  <Select value={genForm.minBand} onValueChange={(v) => setGenForm({ ...genForm, minBand: v as (typeof BANDS)[number] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{BANDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button
                  disabled={generatePlan.isPending}
                  onClick={() => generatePlan.mutate({
                    year: genForm.year,
                    name: genForm.name || undefined,
                    capacityInspectorDays: genForm.capacityInspectorDays,
                    estimatedDaysPerInspection: genForm.estimatedDaysPerInspection,
                    dueStart: genForm.dueStart,
                    dueEnd: genForm.dueEnd,
                    minBand: genForm.minBand,
                  })}
                >
                  {generatePlan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate plan"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">Plans</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {((plans.data as any[]) ?? []).map((p: any) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPlanId(p.id)}
                    className={`w-full text-left border rounded px-3 py-2 text-sm ${selectedPlanId === p.id ? "border-primary" : "border-border"}`}
                  >
                    <div className="flex justify-between">
                      <span className="font-medium">{p.name}</span>
                      <Badge variant="outline" className={p.status === "approved" ? "bg-green-500/20 text-green-300 border-green-500/40" : ""}>{p.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {p.year} · capacity {p.capacity_inspector_days}d · allocated {p.allocated_inspector_days}d
                    </p>
                  </button>
                ))}
                {((plans.data as any[]) ?? []).length === 0 && <p className="text-sm text-muted-foreground">No plans yet.</p>}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg">Plan items</CardTitle>
                {planDetail.data?.plan && (
                  <CardDescription>
                    {(planDetail.data.plan as any).name} — status {(planDetail.data.plan as any).status}
                    {(planDetail.data.plan as any).status === "draft" && (
                      <Button size="sm" className="ml-3" disabled={approvePlan.isPending} onClick={() => approvePlan.mutate({ planId: (planDetail.data!.plan as any).id })}>
                        Approve plan
                      </Button>
                    )}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {!selectedPlanId ? (
                  <p className="text-sm text-muted-foreground">Select a plan to view its inspection schedule.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">Rank</TableHead>
                        <TableHead>Organisation</TableHead>
                        <TableHead>Due window</TableHead>
                        <TableHead>Team</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((planDetail.data?.items as any[]) ?? []).map((it: any) => (
                        <TableRow key={it.id}>
                          <TableCell className="text-right font-mono">{it.rank}</TableCell>
                          <TableCell>{it.org_name ?? `Org #${it.org_id}`}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{String(it.due_start).slice(0, 10)} → {String(it.due_end).slice(0, 10)}</TableCell>
                          <TableCell className="text-sm">{it.assigned_team ?? <span className="text-muted-foreground">unassigned</span>}</TableCell>
                          <TableCell><Badge variant="outline">{String(it.status).replaceAll("_", " ")}</Badge></TableCell>
                          <TableCell className="text-right space-x-1">
                            {["scheduled", "deferred"].includes(it.status) && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => { setAssignFor(it.id); setAssignTeam(""); }}>Assign</Button>
                                <Button size="sm" variant="outline" disabled={referItem.isPending} onClick={() => referItem.mutate({ planItemId: it.id })}>Refer to field</Button>
                              </>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {((planDetail.data?.items as any[]) ?? []).length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No items in this plan.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
                {assignFor != null && (
                  <div className="border rounded-lg p-4 mt-4 flex flex-wrap gap-3 items-end">
                    <div>
                      <Label htmlFor="sr-team">Assign team to item #{assignFor}</Label>
                      <Input id="sr-team" value={assignTeam} onChange={(e) => setAssignTeam(e.target.value)} placeholder="e.g. Lagos Zone A" className="w-56" />
                    </div>
                    <Button disabled={assignItem.isPending || !assignTeam.trim()} onClick={() => assignItem.mutate({ planItemId: assignFor, assignedTeam: assignTeam.trim() })}>Assign</Button>
                    <Button variant="ghost" onClick={() => setAssignFor(null)}>Cancel</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
