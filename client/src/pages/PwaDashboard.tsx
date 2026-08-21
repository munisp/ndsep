/**
 * PwaDashboard — Mobile-first PWA Platform Dashboard for NDPC Staff
 *
 * Sections:
 *  - Live KPI strip (orgs, violations, breaches, penalties)
 *  - NDPA Compliance Index ring
 *  - Compliance trend AreaChart (180 days)
 *  - Breach timeline feed
 *  - Enforcement cases list
 *  - Sector leaderboard
 *  - Quick-nav grid to all platform modules
 *  - Offline indicator + install banner
 */
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  RadialBarChart, RadialBar, ResponsiveContainer,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  Shield, AlertTriangle, Building2, Gavel, Activity,
  TrendingUp, TrendingDown, RefreshCw, Bell, ChevronRight,
  Globe, Database, Network, Zap, FileText, CheckCircle2,
  XCircle, Clock, BarChart2, Users, Lock, Search,
  ArrowUpRight, ArrowDownRight, Flame, ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  blue:    "#3b82f6",
  cyan:    "#06b6d4",
  emerald: "#10b981",
  violet:  "#8b5cf6",
  amber:   "#f59e0b",
  rose:    "#f43f5e",
  slate:   "#475569",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
function fmtNGN(n: number) {
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(0)}K`;
  return `₦${n}`;
}
function fmtDate(d: string | number | Date) {
  return new Date(d).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "2-digit" });
}
function severityColor(s: string) {
  if (s === "critical") return "text-rose-400";
  if (s === "high") return "text-amber-400";
  if (s === "medium") return "text-yellow-400";
  return "text-muted-foreground";
}
function statusBadge(s: string) {
  const map: Record<string, string> = {
    compliant: "bg-emerald-500/20 text-emerald-300",
    non_compliant: "bg-rose-500/20 text-rose-300",
    under_review: "bg-amber-500/20 text-amber-300",
    open: "bg-rose-500/20 text-rose-300",
    settled: "bg-emerald-500/20 text-emerald-300",
    closed: "bg-muted text-muted-foreground",
    active: "bg-cyan-500/20 text-cyan-300",
  };
  return map[s] ?? "bg-muted text-muted-foreground";
}

// ─── Sub-components ───────────────────────────────────────────────────────────
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

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border/50 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-muted-foreground font-medium mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

function NdpaRing({ score }: { score: number }) {
  const color = score >= 75 ? C.emerald : score >= 55 ? C.amber : C.rose;
  const label = score >= 75 ? "Strong" : score >= 55 ? "Moderate" : "Weak";
  const data = [{ value: score, fill: color }];
  return (
    <div className="relative flex flex-col items-center">
      <ResponsiveContainer width={130} height={130}>
        <RadialBarChart cx="50%" cy="50%" innerRadius="62%" outerRadius="82%"
          startAngle={225} endAngle={-45} data={data} barSize={11}>
          <RadialBar background={{ fill: "#1e293b" }} dataKey="value" cornerRadius={5} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black" style={{ color }}>{score}%</span>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function PwaDashboard() {
  const [tab, setTab] = useState<"overview" | "breaches" | "enforcement" | "sectors">("overview");

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.dashboard.stats.useQuery();
  const { data: ndpaIndex, refetch: refetchNdpa } = trpc.ndpaStats.index.useQuery(undefined, { refetchInterval: 120_000 });
  const { data: breachTimeline, refetch: refetchBreaches } = trpc.ndpaStats.breachTimeline.useQuery({ limit: 12 }, { refetchInterval: 60_000 });
  const { data: complianceTrend } = trpc.ndpaStats.complianceTrend.useQuery({ days: 90 }, { refetchInterval: 300_000 });
  const { data: violationTrend } = trpc.dashboard.violationTrend.useQuery();
  const { data: enforcementCases, refetch: refetchCases } = trpc.enforcementCases.list.useQuery({ limit: 10 });
  const { data: leaderboard } = trpc.leaderboard.list.useQuery({ limit: 8 });
  const { data: sectorStats } = trpc.sectors.stats.useQuery();

  const isLoading = statsLoading;

  function refetchAll() {
    refetchStats(); refetchNdpa(); refetchBreaches(); refetchCases();
  }

  // ── Derived data ──
  const ndpaScore = useMemo(() => {
    if (!ndpaIndex) return 62;
    const idx = ndpaIndex as any;
    return Math.round(Number(idx.overallScore ?? idx.overall_score ?? idx.score ?? 62));
  }, [ndpaIndex]);

  const trendData = useMemo(() =>
    (complianceTrend as any[] ?? []).map((r: any) => ({
      date: String(r.date ?? r.snapshot_date ?? "").slice(5),
      score: Number(r.score ?? r.compliance_score ?? 0),
      breaches: Number(r.breaches ?? r.breach_count ?? 0),
    })).slice(-30),
    [complianceTrend]
  );

  const violationData = useMemo(() =>
    (violationTrend as any[] ?? []).slice(-8).map((r: any) => ({
      week: String(r.period ?? r.week ?? "").slice(5),
      critical: Number(r.critical ?? 0),
      high: Number(r.violations ?? r.high ?? 0),
    })),
    [violationTrend]
  );

  const orgStats = (stats as any)?.orgStats;
  const violStats = (stats as any)?.violationStats;
  const alertStats = (stats as any)?.alertStats;
  const penaltyStats = (stats as any)?.penaltyStats;
  const gapStats = (stats as any)?.complianceGapStats;

  const kpis = [
    { label: "Organisations", value: fmt(orgStats?.total), sub: `${fmt(orgStats?.compliant)} compliant`, icon: Building2, color: "text-cyan-400", bg: "bg-cyan-500/10", up: true },
    { label: "Violations", value: fmt(violStats?.total), sub: `${fmt(violStats?.critical)} critical`, icon: AlertTriangle, color: "text-rose-400", bg: "bg-rose-500/10", up: false },
    { label: "Breaches", value: fmt(gapStats?.breaches?.total), sub: `${fmt(gapStats?.breaches?.open)} open`, icon: ShieldAlert, color: "text-amber-400", bg: "bg-amber-500/10", up: false },
    { label: "Penalties", value: fmtNGN(Number(penaltyStats?.totalAmount ?? 0)), sub: `${fmt(penaltyStats?.overdue)} overdue`, icon: Gavel, color: "text-violet-400", bg: "bg-violet-500/10", up: true },
  ];

  const cases = (enforcementCases as any[]) ?? [];
  const breaches = (breachTimeline as any[]) ?? [];
  const leaders = (leaderboard as any[]) ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <OfflineIndicator />

      {/* ── Header ── */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border/60">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/30">
              <Shield className="h-4 w-4 text-foreground" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground leading-none">NDSEP Platform</p>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">NDPC Enforcement Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refetchAll}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-cyan-400 hover:bg-card transition-colors" aria-label="Refresh">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
            <Link href="/alerts">
              <button className="p-1.5 rounded-lg text-muted-foreground hover:text-cyan-400 hover:bg-card transition-colors relative">
                <Bell className="h-4 w-4" />
                {Number(alertStats?.critical) > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-rose-500 text-[8px] font-bold text-foreground flex items-center justify-center">
                    {alertStats.critical}
                  </span>
                )}
              </button>
            </Link>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-lg mx-auto px-4 pb-2 flex gap-1">
          {(["overview", "breaches", "enforcement", "sectors"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 text-[11px] font-semibold py-1.5 rounded-lg capitalize transition-all ${
                tab === t ? "bg-blue-600 text-foreground shadow-md shadow-blue-600/20" : "text-muted-foreground hover:text-foreground"
              }`}>
              {t}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pt-4 pb-8 space-y-5">

        {/* ══ OVERVIEW TAB ══ */}
        {tab === "overview" && (
          <>
            {/* NDPA Index + KPIs */}
            <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
              <div className="flex items-center gap-4">
                <NdpaRing score={ndpaScore} />
                <div className="flex-1 grid grid-cols-2 gap-2">
                  {kpis.slice(0, 2).map(({ label, value, sub, icon: Icon, color, bg, up }) => (
                    <div key={label} className="bg-card/60 rounded-xl p-2.5">
                      <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center mb-1.5`}>
                        <Icon className={`h-3.5 w-3.5 ${color}`} />
                      </div>
                      <p className="text-base font-black text-foreground leading-none">{value}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">{sub}</p>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground text-center mt-3">NDPA Compliance Index · Updated every 2 min</p>
            </div>

            {/* KPI row 2 */}
            <div className="grid grid-cols-2 gap-3">
              {kpis.slice(2).map(({ label, value, sub, icon: Icon, color, bg }) => (
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

            {/* Compliance trend */}
            <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
              <SectionHeader title="Compliance Trend (90d)" icon={TrendingUp} href="/frameworks" />
              {trendData.length === 0 ? (
                <div className="h-36 flex items-center justify-center">
                  <p className="text-xs text-muted-foreground">Loading trend data…</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={150}>
                  <AreaChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                    <defs>
                      <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.blue} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={C.blue} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} interval={6} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} domain={[0, 100]} />
                    <Tooltip content={<ChartTip />} />
                    <Area type="monotone" dataKey="score" name="Score" stroke={C.blue} strokeWidth={2} fill="url(#scoreGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Violation bar chart */}
            {violationData.length > 0 && (
              <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
                <SectionHeader title="Weekly Violations" icon={AlertTriangle} href="/compliance" />
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={violationData} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                    <XAxis dataKey="week" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="critical" name="Critical" fill={C.rose} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="high" name="High" fill={C.amber} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* NDPA gap stats */}
            {gapStats && (
              <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
                <SectionHeader title="NDPA Gap Closure" icon={Shield} />
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Consent", val: gapStats.consent?.active, total: gapStats.consent?.total, color: C.cyan },
                    { label: "DPO Reg.", val: gapStats.dpoRegistry?.verified, total: gapStats.dpoRegistry?.total, color: C.emerald },
                    { label: "DPIA", val: gapStats.dpia?.approved, total: gapStats.dpia?.total, color: C.violet },
                    { label: "ROPA", val: gapStats.ropa?.active, total: gapStats.ropa?.total, color: C.blue },
                    { label: "Training", val: gapStats.staffTraining?.completed, total: gapStats.staffTraining?.total, color: C.amber },
                    { label: "Audit Ret.", val: gapStats.auditReturns?.submitted ?? gapStats.auditReturns?.total, total: gapStats.auditReturns?.total, color: C.rose },
                  ].map(({ label, val, total, color }) => {
                    const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                    return (
                      <div key={label} className="bg-card/60 rounded-xl p-2.5 text-center">
                        <p className="text-base font-black text-foreground">{pct}%</p>
                        <p className="text-[10px] text-muted-foreground">{label}</p>
                        <div className="mt-1.5 h-1 rounded-full bg-muted">
                          <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quick nav */}
            <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
              <SectionHeader title="Quick Navigation" icon={Zap} />
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Orgs", icon: Building2, href: "/organizations", color: "text-cyan-400", bg: "bg-cyan-500/10" },
                  { label: "Breaches", icon: ShieldAlert, href: "/breach-notification", color: "text-rose-400", bg: "bg-rose-500/10" },
                  { label: "Enforce", icon: Gavel, href: "/enforcement-cases", color: "text-violet-400", bg: "bg-violet-500/10" },
                  { label: "Sectors", icon: BarChart2, href: "/sectors", color: "text-amber-400", bg: "bg-amber-500/10" },
                  { label: "DPIA", icon: FileText, href: "/dpia", color: "text-blue-400", bg: "bg-blue-500/10" },
                  { label: "DPO Reg.", icon: Users, href: "/dpo-registry", color: "text-emerald-400", bg: "bg-emerald-500/10" },
                  { label: "Network", icon: Network, href: "/network", color: "text-cyan-400", bg: "bg-cyan-500/10" },
                  { label: "Reports", icon: TrendingUp, href: "/reports", color: "text-violet-400", bg: "bg-violet-500/10" },
                ].map(({ label, icon: Icon, href, color, bg }) => (
                  <Link key={label} href={href}>
                    <div className="bg-card/60 border border-border/40 rounded-xl p-2.5 flex flex-col items-center gap-1.5 cursor-pointer hover:border-blue-500/40 hover:bg-muted/60 transition-all">
                      <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center`}>
                        <Icon className={`h-3.5 w-3.5 ${color}`} />
                      </div>
                      <span className="text-[10px] text-muted-foreground text-center leading-tight">{label}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ══ BREACHES TAB ══ */}
        {tab === "breaches" && (
          <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
            <SectionHeader title="Breach Incident Timeline" icon={ShieldAlert} href="/breach-notification" />
            {breaches.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No breach incidents recorded</p>
            ) : (
              <div className="space-y-3">
                {breaches.map((b: any, i: number) => (
                  <div key={b.id ?? i} className="flex items-start gap-3 pb-3 border-b border-border/60 last:border-0">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      b.breach_incident_severity === "critical" ? "bg-rose-500" :
                      b.breach_incident_severity === "high" ? "bg-amber-500" : "bg-yellow-500"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{b.organisation_name ?? b.organization_name ?? "Unknown Org"}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{b.breach_description ?? b.description ?? "Data breach incident"}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] font-semibold ${severityColor(b.breach_incident_severity ?? "medium")}`}>
                          {(b.breach_incident_severity ?? "medium").toUpperCase()}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{fmtDate(b.breach_detected_at ?? b.created_at ?? Date.now())}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusBadge(b.breach_incident_status ?? "open")}`}>
                          {b.breach_incident_status ?? "open"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ ENFORCEMENT TAB ══ */}
        {tab === "enforcement" && (
          <div className="space-y-4">
            <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
              <SectionHeader title="Enforcement Cases" icon={Gavel} href="/enforcement-cases" />
              {cases.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No enforcement cases found</p>
              ) : (
                <div className="space-y-3">
                  {cases.map((c: any, i: number) => (
                    <div key={c.id ?? i} className="flex items-start gap-3 pb-3 border-b border-border/60 last:border-0">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        ["settled", "closed"].includes(c.status) ? "bg-emerald-500/15" : "bg-rose-500/15"
                      }`}>
                        {["settled", "closed"].includes(c.status)
                          ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          : <XCircle className="h-4 w-4 text-rose-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{c.organisation_name ?? c.organization_name ?? `Case #${c.id}`}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{c.case_description ?? c.description ?? "Enforcement action"}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusBadge(c.status)}`}>{c.status}</span>
                          {c.penalty_amount && <span className="text-[10px] text-amber-400 font-semibold">{fmtNGN(Number(c.penalty_amount))}</span>}
                          <span className="text-[10px] text-muted-foreground">{fmtDate(c.created_at ?? Date.now())}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Penalty summary */}
            {penaltyStats && (
              <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
                <SectionHeader title="Penalty Summary" icon={Gavel} />
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Total Issued", value: fmtNGN(Number(penaltyStats.totalAmount ?? 0)), color: "text-violet-400" },
                    { label: "Pending", value: fmtNGN(Number(penaltyStats.pendingAmount ?? 0)), color: "text-amber-400" },
                    { label: "Overdue", value: fmtNGN(Number(penaltyStats.overdueAmount ?? 0)), color: "text-rose-400" },
                    { label: "Cases", value: fmt(penaltyStats.total), color: "text-cyan-400" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-card/60 rounded-xl p-3">
                      <p className={`text-lg font-black ${color}`}>{value}</p>
                      <p className="text-[11px] text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ SECTORS TAB ══ */}
        {tab === "sectors" && (
          <div className="space-y-4">
            {/* Leaderboard */}
            <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
              <SectionHeader title="Compliance Leaderboard" icon={TrendingUp} href="/leaderboard" />
              {leaders.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No leaderboard data</p>
              ) : (
                <div className="space-y-2">
                  {leaders.map((org: any, i: number) => {
                    const score = Number(org.compliance_score ?? org.score ?? 0);
                    const barColor = score >= 80 ? C.emerald : score >= 60 ? C.amber : C.rose;
                    return (
                      <div key={org.id ?? i} className="flex items-center gap-3">
                        <span className="text-[11px] font-bold text-muted-foreground w-4 flex-shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-semibold text-foreground truncate">{org.name ?? org.organisation_name ?? `Org #${org.id}`}</p>
                            <span className="text-xs font-bold ml-2 flex-shrink-0" style={{ color: barColor }}>{score}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted">
                            <div className="h-1.5 rounded-full transition-all" style={{ width: `${score}%`, background: barColor }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sector stats */}
            {sectorStats && (
              <div className="bg-background/60 border border-border/50 rounded-2xl p-4">
                <SectionHeader title="Sector Overview" icon={BarChart2} href="/sectors" />
                <div className="space-y-2">
                  {((sectorStats as unknown) as any[]).slice(0, 6).map((s: any, i: number) => {
                    const avg = Number(s.avg_score ?? s.avgScore ?? 0);
                    return (
                      <div key={s.sector ?? i} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs text-muted-foreground truncate capitalize">{s.sector ?? s.name ?? `Sector ${i + 1}`}</p>
                            <span className="text-xs font-semibold text-muted-foreground ml-2 flex-shrink-0">{avg}%</span>
                          </div>
                          <div className="h-1 rounded-full bg-muted">
                            <div className="h-1 rounded-full" style={{ width: `${avg}%`, background: Object.values(C)[i % Object.values(C).length] }} />
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">{s.org_count ?? s.count ?? 0} orgs</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Footer nav ── */}
        <div className="flex gap-2 pt-2">
          <Link href="/dpco-app" className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs border-border text-muted-foreground hover:text-foreground">
              DPCO App
            </Button>
          </Link>
          <Link href="/" className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs border-border text-muted-foreground hover:text-foreground">
              Desktop →
            </Button>
          </Link>
        </div>

        <p className="text-[10px] text-muted-foreground text-center pb-2">
          NDSEP v1.0.0 · NDPC © 2026 · All data is live
        </p>
      </main>

      <InstallBanner />
    </div>
  );
}
