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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Bot, RefreshCw } from "lucide-react";

const RISK_TIERS = ["minimal", "limited", "high", "unacceptable"] as const;
const SEVERITIES = ["class_1_serious", "class_2_significant", "class_3_minor"] as const;
const INCIDENT_STATUSES = ["reported", "acknowledged", "investigating", "contained", "closed", "referred_enforcement"] as const;
const TIER_COLORS: Record<string, string> = {
  minimal: "bg-green-500/20 text-green-300 border-green-500/40",
  limited: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  unacceptable: "bg-red-500/20 text-red-300 border-red-500/40",
};

export default function AiRuntimeOversight() {
  const [sysStatus, setSysStatus] = useState<string>("");
  const systems = trpc.aiRuntimeOversight.listSystems.useQuery(
    sysStatus ? { status: sysStatus as "registered" | "approved" | "suspended" | "retired" } : undefined
  );
  const [incStatus, setIncStatus] = useState<string>("");
  const [slaOnly, setSlaOnly] = useState(false);
  const incidents = trpc.aiRuntimeOversight.listIncidents.useQuery({
    status: (incStatus || undefined) as (typeof INCIDENT_STATUSES)[number] | undefined,
    sla_breached_only: slaOnly,
  });
  const audits = trpc.aiRuntimeOversight.listAudits.useQuery(undefined);
  const register_public = trpc.aiRuntimeOversight.transparencyRegister.useQuery();
  const triggers = trpc.aiRuntimeOversight.listReauditTriggers.useQuery({});

  const refresh = () => { systems.refetch(); incidents.refetch(); audits.refetch(); register_public.refetch(); triggers.refetch(); };

  // Register system
  const [sysForm, setSysForm] = useState({ organization_id: "", system_name: "", purpose: "", risk_tier: "limited" as (typeof RISK_TIERS)[number], model_version: "" });
  const registerSystem = trpc.aiRuntimeOversight.registerSystem.useMutation({
    onSuccess: () => { toast.success("AI system registered"); setSysForm({ organization_id: "", system_name: "", purpose: "", risk_tier: "limited", model_version: "" }); systems.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const approveSystem = trpc.aiRuntimeOversight.approveSystem.useMutation({
    onSuccess: () => { toast.success("System approved"); systems.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  // Incidents
  const [incForm, setIncForm] = useState({ organization_id: "", system_id: "", severity_class: "class_3_minor" as (typeof SEVERITIES)[number], description: "", reporter_type: "org" as "org" | "public" | "regulator" });
  const reportIncident = trpc.aiRuntimeOversight.reportIncident.useMutation({
    onSuccess: () => { toast.success("Incident reported"); setIncForm({ ...incForm, description: "" }); incidents.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [incNote, setIncNote] = useState("");
  const updateIncident = trpc.aiRuntimeOversight.updateIncidentStatus.useMutation({
    onSuccess: () => { toast.success("Incident updated"); setIncNote(""); incidents.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [referFor, setReferFor] = useState<number | null>(null);
  const [referCaseId, setReferCaseId] = useState("");
  const [referNotes, setReferNotes] = useState("");
  const referIncident = trpc.aiRuntimeOversight.referIncidentToEnforcement.useMutation({
    onSuccess: () => { toast.success("Incident referred to enforcement"); setReferFor(null); setReferCaseId(""); setReferNotes(""); incidents.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  // Audits
  const [schedForm, setSchedForm] = useState({ system_id: "", audit_period: "", due_date: "" });
  const scheduleAudit = trpc.aiRuntimeOversight.scheduleAudit.useMutation({
    onSuccess: () => { toast.success("Audit scheduled"); setSchedForm({ system_id: "", audit_period: "", due_date: "" }); audits.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [auditForm, setAuditForm] = useState({ system_id: "", audit_period: "", auditor_name: "", findings_summary: "", report_ref: "" });
  const submitAudit = trpc.aiRuntimeOversight.submitAudit.useMutation({
    onSuccess: () => { toast.success("Audit submitted"); setAuditForm({ system_id: "", audit_period: "", auditor_name: "", findings_summary: "", report_ref: "" }); audits.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [reviewNotes, setReviewNotes] = useState("");
  const reviewAudit = trpc.aiRuntimeOversight.reviewAudit.useMutation({
    onSuccess: () => { toast.success("Audit reviewed"); setReviewNotes(""); audits.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [triggerReason, setTriggerReason] = useState("");
  const resolveTrigger = trpc.aiRuntimeOversight.resolveReauditTrigger.useMutation({
    onSuccess: () => { toast.success("Re-audit trigger resolved"); setTriggerReason(""); triggers.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "AI Runtime Oversight" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Bot className="h-6 w-6" /> AI Runtime Oversight</h1>
        <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      <Tabs defaultValue="systems">
        <TabsList>
          <TabsTrigger value="systems">System register</TabsTrigger>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
          <TabsTrigger value="audits">Audits</TabsTrigger>
          <TabsTrigger value="transparency">Transparency register</TabsTrigger>
        </TabsList>

        <TabsContent value="systems" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Register an AI system</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <div>
                <Label>Organisation ID</Label>
                <Input type="number" value={sysForm.organization_id} onChange={(e) => setSysForm({ ...sysForm, organization_id: e.target.value })} />
              </div>
              <div>
                <Label>System name</Label>
                <Input value={sysForm.system_name} onChange={(e) => setSysForm({ ...sysForm, system_name: e.target.value })} />
              </div>
              <div>
                <Label>Risk tier</Label>
                <Select value={sysForm.risk_tier} onValueChange={(v) => setSysForm({ ...sysForm, risk_tier: v as (typeof RISK_TIERS)[number] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RISK_TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Model version</Label>
                <Input value={sysForm.model_version} onChange={(e) => setSysForm({ ...sysForm, model_version: e.target.value })} />
              </div>
              <Button
                disabled={registerSystem.isPending || !sysForm.organization_id || sysForm.system_name.trim().length < 2}
                onClick={() => registerSystem.mutate({
                  organization_id: Number(sysForm.organization_id),
                  system_name: sysForm.system_name.trim(),
                  purpose: sysForm.purpose || undefined,
                  risk_tier: sysForm.risk_tier,
                  model_version: sysForm.model_version || undefined,
                })}
              >Register</Button>
              <div className="md:col-span-5">
                <Label>Purpose (optional)</Label>
                <Textarea value={sysForm.purpose} onChange={(e) => setSysForm({ ...sysForm, purpose: e.target.value })} rows={2} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Registered systems</CardTitle>
              <div className="pt-2">
                <Select value={sysStatus || "all"} onValueChange={(v) => setSysStatus(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {["registered", "approved", "suspended", "retired"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>System</TableHead><TableHead>Org</TableHead><TableHead>Tier</TableHead>
                    <TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((systems.data as any[]) ?? []).map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.system_name}</TableCell>
                      <TableCell>#{s.organization_id}</TableCell>
                      <TableCell><Badge variant="outline" className={TIER_COLORS[s.risk_tier] ?? ""}>{s.risk_tier}</Badge></TableCell>
                      <TableCell className="font-mono text-sm">{s.model_version ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{s.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {s.status === "registered" && (
                          <Button size="sm" variant="outline" disabled={approveSystem.isPending} onClick={() => approveSystem.mutate({ id: s.id })}>Approve</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {((systems.data as any[]) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No systems registered.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {((triggers.data as any[]) ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-lg">Re-audit triggers</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>System</TableHead><TableHead>Trigger</TableHead><TableHead>Raised</TableHead><TableHead /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {(triggers.data as any[]).map((t: any) => (
                      <TableRow key={t.id}>
                        <TableCell>#{t.system_id}</TableCell>
                        <TableCell className="text-sm">{t.trigger_type ?? t.reason ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{t.created_at ? new Date(t.created_at).toLocaleString() : "—"}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="outline" disabled={resolveTrigger.isPending || triggerReason.trim().length < 5} onClick={() => resolveTrigger.mutate({ id: t.id, resolution: "cleared", reason: triggerReason.trim() })}>Clear</Button>
                          <Button size="sm" variant="outline" disabled={resolveTrigger.isPending || triggerReason.trim().length < 5} onClick={() => resolveTrigger.mutate({ id: t.id, resolution: "sandbox_review", reason: triggerReason.trim() })}>Sandbox review</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="max-w-md mt-3">
                  <Label htmlFor="ai-trigger-reason">Resolution reason (min 5 chars, applies to actions above)</Label>
                  <Input id="ai-trigger-reason" value={triggerReason} onChange={(e) => setTriggerReason(e.target.value)} />
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="incidents" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Report an incident</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <Label>Organisation ID</Label>
                <Input type="number" value={incForm.organization_id} onChange={(e) => setIncForm({ ...incForm, organization_id: e.target.value })} />
              </div>
              <div>
                <Label>System ID (optional)</Label>
                <Input type="number" value={incForm.system_id} onChange={(e) => setIncForm({ ...incForm, system_id: e.target.value })} />
              </div>
              <div>
                <Label>Severity class</Label>
                <Select value={incForm.severity_class} onValueChange={(v) => setIncForm({ ...incForm, severity_class: v as (typeof SEVERITIES)[number] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reporter type</Label>
                <Select value={incForm.reporter_type} onValueChange={(v) => setIncForm({ ...incForm, reporter_type: v as "org" | "public" | "regulator" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="org">Organisation</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="regulator">Regulator</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-3">
                <Label>Description (min 10 chars)</Label>
                <Textarea value={incForm.description} onChange={(e) => setIncForm({ ...incForm, description: e.target.value })} rows={2} />
              </div>
              <Button
                disabled={reportIncident.isPending || !incForm.organization_id || incForm.description.trim().length < 10}
                onClick={() => reportIncident.mutate({
                  organization_id: Number(incForm.organization_id),
                  system_id: incForm.system_id ? Number(incForm.system_id) : undefined,
                  severity_class: incForm.severity_class,
                  description: incForm.description.trim(),
                  reporter_type: incForm.reporter_type,
                })}
              >Report</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Incident queue</CardTitle>
              <div className="flex gap-4 items-center pt-2">
                <Select value={incStatus || "all"} onValueChange={(v) => setIncStatus(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {INCIDENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={slaOnly} onCheckedChange={(c) => setSlaOnly(c === true)} /> SLA breached only
                </label>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead><TableHead>Org</TableHead><TableHead>Severity</TableHead>
                    <TableHead>Description</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((incidents.data as any)?.data ?? (incidents.data as any[]) ?? []).map((i: any) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono">{i.id}</TableCell>
                      <TableCell>#{i.organization_id}</TableCell>
                      <TableCell><Badge variant="outline" className={i.severity_class === "class_1_serious" ? "bg-red-500/20 text-red-300 border-red-500/40" : ""}>{String(i.severity_class).replaceAll("_", " ")}</Badge></TableCell>
                      <TableCell className="max-w-[280px] truncate text-sm">{i.description}</TableCell>
                      <TableCell><Badge variant="outline">{String(i.status).replaceAll("_", " ")}</Badge></TableCell>
                      <TableCell className="text-right space-x-1">
                        {!["closed", "referred_enforcement"].includes(i.status) && (
                          <>
                            <Select onValueChange={(st) => updateIncident.mutate({ id: i.id, status: st as (typeof INCIDENT_STATUSES)[number], note: incNote || undefined })}>
                              <SelectTrigger className="w-36 h-8 inline-flex"><SelectValue placeholder="Move to…" /></SelectTrigger>
                              <SelectContent>
                                {INCIDENT_STATUSES.filter((st) => st !== "referred_enforcement").map((st) => <SelectItem key={st} value={st}>{st.replaceAll("_", " ")}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button size="sm" variant="outline" onClick={() => { setReferFor(i.id); setReferCaseId(""); setReferNotes(""); }}>Refer</Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(((incidents.data as any)?.data ?? (incidents.data as any[])) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No incidents match.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              {referFor != null && (
                <div className="border rounded-lg p-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                  <div>
                    <Label>Enforcement case ID</Label>
                    <Input type="number" value={referCaseId} onChange={(e) => setReferCaseId(e.target.value)} />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Link notes (min 10 chars)</Label>
                    <Input value={referNotes} onChange={(e) => setReferNotes(e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={referIncident.isPending || !referCaseId || referNotes.trim().length < 10} onClick={() => referIncident.mutate({ incident_id: referFor, enforcement_case_id: Number(referCaseId), link_notes: referNotes.trim() })}>Refer</Button>
                    <Button size="sm" variant="ghost" onClick={() => setReferFor(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audits" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">Schedule audit</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <Label>System ID</Label>
                    <Input type="number" value={schedForm.system_id} onChange={(e) => setSchedForm({ ...schedForm, system_id: e.target.value })} />
                  </div>
                  <div>
                    <Label>Period</Label>
                    <Input value={schedForm.audit_period} onChange={(e) => setSchedForm({ ...schedForm, audit_period: e.target.value })} placeholder="2026-H2" />
                  </div>
                  <div>
                    <Label>Due date</Label>
                    <Input type="date" value={schedForm.due_date} onChange={(e) => setSchedForm({ ...schedForm, due_date: e.target.value })} />
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={scheduleAudit.isPending || !schedForm.system_id || schedForm.audit_period.trim().length < 4 || !schedForm.due_date}
                  onClick={() => scheduleAudit.mutate({ system_id: Number(schedForm.system_id), audit_period: schedForm.audit_period.trim(), due_date: schedForm.due_date })}
                >Schedule</Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-lg">Submit audit report</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>System ID</Label>
                    <Input type="number" value={auditForm.system_id} onChange={(e) => setAuditForm({ ...auditForm, system_id: e.target.value })} />
                  </div>
                  <div>
                    <Label>Period</Label>
                    <Input value={auditForm.audit_period} onChange={(e) => setAuditForm({ ...auditForm, audit_period: e.target.value })} placeholder="2026-H1" />
                  </div>
                  <div>
                    <Label>Auditor name</Label>
                    <Input value={auditForm.auditor_name} onChange={(e) => setAuditForm({ ...auditForm, auditor_name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Report reference (optional)</Label>
                    <Input value={auditForm.report_ref} onChange={(e) => setAuditForm({ ...auditForm, report_ref: e.target.value })} />
                  </div>
                </div>
                <Label>Findings summary (min 10 chars)</Label>
                <Textarea value={auditForm.findings_summary} onChange={(e) => setAuditForm({ ...auditForm, findings_summary: e.target.value })} rows={2} />
                <Button
                  size="sm"
                  disabled={submitAudit.isPending || !auditForm.system_id || auditForm.audit_period.trim().length < 4 || auditForm.auditor_name.trim().length < 2 || auditForm.findings_summary.trim().length < 10}
                  onClick={() => submitAudit.mutate({
                    system_id: Number(auditForm.system_id),
                    audit_period: auditForm.audit_period.trim(),
                    auditor_name: auditForm.auditor_name.trim(),
                    findings_summary: auditForm.findings_summary.trim(),
                    report_ref: auditForm.report_ref || undefined,
                  })}
                >Submit</Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-lg">Audit records</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead><TableHead>System</TableHead><TableHead>Period</TableHead>
                    <TableHead>Auditor</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(((audits.data as any)?.data ?? (audits.data as any[])) ?? []).map((a: any) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono">{a.id}</TableCell>
                      <TableCell>#{a.system_id}</TableCell>
                      <TableCell>{a.audit_period}</TableCell>
                      <TableCell>{a.auditor_name}</TableCell>
                      <TableCell><Badge variant="outline">{a.status ?? a.decision ?? "submitted"}</Badge></TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="outline" disabled={reviewAudit.isPending || reviewNotes.trim().length < 5} onClick={() => reviewAudit.mutate({ id: a.id, decision: "accepted", review_notes: reviewNotes.trim() })}>Accept</Button>
                        <Button size="sm" variant="destructive" disabled={reviewAudit.isPending || reviewNotes.trim().length < 5} onClick={() => reviewAudit.mutate({ id: a.id, decision: "rejected", review_notes: reviewNotes.trim() })}>Reject</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(((audits.data as any)?.data ?? (audits.data as any[])) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No audits on record.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <div className="max-w-md">
                <Label htmlFor="ai-review-notes">Review notes (min 5 chars, applies to accept/reject above)</Label>
                <Input id="ai-review-notes" value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transparency" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Public transparency register</CardTitle>
              <CardDescription>Approved high-risk AI systems, as published publicly.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>System</TableHead><TableHead>Organisation</TableHead><TableHead>Tier</TableHead><TableHead>Since</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {(((register_public.data as any)?.rows ?? (register_public.data as any[])) ?? []).map((r: any, i: number) => (
                    <TableRow key={r.id ?? i}>
                      <TableCell className="font-medium">{r.system_name}</TableCell>
                      <TableCell>{r.org_name ?? `#${r.organization_id}`}</TableCell>
                      <TableCell><Badge variant="outline" className={TIER_COLORS[r.risk_tier] ?? ""}>{r.risk_tier}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.approved_at ?? r.created_at ? new Date(r.approved_at ?? r.created_at).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {(((register_public.data as any)?.rows ?? (register_public.data as any[])) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Transparency register is empty.</TableCell></TableRow>
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
