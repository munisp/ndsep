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
import { Globe2, Loader2, Radar, RefreshCw } from "lucide-react";

const COMPLIANCE_COLORS: Record<string, string> = {
  compliant: "bg-green-500/20 text-green-300 border-green-500/40",
  non_compliant: "bg-red-500/20 text-red-300 border-red-500/40",
  pending_review: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
};
const FINDING_STATUSES = ["open", "referred", "under_investigation", "resolved", "dismissed"] as const;
const ADEQUACY_COLORS: Record<string, string> = {
  adequate: "bg-green-500/20 text-green-300 border-green-500/40",
  partial: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  none: "bg-red-500/20 text-red-300 border-red-500/40",
  under_review: "bg-blue-500/20 text-blue-300 border-blue-500/40",
};

export default function CrossBorderDeclarationsReview() {
  const stats = trpc.crossBorderDeclarations.stats.useQuery();
  const [compliance, setCompliance] = useState<string>("");
  const declarations = trpc.crossBorderDeclarations.list.useQuery({
    complianceStatus: (compliance || undefined) as "compliant" | "non_compliant" | "pending_review" | undefined,
    limit: 50,
  });
  const findings = trpc.crossBorderDeclarations.listFindings.useQuery({ limit: 50 });
  const scc = trpc.crossBorderDeclarations.listSccRegistrations.useQuery({ limit: 100 });
  const destRisk = trpc.crossBorderDeclarations.listDestinationRisk.useQuery(undefined);

  const refresh = () => { stats.refetch(); declarations.refetch(); findings.refetch(); scc.refetch(); destRisk.refetch(); };

  const updateFinding = trpc.crossBorderDeclarations.updateFindingStatus.useMutation({
    onSuccess: () => { toast.success("Finding updated"); findings.refetch(); stats.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const runScans = trpc.crossBorderDeclarations.runAnomalyScans.useMutation({
    onSuccess: (res: any) => { toast.success(`Anomaly scan complete — ${res.findingsCreated ?? res.findings ?? 0} new finding(s)`); findings.refetch(); stats.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const reviewScc = trpc.crossBorderDeclarations.reviewSccRegistration.useMutation({
    onSuccess: () => { toast.success("SCC registration reviewed"); scc.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [sccNotes, setSccNotes] = useState("");

  const st: any = stats.data ?? {};

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Cross-Border Declarations" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Globe2 className="h-6 w-6" /> Cross-Border Declarations Review</h1>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="secondary" onClick={() => runScans.mutate({})} disabled={runScans.isPending}>
            {runScans.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Radar className="h-4 w-4 mr-2" />}
            Run anomaly scans
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: "Active declarations", value: st.active_declarations },
          { label: "Non-compliant", value: st.non_compliant, danger: true },
          { label: "Pending review", value: st.pending_review },
          { label: "Zero-transfer attestations", value: st.zero_transfer_attestations },
          { label: "Open findings", value: st.open_findings, danger: true },
          { label: "Pending referrals", value: st.pending_referrals, danger: true },
        ].map((k) => (
          <Card key={k.label} className={k.danger && k.value ? "border-red-500/50" : ""}>
            <CardHeader className="pb-1 pt-3"><CardDescription>{k.label}</CardDescription></CardHeader>
            <CardContent className={`text-2xl font-mono font-bold ${k.danger && k.value ? "text-red-400" : ""}`}>{k.value ?? "—"}</CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="declarations">
        <TabsList>
          <TabsTrigger value="declarations">Declarations</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="scc">SCC registrations</TabsTrigger>
          <TabsTrigger value="risk">Destination risk</TabsTrigger>
        </TabsList>

        <TabsContent value="declarations" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Transfer declarations</CardTitle>
              <div className="pt-2">
                <Select value={compliance || "all"} onValueChange={(v) => setCompliance(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="compliant">Compliant</SelectItem>
                    <SelectItem value="non_compliant">Non-compliant</SelectItem>
                    <SelectItem value="pending_review">Pending review</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead><TableHead>Organisation</TableHead><TableHead>Destination</TableHead>
                    <TableHead>Status</TableHead><TableHead>Compliance</TableHead><TableHead>Submitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((declarations.data as any)?.data ?? (declarations.data as any[]) ?? []).map((d: any) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono">{d.id}</TableCell>
                      <TableCell>{d.org_name ?? `Org #${d.organization_id}`}</TableCell>
                      <TableCell>{d.destination_country ?? d.country ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{String(d.status).replaceAll("_", " ")}</Badge></TableCell>
                      <TableCell><Badge variant="outline" className={COMPLIANCE_COLORS[d.compliance_status] ?? ""}>{String(d.compliance_status ?? "—").replaceAll("_", " ")}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{d.submitted_at ?? d.created_at ? new Date(d.submitted_at ?? d.created_at).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {(((declarations.data as any)?.data ?? (declarations.data as any[])) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No declarations match.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="findings" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Anomaly findings</CardTitle>
              <CardDescription>Statistical anomalies detected across declaration series. Update status as the investigation proceeds.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead><TableHead>Org</TableHead><TableHead>Type</TableHead><TableHead>Detail</TableHead>
                    <TableHead>Referral</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Move to</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((findings.data as any)?.data ?? (findings.data as any[]) ?? []).map((f: any) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-mono">{f.id}</TableCell>
                      <TableCell>#{f.organization_id}</TableCell>
                      <TableCell className="text-sm">{String(f.finding_type ?? "").replaceAll("_", " ")}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">{f.detail ?? f.description ?? "—"}</TableCell>
                      <TableCell>{f.enforcement_referral ? <Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/40">referred</Badge> : "—"}</TableCell>
                      <TableCell><Badge variant="outline">{String(f.status).replaceAll("_", " ")}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Select onValueChange={(v) => updateFinding.mutate({ id: f.id, status: v as (typeof FINDING_STATUSES)[number] })}>
                          <SelectTrigger className="w-40 h-8 inline-flex"><SelectValue placeholder="Change…" /></SelectTrigger>
                          <SelectContent>
                            {FINDING_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(((findings.data as any)?.data ?? (findings.data as any[])) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No findings.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scc" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Standard contractual clause registrations</CardTitle>
              <CardDescription>Review submitted SCC registrations — approve, suspend or expire.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead><TableHead>Controller</TableHead><TableHead>Processor</TableHead>
                    <TableHead>Clauses</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(((scc.data as any)?.rows ?? (scc.data as any)?.data ?? (scc.data as any[])) ?? []).map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">{r.id}</TableCell>
                      <TableCell>{r.controller_party}</TableCell>
                      <TableCell>{r.processor_party}</TableCell>
                      <TableCell className="text-sm">{r.clauses_version}</TableCell>
                      <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                      <TableCell className="text-right space-x-1">
                        {r.status === "pending" && (
                          <>
                            <Button size="sm" variant="outline" disabled={reviewScc.isPending} onClick={() => reviewScc.mutate({ id: r.id, decision: "approved", review_notes: sccNotes || undefined })}>Approve</Button>
                            <Button size="sm" variant="destructive" disabled={reviewScc.isPending} onClick={() => reviewScc.mutate({ id: r.id, decision: "suspended", review_notes: sccNotes || undefined })}>Suspend</Button>
                          </>
                        )}
                        {r.status === "approved" && (
                          <Button size="sm" variant="outline" disabled={reviewScc.isPending} onClick={() => reviewScc.mutate({ id: r.id, decision: "expired", review_notes: sccNotes || undefined })}>Expire</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(((scc.data as any)?.rows ?? (scc.data as any)?.data ?? (scc.data as any[])) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No SCC registrations.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <div className="max-w-md">
                <Label htmlFor="cbd-scc-notes">Review notes (optional, applies to actions above)</Label>
                <Input id="cbd-scc-notes" value={sccNotes} onChange={(e) => setSccNotes(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risk" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Destination risk register</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Country</TableHead><TableHead>ISO</TableHead><TableHead>Adequacy</TableHead><TableHead className="text-right">Risk score</TableHead><TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(((destRisk.data as any)?.rows ?? (destRisk.data as any[])) ?? []).map((r: any) => (
                    <TableRow key={r.id ?? r.country}>
                      <TableCell className="font-medium">{r.country}</TableCell>
                      <TableCell className="font-mono text-sm">{r.iso_code ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline" className={ADEQUACY_COLORS[r.adequacy_status] ?? ""}>{String(r.adequacy_status ?? "—").replaceAll("_", " ")}</Badge></TableCell>
                      <TableCell className="text-right font-mono">{r.risk_score ?? "—"}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-sm text-muted-foreground">{r.notes ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                  {(((destRisk.data as any)?.rows ?? (destRisk.data as any[])) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No destination risk entries.</TableCell></TableRow>
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
