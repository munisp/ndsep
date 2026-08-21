/**
 * DpcoPwaDashboard — Full-screen PWA DPCO Dashboard
 *
 * A rich, mobile-first dashboard with:
 *  - Compliance health ring (RadialBar)
 *  - Monthly earnings area chart (AreaChart)
 *  - Service-type breakdown (PieChart)
 *  - KPI cards (earnings, clients, invoices, outstanding)
 *  - Overdue alert list
 *  - Recent payments activity feed
 *  - Quick-action tiles
 *  - Offline indicator + install banner
 */
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadialBarChart,
  RadialBar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import {
  TrendingUp,
  Users,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  ShieldCheck,
  ClipboardCheck,
  Star,
  Building2,
  ChevronRight,
  Download,
  Bell,
  RefreshCw,
  BarChart2,
  Activity,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InvoiceDrilldownSheet, type InvoiceRow } from "@/components/pwa/InvoiceDrilldownSheet";
import { ComplianceScoreSheet } from "@/components/pwa/ComplianceScoreSheet";
import { useDragReorder } from "@/hooks/useDragReorder";

// ─── Constants ────────────────────────────────────────────────────────────────
const CHART_COLORS = {
  cyan: "#06b6d4",
  emerald: "#10b981",
  violet: "#8b5cf6",
  amber: "#f59e0b",
  rose: "#f43f5e",
  slate: "#475569",
};

function formatNGN(n: number) {
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n);
}

function formatDate(d: string | number) {
  return new Date(d).toLocaleDateString("en-NG", { day: "2-digit", month: "short" });
}

// ─── Compliance Ring ──────────────────────────────────────────────────────────
function ComplianceRing({ score }: { score: number }) {
  const data = [{ name: "Compliance", value: score, fill: score >= 80 ? CHART_COLORS.emerald : score >= 60 ? CHART_COLORS.amber : CHART_COLORS.rose }];
  const label = score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Needs Work";
  const color = score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-rose-400";

  return (
    <div className="relative flex flex-col items-center">
      <ResponsiveContainer width={140} height={140}>
        <RadialBarChart
          cx="50%" cy="50%"
          innerRadius="65%" outerRadius="85%"
          startAngle={225} endAngle={-45}
          data={data}
          barSize={12}
        >
          <RadialBar background={{ fill: "#1e293b" }} dataKey="value" cornerRadius={6} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-black ${color}`}>{score}%</span>
        <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
      </div>
    </div>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border/50 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-muted-foreground font-medium mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">
          {p.name}: {typeof p.value === "number" && p.value > 1000 ? formatNGN(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ title, href, icon: Icon }: { title: string; href?: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-cyan-400" />
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{title}</span>
      </div>
      {href && (
        <Link href={href}>
          <span className="text-xs text-cyan-400 flex items-center gap-0.5 hover:text-cyan-300">
            View all <ChevronRight className="h-3 w-3" />
          </span>
        </Link>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function DpcoPwaDashboard() {
  const { user } = useAuth();
  const DEMO_DPCO_ORG_ID = (user as any)?.dpcoOrgId ?? 1;
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "12m">("30d");
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRow | null>(null);
  const [showScoreSheet, setShowScoreSheet] = useState(false);

  const WIDGET_ORDER_DEFAULT = ["overdue", "earnings", "service", "payments", "stats"];
  const drag = useDragReorder(WIDGET_ORDER_DEFAULT, "dpco-dashboard-widget-order");

  const earningsQuery = trpc.billing.getDpcoEarnings.useQuery({
    dpcoOrgId: DEMO_DPCO_ORG_ID,
    period,
  });
  const invoicesQuery = trpc.billing.listInvoices.useQuery({
    dpcoOrgId: DEMO_DPCO_ORG_ID,
    limit: 20,
  });
  const statsQuery = trpc.dpco.dashboardStats.useQuery({ dpcoOrgId: DEMO_DPCO_ORG_ID });

  const earnings = earningsQuery.data;
  const invoices = invoicesQuery.data?.rows ?? [];
  const stats = statsQuery.data;

  const overdueInvoices = invoices.filter((i) => i.status === "overdue");
  const recentPayments = earnings?.recentPayments ?? [];
  const monthlyTrend = useMemo(
    () =>
      (earnings?.monthlyTrend ?? []).map((m: any) => ({
        month: m.month,
        earned: Number(m.net_earned ?? 0),
        billed: Number(m.total_billed ?? 0),
        fees: Number(m.platform_fees ?? 0),
      })),
    [earnings]
  );
  const byService = useMemo(
    () =>
      (earnings?.byServiceType ?? []).map((s: any) => ({
        name: String(s.service_type ?? "Other").replace(/_/g, " "),
        value: Number(s.net_earned ?? 0),
      })),
    [earnings]
  );

  // Derived compliance score (mock from stats)
  const complianceScore = useMemo(() => {
    if (!stats) return 72;
    const base = 50;
    const clientBonus = Math.min(stats.activeClients * 2, 20);
    const trainingBonus = Math.min(stats.trainingSessions * 3, 15);
    const penaltyDeduction = Math.min(stats.pendingCars * 5, 20);
    return Math.min(100, Math.max(0, base + clientBonus + trainingBonus - penaltyDeduction));
  }, [stats]);

  const isLoading = earningsQuery.isLoading || invoicesQuery.isLoading;

  const kpis = [
    {
      label: "Net Earned",
      value: earnings ? formatNGN(earnings.summary.totalEarned) : "—",
      sub: period === "30d" ? "Last 30 days" : period === "7d" ? "Last 7 days" : period === "90d" ? "Last 90 days" : "Last 12 months",
      icon: Wallet,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      trend: "+12%",
      up: true,
    },
    {
      label: "Active Clients",
      value: stats ? String(stats.activeClients) : "—",
      sub: `${stats?.totalDpcos ?? 0} total DPCOs`,
      icon: Users,
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
      trend: "+3",
      up: true,
    },
    {
      label: "Outstanding",
      value: earnings ? formatNGN(earnings.summary.outstandingAmount) : "—",
      sub: `${earnings?.summary.overdueInvoices ?? 0} overdue`,
      icon: AlertTriangle,
      color: earnings?.summary.overdueInvoices ? "text-amber-400" : "text-muted-foreground",
      bg: earnings?.summary.overdueInvoices ? "bg-amber-500/10" : "bg-muted/20",
      trend: overdueInvoices.length > 0 ? `${overdueInvoices.length} overdue` : "All clear",
      up: false,
    },
    {
      label: "Platform Fees",
      value: earnings ? formatNGN(earnings.summary.totalPlatformFees) : "—",
      sub: "Remitted to NDPC",
      icon: BarChart2,
      color: "text-violet-400",
      bg: "bg-violet-500/10",
      trend: `${earnings?.summary.paidInvoices ?? 0} paid`,
      up: true,
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <OfflineIndicator />

      {/* ── Header ── */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border/60">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <span className="text-foreground font-black text-sm">N</span>
            </div>
            <div>
              <p className="text-sm font-bold text-foreground leading-none">DPCO Dashboard</p>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">NDSEP Platform</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { earningsQuery.refetch(); invoicesQuery.refetch(); statsQuery.refetch(); }}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-cyan-400 hover:bg-card transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
            <Link href="/dpco/billing">
              <button className="p-1.5 rounded-lg text-muted-foreground hover:text-cyan-400 hover:bg-card transition-colors relative">
                <Bell className="h-4 w-4" />
                {overdueInvoices.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-amber-500 text-[8px] font-bold text-foreground flex items-center justify-center">
                    {overdueInvoices.length}
                  </span>
                )}
              </button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="max-w-lg mx-auto px-4 pt-5 pb-8 space-y-6">

        {/* ── Period selector ── */}
        <div className="flex gap-1.5 bg-background/60 p-1 rounded-xl border border-border/60">
          {(["7d", "30d", "90d", "12m"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-all ${
                period === p
                  ? "bg-cyan-500 text-foreground shadow-md shadow-cyan-500/20"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p === "12m" ? "1Y" : p.toUpperCase()}
            </button>
          ))}
        </div>

        {/* ── Compliance + KPIs row ── */}
        <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
          <div className="flex items-center gap-4">
            <button onClick={() => setShowScoreSheet(true)} className="focus-visible:outline-none" title="Tap to see score breakdown" data-tour="dpco-compliance-ring">
              <ComplianceRing score={complianceScore} />
            </button>
            <div className="flex-1 grid grid-cols-2 gap-2">
              {kpis.slice(0, 2).map(({ label, value, sub, icon: Icon, color, bg, trend, up }) => (
                <div key={label} className="bg-card/60 rounded-xl p-2.5">
                  <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center mb-1.5`}>
                    <Icon className={`h-3.5 w-3.5 ${color}`} />
                  </div>
                  <p className="text-base font-black text-foreground leading-none">{value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{label}</p>
                  <div className={`flex items-center gap-0.5 mt-1 text-[10px] font-medium ${up ? "text-emerald-400" : "text-amber-400"}`}>
                    {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {trend}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => setShowScoreSheet(true)} className="w-full focus-visible:outline-none">
            <p className="text-[10px] text-cyan-500/70 text-center mt-3 hover:text-cyan-400 transition-colors">Compliance Health Score · Tap ring for breakdown ↑</p>
          </button>
        </div>

        {/* ── KPI row 2 ── */}
        <div className="grid grid-cols-2 gap-3">
          {kpis.slice(2).map(({ label, value, sub, icon: Icon, color, bg, trend, up }) => (
            <div key={label} className="bg-background/60 border border-border/50 rounded-2xl p-3.5">
              <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center mb-2`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <p className="text-xl font-black text-foreground leading-none">{value}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
              <p className="text-[10px] text-muted-foreground">{sub}</p>
            </div>
          ))}
        </div>

        {/* ── Drag mode toolbar ── */}
        {drag.dragMode && (
          <div className="flex items-center justify-between bg-cyan-950/60 border border-cyan-500/30 rounded-xl px-4 py-2">
            <p className="text-xs text-cyan-300 font-semibold">Drag widgets to reorder</p>
            <div className="flex gap-2">
              <button onClick={drag.resetOrder} className="text-[11px] text-muted-foreground hover:text-foreground">Reset</button>
              <button onClick={drag.deactivateDragMode} className="text-[11px] text-cyan-400 font-bold hover:text-cyan-300">Done</button>
            </div>
          </div>
        )}

        {/* ── Reorderable widgets ── */}
        {drag.order.map((widgetId) => {
          const isDragging = drag.draggingId === widgetId;
          const isDragOver = drag.dragOverId === widgetId;
          const lp = drag.getLongPressProps(widgetId);
          const wrapperClass = `transition-all duration-200 ${
            isDragging ? "opacity-40 scale-95" : isDragOver && drag.dragMode ? "ring-2 ring-cyan-500/60 rounded-2xl" : ""
          }`;

          if (widgetId === "overdue") return overdueInvoices.length > 0 ? (
            <div key="overdue" className={wrapperClass} {...lp}
              onPointerEnter={() => drag.dragMode && drag.onDragOver("overdue")}>
              <div className="bg-amber-950/30 border border-amber-500/30 rounded-2xl p-4">
                {drag.dragMode && <p className="text-[10px] text-muted-foreground text-right mb-1">☰ hold &amp; drag</p>}
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                    {overdueInvoices.length} Overdue Invoice{overdueInvoices.length > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-2">
                  {overdueInvoices.slice(0, 3).map((inv) => (
                    <div key={inv.id}
                      className="flex items-center justify-between bg-amber-900/20 rounded-xl px-3 py-2 cursor-pointer hover:bg-amber-900/40 transition-colors"
                      onClick={() => !drag.dragMode && setSelectedInvoice(inv as unknown as InvoiceRow)}>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{inv.client_name}</p>
                        <p className="text-[10px] text-amber-400/70">Due {formatDate(inv.due_date)} · tap for details</p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <p className="text-xs font-bold text-amber-300">{formatNGN(Number(inv.total_amount))}</p>
                        <button onClick={(e) => { e.stopPropagation(); window.open(`/api/invoices/${inv.id}/invoice.pdf`, "_blank"); }}
                          className="text-[10px] text-amber-400/70 flex items-center gap-0.5 hover:text-amber-300 mt-0.5">
                          <Download className="h-2.5 w-2.5" /> PDF
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {overdueInvoices.length > 3 && (
                  <Link href="/dpco/billing">
                    <p className="text-xs text-amber-400 text-center mt-2 hover:text-amber-300">+{overdueInvoices.length - 3} more overdue →</p>
                  </Link>
                )}
              </div>
            </div>
          ) : null;

          if (widgetId === "earnings") return (
            <div key="earnings" className={wrapperClass} {...lp}
              onPointerEnter={() => drag.dragMode && drag.onDragOver("earnings")}>
              <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
                {drag.dragMode && <p className="text-[10px] text-muted-foreground text-right mb-1">☰ hold &amp; drag</p>}
                <SectionHeader title="Monthly Earnings" href="/dpco/billing" icon={TrendingUp} />
                {monthlyTrend.length === 0 ? (
                  <div className="h-36 flex items-center justify-center">
                    <p className="text-xs text-muted-foreground">No payment data yet</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={monthlyTrend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="earnGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS.cyan} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={CHART_COLORS.cyan} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="feeGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS.violet} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={CHART_COLORS.violet} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNGN(v)} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="earned" name="Net Earned" stroke={CHART_COLORS.cyan} strokeWidth={2} fill="url(#earnGrad)" dot={false} />
                      <Area type="monotone" dataKey="fees" name="Platform Fees" stroke={CHART_COLORS.violet} strokeWidth={1.5} fill="url(#feeGrad)" dot={false} strokeDasharray="4 2" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          );

          if (widgetId === "service") return byService.length > 0 ? (
            <div key="service" className={wrapperClass} {...lp}
              onPointerEnter={() => drag.dragMode && drag.onDragOver("service")}>
              <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
                {drag.dragMode && <p className="text-[10px] text-muted-foreground text-right mb-1">☰ hold &amp; drag</p>}
                <SectionHeader title="Revenue by Service" icon={Activity} />
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width={120} height={120}>
                    <PieChart>
                      <Pie data={byService} cx="50%" cy="50%" innerRadius={32} outerRadius={52} paddingAngle={3} dataKey="value">
                        {byService.map((_: any, i: number) => (
                          <Cell key={i} fill={Object.values(CHART_COLORS)[i % Object.values(CHART_COLORS).length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any) => formatNGN(Number(v))} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5">
                    {byService.slice(0, 4).map((s: any, i: number) => (
                      <div key={s.name} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: Object.values(CHART_COLORS)[i % Object.values(CHART_COLORS).length] }} />
                          <span className="text-[11px] text-muted-foreground truncate capitalize">{s.name}</span>
                        </div>
                        <span className="text-[11px] font-semibold text-foreground flex-shrink-0">{formatNGN(s.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null;

          if (widgetId === "payments") return (
            <div key="payments" className={wrapperClass} {...lp}
              onPointerEnter={() => drag.dragMode && drag.onDragOver("payments")}>
              <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
                {drag.dragMode && <p className="text-[10px] text-muted-foreground text-right mb-1">☰ hold &amp; drag</p>}
                <SectionHeader title="Recent Payments" href="/dpco/billing" icon={Zap} />
                {recentPayments.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No payments recorded yet</p>
                ) : (
                  <div className="space-y-2">
                    {recentPayments.slice(0, 5).map((p: any) => (
                      <div key={p.id} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{p.client_name ?? "Client"}</p>
                          <p className="text-[10px] text-muted-foreground">{p.invoice_number} · {p.service_type?.replace(/_/g, " ")}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs font-bold text-emerald-400">+{formatNGN(Number(p.amount))}</p>
                          <p className="text-[10px] text-muted-foreground">{formatDate(p.paid_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );

          if (widgetId === "stats") return stats ? (
            <div key="stats" className={wrapperClass} {...lp}
              onPointerEnter={() => drag.dragMode && drag.onDragOver("stats")}>
              <div className="grid grid-cols-3 gap-2">
                {drag.dragMode && <p className="col-span-3 text-[10px] text-muted-foreground text-right">☰ hold &amp; drag</p>}
                {[
                  { label: "Training", value: stats.trainingSessions, icon: Star, color: "text-amber-400" },
                  { label: "Verifications", value: stats.verificationStatements, icon: ShieldCheck, color: "text-cyan-400" },
                  { label: "Policy Drafts", value: stats.policyDrafts, icon: FileText, color: "text-violet-400" },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="bg-background/60 border border-border/50 rounded-xl p-3 text-center">
                    <Icon className={`h-5 w-5 ${color} mx-auto mb-1`} />
                    <p className="text-lg font-black text-foreground">{value}</p>
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null;

          return null;
        })}

        {/* ── Quick Actions ── */}
        <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
          <SectionHeader title="Quick Actions" icon={Zap} />
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "New Invoice", icon: FileText, href: "/dpco/billing", color: "text-cyan-400", bg: "bg-cyan-500/10" },
              { label: "Add Client", icon: Building2, href: "/dpco/clients", color: "text-emerald-400", bg: "bg-emerald-500/10" },
              { label: "Start Audit", icon: ClipboardCheck, href: "/dpco/audit", color: "text-violet-400", bg: "bg-violet-500/10" },
              { label: "Subscription", icon: CreditCard, href: "/dpco/subscription", color: "text-amber-400", bg: "bg-amber-500/10" },
              { label: "Evidence", icon: ShieldCheck, href: "/dpco/evidence", color: "text-rose-400", bg: "bg-rose-500/10" },
              { label: "Scorecard", icon: Star, href: "/dpco/scorecard", color: "text-cyan-400", bg: "bg-cyan-500/10" },
            ].map(({ label, icon: Icon, href, color, bg }) => (
              <Link key={label} href={href}>
                <div className="bg-card/60 border border-border/40 rounded-xl p-3 flex flex-col items-center gap-1.5 cursor-pointer hover:border-cyan-500/40 hover:bg-muted/60 transition-all">
                  <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
                    <Icon className={`h-4 w-4 ${color}`} />
                  </div>
                  <span className="text-[11px] text-muted-foreground text-center leading-tight">{label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* ── Navigation links ── */}
        <div className="flex gap-2">
          <Link href="/dpco-app" className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs border-border text-muted-foreground hover:text-foreground gap-1.5">
              ← PWA Home
            </Button>
          </Link>
          <Link href="/" className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs border-border text-muted-foreground hover:text-foreground gap-1.5">
              Desktop Portal →
            </Button>
          </Link>
        </div>

        <p className="text-[10px] text-muted-foreground text-center pb-2">
          NDSEP DPCO Portal · v1.0.0 · © 2026 NDPC
        </p>
      </main>

      <InstallBanner />
      <InvoiceDrilldownSheet
        invoice={selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
      />
      <ComplianceScoreSheet
        open={showScoreSheet}
        onClose={() => setShowScoreSheet(false)}
        breakdown={{
          activeClients: stats?.activeClients ?? 0,
          trainingSessions: stats?.trainingSessions ?? 0,
          pendingCars: stats?.pendingCars ?? 0,
          overdueInvoices: overdueInvoices.length,
          score: complianceScore,
        }}
      />
    </div>
  );
}
