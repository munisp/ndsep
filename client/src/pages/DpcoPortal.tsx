import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { useDpcoOnboardingTour } from "@/hooks/useDpcoOnboardingTour";
import {
  Building2, Users, FileCheck, GraduationCap, FileText, ShieldCheck,
  TrendingUp, AlertTriangle, CheckCircle, Clock, ArrowRight, BarChart3,
  BookOpen, Scale, Briefcase, Search, Bell, Receipt, Award
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const QUICK_ACTIONS = [
  { label: "DPCO Registry", desc: "Browse all licensed DPCOs", href: "/dpco/registry", icon: Building2 },
  { label: "Client Portfolio", desc: "Manage your client engagements", href: "/dpco/clients", icon: Users },
  { label: "Audit Workspace", desc: "Run end-to-end compliance audits", href: "/dpco/audit", icon: FileCheck },
  { label: "Verification Statements", desc: "Generate & sign DPCO statements", href: "/dpco/verification", icon: ShieldCheck },
  { label: "Evidence Vault", desc: "Tamper-proof evidence storage", href: "/dpco/evidence", icon: FileText },
  { label: "Billing & Earnings", desc: "Invoices, payments & revenue tracking", href: "/dpco/billing", icon: Receipt },
  { label: "Policy Hub", desc: "NDPA-compliant policy template library", href: "/dpco/policy", icon: BookOpen },
];

const MANDATE_ITEMS = [
  { ref: "NDPA §33", title: "Conduct Data Protection Audits", desc: "Annual and ad-hoc audits of Data Controllers and Processors", done: true },
  { ref: "NDPA §44", title: "File Compliance Audit Returns", desc: "Submit CAR to NDPC by 31 March each year", done: true },
  { ref: "NDPA §33(3)", title: "Issue Verification Statements", desc: "Accompany all NDPC filings with DPCO Verification Statement", done: true },
  { ref: "NDPR 4.1(4)", title: "Outsourced DPO Services", desc: "Provide DPO services to organisations without in-house DPO", done: true },
  { ref: "NDPA §32", title: "Staff Training & Certification", desc: "Deliver NDPA-compliant data protection training programs", done: true },
  { ref: "NDPA §40", title: "Breach Incident Support", desc: "Assist organisations in breach assessment and NDPC notification", done: true },
  { ref: "NDPA §43", title: "Policy & Contract Drafting", desc: "Draft DPAs, DSAs, privacy policies, BCRs, and SARs", done: true },
  { ref: "NDPA §38", title: "DPIA Facilitation", desc: "Conduct Data Protection Impact Assessments for high-risk processing", done: true },
  { ref: "NDPA §45", title: "Due Diligence Assessments", desc: "Pre-merger/acquisition data protection due diligence", done: true },
  { ref: "NDPA §33(5)", title: "NDPC Liaison", desc: "Interface with NDPC on behalf of client organisations", done: true },
];

export default function DpcoPortal() {
  const [selectedDpcoId, setSelectedDpcoId] = useState<string>("all");
  const { user } = useAuth();
  const isDemo = user?.openId === "demo-dpco-user-001" || user?.openId === "demo-admin-user-001";
  useDpcoOnboardingTour(isDemo);

  const dpcoOrgId = selectedDpcoId !== "all" ? Number(selectedDpcoId) : undefined;
  const { data: stats, isLoading } = trpc.dpco.dashboardStats.useQuery(
    { dpcoOrgId },
    { refetchInterval: 60000 }
  );

  const { data: dpcoList } = trpc.dpco.listOrganisations.useQuery({ status: "active", limit: 50 });

  const kpis = [
    { label: "Licensed DPCOs", value: stats?.totalDpcos ?? 0, sub: `${stats?.activeDpcos ?? 0} active`, icon: Building2 },
    { label: "Active Clients", value: stats?.activeClients ?? 0, sub: "current engagements", icon: Users },
    { label: "Pending CARs", value: stats?.pendingCars ?? 0, sub: "audit returns outstanding", icon: FileCheck },
    { label: "Training Sessions", value: stats?.trainingSessions ?? 0, sub: "total delivered", icon: GraduationCap },
    { label: "Verification Stmts", value: stats?.verificationStatements ?? 0, sub: "statements issued", icon: ShieldCheck },
    { label: "Policy Drafts", value: stats?.policyDrafts ?? 0, sub: "documents drafted", icon: FileText },
    { label: "Expiring Licences", value: stats?.expiringDpcos ?? 0, sub: "within 90 days", icon: AlertTriangle },
    { label: "Expired Licences", value: stats?.expiredDpcos ?? 0, sub: "require renewal", icon: Clock },
  ];

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Dpco Portal" }]} className="mb-4" />
      {/* Header — matches Dashboard pattern */}
      <div data-tour="dpco-header" className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">DPCO Operations Portal</h1>
          <p className="text-muted-foreground text-sm mt-1">
            One-stop platform for Data Protection Compliance Organisations — NDPA 2023 §33
          </p>
        </div>
        <Select value={selectedDpcoId} onValueChange={setSelectedDpcoId}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="All DPCOs (Platform-wide)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All DPCOs (Platform-wide)</SelectItem>
            {(dpcoList?.rows ?? []).map((d: any) => (
              <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI Grid — uses Card component like other pages */}
      <div data-tour="dpco-kpi-cards" className="grid grid-cols-4 gap-4">
        {kpis.map(({ label, value, sub, icon: Icon }) => (
          <Card key={label} className="relative overflow-hidden border border-border/60">
            <div className="absolute inset-0 blueprint-grid opacity-30" />
            <CardContent className="relative p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="data-label mb-1">{label}</p>
                  <p className="metric-value text-2xl font-bold text-foreground">{isLoading ? "—" : value}</p>
                  <p className="text-xs text-muted-foreground mt-1 mono">{sub}</p>
                </div>
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Quick Actions */}
        <div className="col-span-2 space-y-4">
          <h2 className="data-label text-sm font-medium uppercase tracking-wider">Quick Actions</h2>
          <div data-tour="dpco-quick-actions" className="grid grid-cols-2 gap-3">
            {QUICK_ACTIONS.map(({ label, desc, href, icon: Icon }) => (
              <Link key={href} href={href}>
                <Card className="hover:border-primary/40 hover:bg-accent/50 transition-all cursor-pointer group h-full">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-foreground font-medium text-sm">{label}</div>
                        <div className="text-muted-foreground text-xs mt-0.5">{desc}</div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* State breakdown */}
          {stats?.stateBreakdown && stats.stateBreakdown.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Active DPCOs by State</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.stateBreakdown.slice(0, 6).map((s: any) => (
                  <div key={s.state} className="flex items-center gap-3">
                    <div className="text-muted-foreground text-xs w-32 truncate">{s.state}</div>
                    <div className="flex-1">
                      <Progress value={Math.min(100, (s.c / (stats?.activeDpcos || 1)) * 100)} className="h-2" />
                    </div>
                    <div className="text-primary text-xs font-mono w-6 text-right">{s.c}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* DPCO Mandate Checklist */}
        <div className="space-y-4">
          <h2 className="data-label text-sm font-medium uppercase tracking-wider">DPCO Statutory Mandate</h2>
          <Card>
            <CardContent className="p-4 space-y-3">
              {MANDATE_ITEMS.map(({ ref, title, desc, done }) => (
                <div key={ref} className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-foreground text-xs font-medium">{title}</span>
                      <Badge variant="outline" className="text-[10px] font-mono">{ref}</Badge>
                    </div>
                    <div className="text-muted-foreground text-xs mt-0.5">{desc}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
