import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Building2, ShieldCheck, AlertTriangle, Globe, CreditCard,
  FileText, Users, TrendingUp, ArrowRight, Activity
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default function BankingDashboard() {
  const { data: instStats } = trpc.banking.institutions.institutionStats.useQuery();
  const { data: kycStats } = trpc.banking.kyc.stats.useQuery();
  const { data: amlStats } = trpc.banking.aml.stats.useQuery();
  const { data: fraudStats } = trpc.banking.fraud.stats.useQuery();
  const { data: payStats } = trpc.banking.payments.paymentStats.useQuery();
  const { data: cbnStats } = trpc.banking.cbnReports.stats.useQuery();
  const { data: corrStats } = trpc.banking.correspondents.stats.useQuery();
  const { data: watchStats } = trpc.banking.watchlist.stats.useQuery();

  const modules = [
    {
      title: "Banking Institutions",
      href: "/banking/institutions",
      icon: Building2,
      color: "text-blue-600",
      bg: "bg-blue-50",
      stats: [
        { label: "Total", value: (instStats as any)?.total ?? "—" },
        { label: "Licensed", value: (instStats as any)?.licensed ?? "—" },
        { label: "Suspended", value: (instStats as any)?.suspended ?? "—", alert: Number((instStats as any)?.suspended) > 0 },
      ],
    },
    {
      title: "KYC Management",
      href: "/banking/kyc",
      icon: ShieldCheck,
      color: "text-green-600",
      bg: "bg-green-50",
      stats: [
        { label: "Total", value: (kycStats as any)?.total ?? "—" },
        { label: "Pending", value: (kycStats as any)?.pending ?? "—", alert: Number((kycStats as any)?.pending) > 0 },
        { label: "PEP Flagged", value: (kycStats as any)?.pep_flagged ?? "—", alert: Number((kycStats as any)?.pep_flagged) > 0 },
      ],
    },
    {
      title: "AML Case Management",
      href: "/banking/aml",
      icon: AlertTriangle,
      color: "text-red-600",
      bg: "bg-red-50",
      stats: [
        { label: "Open Cases", value: (amlStats as any)?.open_cases ?? "—", alert: Number((amlStats as any)?.open_cases) > 0 },
        { label: "Escalated", value: (amlStats as any)?.escalated ?? "—", alert: Number((amlStats as any)?.escalated) > 0 },
        { label: "STRs Filed", value: (amlStats as any)?.str_filed ?? "—" },
      ],
    },
    {
      title: "Payments (NIP/RTGS)",
      href: "/banking/payments",
      icon: CreditCard,
      color: "text-purple-600",
      bg: "bg-purple-50",
      stats: [
        { label: "NIP Txns", value: (payStats as any)?.total_nip ?? "—" },
        { label: "RTGS Txns", value: (payStats as any)?.total_rtgs ?? "—" },
        { label: "AML Flagged", value: (payStats as any)?.nip_aml_flagged ?? "—", alert: Number((payStats as any)?.nip_aml_flagged) > 0 },
      ],
    },
    {
      title: "SWIFT Messages",
      href: "/banking/swift",
      icon: Globe,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
      stats: [
        { label: "Total", value: (instStats as any)?.total ?? "—" },
        { label: "Sanctions Flagged", value: "—", alert: false },
        { label: "MT103 Count", value: "—" },
      ],
    },
    {
      title: "Fraud Detection",
      href: "/banking/fraud",
      icon: Activity,
      color: "text-orange-600",
      bg: "bg-orange-50",
      stats: [
        { label: "Open Alerts", value: (fraudStats as any)?.open_alerts ?? "—", alert: Number((fraudStats as any)?.open_alerts) > 0 },
        { label: "Confirmed Fraud", value: (fraudStats as any)?.confirmed_fraud ?? "—" },
        { label: "High Risk", value: (fraudStats as any)?.high_risk ?? "—", alert: Number((fraudStats as any)?.high_risk) > 0 },
      ],
    },
    {
      title: "CBN Regulatory Reports",
      href: "/banking/cbn-reports",
      icon: FileText,
      color: "text-teal-600",
      bg: "bg-teal-50",
      stats: [
        { label: "Drafts", value: (cbnStats as any)?.drafts ?? "—" },
        { label: "Overdue", value: (cbnStats as any)?.overdue ?? "—", alert: Number((cbnStats as any)?.overdue) > 0 },
        { label: "Past Deadline", value: (cbnStats as any)?.past_deadline ?? "—", alert: Number((cbnStats as any)?.past_deadline) > 0 },
      ],
    },
    {
      title: "Correspondent Banks",
      href: "/banking/correspondents",
      icon: Users,
      color: "text-cyan-600",
      bg: "bg-cyan-50",
      stats: [
        { label: "Active", value: (corrStats as any)?.active ?? "—" },
        { label: "High Risk", value: (corrStats as any)?.high_risk ?? "—", alert: Number((corrStats as any)?.high_risk) > 0 },
        { label: "Countries", value: (corrStats as any)?.countries_count ?? "—" },
      ],
    },
    {
      title: "Watchlist / Sanctions",
      href: "/banking/watchlist",
      icon: TrendingUp,
      color: "text-rose-600",
      bg: "bg-rose-50",
      stats: [
        { label: "Active Entries", value: (watchStats as any)?.active ?? "—" },
        { label: "OFAC SDN", value: (watchStats as any)?.ofac ?? "—" },
        { label: "Terrorism", value: (watchStats as any)?.terrorism ?? "—", alert: Number((watchStats as any)?.terrorism) > 0 },
      ],
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Banking", href: "/banking" }, { label: "Dashboard" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Banking Services</h1>
          <p className="text-sm text-muted-foreground mt-1">
            CBN-regulated financial institution oversight — KYC, AML, NIP/RTGS, SWIFT, Fraud, Correspondent Banking
          </p>
        </div>
        <Badge variant="outline" className="text-green-700 border-green-500/30 bg-green-50">
          CBN Compliant
        </Badge>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Licensed Institutions</p>
            <p className="text-2xl font-bold text-blue-700">{(instStats as any)?.licensed ?? "—"}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Open AML Cases</p>
            <p className="text-2xl font-bold text-red-700">{(amlStats as any)?.open_cases ?? "—"}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Fraud Alerts (Open)</p>
            <p className="text-2xl font-bold text-orange-700">{(fraudStats as any)?.open_alerts ?? "—"}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-teal-500">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">CBN Reports Overdue</p>
            <p className="text-2xl font-bold text-teal-700">{(cbnStats as any)?.overdue ?? "—"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Module Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map((mod) => {
          const Icon = mod.icon;
          return (
            <Card key={mod.href} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <div className={`p-2 rounded-lg ${mod.bg}`}>
                    <Icon className={`h-4 w-4 ${mod.color}`} />
                  </div>
                  {mod.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {mod.stats.map((s) => (
                    <div key={s.label} className="text-center">
                      <p className={`text-lg font-bold ${s.alert ? "text-red-600" : "text-foreground"}`}>
                        {s.value}
                      </p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>
                <Link href={mod.href}>
                  <Button variant="outline" size="sm" className="w-full">
                    Open <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
