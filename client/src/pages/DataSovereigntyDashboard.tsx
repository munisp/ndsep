import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { OrgIdentityPrefill } from "@/components/OrgIdentityPrefill";
import { FormCopilotInput } from "@/components/FormCopilotInput";
import { CalendarClock, Globe2, Loader2, RefreshCw, Send, ShieldAlert, ShieldCheck } from "lucide-react";

const TIERS = ["sovereign_ready", "on_track", "at_risk", "critical", "non_compliant"] as const;
const TIER_COLORS: Record<string, string> = {
  sovereign_ready: "bg-green-500/20 text-green-300 border-green-500/40",
  on_track: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  at_risk: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  critical: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  non_compliant: "bg-red-500/20 text-red-300 border-red-500/40",
};
const VIOLATION_TYPES = [
  "foreign_egress_threshold", "egress_changepoint_shift", "undeclared_hosting",
  "key_custody_foreign", "backup_foreign", "admin_access_foreign", "attestation_expired", "manual",
] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const ENTITY_TYPES = ["psp", "fintech", "bank", "switch", "mmo", "pssp", "ptsp", "super_agent", "other"] as const;

/** Parse "City, CC" lines into location objects (ISO alpha-2 country). */
function parseLocations(text: string): { name?: string; city?: string; country: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      const country = (parts[parts.length - 1] ?? "").toUpperCase();
      const city = parts.length > 1 ? parts.slice(0, -1).join(", ") : undefined;
      if (country.length !== 2) return null;
      return city !== undefined ? { city, country } : { country };
    })
    .filter((x): x is { city?: string; country: string } => x !== null);
}

/** Parse "Name, CC, service" lines into subprocessor entries. */
function parseSubprocessors(text: string): { name: string; country: string; service?: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, country, service] = line.split(",").map((p) => p.trim());
      if (!(name && country && country.length === 2)) return null;
      const cc = country.toUpperCase();
      return service ? { name, country: cc, service } : { name, country: cc };
    })
    .filter((x): x is { name: string; country: string; service?: string } => x !== null);
}

/** Hosting declaration form (dataSovereignty.submitDeclaration) with registry identity prefill. */
function HostingDeclarationForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [form, setForm] = useState({
    entity_ref: "", entity_name: "", entity_type: "fintech" as (typeof ENTITY_TYPES)[number],
    in_scope: true, primary_dc_name: "", primary_dc_city: "", primary_dc_country: "NG",
    cloud_provider: "", cloud_regions: "", backup_locations: "", dr_locations: "",
    admin_access_locations: "", key_country: "NG", custody_model: "", hsm_provider: "", subprocessors: "",
  });
  const set = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const submit = trpc.dataSovereignty.submitDeclaration.useMutation({
    onSuccess: () => {
      toast.success("Hosting declaration submitted");
      onSubmitted();
      setForm((f) => ({ ...f, entity_ref: "", entity_name: "" }));
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = () => {
    if (form.entity_ref.trim().length < 2 || form.entity_name.trim().length < 2) {
      toast.error("Entity reference and entity name are required (use the registry lookup to pre-fill)");
      return;
    }
    submit.mutate({
      entity_ref: form.entity_ref.trim(),
      entity_name: form.entity_name.trim(),
      entity_type: form.entity_type,
      in_scope: form.in_scope,
      primary_dc_name: form.primary_dc_name || undefined,
      primary_dc_city: form.primary_dc_city || undefined,
      primary_dc_country: form.primary_dc_country ? form.primary_dc_country.toUpperCase() : undefined,
      cloud_provider: form.cloud_provider || undefined,
      cloud_regions: form.cloud_regions.split(",").map((s) => s.trim()).filter(Boolean),
      backup_locations: parseLocations(form.backup_locations),
      dr_locations: parseLocations(form.dr_locations),
      admin_access_locations: parseLocations(form.admin_access_locations),
      encryption_key_custody: form.key_country.length === 2
        ? { country: form.key_country.toUpperCase(), hsm_provider: form.hsm_provider || undefined, custody_model: (form.custody_model || undefined) as any }
        : undefined,
      subprocessors: parseSubprocessors(form.subprocessors),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Submit hosting declaration</CardTitle>
        <CardDescription>
          Self-declared hosting posture for an in-scope entity. Look up the entity once by registration
          reference — identity fields pre-fill instead of being re-typed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <OrgIdentityPrefill
          idPrefix="hosting-decl"
          onResolved={(id) => {
            setForm((f) => ({
              ...f,
              entity_ref: f.entity_ref || id.registrationRef || id.cacNumber || id.rcNumber || (id.orgId != null ? `org:${id.orgId}` : ""),
              entity_name: f.entity_name || id.name || "",
            }));
          }}
        />
        {/* Form copilot (round 12 W7): natural-language prefill — never auto-submits. */}
        <FormCopilotInput
          form="hosting_declaration"
          onPrefill={(fields, _conf) => {
            const locLines = (arr: unknown) =>
              Array.isArray(arr)
                ? (arr as Array<{ city?: string; country?: string }>)
                    .map((l) => [l?.city, l?.country].filter(Boolean).join(", "))
                    .filter(Boolean)
                    .join("\n")
                : "";
            const subLines = (arr: unknown) =>
              Array.isArray(arr)
                ? (arr as Array<{ name?: string; country?: string; service?: string }>)
                    .map((p) => [p?.name, p?.country, p?.service].filter(Boolean).join(", "))
                    .filter(Boolean)
                    .join("\n")
                : "";
            const custody = (fields.encryption_key_custody ?? {}) as { country?: string; hsm_provider?: string; custody_model?: string };
            setForm((f) => ({
              ...f,
              entity_ref: typeof fields.entity_ref === "string" ? fields.entity_ref : f.entity_ref,
              entity_name: typeof fields.entity_name === "string" ? fields.entity_name : f.entity_name,
              entity_type: typeof fields.entity_type === "string" ? (fields.entity_type as typeof f.entity_type) : f.entity_type,
              in_scope: typeof fields.in_scope === "boolean" ? fields.in_scope : f.in_scope,
              primary_dc_name: typeof fields.primary_dc_name === "string" ? fields.primary_dc_name : f.primary_dc_name,
              primary_dc_city: typeof fields.primary_dc_city === "string" ? fields.primary_dc_city : f.primary_dc_city,
              primary_dc_country: typeof fields.primary_dc_country === "string" ? fields.primary_dc_country : f.primary_dc_country,
              cloud_provider: typeof fields.cloud_provider === "string" ? fields.cloud_provider : f.cloud_provider,
              cloud_regions: Array.isArray(fields.cloud_regions) ? (fields.cloud_regions as string[]).join(", ") : f.cloud_regions,
              backup_locations: locLines(fields.backup_locations) || f.backup_locations,
              dr_locations: locLines(fields.dr_locations) || f.dr_locations,
              admin_access_locations: locLines(fields.admin_access_locations) || f.admin_access_locations,
              key_country: typeof custody.country === "string" ? custody.country : f.key_country,
              custody_model: typeof custody.custody_model === "string" ? custody.custody_model : f.custody_model,
              hsm_provider: typeof custody.hsm_provider === "string" ? custody.hsm_provider : f.hsm_provider,
              subprocessors: subLines(fields.subprocessors) || f.subprocessors,
            }));
          }}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Entity reference *</Label>
            <Input value={form.entity_ref} onChange={(e) => set("entity_ref", e.target.value)} placeholder="RC number / org ref" className="font-mono" />
          </div>
          <div>
            <Label>Entity name *</Label>
            <Input value={form.entity_name} onChange={(e) => set("entity_name", e.target.value)} />
          </div>
          <div>
            <Label>Entity type</Label>
            <Select value={form.entity_type} onValueChange={(v) => set("entity_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Primary DC name</Label>
            <Input value={form.primary_dc_name} onChange={(e) => set("primary_dc_name", e.target.value)} />
          </div>
          <div>
            <Label>Primary DC city</Label>
            <Input value={form.primary_dc_city} onChange={(e) => set("primary_dc_city", e.target.value)} />
          </div>
          <div>
            <Label>Primary DC country (ISO-2)</Label>
            <Input value={form.primary_dc_country} maxLength={2} onChange={(e) => set("primary_dc_country", e.target.value.toUpperCase())} />
          </div>
          <div>
            <Label>Cloud provider</Label>
            <Input value={form.cloud_provider} onChange={(e) => set("cloud_provider", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Cloud regions (comma-separated)</Label>
            <Input value={form.cloud_regions} onChange={(e) => set("cloud_regions", e.target.value)} placeholder="eu-west-1, af-south-1" />
          </div>
          <div>
            <Label>Key custody country (ISO-2)</Label>
            <Input value={form.key_country} maxLength={2} onChange={(e) => set("key_country", e.target.value.toUpperCase())} />
          </div>
          <div>
            <Label>Custody model</Label>
            <Select value={form.custody_model || "unset"} onValueChange={(v) => set("custody_model", v === "unset" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">—</SelectItem>
                {["own_hsm", "cloud_kms", "byok", "hyok"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>HSM / KMS provider</Label>
            <Input value={form.hsm_provider} onChange={(e) => set("hsm_provider", e.target.value)} />
          </div>
          <div>
            <Label>In scope for localisation</Label>
            <Select value={form.in_scope ? "yes" : "no"} onValueChange={(v) => set("in_scope", v === "yes")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">In scope</SelectItem>
                <SelectItem value="no">Out of scope</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Backup locations (one per line: City, CC)</Label>
            <Textarea rows={2} value={form.backup_locations} onChange={(e) => set("backup_locations", e.target.value)} placeholder={"Lagos, NG"} />
          </div>
          <div>
            <Label>DR locations (one per line: City, CC)</Label>
            <Textarea rows={2} value={form.dr_locations} onChange={(e) => set("dr_locations", e.target.value)} placeholder={"Lagos, NG"} />
          </div>
          <div>
            <Label>Admin access locations (one per line: City, CC)</Label>
            <Textarea rows={2} value={form.admin_access_locations} onChange={(e) => set("admin_access_locations", e.target.value)} placeholder={"Abuja, NG"} />
          </div>
          <div>
            <Label>Subprocessors (one per line: Name, CC, service)</Label>
            <Textarea rows={2} value={form.subprocessors} onChange={(e) => set("subprocessors", e.target.value)} placeholder={"ExampleCloud Ltd, IE, hosting"} />
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

const VSTATUS_COLORS: Record<string, string> = {
  detected: "bg-red-500/20 text-red-300 border-red-500/40",
  acknowledged: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  under_remediation: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  resolved: "bg-green-500/20 text-green-300 border-green-500/40",
  dismissed: "bg-muted text-muted-foreground border-border",
};

export default function DataSovereigntyDashboard() {
  const utils = trpc.useUtils();
  const countdown = trpc.dataSovereignty.deadlineCountdown.useQuery();
  const heatMap = trpc.dataSovereignty.sectorHeatMap.useQuery();
  const offenders = trpc.dataSovereignty.worstOffenders.useQuery({ limit: 20 });

  const [tierFilter, setTierFilter] = useState<string>("");
  const register = trpc.dataSovereignty.scoreRegister.useQuery(
    tierFilter ? { tier: tierFilter as (typeof TIERS)[number] } : undefined
  );

  const [vioStatus, setVioStatus] = useState<string>("");
  const violations = trpc.dataSovereignty.listViolations.useQuery(
    vioStatus ? { status: vioStatus as "detected" | "acknowledged" | "under_remediation" | "resolved" | "dismissed" } : { openOnly: true }
  );

  const [recomputeRef, setRecomputeRef] = useState("");
  const recompute = trpc.dataSovereignty.recomputeScore.useMutation({
    onSuccess: (res: any) => {
      toast.success(`Score recomputed: ${res.score} (${res.readiness_tier})`);
      utils.dataSovereignty.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const acknowledge = trpc.dataSovereignty.acknowledgeViolation.useMutation({
    onSuccess: () => { toast.success("Violation acknowledged"); violations.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const updateStatus = trpc.dataSovereignty.updateViolationStatus.useMutation({
    onSuccess: () => { toast.success("Violation status updated"); violations.refetch(); setResolveFor(null); setResolveNotes(""); },
    onError: (err) => toast.error(err.message),
  });
  const dismiss = trpc.dataSovereignty.dismissViolation.useMutation({
    onSuccess: () => { toast.success("Violation dismissed"); violations.refetch(); setDismissFor(null); setDismissReason(""); },
    onError: (err) => toast.error(err.message),
  });

  const [resolveFor, setResolveFor] = useState<number | null>(null);
  const [resolveTo, setResolveTo] = useState<"under_remediation" | "resolved">("under_remediation");
  const [resolveNotes, setResolveNotes] = useState("");
  const [dismissFor, setDismissFor] = useState<number | null>(null);
  const [dismissReason, setDismissReason] = useState("");

  const cd: any = countdown.data;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Data Sovereignty" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Globe2 className="h-6 w-6" /> Data Sovereignty &amp; Localisation
        </h1>
        <Button variant="ghost" size="sm" onClick={() => utils.dataSovereignty.invalidate()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Deadline countdown */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className={cd?.past_deadline ? "border-red-500/50" : "border-yellow-500/40"}>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><CalendarClock className="h-4 w-4" /> Localisation deadline</CardDescription>
            <CardTitle className="text-3xl font-mono">
              {cd ? (cd.past_deadline ? "PASSED" : `${cd.days_remaining}d`) : "…"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {cd?.deadline ? `Deadline: ${String(cd.deadline).slice(0, 10)}` : ""}
            {cd?.note && <p className="text-yellow-400 mt-1">{cd.note}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>In-scope entities</CardDescription>
            <CardTitle className="text-3xl font-mono">{cd?.in_scope_entities ?? "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{cd?.declared_entities ?? 0} declarations on file</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Expired attestation flags</CardDescription>
            <CardTitle className="text-3xl font-mono text-orange-400">{cd?.expired_attestation_flags ?? "—"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Readiness tiers</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1">
            {cd?.readiness_tiers
              ? TIERS.map((t) => (
                  <Badge key={t} variant="outline" className={TIER_COLORS[t]}>
                    {t.replaceAll("_", " ")}: {cd.readiness_tiers[t] ?? 0}
                  </Badge>
                ))
              : <span className="text-xs text-muted-foreground">No score data</span>}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="heatmap">
        <TabsList>
          <TabsTrigger value="heatmap">Sector heat map</TabsTrigger>
          <TabsTrigger value="register">Score register</TabsTrigger>
          <TabsTrigger value="violations">Violations</TabsTrigger>
          <TabsTrigger value="declare">Submit declaration</TabsTrigger>
        </TabsList>

        <TabsContent value="declare" className="space-y-4 mt-4">
          <HostingDeclarationForm onSubmitted={() => utils.dataSovereignty.invalidate()} />
        </TabsContent>

        <TabsContent value="heatmap" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Sector heat map</CardTitle>
              <CardDescription>Average sovereignty score and open violations per entity type (worst first).</CardDescription>
            </CardHeader>
            <CardContent>
              {heatMap.data?.note && <p className="text-sm text-yellow-400 mb-2">{heatMap.data.note}</p>}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity type</TableHead>
                    <TableHead className="text-right">Entities</TableHead>
                    <TableHead className="text-right">In scope</TableHead>
                    <TableHead className="text-right">Avg score</TableHead>
                    <TableHead className="text-right">At risk or worse</TableHead>
                    <TableHead className="text-right">Open violations</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(heatMap.data?.rows ?? []).map((r: any) => {
                    const score = r.avg_score == null ? null : Number(r.avg_score);
                    const heat = score == null ? "" : score < 0.4 ? "bg-red-500/15" : score < 0.7 ? "bg-yellow-500/10" : "bg-green-500/10";
                    return (
                      <TableRow key={r.entity_type} className={heat}>
                        <TableCell className="font-medium">{r.entity_type ?? "unknown"}</TableCell>
                        <TableCell className="text-right">{r.entities}</TableCell>
                        <TableCell className="text-right">{r.in_scope_entities}</TableCell>
                        <TableCell className="text-right font-mono">{score == null ? "—" : score.toFixed(3)}</TableCell>
                        <TableCell className="text-right">{r.at_risk_or_worse}</TableCell>
                        <TableCell className="text-right">{r.open_violations}</TableCell>
                      </TableRow>
                    );
                  })}
                  {(heatMap.data?.rows ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No declarations on file yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-orange-400" /> Worst offenders</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Open violations</TableHead>
                    <TableHead className="text-right">Foreign egress (24h)</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(offenders.data?.rows ?? []).map((r: any) => (
                    <TableRow key={r.entity_ref}>
                      <TableCell className="font-medium">{r.entity_name ?? r.entity_ref}</TableCell>
                      <TableCell className="text-muted-foreground">{r.entity_type ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{Number(r.score).toFixed(3)}</TableCell>
                      <TableCell><Badge variant="outline" className={TIER_COLORS[r.readiness_tier] ?? ""}>{String(r.readiness_tier).replaceAll("_", " ")}</Badge></TableCell>
                      <TableCell className="text-right">{r.open_violations}</TableCell>
                      <TableCell className="text-right font-mono">{(Number(r.foreign_ratio_24h) * 100).toFixed(1)}%</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" disabled={recompute.isPending} onClick={() => recompute.mutate({ entity_ref: r.entity_ref })}>
                          Rescore
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(offenders.data?.rows ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No scores computed yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="register" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Entity score register</CardTitle>
              <CardDescription>Latest sovereignty score per entity, worst first.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <Label>Tier filter</Label>
                  <Select value={tierFilter || "all"} onValueChange={(v) => setTierFilter(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All tiers</SelectItem>
                      {TIERS.map((t) => <SelectItem key={t} value={t}>{t.replaceAll("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2 items-end">
                  <div>
                    <Label htmlFor="ds-recompute">Recompute score for entity ref</Label>
                    <Input id="ds-recompute" value={recomputeRef} onChange={(e) => setRecomputeRef(e.target.value)} placeholder="entity reference" className="w-56" />
                  </div>
                  <Button
                    variant="secondary"
                    disabled={recompute.isPending || recomputeRef.trim().length < 2}
                    onClick={() => recompute.mutate({ entity_ref: recomputeRef.trim() })}
                  >
                    {recompute.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Recompute"}
                  </Button>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity ref</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Computed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(register.data?.rows ?? []).map((r: any) => (
                    <TableRow key={r.entity_ref}>
                      <TableCell className="font-mono text-sm">{r.entity_ref}</TableCell>
                      <TableCell className="text-right font-mono">{Number(r.score).toFixed(3)}</TableCell>
                      <TableCell><Badge variant="outline" className={TIER_COLORS[r.readiness_tier] ?? ""}>{String(r.readiness_tier).replaceAll("_", " ")}</Badge></TableCell>
                      <TableCell className="text-muted-foreground text-sm">{r.computed_at ? new Date(r.computed_at).toLocaleString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {(register.data?.rows ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No scores on record.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="violations" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Residency violations</CardTitle>
              <CardDescription>Detected localisation violations. Acknowledge, advance remediation, or dismiss (admin, reason required).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Status filter</Label>
                <Select value={vioStatus || "open"} onValueChange={(v) => setVioStatus(v === "open" ? "" : v)}>
                  <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open only</SelectItem>
                    {["detected", "acknowledged", "under_remediation", "resolved", "dismissed"].map((s) => (
                      <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Detected</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(violations.data?.rows ?? []).map((v: any) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono text-sm">{v.entity_ref}</TableCell>
                      <TableCell className="text-sm">{String(v.violation_type).replaceAll("_", " ")}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={v.severity === "critical" || v.severity === "high" ? "bg-red-500/20 text-red-300 border-red-500/40" : ""}>{v.severity}</Badge>
                      </TableCell>
                      <TableCell><Badge variant="outline" className={VSTATUS_COLORS[v.status] ?? ""}>{String(v.status).replaceAll("_", " ")}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.detected_at ? new Date(v.detected_at).toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-right space-x-1">
                        {v.status === "detected" && (
                          <Button size="sm" variant="outline" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate({ id: v.id })}>Acknowledge</Button>
                        )}
                        {(v.status === "acknowledged" || v.status === "under_remediation") && (
                          <Button size="sm" variant="outline" onClick={() => { setResolveFor(v.id); setResolveTo(v.status === "acknowledged" ? "under_remediation" : "resolved"); }}>
                            Advance
                          </Button>
                        )}
                        {["detected", "acknowledged", "under_remediation"].includes(v.status) && (
                          <Button size="sm" variant="ghost" className="text-red-400" onClick={() => setDismissFor(v.id)}>Dismiss</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(violations.data?.rows ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No violations match this filter.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>

              {resolveFor != null && (
                <div className="border rounded-lg p-4 space-y-3">
                  <h3 className="font-medium">Advance violation #{resolveFor}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div>
                      <Label>New status</Label>
                      <Select value={resolveTo} onValueChange={(v) => setResolveTo(v as "under_remediation" | "resolved")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="under_remediation">Under remediation</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-2">
                      <Label htmlFor="ds-resolve-notes">Resolution notes (min 5 chars)</Label>
                      <Textarea id="ds-resolve-notes" value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={updateStatus.isPending || resolveNotes.trim().length < 5}
                      onClick={() => updateStatus.mutate({ id: resolveFor, to: resolveTo, resolution_notes: resolveNotes.trim() })}
                    >
                      Confirm
                    </Button>
                    <Button variant="ghost" onClick={() => setResolveFor(null)}>Cancel</Button>
                  </div>
                </div>
              )}

              {dismissFor != null && (
                <div className="border border-red-500/40 rounded-lg p-4 space-y-3">
                  <h3 className="font-medium text-red-400">Dismiss violation #{dismissFor} (admin)</h3>
                  <Label htmlFor="ds-dismiss-reason">Reason (min 10 chars)</Label>
                  <Textarea id="ds-dismiss-reason" value={dismissReason} onChange={(e) => setDismissReason(e.target.value)} />
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      disabled={dismiss.isPending || dismissReason.trim().length < 10}
                      onClick={() => dismiss.mutate({ id: dismissFor, reason: dismissReason.trim() })}
                    >
                      Dismiss violation
                    </Button>
                    <Button variant="ghost" onClick={() => setDismissFor(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
