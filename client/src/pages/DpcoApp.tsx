/**
 * DpcoApp — DPCO Portal PWA
 *
 * Responsive layout:
 *  - Desktop (lg+): persistent left sidebar + wide content area
 *  - Mobile: top header + bottom navigation bar
 *
 * Five tabs: Home (Dashboard), Clients, Billing, Audit, Settings
 */
import { useState, useMemo, createContext, useContext } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { usePwaLock } from "@/hooks/usePwaLock";
import { PwaLockScreen } from "@/components/pwa/PwaLockScreen";
import { PushNotificationSettings } from "@/components/pwa/PushNotificationSettings";
import { PwaSecuritySettings } from "@/components/pwa/PwaSecuritySettings";
import { InvoiceDrilldownSheet, type InvoiceRow } from "@/components/pwa/InvoiceDrilldownSheet";
import { ComplianceScoreSheet } from "@/components/pwa/ComplianceScoreSheet";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  RadialBarChart, RadialBar, ResponsiveContainer,
  XAxis, YAxis, Tooltip,
} from "recharts";
import {
  LayoutDashboard, Users, Receipt, ClipboardCheck, Settings,
  Bell, ChevronRight, ShieldCheck, AlertTriangle, CheckCircle2,
  TrendingUp, Download, ExternalLink, Smartphone, Star,
  BarChart2, FileText, CreditCard, Building2, RefreshCw,
  Wallet, ArrowUpRight, ArrowDownRight, Zap, Activity,
  Menu, X, Calendar,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ─── DPCO Org Context ─────────────────────────────────────────────────────────
const DpcoOrgContext = createContext<number>(1);
const useDpcoOrgId = () => useContext(DpcoOrgContext);

const CHART_COLORS = {
  cyan: "#06b6d4",
  emerald: "#10b981",
  violet: "#8b5cf6",
  amber: "#f59e0b",
  rose: "#f43f5e",
};

function formatNGN(n: number) {
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n);
}

function formatNGNFull(n: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n);
}

function formatDate(d: string | number) {
  return new Date(d).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Tab Types ────────────────────────────────────────────────────────────────
type Tab = "home" | "clients" | "billing" | "audit" | "settings" | "registry" | "evidence" | "scorecard" | "renewal" | "ai-tools" | "verification" | "subscription";

const NAV_ITEMS: { id: Tab; label: string; icon: React.ElementType; bottomNav?: boolean }[] = [
  { id: "home", label: "Dashboard", icon: LayoutDashboard, bottomNav: true },
  { id: "clients", label: "Clients", icon: Users, bottomNav: true },
  { id: "billing", label: "Billing", icon: Receipt, bottomNav: true },
  { id: "audit", label: "Audit", icon: ClipboardCheck, bottomNav: true },
  { id: "registry", label: "Registry", icon: Building2 },
  { id: "evidence", label: "Evidence", icon: FileText },
  { id: "scorecard", label: "Scorecard", icon: BarChart2 },
  { id: "verification", label: "Verification", icon: ShieldCheck },
  { id: "subscription", label: "Subscription", icon: CreditCard },
  { id: "renewal", label: "Renewal", icon: RefreshCw },
  { id: "ai-tools", label: "AI Tools", icon: Zap },
  { id: "settings", label: "Settings", icon: Settings, bottomNav: true },
];

const BOTTOM_NAV_ITEMS = NAV_ITEMS.filter(i => i.bottomNav);

// ─── Compliance Ring ──────────────────────────────────────────────────────────
function ComplianceRing({ score, size = 140 }: { score: number; size?: number }) {
  const data = [{ name: "Compliance", value: score, fill: score >= 80 ? CHART_COLORS.emerald : score >= 60 ? CHART_COLORS.amber : CHART_COLORS.rose }];
  const label = score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Needs Work";
  const color = score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-rose-400";
  return (
    <div className="relative flex flex-col items-center" style={{ width: size, height: size }}>
      <ResponsiveContainer width={size} height={size}>
        <RadialBarChart cx="50%" cy="50%" innerRadius="65%" outerRadius="85%" startAngle={225} endAngle={-45} data={data} barSize={12}>
          <RadialBar background={{ fill: "#1e293b" }} dataKey="value" cornerRadius={6} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-black ${color}`} style={{ fontSize: size * 0.17 }}>{score}%</span>
        <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
      </div>
    </div>
  );
}

// ─── Chart Tooltip ────────────────────────────────────────────────────────────
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

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: "bg-emerald-500/20 text-emerald-400",
    overdue: "bg-amber-500/20 text-amber-400",
    sent: "bg-cyan-500/20 text-cyan-400",
    draft: "bg-muted text-muted-foreground",
    active: "bg-emerald-500/20 text-emerald-400",
    pending: "bg-amber-500/20 text-amber-400",
    completed: "bg-cyan-500/20 text-cyan-400",
    "in-progress": "bg-violet-500/20 text-violet-400",
    open: "bg-muted text-muted-foreground",
    low: "bg-emerald-500/20 text-emerald-400",
    medium: "bg-amber-500/20 text-amber-400",
    high: "bg-rose-500/20 text-rose-400",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

// ─── HOME TAB ─────────────────────────────────────────────────────────────────
function HomeTab() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "12m">("30d");
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRow | null>(null);
  const [showScoreSheet, setShowScoreSheet] = useState(false);

  const earningsQuery = trpc.billing.getDpcoEarnings.useQuery({ dpcoOrgId: useDpcoOrgId(), period });
  const invoicesQuery = trpc.billing.listInvoices.useQuery({ dpcoOrgId: useDpcoOrgId(), limit: 20 });
  const statsQuery = trpc.dpco.dashboardStats.useQuery({ dpcoOrgId: useDpcoOrgId() });

  const earnings = earningsQuery.data;
  const invoices = invoicesQuery.data?.rows ?? [];
  const stats = statsQuery.data;
  const isLoading = earningsQuery.isLoading || invoicesQuery.isLoading;

  const overdueInvoices = invoices.filter((i) => i.status === "overdue");
  const monthlyTrend = useMemo(
    () => (earnings?.monthlyTrend ?? []).map((m: any) => ({
      month: m.month, earned: Number(m.net_earned ?? 0), billed: Number(m.total_billed ?? 0), fees: Number(m.platform_fees ?? 0),
    })),
    [earnings]
  );
  const byService = useMemo(
    () => (earnings?.byServiceType ?? []).map((s: any) => ({
      name: String(s.service_type ?? "Other").replace(/_/g, " "), value: Number(s.net_earned ?? 0),
    })),
    [earnings]
  );
  const complianceScore = useMemo(() => {
    if (!stats) return 72;
    return Math.min(100, Math.max(0, 50 + Math.min(stats.activeClients * 2, 20) + Math.min(stats.trainingSessions * 3, 15) - Math.min(stats.pendingCars * 5, 20)));
  }, [stats]);

  const kpis = [
    { label: "Net Earned", value: earnings ? formatNGN(earnings.summary.totalEarned) : "—", sub: `Last ${period}`, icon: Wallet, color: "text-emerald-400", bg: "bg-emerald-500/10", trend: "+12%", up: true },
    { label: "Active Clients", value: stats ? String(stats.activeClients) : "—", sub: `${stats?.totalDpcos ?? 0} total`, icon: Users, color: "text-cyan-400", bg: "bg-cyan-500/10", trend: "+3", up: true },
    { label: "Outstanding", value: earnings ? formatNGN(earnings.summary.outstandingAmount) : "—", sub: `${earnings?.summary.overdueInvoices ?? 0} overdue`, icon: AlertTriangle, color: overdueInvoices.length > 0 ? "text-amber-400" : "text-muted-foreground", bg: overdueInvoices.length > 0 ? "bg-amber-500/10" : "bg-muted/20", trend: overdueInvoices.length > 0 ? `${overdueInvoices.length} overdue` : "All clear", up: false },
    { label: "Platform Fees", value: earnings ? formatNGN(earnings.summary.totalPlatformFees) : "—", sub: "Remitted to NDPC", icon: BarChart2, color: "text-violet-400", bg: "bg-violet-500/10", trend: `${earnings?.summary.paidInvoices ?? 0} paid`, up: true },
  ];

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">DPCO Portal</p>
          <h2 className="text-2xl font-black text-foreground mt-0.5">Good day 👋</h2>
          <p className="text-sm text-muted-foreground mt-0.5">DataGuard Ltd · NDPC-DPCO-2024-0042 · Professional</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { earningsQuery.refetch(); invoicesQuery.refetch(); statsQuery.refetch(); }}
            className="p-2 rounded-lg text-muted-foreground hover:text-cyan-400 hover:bg-card transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <div className="relative">
            <Bell className="h-5 w-5 text-muted-foreground" />
            {overdueInvoices.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-[9px] font-bold text-foreground flex items-center justify-center">{overdueInvoices.length}</span>
            )}
          </div>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex gap-1.5 bg-background/60 p-1 rounded-xl border border-border/60 max-w-xs">
        {(["7d", "30d", "90d", "12m"] as const).map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-all ${period === p ? "bg-cyan-500 text-foreground shadow-md" : "text-muted-foreground hover:text-foreground"}`}>
            {p === "12m" ? "1Y" : p.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Main grid: compliance ring + KPIs + chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Compliance ring */}
        <div className="bg-background/60 border border-border/50 rounded-2xl p-5 flex flex-col items-center justify-center gap-3">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Compliance Health</p>
          <button onClick={() => setShowScoreSheet(true)} className="focus-visible:outline-none hover:opacity-90 transition-opacity">
            <ComplianceRing score={complianceScore} size={160} />
          </button>
          <p className="text-[11px] text-cyan-500/70 text-center">Click ring for full breakdown</p>
          <div className="grid grid-cols-3 gap-2 w-full mt-1">
            {[
              { label: "Clients", value: `${stats?.activeClients ?? "—"}/15` },
              { label: "Training", value: `${stats?.trainingSessions ?? "—"}/10` },
              { label: "Audits", value: `${stats?.pendingCars !== undefined ? Math.max(0, 5 - stats.pendingCars) : "—"}/5` },
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <p className="text-sm font-bold text-foreground">{value}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-3 content-start">
          {kpis.map(({ label, value, sub, icon: Icon, color, bg, trend, up }) => (
            <div key={label} className="bg-background/60 border border-border/50 rounded-2xl p-4">
              <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
                <Icon className={`h-4.5 w-4.5 ${color}`} />
              </div>
              <p className="text-xl font-black text-foreground leading-none">{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{label}</p>
              <p className="text-[10px] text-muted-foreground">{sub}</p>
              <div className={`flex items-center gap-0.5 mt-2 text-[10px] font-semibold ${up ? "text-emerald-400" : "text-amber-400"}`}>
                {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {trend}
              </div>
            </div>
          ))}
        </div>

        {/* Earnings chart */}
        <div className="bg-background/60 border border-border/50 rounded-2xl p-5">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4">Monthly Earnings (NGN)</p>
          {monthlyTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={monthlyTrend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradEarned" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.cyan} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS.cyan} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradFees" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.violet} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS.violet} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNGN(v)} width={50} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="earned" name="Net Earned" stroke={CHART_COLORS.cyan} fill="url(#gradEarned)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="fees" name="Platform Fees" stroke={CHART_COLORS.violet} fill="url(#gradFees)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No earnings data yet</div>
          )}
        </div>
      </div>

      {/* Service breakdown + overdue alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Service type pie */}
        <div className="bg-background/60 border border-border/50 rounded-2xl p-5">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4">Revenue by Service Type</p>
          {byService.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={byService} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                    {byService.map((_: any, i: number) => (
                      <Cell key={i} fill={Object.values(CHART_COLORS)[i % 5]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatNGN(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {byService.slice(0, 5).map((s: any, i: number) => (
                  <div key={s.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: Object.values(CHART_COLORS)[i % 5] }} />
                      <span className="text-xs text-muted-foreground capitalize">{s.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-foreground">{formatNGN(s.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No service data yet</div>
          )}
        </div>

        {/* Overdue alerts or recent invoices */}
        <div className="bg-background/60 border border-border/50 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {overdueInvoices.length > 0 ? `⚠ ${overdueInvoices.length} Overdue Invoice${overdueInvoices.length > 1 ? "s" : ""}` : "Recent Invoices"}
            </p>
            <Link href="/dpco/billing">
              <span className="text-xs text-cyan-400 flex items-center gap-0.5 hover:text-cyan-300">View all <ChevronRight className="h-3 w-3" /></span>
            </Link>
          </div>
          <div className="space-y-2">
            {invoices.slice(0, 5).map((inv) => (
              <div key={inv.id}
                className="flex items-center justify-between bg-card/50 rounded-xl px-3.5 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setSelectedInvoice(inv as unknown as InvoiceRow)}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{inv.client_name}</p>
                  <p className="text-xs text-muted-foreground">{inv.invoice_number}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <p className="text-sm font-bold text-foreground">{formatNGN(Number(inv.total_amount))}</p>
                  <StatusBadge status={inv.status} />
                </div>
              </div>
            ))}
            {invoices.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No invoices yet</p>}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="bg-background/60 border border-border/50 rounded-2xl p-5">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <Zap className="h-4 w-4 text-cyan-400" /> Quick Actions
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {[
            { label: "New Invoice", icon: FileText, href: "/dpco/billing", color: "text-cyan-400", bg: "bg-cyan-500/10" },
            { label: "Add Client", icon: Building2, href: "/dpco/clients", color: "text-emerald-400", bg: "bg-emerald-500/10" },
            { label: "Start Audit", icon: ClipboardCheck, href: "/dpco/audit", color: "text-violet-400", bg: "bg-violet-500/10" },
            { label: "Subscription", icon: CreditCard, href: "/dpco/subscription", color: "text-amber-400", bg: "bg-amber-500/10" },
            { label: "Evidence", icon: ShieldCheck, href: "/dpco/evidence", color: "text-rose-400", bg: "bg-rose-500/10" },
            { label: "Scorecard", icon: Star, href: "/dpco/scorecard", color: "text-cyan-400", bg: "bg-cyan-500/10" },
          ].map(({ label, icon: Icon, href, color, bg }) => (
            <Link key={label} href={href}>
              <div className="bg-card/60 border border-border/40 rounded-xl p-3 flex flex-col items-center gap-2 cursor-pointer hover:border-cyan-500/40 hover:bg-muted/60 transition-all">
                <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center`}>
                  <Icon className={`h-4.5 w-4.5 ${color}`} />
                </div>
                <span className="text-xs text-muted-foreground text-center leading-tight font-medium">{label}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Training Sessions", value: stats.trainingSessions, icon: Star, color: "text-amber-400", bg: "bg-amber-500/10" },
            { label: "Verifications", value: stats.verificationStatements, icon: ShieldCheck, color: "text-cyan-400", bg: "bg-cyan-500/10" },
            { label: "Policy Drafts", value: stats.policyDrafts, icon: FileText, color: "text-violet-400", bg: "bg-violet-500/10" },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="bg-background/60 border border-border/50 rounded-2xl p-4 text-center">
              <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mx-auto mb-2`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <p className="text-2xl font-black text-foreground">{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

      <InvoiceDrilldownSheet invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
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

// ─── CLIENTS TAB ──────────────────────────────────────────────────────────────
function ClientsTab() {
  const [search, setSearch] = useState("");
  const clientsQuery = trpc.dpco.listClients.useQuery({ dpcoOrgId: useDpcoOrgId() });
  const clients = clientsQuery.data ?? [];

  const filtered = clients.filter((c: any) =>
    !search ||
    c.org_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.org_sector?.toLowerCase().includes(search.toLowerCase())
  );

  const sectors = Array.from(new Set(clients.map((c: any) => c.org_sector).filter(Boolean)));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-foreground">Clients</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{clients.length} total organisations</p>
        </div>
        <Link href="/dpco/clients">
          <Button size="sm" className="bg-cyan-500 hover:bg-cyan-400 text-foreground font-semibold gap-1.5">
            <Building2 className="h-4 w-4" /> Add Client
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search clients or sectors…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-background/60 border border-border/60 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus:border-cyan-500/50"
        />
      </div>

      {/* Sector chips */}
      {sectors.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setSearch("")} className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${!search ? "bg-cyan-500 text-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}>
            All ({clients.length})
          </button>
          {sectors.map((s: any) => (
            <button key={s} onClick={() => setSearch(s)}
              className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${search === s ? "bg-cyan-500 text-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}>
              {s} ({clients.filter((c: any) => c.org_sector === s).length})
            </button>
          ))}
        </div>
      )}

      {/* Client table / cards */}
      {clientsQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-card/40 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No clients found</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block bg-background/60 border border-border/50 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Organisation</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Sector</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Location</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Risk</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Contact</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c: any, i: number) => (
                  <tr key={c.id} className={`border-b border-border/30 hover:bg-card/30 transition-colors ${i === filtered.length - 1 ? "border-0" : ""}`}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                          <Building2 className="h-4 w-4 text-cyan-400" />
                        </div>
                    <p className="font-semibold text-foreground">{c.org_name}</p>
                    </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">{c.org_sector}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{c.location ?? c.state ?? "—"}</td>
                    <td className="px-5 py-3.5"><StatusBadge status={c.status ?? "active"} /></td>
                    <td className="px-5 py-3.5"><StatusBadge status={c.risk_level ?? c.engagement_type ?? "audit"} /></td>
                    <td className="px-5 py-3.5 text-muted-foreground text-xs">{c.contract_reference ?? c.engagement_type ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-3">
            {filtered.map((c: any) => (
              <div key={c.id} className="bg-background/60 border border-border/50 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                      <Building2 className="h-4.5 w-4.5 text-cyan-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{c.org_name}</p>
                      <p className="text-xs text-muted-foreground">{c.org_sector} · {c.location ?? c.state ?? "—"}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={c.status ?? "active"} />
                    <StatusBadge status={c.risk_level ?? "low"} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">{c.contract_reference ?? c.engagement_type?.replace(/_/g, " ") ?? "—"}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="text-center">
        <Link href="/dpco/clients">
          <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:text-foreground gap-1.5">
            <ExternalLink className="h-4 w-4" /> Full Client Management Portal
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ─── BILLING TAB ──────────────────────────────────────────────────────────────
function BillingTab() {
  const invoicesQuery = trpc.billing.listInvoices.useQuery({ dpcoOrgId: useDpcoOrgId(), limit: 50 });
  const earningsQuery = trpc.billing.getDpcoEarnings.useQuery({ dpcoOrgId: useDpcoOrgId(), period: "30d" });
  const invoices = invoicesQuery.data?.rows ?? [];
  const earnings = earningsQuery.data;
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRow | null>(null);

  const summary = [
    { label: "Total Billed", value: earnings ? formatNGNFull(earnings.summary.totalBilled) : "—", color: "text-foreground" },
    { label: "Collected", value: earnings ? formatNGNFull(earnings.summary.totalEarned + earnings.summary.totalPlatformFees) : "—", color: "text-emerald-400" },
    { label: "Overdue", value: earnings ? formatNGNFull(earnings.summary.outstandingAmount) : "—", color: "text-amber-400" },
    { label: "Platform Fee", value: earnings ? formatNGNFull(earnings.summary.totalPlatformFees) : "—", color: "text-violet-400" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-foreground">Billing</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{invoices.length} invoices</p>
        </div>
        <Link href="/dpco/billing">
          <Button size="sm" className="bg-cyan-500 hover:bg-cyan-400 text-foreground font-semibold gap-1.5">
            <FileText className="h-4 w-4" /> New Invoice
          </Button>
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summary.map(({ label, value, color }) => (
          <div key={label} className="bg-background/60 border border-border/50 rounded-2xl p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">{label}</p>
            <p className={`text-lg font-black ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Invoice list */}
      <div className="bg-background/60 border border-border/50 rounded-2xl overflow-hidden">
        {/* Desktop table */}
        <div className="hidden lg:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Invoice</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Client</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Service</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Due Date</th>
                <th className="text-right px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Amount</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">No invoices found</td></tr>
              )}
              {invoices.map((inv, i) => (
                  <tr key={inv.id}
                  className={`border-b border-border/30 hover:bg-card/30 transition-colors cursor-pointer ${i === invoices.length - 1 ? "border-0" : ""}`}
                  onClick={() => setSelectedInvoice(inv as unknown as InvoiceRow)}
                  title="Click to view invoice details">
                  <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{inv.invoice_number}</td>
                  <td className="px-5 py-3.5 font-semibold text-foreground">{inv.client_name}</td>
                  <td className="px-5 py-3.5 text-muted-foreground capitalize">{inv.service_type?.replace(/_/g, " ")}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">{formatDate(inv.due_date)}</td>
                  <td className="px-5 py-3.5 text-right font-bold text-foreground">{formatNGN(Number(inv.total_amount))}</td>
                  <td className="px-5 py-3.5"><StatusBadge status={inv.status} /></td>
                  <td className="px-5 py-3.5">
                    <button onClick={(e) => { e.stopPropagation(); window.open(`/api/invoices/${inv.id}/invoice.pdf`, "_blank"); }}
                      className="text-xs text-cyan-400 flex items-center gap-1 hover:text-cyan-300">
                      <Download className="h-3 w-3" /> PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

          {/* Mobile cards */}
        <div className="lg:hidden divide-y divide-slate-800/40">
          {invoices.length === 0 && <p className="text-center text-muted-foreground py-10">No invoices found</p>}
          {invoices.map((inv) => (
            <div key={inv.id} className="px-4 py-3.5 cursor-pointer hover:bg-card/30 transition-colors"
              onClick={() => setSelectedInvoice(inv as unknown as InvoiceRow)}
              title="Tap to view invoice details">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground">{inv.client_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{inv.invoice_number} · Due {formatDate(inv.due_date)}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-foreground">{formatNGN(Number(inv.total_amount))}</p>
                  <StatusBadge status={inv.status} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <InvoiceDrilldownSheet invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
    </div>
  );
}

// ─── AUDIT TAB ────────────────────────────────────────────────────────────────
function AuditTab() {
  const auditsQuery = trpc.dpco.listAuditEngagements.useQuery({ dpcoOrgId: useDpcoOrgId() });
  const audits = auditsQuery.data ?? [];

  const statusCounts = {
    "in-progress": audits.filter((a: any) => a.status === "in-progress" || a.audit_status === "in-progress").length,
    completed: audits.filter((a: any) => a.status === "completed" || a.audit_status === "completed").length,
    open: audits.filter((a: any) => a.status === "open" || a.audit_status === "open" || (!a.status && !a.audit_status)).length,
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-foreground">Audit Workspace</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{audits.length} audit engagements</p>
        </div>
        <Link href="/dpco/audit">
          <Button size="sm" className="bg-cyan-500 hover:bg-cyan-400 text-foreground font-semibold gap-1.5">
            <ClipboardCheck className="h-4 w-4" /> Full Workspace
          </Button>
        </Link>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "In Progress", count: statusCounts["in-progress"], color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20" },
          { label: "Completed", count: statusCounts.completed, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
          { label: "Open", count: statusCounts.open, color: "text-muted-foreground", bg: "bg-muted/20", border: "border-border/40" },
        ].map(({ label, count, color, bg, border }) => (
          <div key={label} className={`bg-background/60 border ${border} rounded-2xl p-4 text-center`}>
            <p className={`text-3xl font-black ${color}`}>{count}</p>
            <p className="text-xs text-muted-foreground mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Audit list */}
      {auditsQuery.isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-24 bg-card/40 rounded-xl animate-pulse" />)}</div>
      ) : audits.length === 0 ? (
        <div className="bg-background/60 border border-border/50 rounded-2xl p-8 text-center">
          <ClipboardCheck className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">No audit engagements yet</p>
          <Link href="/dpco/audit">
            <Button size="sm" className="bg-cyan-500 hover:bg-cyan-400 text-foreground font-semibold gap-1.5">
              <ExternalLink className="h-4 w-4" /> Open Audit Workspace
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {audits.map((a: any) => {
            const status = a.status ?? a.audit_status ?? "open";
            const progress = a.progress ?? (status === "completed" ? 100 : status === "in-progress" ? 65 : 10);
            return (
              <div key={a.id} className="bg-background/60 border border-border/50 rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="font-semibold text-foreground">{a.client_name ?? a.organisation_name ?? "Client"}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{a.audit_type ?? a.title ?? "NDPA Compliance Audit"}</p>
                  </div>
                  <StatusBadge status={status} />
                </div>
                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Progress</span>
                    <span className="font-semibold text-foreground">{progress}%</span>
                  </div>
                  <div className="h-2 bg-card rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${status === "completed" ? "bg-emerald-500" : status === "in-progress" ? "bg-violet-500" : "bg-muted"}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
                {a.compliance_score && (
                  <p className="text-xs text-muted-foreground mt-2">Score: <span className="font-bold text-foreground">{a.compliance_score}/100</span></p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="text-center">
        <Link href="/dpco/audit">
          <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:text-foreground gap-1.5">
            <ExternalLink className="h-4 w-4" /> Full Audit Workspace with Evidence Upload
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ─── SETTINGS TAB ─────────────────────────────────────────────────────────────
function SettingsTab({ lock }: { lock: ReturnType<typeof usePwaLock> }) {
  const { isInstallable, isInstalled, install } = usePwaInstall();

  const settingsLinks = [
    { label: "Subscription Plan", icon: CreditCard, href: "/dpco/subscription", desc: "Manage your DPCO tier & platform fee rate" },
    { label: "DPCO Registry", icon: ShieldCheck, href: "/dpco/registry", desc: "Organisation details & licence information" },
    { label: "Evidence Vault", icon: ShieldCheck, href: "/dpco/evidence", desc: "Manage compliance evidence packages" },
    { label: "Client Onboarding", icon: Building2, href: "/dpco/onboard", desc: "Onboarding workflow for new clients" },
    { label: "Policy Hub", icon: FileText, href: "/dpco/policy", desc: "Policy templates & drafting tools" },
    { label: "Training Centre", icon: Star, href: "/dpco/training", desc: "Staff training records & sessions" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground mt-0.5">DataGuard Ltd · Professional Plan · Active</p>
      </div>

      {/* Install card */}
      {!isInstalled && (
        <div className="bg-gradient-to-br from-cyan-900/40 to-slate-800/60 border border-cyan-500/30 rounded-2xl p-5">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center">
              <Smartphone className="h-6 w-6 text-cyan-400" />
            </div>
            <div>
              <p className="font-bold text-foreground">Install as App</p>
              <p className="text-sm text-muted-foreground">Works offline · Fast launch · Home screen icon</p>
            </div>
          </div>
          {isInstallable ? (
            <Button className="w-full bg-cyan-500 hover:bg-cyan-400 text-foreground font-semibold gap-2" onClick={install}>
              <Download className="h-4 w-4" /> Install DPCO Portal
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground text-center">Use your browser's "Add to Home Screen" option to install.</p>
          )}
        </div>
      )}

      {isInstalled && (
        <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-2xl p-4 flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-400 flex-shrink-0" />
          <p className="text-emerald-300 font-medium">App installed — running in standalone mode</p>
        </div>
      )}

      {/* Settings links grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {settingsLinks.map(({ label, icon: Icon, href, desc }) => (
          <Link key={label} href={href}>
            <div className="bg-background/60 border border-border/50 rounded-2xl px-4 py-3.5 flex items-center gap-4 cursor-pointer hover:border-cyan-500/30 hover:bg-card/40 transition-all">
              <div className="w-10 h-10 rounded-xl bg-card flex items-center justify-center flex-shrink-0">
                <Icon className="h-5 w-5 text-cyan-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </div>
          </Link>
        ))}
      </div>

      {/* Push Notifications */}
      <div className="bg-background/60 border border-border/50 rounded-2xl p-5">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4">Notifications</p>
        <PushNotificationSettings />
      </div>

      {/* Security */}
      <div className="bg-background/60 border border-border/50 rounded-2xl p-5">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4">Security</p>
        <PwaSecuritySettings lock={lock} />
      </div>

      {/* App info */}
      <div className="bg-background/60 border border-border/50 rounded-2xl p-4 text-center space-y-1">
        <p className="text-sm font-semibold text-muted-foreground">NDSEP DPCO Portal</p>
        <p className="text-xs text-muted-foreground">Version 1.0.0 · PWA enabled</p>
        <p className="text-xs text-muted-foreground">© 2026 National Data Protection Commission</p>
      </div>
    </div>
  );
}

// ─── SIDEBAR NAV (desktop) ────────────────────────────────────────────────────
function SidebarNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <aside className="hidden lg:flex flex-col w-60 bg-background border-r border-border/60 h-screen sticky top-0 overflow-y-auto">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500 flex items-center justify-center shadow-lg shadow-cyan-500/30">
            <span className="text-foreground font-black text-base">N</span>
          </div>
          <div>
            <p className="font-bold text-foreground leading-none text-sm">DPCO Portal</p>
            <p className="text-[10px] text-muted-foreground leading-none mt-0.5">NDSEP Platform</p>
          </div>
        </div>
      </div>

      {/* Org info */}
      <div className="px-5 py-4 border-b border-border/60">
        <div className="bg-background/60 rounded-xl p-3">
          <p className="text-sm font-bold text-foreground">DataGuard Ltd</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">NDPC-DPCO-2024-0042</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded-full font-semibold">Professional</span>
            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">Active</span>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            data-tour={`dpco-nav-${id}`}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              active === id
                ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                : "text-muted-foreground hover:text-foreground hover:bg-card/60"
            }`}
          >
            <Icon className="h-4.5 w-4.5 flex-shrink-0" />
            {label}
            {active === id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-400" />}
          </button>
        ))}
      </nav>

      {/* Bottom links */}
      <div className="px-3 py-4 border-t border-border/60 space-y-1">
        <Link href="/dpco">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-card/60 transition-all cursor-pointer">
            <ExternalLink className="h-4 w-4" />
            Full Desktop Portal
          </div>
        </Link>
        <Link href="/">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-card/60 transition-all cursor-pointer">
            <LayoutDashboard className="h-4 w-4" />
            NDPC Admin
          </div>
        </Link>
      </div>
    </aside>
  );
}

// ─── BOTTOM NAV (mobile) ──────────────────────────────────────────────────────
function BottomNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreItems = NAV_ITEMS.filter(i => !i.bottomNav);
  const isMoreActive = moreItems.some(i => i.id === active);

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur border-t border-border/60">
      {/* More menu overlay */}
      {moreOpen && (
        <div className="absolute bottom-full left-0 right-0 bg-background/98 backdrop-blur border-t border-border/60 p-3 grid grid-cols-4 gap-2">
          {moreItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { onChange(id); setMoreOpen(false); }}
              className={`flex flex-col items-center justify-center py-2.5 gap-1 rounded-xl transition-colors ${
                active === id ? "bg-cyan-500/15 text-cyan-400" : "text-muted-foreground hover:text-foreground hover:bg-card/60"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[9px] font-medium leading-none text-center">{label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-stretch">
        {BOTTOM_NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { onChange(id); setMoreOpen(false); }}
            className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors ${
              active === id ? "text-cyan-400" : "text-muted-foreground hover:text-muted-foreground"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-none">{label}</span>
          </button>
        ))}
        {/* More button */}
        <button
          onClick={() => setMoreOpen(p => !p)}
          className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors ${
            isMoreActive || moreOpen ? "text-cyan-400" : "text-muted-foreground hover:text-muted-foreground"
          }`}
        >
          <Menu className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-none">More</span>
        </button>
      </div>
    </nav>
  );
}

// ─── MAIN PWA PAGE ────────────────────────────────────────────────────────────
export default function DpcoApp() {
  const { user } = useAuth();
  const dpcoOrgId = (user as any)?.dpcoOrgId ?? 1;
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const lock = usePwaLock();
  const tabContent: Record<Tab, React.ReactNode> = {
    home: <HomeTab />,
    clients: <ClientsTab />,
    billing: <BillingTab />,
    audit: <AuditTab />,
    settings: <SettingsTab lock={lock} />,
    registry: <div className="text-center py-16 text-muted-foreground"><Building2 className="h-12 w-12 mx-auto mb-3 opacity-40" /><p className="font-semibold">DPCO Registry</p><p className="text-sm mt-1">Manage your DPCO registration, certifications, and compliance records.</p></div>,
    evidence: <div className="text-center py-16 text-muted-foreground"><FileText className="h-12 w-12 mx-auto mb-3 opacity-40" /><p className="font-semibold">Evidence Vault</p><p className="text-sm mt-1">Upload and manage audit evidence packages and compliance documentation.</p></div>,
    scorecard: <div className="text-center py-16 text-muted-foreground"><BarChart2 className="h-12 w-12 mx-auto mb-3 opacity-40" /><p className="font-semibold">DPCO Scorecard</p><p className="text-sm mt-1">View your compliance scorecard with category breakdowns and trends.</p></div>,
    verification: <div className="text-center py-16 text-muted-foreground"><ShieldCheck className="h-12 w-12 mx-auto mb-3 opacity-40" /><p className="font-semibold">Verification Statements</p><p className="text-sm mt-1">Manage and issue verification statements for your clients.</p></div>,
    subscription: <div className="text-center py-16 text-muted-foreground"><CreditCard className="h-12 w-12 mx-auto mb-3 opacity-40" /><p className="font-semibold">Subscription Plan</p><p className="text-sm mt-1">View and manage your DPCO subscription, billing cycle, and payment methods.</p></div>,
    renewal: <div className="text-center py-16 text-muted-foreground"><RefreshCw className="h-12 w-12 mx-auto mb-3 opacity-40" /><p className="font-semibold">Licence Renewal</p><p className="text-sm mt-1">Renew your DPCO licence and track renewal deadlines.</p></div>,
    "ai-tools": <div className="text-center py-16 text-muted-foreground"><Zap className="h-12 w-12 mx-auto mb-3 opacity-40" /><p className="font-semibold">AI Audit Tools</p><p className="text-sm mt-1">AI-powered compliance gap detection, policy analysis, and audit recommendations.</p></div>,
  };

  const activeItem = NAV_ITEMS.find((n) => n.id === activeTab)!;

  return (
    <DpcoOrgContext.Provider value={dpcoOrgId}>
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Desktop sidebar */}
      <SidebarNav active={activeTab} onChange={setActiveTab} />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header */}
        <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border/60 px-4 lg:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Mobile logo */}
            <div className="lg:hidden flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-cyan-500 flex items-center justify-center">
                <span className="text-foreground font-black text-sm">N</span>
              </div>
              <div>
                <p className="text-sm font-bold text-foreground leading-none">DPCO Portal</p>
                <p className="text-[10px] text-muted-foreground leading-none mt-0.5">NDSEP Platform</p>
              </div>
            </div>
            {/* Desktop breadcrumb */}
            <div className="hidden lg:flex items-center gap-2">
              <activeItem.icon className="h-5 w-5 text-cyan-400" />
              <h1 className="text-lg font-bold text-foreground">{activeItem.label}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-muted-foreground hidden sm:inline">Live</span>
          </div>
        </header>

        {/* Offline indicator */}
        <OfflineIndicator />

        {/* Content */}
        <main className="flex-1 px-4 lg:px-8 pt-6 pb-24 lg:pb-8 overflow-y-auto">
          {tabContent[activeTab]}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <BottomNav active={activeTab} onChange={setActiveTab} />

      {/* Install banner */}
      <InstallBanner />

      {/* Lock screen */}
      {lock.isLocked && <PwaLockScreen lock={lock} />}
    </div>
    </DpcoOrgContext.Provider>
  );
}
