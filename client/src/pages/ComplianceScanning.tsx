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
import { Checkbox } from "@/components/ui/checkbox";
import { RefreshCw, ScanSearch } from "lucide-react";
import { InfraPosturePanel } from "@/components/InfraPosturePanel";

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const SEV_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-300 border-red-500/40",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  low: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  info: "bg-muted text-muted-foreground border-border",
};
const FINDING_STATUSES = ["open", "acknowledged", "suppressed", "referred", "resolved", "dismissed"] as const;
const RUN_STATUSES = ["scheduled", "running", "completed", "failed", "cancelled"] as const;

export default function ComplianceScanning() {
  const overview = trpc.complianceScanning.scanningOverview.useQuery();
  const targets = trpc.complianceScanning.listTargets.useQuery({});
  const [runStatus, setRunStatus] = useState<string>("");
  const runs = trpc.complianceScanning.listRuns.useQuery({
    status: (runStatus || undefined) as (typeof RUN_STATUSES)[number] | undefined,
  });
  const [findingStatus, setFindingStatus] = useState<string>("open");
  const findings = trpc.complianceScanning.listFindings.useQuery({
    status: (findingStatus || undefined) as (typeof FINDING_STATUSES)[number] | undefined,
  });
  const suppressions = trpc.complianceScanning.listSuppressions.useQuery({});

  const refresh = () => { overview.refetch(); targets.refetch(); runs.refetch(); findings.refetch(); suppressions.refetch(); };

  const [targetForm, setTargetForm] = useState({ controller_name: "", base_url: "", organization_id: "", scan_interval_hours: 168, max_pages: 5 });
  const addTarget = trpc.complianceScanning.addTarget.useMutation({
    onSuccess: () => { toast.success("Scan target added"); setTargetForm({ controller_name: "", base_url: "", organization_id: "", scan_interval_hours: 168, max_pages: 5 }); targets.refetch(); overview.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const scheduleScan = trpc.complianceScanning.scheduleScan.useMutation({
    onSuccess: () => { toast.success("Scan scheduled"); runs.refetch(); overview.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const cancelScan = trpc.complianceScanning.cancelScan.useMutation({
    onSuccess: () => { toast.success("Scan cancelled"); runs.refetch(); overview.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const findingStatusMut = trpc.complianceScanning.setFindingStatus.useMutation({
    onSuccess: () => { toast.success("Finding updated"); findings.refetch(); overview.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [referFor, setReferFor] = useState<number | null>(null);
  const [referNotes, setReferNotes] = useState("");
  const referFinding = trpc.complianceScanning.referFindingToEnforcement.useMutation({
    onSuccess: () => { toast.success("Finding referred to enforcement"); setReferFor(null); setReferNotes(""); findings.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  // ── Bulk finding actions (round 12 W2) ───────────────────────────────────
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<"acknowledged" | "resolved" | "dismissed">("acknowledged");
  const [suppressReason, setSuppressReason] = useState("");
  const bulkSetStatus = trpc.bulkOps.bulkSetFindingStatus.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Bulk status: ${r.succeeded}/${r.total} updated${r.failed.length ? ` — ${r.failed.length} skipped (already closed)` : ""}`);
      setChecked(new Set()); findings.refetch(); overview.refetch();
    },
    onError: (err: any) => toast.error(err.message),
  });
  const bulkSuppress = trpc.bulkOps.bulkSuppressFindings.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Suppression requested for ${r.succeeded}/${r.total} finding(s) — a second officer must approve each request${r.failed.length ? ` — ${r.failed.length} skipped` : ""}`);
      setChecked(new Set()); setSuppressReason(""); findings.refetch(); suppressions.refetch(); overview.refetch();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const findingRows: any[] = (findings.data as any[]) ?? [];
  const toggleFinding = (id: number, v: boolean) => setChecked((prev) => {
    const next = new Set(prev);
    if (v) next.add(id); else next.delete(id);
    return next;
  });

  const ov: any = overview.data ?? {};

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Compliance Scanning" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ScanSearch className="h-6 w-6" /> Web Compliance Scanning</h1>
        <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: "Enabled targets", value: ov.enabled_targets },
          { label: "Scheduled runs", value: ov.scheduled_runs },
          { label: "Completed runs", value: ov.completed_runs },
          { label: "Open findings", value: ov.open_findings },
          { label: "Open critical/high", value: ov.open_high_findings, danger: true },
          { label: "Pending suppressions", value: ov.pending_suppressions },
        ].map((k) => (
          <Card key={k.label} className={k.danger && k.value ? "border-red-500/50" : ""}>
            <CardHeader className="pb-1 pt-3"><CardDescription>{k.label}</CardDescription></CardHeader>
            <CardContent className={`text-2xl font-mono font-bold ${k.danger && k.value ? "text-red-400" : ""}`}>{k.value ?? "—"}</CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="targets">
        <TabsList>
          <TabsTrigger value="targets">Targets</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="suppressions">Suppressions</TabsTrigger>
        </TabsList>

        <TabsContent value="targets" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Add scan target</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
              <div className="md:col-span-2">
                <Label>Controller name</Label>
                <Input value={targetForm.controller_name} onChange={(e) => setTargetForm({ ...targetForm, controller_name: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Label>Base URL (https)</Label>
                <Input type="url" value={targetForm.base_url} onChange={(e) => setTargetForm({ ...targetForm, base_url: e.target.value })} placeholder="https://example.ng" />
              </div>
              <div>
                <Label>Interval (hours)</Label>
                <Input type="number" min={1} max={8760} value={targetForm.scan_interval_hours} onChange={(e) => setTargetForm({ ...targetForm, scan_interval_hours: Number(e.target.value) })} />
              </div>
              <Button
                disabled={addTarget.isPending || targetForm.controller_name.trim().length < 2 || !/^https:\/\//.test(targetForm.base_url)}
                onClick={() => addTarget.mutate({
                  controller_name: targetForm.controller_name.trim(),
                  base_url: targetForm.base_url.trim(),
                  organization_id: targetForm.organization_id ? Number(targetForm.organization_id) : undefined,
                  scan_interval_hours: targetForm.scan_interval_hours,
                  max_pages: targetForm.max_pages,
                })}
              >Add target</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Targets</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Controller</TableHead><TableHead>Base URL</TableHead><TableHead>Interval</TableHead>
                    <TableHead>Enabled</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((targets.data as any[]) ?? []).map((t: any) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.controller_name}</TableCell>
                      <TableCell className="font-mono text-xs">{t.base_url}</TableCell>
                      <TableCell className="text-sm">{t.scan_interval_hours}h</TableCell>
                      <TableCell>{t.enabled ? <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-500/40">enabled</Badge> : <Badge variant="outline">disabled</Badge>}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" disabled={scheduleScan.isPending || !t.enabled} onClick={() => scheduleScan.mutate({ target_id: t.id })}>Scan now</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {((targets.data as any[]) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No scan targets.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Scan runs</CardTitle>
              <div className="pt-2">
                <Select value={runStatus || "all"} onValueChange={(v) => setRunStatus(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {RUN_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead><TableHead>Controller</TableHead><TableHead>Scheduled</TableHead>
                    <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((runs.data as any[]) ?? []).map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">{r.id}</TableCell>
                      <TableCell>{r.controller_name ?? `target #${r.target_id}`}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.scheduled_at ? new Date(r.scheduled_at).toLocaleString() : "—"}</TableCell>
                      <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {["scheduled", "running"].includes(r.status) && (
                          <Button size="sm" variant="ghost" className="text-red-400" disabled={cancelScan.isPending} onClick={() => cancelScan.mutate({ run_id: r.id })}>Cancel</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {((runs.data as any[]) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No scan runs.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="findings" className="mt-4 space-y-4">
          <div>
            <Label>Status</Label>
            <Select value={findingStatus} onValueChange={setFindingStatus}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FINDING_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-lg">Findings ({findingStatus})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {findingRows.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap rounded-md border px-3 py-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      aria-label="Select all findings"
                      checked={findingRows.every((f) => checked.has(f.id))}
                      onCheckedChange={(v) => setChecked(v ? new Set(findingRows.map((f) => f.id)) : new Set())}
                    />
                    Select all ({findingRows.length})
                  </label>
                  {checked.size > 0 && (
                    <>
                      <span className="text-sm font-medium">{checked.size} selected</span>
                      <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v as "acknowledged" | "resolved" | "dismissed")}>
                        <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["acknowledged", "resolved", "dismissed"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm" variant="secondary"
                        disabled={bulkSetStatus.isPending || bulkSuppress.isPending}
                        onClick={() => bulkSetStatus.mutate({ findingIds: Array.from(checked), status: bulkStatus })}
                      >Set status</Button>
                      <Input
                        value={suppressReason}
                        onChange={(e) => setSuppressReason(e.target.value)}
                        placeholder="Suppression reason (min 20 chars)"
                        className="w-64 h-8"
                      />
                      <Button
                        size="sm" variant="outline"
                        disabled={bulkSuppress.isPending || bulkSetStatus.isPending || suppressReason.trim().length < 20}
                        onClick={() => bulkSuppress.mutate({ findingIds: Array.from(checked), reason: suppressReason.trim() })}
                      >Request suppression</Button>
                      <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>Clear</Button>
                    </>
                  )}
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Type</TableHead><TableHead>Severity</TableHead><TableHead>Target</TableHead>
                    <TableHead>URL</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {findingRows.map((f: any) => (
                    <TableRow key={f.id}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Select finding ${f.id}`}
                          checked={checked.has(f.id)}
                          onCheckedChange={(v) => toggleFinding(f.id, Boolean(v))}
                        />
                      </TableCell>
                      <TableCell className="text-sm">{String(f.finding_type).replaceAll("_", " ")}</TableCell>
                      <TableCell><Badge variant="outline" className={SEV_COLORS[f.severity] ?? ""}>{f.severity}</Badge></TableCell>
                      <TableCell className="text-sm">{f.controller_name ?? `#${f.target_id}`}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[220px] truncate">{f.url ?? "—"}</TableCell>
                      <TableCell className="text-right space-x-1">
                        {f.status === "open" && (
                          <>
                            <Button size="sm" variant="outline" disabled={findingStatusMut.isPending} onClick={() => findingStatusMut.mutate({ id: f.id, status: "acknowledged" })}>Ack</Button>
                            <Button size="sm" variant="outline" disabled={findingStatusMut.isPending} onClick={() => findingStatusMut.mutate({ id: f.id, status: "resolved" })}>Resolve</Button>
                            <Button size="sm" variant="ghost" disabled={findingStatusMut.isPending} onClick={() => findingStatusMut.mutate({ id: f.id, status: "dismissed" })}>Dismiss</Button>
                            <Button size="sm" variant="secondary" onClick={() => { setReferFor(f.id); setReferNotes(""); }}>Refer</Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {findingRows.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No findings with this status.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              {referFor != null && (
                <div className="border rounded-lg p-3 flex gap-2 items-end">
                  <div className="flex-1">
                    <Label htmlFor="cs-refer-notes">Referral notes (min 10 chars)</Label>
                    <Input id="cs-refer-notes" value={referNotes} onChange={(e) => setReferNotes(e.target.value)} />
                  </div>
                  <Button size="sm" disabled={referFinding.isPending || referNotes.trim().length < 10} onClick={() => referFinding.mutate({ finding_id: referFor, notes: referNotes.trim() })}>Refer to enforcement</Button>
                  <Button size="sm" variant="ghost" onClick={() => setReferFor(null)}>Cancel</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Round 13 W3: OSIRIS RECON infra posture (additive; findings also
            appear in the Findings tab as type infra_posture). */}
        <TabsContent value="posture" className="mt-4">
          <InfraPosturePanel />
        </TabsContent>

        <TabsContent value="suppressions" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Suppression requests</CardTitle>
              <CardDescription>Controller-requested finding suppressions pending review.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>#</TableHead><TableHead>Finding</TableHead><TableHead>Justification</TableHead><TableHead>Status</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {((suppressions.data as any[]) ?? []).map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono">{s.id}</TableCell>
                      <TableCell>#{s.finding_id}</TableCell>
                      <TableCell className="max-w-[320px] truncate text-sm">{s.justification ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{s.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {((suppressions.data as any[]) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No suppression requests.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
