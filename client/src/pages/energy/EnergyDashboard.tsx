import { useState } from "react";
import { ExportButton } from "@/components/ExportButton";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, Zap } from "lucide-react";

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

function statusBadge(s: string) {
  const map: Record<string, string> = {
    active: "bg-green-500/15 text-green-600 dark:text-green-400", suspended: "bg-red-500/15 text-red-600 dark:text-red-400",
    revoked: "bg-red-500/15 text-red-600 dark:text-red-400", pending: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
    submitted: "bg-blue-500/15 text-blue-600 dark:text-blue-400", draft: "bg-muted text-foreground",
  };
  return <Badge className={map[s] ?? "bg-muted text-foreground"}>{s.replace(/_/g, " ")}</Badge>;
}

function severityBadge(s: string) {
  const map: Record<string, string> = { critical: "bg-red-500/15 text-red-600 dark:text-red-400", high: "bg-orange-500/15 text-orange-600 dark:text-orange-400", medium: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400", low: "bg-blue-500/15 text-blue-600 dark:text-blue-400" };
  return <Badge className={map[s] ?? "bg-muted text-foreground"}>{s}</Badge>;
}

export default function EnergyDashboard() {
  const [tab, setTab] = useState("companies");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("all");
  const [eventType, setEventType] = useState("all");
  const [violationOnly, setViolationOnly] = useState(false);

  const stats = trpc.energy.getStats.useQuery();
  const companies = trpc.energy.listCompanies.useQuery({ search: search || undefined, sector: sector === "all" ? undefined : sector });
  const licences = trpc.energy.listLicences.useQuery();
  const gridEvents = trpc.energy.listGridEvents.useQuery({
    eventType: eventType === "all" ? undefined : eventType,
    violationOnly: violationOnly || undefined,
  });
  const oilGasReports = trpc.energy.listOilGasReports.useQuery();

  const s = stats.data as any;
  const fmt = (n: number | string) => Number(n).toLocaleString();
  const fmtNgn = (n: number | string) => `₦${(Number(n) / 1e9).toFixed(1)}B`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary" /> Energy Sector Regulatory Module
        </h1>
        <p className="text-sm text-muted-foreground mt-1">NERC / NUPRC — Electricity, Oil & Gas Data Sovereignty & Grid Monitoring</p>
        <ExportButton data={companies.data?.data ?? []} filename="energy-assets" label="Export" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="Total Companies" value={s?.total_companies ?? "—"} />
        <StatCard label="Compliant" value={s?.compliant_companies ?? "—"} color="text-green-600" />
        <StatCard label="Active Licences" value={s?.active_licences ?? "—"} />
        <StatCard label="Data Violations" value={s?.data_violations ?? "—"} color="text-red-600" />
        <StatCard label="Cyber Incidents" value={s?.cyber_incidents ?? "—"} color="text-red-600" />
        <StatCard label="Offshore Reports" value={s?.offshore_reports ?? "—"} color="text-orange-600" />
        <StatCard label="Elec. Customers" value={s ? fmt(s.total_electricity_customers) : "—"} />
        <StatCard label="Total Capacity" value={s ? `${fmt(s.total_capacity_mw)} MW` : "—"} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="companies">Companies</TabsTrigger>
          <TabsTrigger value="licences">Licences</TabsTrigger>
          <TabsTrigger value="grid">Grid Events</TabsTrigger>
          <TabsTrigger value="oilgas">Oil & Gas Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="companies" className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Input placeholder="Search companies..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
            <Select value={sector} onValueChange={setSector}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sectors</SelectItem>
                <SelectItem value="electricity">Electricity</SelectItem>
                <SelectItem value="oil_gas">Oil & Gas</SelectItem>
                <SelectItem value="refinery">Refinery</SelectItem>
                <SelectItem value="renewable">Renewable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Company","Code","Sector","NERC Licence","NUPRC Licence","Capacity (MW)","Customers","SCADA","Compliant","Active"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(companies.data?.data as any[] ?? []).map((c: any) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{c.company_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.company_code}</td>
                    <td className="px-3 py-2">{c.sector?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.nerc_licence_number || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.nuprc_licence_number || "—"}</td>
                    <td className="px-3 py-2">{c.installed_capacity_mw ? fmt(c.installed_capacity_mw) : "—"}</td>
                    <td className="px-3 py-2">{c.customer_base ? fmt(c.customer_base) : "—"}</td>
                    <td className="px-3 py-2 text-xs">{c.scada_system ?? "—"}</td>
                    <td className="px-3 py-2">{c.data_localisation_compliant ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{c.is_active ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="licences" className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Licence Ref","Company","Type","Capacity (MW)","Geographic Scope","Annual Fee","Issued","Expires","Data Localisation","Cyber Secure","Status"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(licences.data as any[] ?? []).map((l: any) => (
                  <tr key={l.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{l.licence_ref}</td>
                    <td className="px-3 py-2">{l.company_name}</td>
                    <td className="px-3 py-2 text-xs">{l.licence_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{l.authorized_capacity_mw ? fmt(l.authorized_capacity_mw) : "—"}</td>
                    <td className="px-3 py-2 text-xs">{l.geographic_scope}</td>
                    <td className="px-3 py-2">{l.annual_fee_ngn ? fmtNgn(l.annual_fee_ngn) : "—"}</td>
                    <td className="px-3 py-2 text-xs">{fmtDate(l.issued_at)}</td>
                    <td className="px-3 py-2 text-xs">{fmtDate(l.expires_at)}</td>
                    <td className="px-3 py-2">{l.data_localisation_condition ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{l.cyber_security_compliant ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{statusBadge(l.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="grid" className="space-y-3">
          <div className="flex gap-2 flex-wrap items-center">
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Event Types</SelectItem>
                {["outage","equipment_failure","load_shedding","voltage_deviation","cyber_incident","frequency_deviation","planned_maintenance"].map(t => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={violationOnly} onChange={e => setViolationOnly(e.target.checked)} />
              Data violations only
            </label>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Event Ref","Company","Type","Severity","Region","Customers","Duration","Power Loss","SCADA Exported","Export Dest.","DL Violation","NERC Reported","Occurred"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(gridEvents.data as any[] ?? []).map((e: any) => (
                  <tr key={e.id} className={`border-t border-border hover:bg-muted/30 ${e.data_localisation_violation ? "bg-red-50/30" : ""}`}>
                    <td className="px-3 py-2 font-mono text-xs">{e.event_ref}</td>
                    <td className="px-3 py-2">{e.company_name}</td>
                    <td className="px-3 py-2 text-xs">{e.event_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{severityBadge(e.severity)}</td>
                    <td className="px-3 py-2 text-xs">{e.affected_region}</td>
                    <td className="px-3 py-2">{fmt(e.affected_customers ?? 0)}</td>
                    <td className="px-3 py-2">{e.duration_minutes ? `${e.duration_minutes}m` : "—"}</td>
                    <td className="px-3 py-2">{e.power_loss_mw ? `${e.power_loss_mw} MW` : "—"}</td>
                    <td className="px-3 py-2">{e.scada_data_exported ? <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400">Yes</Badge> : "No"}</td>
                    <td className="px-3 py-2 text-xs">{e.export_destination ?? "—"}</td>
                    <td className="px-3 py-2">{e.data_localisation_violation ? <Badge className="bg-red-500/15 text-red-600 dark:text-red-400">VIOLATION</Badge> : <Badge className="bg-green-500/15 text-green-600 dark:text-green-400">OK</Badge>}</td>
                    <td className="px-3 py-2">{e.reported_to_nerc ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2 text-xs">{fmtDate(e.occurred_at, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="oilgas" className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Report Ref","Company","Type","Period","Production (bbl)","Reserves (bbl)","Storage Location","Country","Locally Stored","NUPRC Submitted","Status"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(oilGasReports.data as any[] ?? []).map((r: any) => (
                  <tr key={r.id} className={`border-t border-border hover:bg-muted/30 ${!r.is_locally_stored ? "bg-orange-50/30" : ""}`}>
                    <td className="px-3 py-2 font-mono text-xs">{r.report_ref}</td>
                    <td className="px-3 py-2">{r.company_name}</td>
                    <td className="px-3 py-2 text-xs">{r.report_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{r.reporting_period}</td>
                    <td className="px-3 py-2">{r.production_barrels ? fmt(r.production_barrels) : "—"}</td>
                    <td className="px-3 py-2">{r.reserves_barrels ? fmt(r.reserves_barrels) : "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.data_storage_location}</td>
                    <td className="px-3 py-2">{r.data_storage_country}</td>
                    <td className="px-3 py-2">{r.is_locally_stored ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{r.nuprc_submitted ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{statusBadge(r.status)}</td>
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
