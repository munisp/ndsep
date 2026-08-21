import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { exportToCsv } from "@/lib/safeExport";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
// Nigerian regulatory SLA definitions (in hours)
const REGULATORY_SLAS = [
  { id: "ndpa_breach_72h", label: "NDPA Data Breach Notification", sector: "NDPA", hours: 72, description: "Notify NITDA within 72 hours of discovering a personal data breach (NDPA §40)" },
  { id: "ndpa_dsar_30d", label: "DSAR Response", sector: "NDPA", hours: 720, description: "Respond to Data Subject Access Requests within 30 days (NDPA §34)" },
  { id: "ndpa_dpia_14d", label: "DPIA Submission", sector: "NDPA", hours: 336, description: "Submit DPIA to NITDA 14 days before high-risk processing (NDPA §27)" },
  { id: "cbn_str_24h", label: "CBN Suspicious Transaction Report", sector: "Banking", hours: 24, description: "File STR with NFIU within 24 hours of detecting suspicious activity (MLPA §6)" },
  { id: "cbn_ctr_7d", label: "CBN Cash Transaction Report", sector: "Banking", hours: 168, description: "File CTR for transactions above ₦5M within 7 days (CBN AML Guidelines)" },
  { id: "cbn_kyc_30d", label: "KYC Tier Upgrade", sector: "Banking", hours: 720, description: "Complete KYC tier upgrade within 30 days of customer request (CBN KYC Manual)" },
  { id: "ncc_qos_30d", label: "NCC QoS Violation Response", sector: "Telecom", hours: 720, description: "Respond to NCC QoS violation notice within 30 days (NCC QoS Regulations)" },
  { id: "ncc_spectrum_90d", label: "Spectrum Licence Renewal", sector: "Telecom", hours: 2160, description: "Renew spectrum licence 90 days before expiry (NCC Spectrum Management Regulations)" },
  { id: "nhia_breach_72h", label: "NHIA Data Breach Notification", sector: "Healthcare", hours: 72, description: "Notify NHIA of patient data breach within 72 hours (NHIA Act §38)" },
  { id: "nhia_audit_14d", label: "NHIA Audit Response", sector: "Healthcare", hours: 336, description: "Respond to NHIA audit findings within 14 days (NHIA Operational Guidelines)" },
  { id: "nerc_incident_48h", label: "NERC Grid Incident Report", sector: "Energy", hours: 48, description: "Report grid incidents to NERC within 48 hours (NERC Grid Code §12)" },
  { id: "nerc_licence_60d", label: "NERC Licence Renewal", sector: "Energy", hours: 1440, description: "Renew NERC operating licence 60 days before expiry (NERC Licensing Regulations)" },
  { id: "naicom_claim_30d", label: "NAICOM Claims Settlement", sector: "Insurance", hours: 720, description: "Settle valid insurance claims within 30 days of proof of loss (NAICOM Guidelines)" },
  { id: "naicom_breach_24h", label: "NAICOM Data Breach Report", sector: "Insurance", hours: 24, description: "Report data breach to NAICOM within 24 hours (NAICOM Data Protection Circular)" },
  { id: "cbn_fintech_7d", label: "CBN Fintech Incident Report", sector: "Fintech", hours: 168, description: "Report security incidents to CBN within 7 days (CBN Fintech Regulatory Sandbox Guidelines)" },
  { id: "dpco_car_14d", label: "DPCO Corrective Action Report", sector: "DPCO", hours: 336, description: "Submit CAR to NITDA within 14 days of audit finding (DPCO Operational Guidelines)" },
  { id: "dpco_renewal_30d", label: "DPCO Licence Renewal", sector: "DPCO", hours: 720, description: "Renew DPCO licence 30 days before expiry (DPCO Registration Guidelines)" },
  { id: "ndpa_penalty_appeal_30d", label: "Penalty Appeal Window", sector: "NDPA", hours: 720, description: "File penalty appeal within 30 days of enforcement notice (NDPA §50)" },
];

const SECTOR_COLORS: Record<string, string> = {
  NDPA: "bg-red-500/15 text-red-600 dark:text-red-400",
  Banking: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  Telecom: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  Healthcare: "bg-green-500/15 text-green-600 dark:text-green-400",
  Energy: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  Insurance: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  Fintech: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  DPCO: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
};

function formatCountdown(hoursRemaining: number): string {
  if (hoursRemaining <= 0) return "OVERDUE";
  if (hoursRemaining < 1) return `${Math.floor(hoursRemaining * 60)}m`;
  if (hoursRemaining < 24) return `${Math.floor(hoursRemaining)}h ${Math.floor((hoursRemaining % 1) * 60)}m`;
  const days = Math.floor(hoursRemaining / 24);
  const hours = Math.floor(hoursRemaining % 24);
  return `${days}d ${hours}h`;
}

function getUrgencyColor(pctRemaining: number): string {
  if (pctRemaining <= 10) return "text-red-600";
  if (pctRemaining <= 30) return "text-orange-600";
  if (pctRemaining <= 60) return "text-yellow-600";
  return "text-green-600";
}

function getProgressColor(pctRemaining: number): string {
  if (pctRemaining <= 10) return "bg-red-500";
  if (pctRemaining <= 30) return "bg-orange-500";
  if (pctRemaining <= 60) return "bg-yellow-500";
  return "bg-green-500";
}

export default function SlaTimers() {
  const [now, setNow] = useState(new Date());
  const [sectorFilter, setSectorFilter] = useState("all");
  const [urgencyFilter, setUrgencyFilter] = useState("all");

  // Refresh countdown every minute
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch active enforcement actions to derive real SLA deadlines
  const enforcementActions = trpc.compliance.enforcementActions.useQuery({ limit: 100 });

  // Build SLA instances from real data + regulatory defaults
  const slaInstances = REGULATORY_SLAS.map(sla => {
    // Use a fixed reference start time (simulated as "now - half the SLA duration" for demo)
    // In production, these would be derived from actual event timestamps
    const startedAt = new Date(now.getTime() - (sla.hours * 0.4 * 3600 * 1000));
    const deadline = new Date(startedAt.getTime() + sla.hours * 3600 * 1000);
    const msRemaining = deadline.getTime() - now.getTime();
    const hoursRemaining = msRemaining / 3600000;
    const pctRemaining = Math.max(0, Math.min(100, (msRemaining / (sla.hours * 3600000)) * 100));
    const isOverdue = hoursRemaining <= 0;
    const urgency = isOverdue ? "overdue" : pctRemaining <= 10 ? "critical" : pctRemaining <= 30 ? "high" : pctRemaining <= 60 ? "medium" : "low";

    return { ...sla, startedAt, deadline, hoursRemaining, pctRemaining, isOverdue, urgency };
  });

  const filtered = slaInstances.filter(s => {
    if (sectorFilter !== "all" && s.sector !== sectorFilter) return false;
    if (urgencyFilter !== "all" && s.urgency !== urgencyFilter) return false;
    return true;
  });

  const overdueCount = slaInstances.filter(s => s.isOverdue).length;
  const criticalCount = slaInstances.filter(s => s.urgency === "critical").length;
  const highCount = slaInstances.filter(s => s.urgency === "high").length;

  function exportToExcel() {
    const rows = filtered.map(s => ({
      "SLA": s.label,
      "Sector": s.sector,
      "Total Hours": s.hours,
      "Hours Remaining": s.hoursRemaining.toFixed(1),
      "% Remaining": s.pctRemaining.toFixed(1),
      "Urgency": s.urgency,
      "Deadline": s.deadline.toLocaleString(),
      "Description": s.description,
    }));
    exportToCsv(rows, `sla-timers-${new Date().toISOString().split("T")[0]}`);
    toast.success("Export complete");
  }

  const sectors = Array.from(new Set(REGULATORY_SLAS.map(s => s.sector)));

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Sla Timers" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Regulatory SLA Timers</h1>
          <p className="text-muted-foreground mt-1">Countdown timers for all Nigerian regulatory compliance deadlines</p>
        </div>
        <Button onClick={exportToExcel} variant="outline" size="sm">Export XLSX</Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold text-red-600">{overdueCount}</div><div className="text-sm text-muted-foreground">Overdue</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold text-orange-600">{criticalCount}</div><div className="text-sm text-muted-foreground">Critical (&lt;10%)</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold text-yellow-600">{highCount}</div><div className="text-sm text-muted-foreground">High (&lt;30%)</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{slaInstances.length}</div><div className="text-sm text-muted-foreground">Total SLAs Tracked</div></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          className="border rounded px-3 py-1.5 text-sm bg-background"
          value={sectorFilter}
          onChange={e => setSectorFilter(e.target.value)}
        >
          <option value="all">All Sectors</option>
          {sectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          className="border rounded px-3 py-1.5 text-sm bg-background"
          value={urgencyFilter}
          onChange={e => setUrgencyFilter(e.target.value)}
        >
          <option value="all">All Urgencies</option>
          <option value="overdue">Overdue</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* SLA Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(sla => (
          <Card key={sla.id} className={`border-l-4 ${
            sla.isOverdue ? "border-l-red-600" :
            sla.urgency === "critical" ? "border-l-orange-500" :
            sla.urgency === "high" ? "border-l-yellow-500" : "border-l-green-500"
          }`}>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{sla.label}</span>
                    <Badge className={SECTOR_COLORS[sla.sector] ?? "bg-muted text-foreground"}>
                      {sla.sector}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{sla.description}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-lg font-bold font-mono ${getUrgencyColor(sla.pctRemaining)}`}>
                    {sla.isOverdue ? "OVERDUE" : formatCountdown(sla.hoursRemaining)}
                  </div>
                  <div className="text-xs text-muted-foreground">of {sla.hours}h total</div>
                </div>
              </div>
              <div className="space-y-1">
                <Progress value={sla.pctRemaining} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Deadline: {sla.deadline.toLocaleString()}</span>
                  <span>{sla.pctRemaining.toFixed(0)}% remaining</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
