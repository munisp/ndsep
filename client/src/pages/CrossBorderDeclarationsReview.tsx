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
import { OrgIdentityPrefill } from "@/components/OrgIdentityPrefill";
import { FormCopilotInput } from "@/components/FormCopilotInput";
import { Globe2, Loader2, Radar, RefreshCw, Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

const LEGAL_BASES = ["adequacy_decision", "bcr", "scc", "derogation", "explicit_consent", "contract_performance", "vital_interests", "none_claimed"] as const;
const SUBJECT_COUNT_BANDS = ["band_0_100", "band_101_1000", "band_1001_10000", "band_10001_100000", "band_100000_plus"] as const;
const VOLUME_BANDS = ["vol_small", "vol_medium", "vol_large", "vol_very_large"] as const;

/** Cross-border transfer declaration form (crossBorderDeclarations.submit) with registry identity prefill. */
function NewDeclarationForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [form, setForm] = useState({
    organizationId: "", orgLabel: "",
    declaration_type: "annual" as "annual" | "on_change",
    period_start: "", period_end: "", destination_country: "",
    legal_basis: "adequacy_decision" as (typeof LEGAL_BASES)[number],
    data_categories: "", subject_count_band: "band_0_100" as (typeof SUBJECT_COUNT_BANDS)[number],
    volume_band: "vol_small" as (typeof VOLUME_BANDS)[number], volume_estimate_gb: "",
    processors: "", declares_no_transfers: false,
  });
  const set = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });

  const submit = trpc.crossBorderDeclarations.submit.useMutation({
    onSuccess: (res: any) => {
      const findings = res?.validation?.findings?.length ?? 0;
      toast.success(`Declaration submitted${findings ? ` — ${findings} validation finding(s) raised` : ""}`);
      onSubmitted();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = () => {
    const orgId = Number(form.organizationId);
    if (!Number.isInteger(orgId) || orgId <= 0) { toast.error("Select the declaring organisation (use the registry lookup to pre-fill)"); return; }
    if (!form.period_start || !form.period_end) { toast.error("Declaration period is required"); return; }
    if (!form.destination_country.trim()) { toast.error("Destination country is required"); return; }
    const processors = form.processors
      .split("\n").map((l) => l.trim()).filter(Boolean)
      .map((l) => {
        const [name, country, role] = l.split(",").map((p) => p.trim());
        return name && country ? { name, country, role: (role === "sub_processor" ? "sub_processor" : "processor") as "processor" | "sub_processor" } : null;
      })
      .filter((x): x is { name: string; country: string; role: "processor" | "sub_processor" } => x !== null);
    submit.mutate({
      organization_id: orgId,
      declaration_type: form.declaration_type,
      period_start: form.period_start,
      period_end: form.period_end,
      destination_country: form.destination_country.trim(),
      legal_basis: form.legal_basis,
      data_categories: form.data_categories.split(",").map((s) => s.trim()).filter(Boolean),
      subject_count_band: form.subject_count_band,
      volume_band: form.volume_band,
      volume_estimate_gb: form.volume_estimate_gb ? Number(form.volume_estimate_gb) : undefined,
      processors,
      declares_no_transfers: form.declares_no_transfers,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">New transfer declaration</CardTitle>
        <CardDescription>
          Annual / on-change declaration under NDPA 2023 ss.41-43. Look up the declaring organisation once by
          registration reference — the organisation identity is resolved instead of re-typed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <OrgIdentityPrefill
          idPrefix="cbd-decl"
          onResolved={(id) => {
            setForm((f) => ({
              ...f,
              organizationId: id.orgId != null ? String(id.orgId) : f.organizationId,
              orgLabel: id.name ?? f.orgLabel,
            }));
          }}
        />
        {/* Form copilot (round 12 W7): natural-language prefill — never auto-submits. */}
        <FormCopilotInput
          form="cross_border_declaration"
          onPrefill={(fields, _conf) => {
            const processorLines = (arr: unknown) =>
              Array.isArray(arr)
                ? (arr as Array<{ name?: string; country?: string; role?: string }>)
                    .map((p) => [p?.name, p?.country, p?.role].filter(Boolean).join(", "))
                    .filter(Boolean)
                    .join("\n")
                : "";
            setForm((f) => ({
              ...f,
              organizationId: typeof fields.organization_id === "number" ? String(fields.organization_id) : f.organizationId,
              declaration_type: typeof fields.declaration_type === "string" ? (fields.declaration_type as typeof f.declaration_type) : f.declaration_type,
              period_start: typeof fields.period_start === "string" ? fields.period_start : f.period_start,
              period_end: typeof fields.period_end === "string" ? fields.period_end : f.period_end,
              destination_country: typeof fields.destination_country === "string" ? fields.destination_country : f.destination_country,
              legal_basis: typeof fields.legal_basis === "string" ? (fields.legal_basis as typeof f.legal_basis) : f.legal_basis,
              data_categories: Array.isArray(fields.data_categories) ? (fields.data_categories as string[]).join(", ") : f.data_categories,
              subject_count_band: typeof fields.subject_count_band === "string" ? (fields.subject_count_band as typeof f.subject_count_band) : f.subject_count_band,
              volume_band: typeof fields.volume_band === "string" ? (fields.volume_band as typeof f.volume_band) : f.volume_band,
              volume_estimate_gb: typeof fields.volume_estimate_gb === "number" ? String(fields.volume_estimate_gb) : f.volume_estimate_gb,
              processors: processorLines(fields.processors) || f.processors,
              declares_no_transfers: typeof fields.declares_no_transfers === "boolean" ? fields.declares_no_transfers : f.declares_no_transfers,
            }));
          }}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Organisation *</Label>
            <Select value={form.organizationId} onValueChange={(v) => set("organizationId", v)}>
              <SelectTrigger><SelectValue placeholder={form.orgLabel || "Select organisation"} /></SelectTrigger>
              <SelectContent>
                {(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Declaration type</Label>
            <Select value={form.declaration_type} onValueChange={(v) => set("declaration_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="annual">Annual</SelectItem>
                <SelectItem value="on_change">On change</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Destination country *</Label>
            <Input value={form.destination_country} onChange={(e) => set("destination_country", e.target.value)} placeholder="e.g. Ireland" />
          </div>
          <div>
            <Label>Period start *</Label>
            <Input type="date" value={form.period_start} onChange={(e) => set("period_start", e.target.value)} />
          </div>
          <div>
            <Label>Period end *</Label>
            <Input type="date" value={form.period_end} onChange={(e) => set("period_end", e.target.value)} />
          </div>
          <div>
            <Label>Legal basis</Label>
            <Select value={form.legal_basis} onValueChange={(v) => set("legal_basis", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LEGAL_BASES.map((b) => <SelectItem key={b} value={b}>{b.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Subject count band</Label>
            <Select value={form.subject_count_band} onValueChange={(v) => set("subject_count_band", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SUBJECT_COUNT_BANDS.map((b) => <SelectItem key={b} value={b}>{b.replace("band_", "").replaceAll("_", "–")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Volume band</Label>
            <Select value={form.volume_band} onValueChange={(v) => set("volume_band", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{VOLUME_BANDS.map((b) => <SelectItem key={b} value={b}>{b.replace("vol_", "").replaceAll("_", " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Volume estimate (GB, optional)</Label>
            <Input type="number" min={0} value={form.volume_estimate_gb} onChange={(e) => set("volume_estimate_gb", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Data categories (comma-separated)</Label>
            <Input value={form.data_categories} onChange={(e) => set("data_categories", e.target.value)} placeholder="identifiers, financial, behavioural" />
          </div>
          <div className="flex items-end gap-2 pb-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.declares_no_transfers} onChange={(e) => set("declares_no_transfers", e.target.checked)} />
              Declares no transfers in period
            </label>
          </div>
          <div className="md:col-span-3">
            <Label>Processors (one per line: Name, Country, role)</Label>
            <Textarea rows={2} value={form.processors} onChange={(e) => set("processors", e.target.value)} placeholder={"ExampleCloud Ltd, Ireland, processor"} />
          </div>
        </div>
        <Button onClick={handleSubmit} disabled={submit.isPending}>
          {submit.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
          Submit declaration
        </Button>
      </CardContent>
    </Card>
  );
}

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
          <TabsTrigger value="new">New declaration</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="scc">SCC registrations</TabsTrigger>
          <TabsTrigger value="risk">Destination risk</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="mt-4">
          <NewDeclarationForm onSubmitted={refresh} />
        </TabsContent>

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
