import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ExportButton } from "@/components/ExportButton";
import { Radio, Wifi, AlertTriangle, Shield, Activity, FileText, CheckCircle, XCircle } from "lucide-react";

function fmtDate(v: any, len = 10): string {
  if (!v) return "—";
  if (typeof v === "string") return v.slice(0, len);
  if (v instanceof Date) return v.toISOString().slice(0, len);
  return String(v).slice(0, len);
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function severityBadge(s: string) {
  const map: Record<string, string> = { critical: "bg-red-500/15 text-red-600 dark:text-red-400", high: "bg-orange-500/15 text-orange-600 dark:text-orange-400", medium: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400", low: "bg-blue-500/15 text-blue-600 dark:text-blue-400" };
  return <Badge className={map[s] ?? "bg-muted text-foreground"}>{s}</Badge>;
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    open: "bg-red-500/15 text-red-600 dark:text-red-400", under_investigation: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
    resolved: "bg-green-500/15 text-green-600 dark:text-green-400", active: "bg-green-500/15 text-green-600 dark:text-green-400",
    pending_renewal: "bg-orange-500/15 text-orange-600 dark:text-orange-400", suspended: "bg-red-500/15 text-red-600 dark:text-red-400",
    fulfilled: "bg-green-500/15 text-green-600 dark:text-green-400", pending: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
    mediation: "bg-blue-500/15 text-blue-600 dark:text-blue-400", filed: "bg-muted text-foreground",
  };
  return <Badge className={map[s] ?? "bg-muted text-foreground"}>{s.replace(/_/g, " ")}</Badge>;
}

export default function TelecomDashboard() {
  
  const [tab, setTab] = useState("operators");
  const [search, setSearch] = useState("");
  const [violationStatus, setViolationStatus] = useState("all");
  const [violationSeverity, setViolationSeverity] = useState("all");
  const [resolveId, setResolveId] = useState<number | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  const stats = trpc.telecom.getStats.useQuery();
  const operators = trpc.telecom.listOperators.useQuery({ search: search || undefined });
  const spectrumLicences = trpc.telecom.listSpectrumLicences.useQuery({ page: 1, limit: 20 });
  const violations = trpc.telecom.listQosViolations.useQuery({
    status: violationStatus === "all" ? undefined : violationStatus,
    severity: violationSeverity === "all" ? undefined : violationSeverity,
  });
  const disputes = trpc.telecom.listInterconnectDisputes.useQuery();
  const intercepts = trpc.telecom.listLawfulIntercepts.useQuery();

  const resolveViolation = trpc.telecom.resolveQosViolation.useMutation({
    onSuccess: () => {
      toast.success("Violation resolved: QoS violation has been marked as resolved.");
      violations.refetch();
      setResolveId(null);
      setResolveNote("");
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const s = stats.data as any;
  const fmt = (n: number | string) => Number(n).toLocaleString();
  const fmtNgn = (n: number | string) => `₦${(Number(n) / 1e9).toFixed(1)}B`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary" /> Telecom Regulatory Module
          </h1>
          <p className="text-sm text-muted-foreground mt-1">NCC — Spectrum, QoS, Interconnect & Lawful Intercept</p>
        </div>
        <ExportButton data={spectrumLicences.data?.data ?? []} filename="telecom-spectrum-licences" label="Export" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="Active Operators" value={s?.active_operators ?? "—"} />
        <StatCard label="Active Licences" value={s?.active_licences ?? "—"} />
        <StatCard label="Open Violations" value={s?.open_violations ?? "—"} color="text-red-600" />
        <StatCard label="Active Disputes" value={s?.active_disputes ?? "—"} color="text-orange-600" />
        <StatCard label="Pending Intercepts" value={s?.pending_intercepts ?? "—"} color="text-yellow-600" />
        <StatCard label="Penalties (Open)" value={s ? fmtNgn(s.total_penalties_open) : "—"} color="text-red-600" />
        <StatCard label="Compliant Licences" value={s?.compliant_licences ?? "—"} color="text-green-600" />
        <StatCard label="LI-Enabled" value={s?.li_enabled_licences ?? "—"} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="operators">Operators</TabsTrigger>
          <TabsTrigger value="spectrum">Spectrum Licences</TabsTrigger>
          <TabsTrigger value="qos">QoS Violations</TabsTrigger>
          <TabsTrigger value="disputes">Interconnect Disputes</TabsTrigger>
          <TabsTrigger value="intercepts">Lawful Intercept</TabsTrigger>
        </TabsList>

        {/* Operators */}
        <TabsContent value="operators" className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Search operators..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Operator","Code","Type","Subscribers","Market Share","Coverage","HQ State","Compliant","LI","Status"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(operators.data as any[] ?? []).map((op: any) => (
                  <tr key={op.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{op.operator_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{op.operator_code}</td>
                    <td className="px-3 py-2">{op.operator_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{fmt(op.subscriber_base ?? 0)}</td>
                    <td className="px-3 py-2">{op.market_share}%</td>
                    <td className="px-3 py-2">{op.coverage_percent}%</td>
                    <td className="px-3 py-2">{op.headquarters_state}</td>
                    <td className="px-3 py-2">{op.data_localisation_compliant ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{op.lawful_intercept_enabled ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{statusBadge(op.is_active ? "active" : "inactive")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Spectrum Licences */}
        <TabsContent value="spectrum" className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Licence Ref","Operator","Band","Frequency Range","Bandwidth","Annual Fee","Issued","Expires","Data Localised","LI","Status"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(spectrumLicences.data?.data as any[] ?? []).map((l: any) => (
                  <tr key={l.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{l.licence_ref}</td>
                    <td className="px-3 py-2">{l.operator_name}</td>
                    <td className="px-3 py-2">{l.band}</td>
                    <td className="px-3 py-2 text-xs">{l.frequency_range_mhz}</td>
                    <td className="px-3 py-2">{l.bandwidth_mhz} MHz</td>
                    <td className="px-3 py-2">{l.annual_fee_ngn ? fmtNgn(l.annual_fee_ngn) : "—"}</td>
                    <td className="px-3 py-2 text-xs">{fmtDate(l.issued_at)}</td>
                    <td className="px-3 py-2 text-xs">{fmtDate(l.expires_at)}</td>
                    <td className="px-3 py-2">{l.data_localisation_compliant ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{l.lawful_intercept_enabled ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{statusBadge(l.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* QoS Violations */}
        <TabsContent value="qos" className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Select value={violationStatus} onValueChange={setViolationStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="under_investigation">Under Investigation</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={violationSeverity} onValueChange={setViolationSeverity}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Ref","Operator","Type","Severity","Measured","Threshold","Unit","Region","Subscribers","Penalty","Status","Actions"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(violations.data?.data as any[] ?? []).map((v: any) => (
                  <tr key={v.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{v.violation_ref}</td>
                    <td className="px-3 py-2">{v.operator_name}</td>
                    <td className="px-3 py-2 text-xs">{v.violation_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{severityBadge(v.severity)}</td>
                    <td className="px-3 py-2">{v.measured_value}</td>
                    <td className="px-3 py-2">{v.threshold_value}</td>
                    <td className="px-3 py-2 text-xs">{v.measurement_unit}</td>
                    <td className="px-3 py-2 text-xs">{v.affected_region}</td>
                    <td className="px-3 py-2">{fmt(v.affected_subscribers ?? 0)}</td>
                    <td className="px-3 py-2">{v.penalty_ngn ? fmtNgn(v.penalty_ngn) : "—"}</td>
                    <td className="px-3 py-2">{statusBadge(v.status)}</td>
                    <td className="px-3 py-2">
                      {v.status !== "resolved" && (
                        <Dialog open={resolveId === v.id} onOpenChange={o => { if (!o) setResolveId(null); }}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline" onClick={() => setResolveId(v.id)}>Resolve</Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Resolve QoS Violation</DialogTitle></DialogHeader>
                            <div className="space-y-3 pt-2">
                              <p className="text-sm text-muted-foreground">Violation: <strong>{v.violation_ref}</strong></p>
                              <div>
                                <Label>Resolution Notes</Label>
                                <Input value={resolveNote} onChange={e => setResolveNote(e.target.value)} placeholder="Describe corrective action taken..." />
                              </div>
                              <Button onClick={() => resolveViolation.mutate({ id: v.id, resolution: resolveNote })} disabled={resolveViolation.isPending} className="w-full">
                                {resolveViolation.isPending ? "Resolving..." : "Mark as Resolved"}
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Interconnect Disputes */}
        <TabsContent value="disputes" className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Dispute Ref","Complainant","Respondent","Type","Amount in Dispute","Status","Filed At"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(disputes.data as any[] ?? []).map((d: any) => (
                  <tr key={d.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{d.dispute_ref}</td>
                    <td className="px-3 py-2">{d.complainant_name}</td>
                    <td className="px-3 py-2">{d.respondent_name}</td>
                    <td className="px-3 py-2 text-xs">{d.dispute_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{d.amount_in_dispute_ngn ? fmtNgn(d.amount_in_dispute_ngn) : "—"}</td>
                    <td className="px-3 py-2">{statusBadge(d.status)}</td>
                    <td className="px-3 py-2 text-xs">{d.filed_at?.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Lawful Intercept */}
        <TabsContent value="intercepts" className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Request Ref","Operator","Agency","Court Order","Type","Urgent","Retention (days)","Status","Requested At"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(intercepts.data as any[] ?? []).map((li: any) => (
                  <tr key={li.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{li.request_ref}</td>
                    <td className="px-3 py-2">{li.operator_name}</td>
                    <td className="px-3 py-2 text-xs">{li.requesting_agency}</td>
                    <td className="px-3 py-2 font-mono text-xs">{li.court_order_ref}</td>
                    <td className="px-3 py-2 text-xs">{li.request_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{li.is_urgent ? <Badge className="bg-red-500/15 text-red-600 dark:text-red-400">Urgent</Badge> : "No"}</td>
                    <td className="px-3 py-2">{li.data_retention_days}</td>
                    <td className="px-3 py-2">{statusBadge(li.status)}</td>
                    <td className="px-3 py-2 text-xs">{li.requested_at?.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
