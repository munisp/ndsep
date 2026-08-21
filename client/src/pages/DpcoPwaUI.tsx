/**
 * DpcoPwaUI — Full PWA DPCO UI Showcase
 * Renders all 5 PWA tabs in an interactive phone-frame mockup.
 * Route: /dpco-ui
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  LayoutDashboard, Users, FileText, ClipboardCheck, Settings,
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Clock,
  Download, ExternalLink, Bell, Shield, CreditCard, ChevronRight,
  Building2, Phone, Mail, MapPin, Star, Activity, BarChart3,
  Lock, Fingerprint, Wifi, WifiOff, Battery, Signal, Plus,
  ArrowUpRight, ArrowDownRight, Calendar, Hash, DollarSign,
  BookOpen, Award, Zap, RefreshCw, Eye, Filter, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// ─── Constants ────────────────────────────────────────────────────────────────
// DEMO_ORG_ID is now resolved at runtime from useAuth() in the main component
const NGN = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(n);

type Tab = "home" | "clients" | "billing" | "audit" | "settings";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "home",     label: "Home",     icon: LayoutDashboard },
  { id: "clients",  label: "Clients",  icon: Users },
  { id: "billing",  label: "Billing",  icon: FileText },
  { id: "audit",    label: "Audit",    icon: ClipboardCheck },
  { id: "settings", label: "Settings", icon: Settings },
];

// ─── Shared micro-components ──────────────────────────────────────────────────
function KpiCard({
  label, value, sub, trend, color = "cyan",
}: {
  label: string; value: string; sub?: string;
  trend?: { dir: "up" | "down"; pct: string }; color?: string;
}) {
  const accent = color === "emerald" ? "text-emerald-400" : color === "amber" ? "text-amber-400" : color === "violet" ? "text-violet-400" : "text-cyan-400";
  const bg = color === "emerald" ? "bg-emerald-500/10" : color === "amber" ? "bg-amber-500/10" : color === "violet" ? "bg-violet-500/10" : "bg-cyan-500/10";
  return (
    <div className={`${bg} border border-border/40 rounded-xl p-3 space-y-1`}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold ${accent}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      {trend && (
        <div className={`flex items-center gap-0.5 text-[10px] ${trend.dir === "up" ? "text-emerald-400" : "text-red-400"}`}>
          {trend.dir === "up" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {trend.pct}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {action}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: "bg-emerald-500/20 text-emerald-400",
    active: "bg-emerald-500/20 text-emerald-400",
    overdue: "bg-amber-500/20 text-amber-400",
    sent: "bg-cyan-500/20 text-cyan-400",
    draft: "bg-muted text-muted-foreground",
    pending: "bg-amber-500/20 text-amber-400",
    completed: "bg-emerald-500/20 text-emerald-400",
    "in-progress": "bg-cyan-500/20 text-cyan-400",
    open: "bg-cyan-500/20 text-cyan-400",
  };
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

// ─── HOME TAB ─────────────────────────────────────────────────────────────────
function HomeTab({ dpcoOrgId }: { dpcoOrgId: number }) {
  const stats = trpc.dpco.dashboardStats.useQuery({ dpcoOrgId });
  const earnings = trpc.billing.getDpcoEarnings.useQuery({ dpcoOrgId });
  const s = stats.data;
  const e = earnings.data?.summary;
  const monthly = earnings.data?.monthlyTrend;

  // dashboardStats returns: { totalDpcos, activeDpcos, expiredDpcos, expiringDpcos,
  //   activeClients, pendingCars, trainingSessions, verificationStatements, policyDrafts,
  //   stateBreakdown, typeBreakdown }
  const complianceScore = s
    ? Math.min(100, Math.round(
        (s.activeClients / Math.max(s.activeDpcos || 1, 1)) * 40 +
        (s.trainingSessions / Math.max(s.trainingSessions + 2, 1)) * 30 +
        (1 - s.pendingCars / Math.max(s.pendingCars + 5, 1)) * 30
      ))
    : 78;

  const earningsData = monthly?.slice(-6).map((m: { month: string; earned: number; fees: number }) => ({
    month: String(m.month ?? "").slice(5),
    net: Number(m.earned ?? 0),
    fee: Number(m.fees ?? 0),
  })) ?? [
    { month: "Oct", net: 1200000, fee: 144000 },
    { month: "Nov", net: 1500000, fee: 180000 },
    { month: "Dec", net: 1100000, fee: 132000 },
    { month: "Jan", net: 1800000, fee: 216000 },
    { month: "Feb", net: 2100000, fee: 252000 },
    { month: "Mar", net: 1950000, fee: 234000 },
  ];

  const scoreColor = complianceScore >= 80 ? "#10b981" : complianceScore >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <div className="space-y-4">
      {/* Welcome */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Good morning,</p>
          <h2 className="text-lg font-bold text-foreground leading-tight">DataGuard Ltd</h2>
          <p className="text-[10px] text-muted-foreground">NDPC-DPCO-2024-0042 · Professional</p>
        </div>
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
            <Shield className="h-5 w-5 text-cyan-400" />
          </div>
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 rounded-full text-[8px] font-bold text-foreground flex items-center justify-center">3</span>
        </div>
      </div>

      {/* Compliance Ring */}
      <div className="bg-card/60 border border-border/40 rounded-2xl p-4">
        <div className="flex items-center gap-4">
          <div className="relative w-20 h-20 flex-shrink-0">
            <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
              <circle cx="40" cy="40" r="32" fill="none" stroke="#1e293b" strokeWidth="8" />
              <circle
                cx="40" cy="40" r="32" fill="none"
                stroke={scoreColor} strokeWidth="8"
                strokeDasharray={`${(complianceScore / 100) * 201} 201`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold text-foreground">{complianceScore}</span>
              <span className="text-[8px] text-muted-foreground">score</span>
            </div>
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-sm font-semibold text-foreground">Compliance Health</p>
            <div className="space-y-1">
              {[
                { label: "Active clients", val: s?.activeClients ?? 12, max: (s?.activeClients ?? 12) + 3, color: "bg-cyan-500" },
                { label: "Trainings done", val: s?.trainingSessions ?? 8, max: (s?.trainingSessions ?? 8) + 2, color: "bg-emerald-500" },
                { label: "Audits clear", val: Math.max(0, 5 - (s?.pendingCars ?? 1)), max: 5, color: "bg-violet-500" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className="text-[9px] text-muted-foreground w-20 flex-shrink-0">{item.label}</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${item.color} rounded-full`} style={{ width: `${(item.val / Math.max(item.max, 1)) * 100}%` }} />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{item.val}/{item.max}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="Net Earnings" value={NGN(e?.totalEarned ?? 9650000)} sub="This year" trend={{ dir: "up", pct: "+12.4%" }} color="emerald" />
        <KpiCard label="Platform Fee" value={NGN(e?.totalPlatformFees ?? 1158000)} sub="12% rate" color="amber" />
        <KpiCard label="Active Clients" value={String(s?.activeClients ?? 12)} sub={`of ${(s?.activeClients ?? 12) + 3} total`} color="cyan" />
        <KpiCard label="Pending CARs" value={String(s?.pendingCars ?? 1)} sub="Requires action" color="violet" />
      </div>

      {/* Earnings sparkline */}
      <div className="bg-card/60 border border-border/40 rounded-xl p-3">
        <SectionHeader title="Monthly Earnings (NGN)" />
        <div style={{ height: 80 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={earningsData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 10 }}
                formatter={(v: number) => [NGN(v), ""]}
              />
              <Area type="monotone" dataKey="net" stroke="#06b6d4" strokeWidth={2} fill="url(#netGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <SectionHeader title="Quick Actions" />
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "New Invoice", icon: FileText, href: "/dpco/billing", color: "text-cyan-400 bg-cyan-500/10" },
            { label: "Dashboard", icon: LayoutDashboard, href: "/dpco-app/dashboard", color: "text-violet-400 bg-violet-500/10" },
            { label: "Subscription", icon: CreditCard, href: "/dpco/subscription", color: "text-emerald-400 bg-emerald-500/10" },
            { label: "Policy Hub", icon: BookOpen, href: "/dpco/policy", color: "text-amber-400 bg-amber-500/10" },
            { label: "Training", icon: Award, href: "/dpco/training", color: "text-pink-400 bg-pink-500/10" },
            { label: "Registry", icon: Building2, href: "/dpco/registry", color: "text-blue-400 bg-blue-500/10" },
          ].map((a) => (
            <Link key={a.label} href={a.href}>
              <div className={`${a.color} border border-border/40 rounded-xl p-2.5 flex flex-col items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity`}>
                <a.icon className="h-5 w-5" />
                <span className="text-[9px] font-medium text-muted-foreground text-center leading-tight">{a.label}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── CLIENTS TAB ──────────────────────────────────────────────────────────────
function ClientsTab({ dpcoOrgId }: { dpcoOrgId: number }) {
  const [search, setSearch] = useState("");
  const clientsQuery = trpc.dpco.listClients.useQuery({ dpcoOrgId });
  const clients = (Array.isArray(clientsQuery.data) ? clientsQuery.data : []) as Array<{
    id: number; organisation_name: string; sector: string; status: string;
    contact_email?: string; contact_phone?: string; city?: string;
    onboarding_date?: string; risk_level?: string;
  }>;

  const filtered = clients.filter((c) =>
    c.organisation_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.sector?.toLowerCase().includes(search.toLowerCase())
  );

  const sectorColors: Record<string, string> = {
    Finance: "bg-emerald-500/20 text-emerald-400",
    Healthcare: "bg-blue-500/20 text-blue-400",
    Technology: "bg-violet-500/20 text-violet-400",
    Education: "bg-amber-500/20 text-amber-400",
    Retail: "bg-pink-500/20 text-pink-400",
    Government: "bg-cyan-500/20 text-cyan-400",
  };

  // Fallback demo clients if none loaded
  const displayClients = filtered.length > 0 ? filtered : [
    { id: 1, organisation_name: "First Bank Nigeria", sector: "Finance", status: "active", contact_email: "dpo@firstbank.ng", city: "Lagos", risk_level: "low" },
    { id: 2, organisation_name: "Eko Hospital Group", sector: "Healthcare", status: "active", contact_email: "privacy@ekohospital.ng", city: "Lagos", risk_level: "medium" },
    { id: 3, organisation_name: "TechVault Solutions", sector: "Technology", status: "pending", contact_email: "legal@techvault.ng", city: "Abuja", risk_level: "low" },
    { id: 4, organisation_name: "Greenleaf Academy", sector: "Education", status: "active", contact_email: "admin@greenleaf.edu.ng", city: "Port Harcourt", risk_level: "low" },
    { id: 5, organisation_name: "ShopRight Nigeria", sector: "Retail", status: "active", contact_email: "dpo@shopright.ng", city: "Kano", risk_level: "high" },
    { id: 6, organisation_name: "FCT Revenue Service", sector: "Government", status: "active", contact_email: "privacy@fctirs.gov.ng", city: "Abuja", risk_level: "medium" },
  ] as typeof clients;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">Clients</h2>
        <Badge className="bg-cyan-500/20 text-cyan-400 border-0 text-xs">{displayClients.length} total</Badge>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients or sectors…"
          className="w-full bg-card/60 border border-border/40 rounded-xl pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus:border-cyan-500/50"
        />
      </div>

      {/* Sector summary pills */}
      <div className="flex gap-1.5 flex-wrap">
        {Object.entries(
          displayClients.reduce((acc, c) => {
            acc[c.sector] = (acc[c.sector] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        ).map(([sector, count]) => (
          <span key={sector} className={`text-[9px] font-medium px-2 py-0.5 rounded-full ${sectorColors[sector] ?? "bg-muted text-muted-foreground"}`}>
            {sector} ({count})
          </span>
        ))}
      </div>

      {/* Client cards */}
      <div className="space-y-2">
        {displayClients.map((c) => (
          <div key={c.id} className="bg-card/60 border border-border/40 rounded-xl p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                    <Building2 className="h-3 w-3 text-cyan-400" />
                  </div>
                  <p className="text-sm font-semibold text-foreground truncate">{c.organisation_name}</p>
                </div>
                <div className="flex items-center gap-2 mt-1.5 ml-7.5">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${sectorColors[c.sector] ?? "bg-muted text-muted-foreground"}`}>{c.sector}</span>
                  {c.city && <span className="text-[9px] text-muted-foreground flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" />{c.city}</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={c.status} />
                {c.risk_level && (
                  <span className={`text-[8px] px-1 py-0.5 rounded ${
                    c.risk_level === "high" ? "bg-red-500/20 text-red-400" :
                    c.risk_level === "medium" ? "bg-amber-500/20 text-amber-400" :
                    "bg-emerald-500/20 text-emerald-400"
                  }`}>{c.risk_level} risk</span>
                )}
              </div>
            </div>
            {c.contact_email && (
              <div className="flex items-center gap-1 mt-2 ml-0">
                <Mail className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground truncate">{c.contact_email}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <Link href="/dpco/clients">
        <Button size="sm" className="w-full bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30 gap-1.5 text-xs">
          <ExternalLink className="h-3.5 w-3.5" />
          Full Client Management Portal
        </Button>
      </Link>
    </div>
  );
}

// ─── BILLING TAB ──────────────────────────────────────────────────────────────
function BillingTab({ dpcoOrgId }: { dpcoOrgId: number }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const invoicesQuery = trpc.billing.listInvoices.useQuery({ dpcoOrgId, limit: 20 });
  const invoices = (invoicesQuery.data?.rows ?? []) as Array<{
    id: number; invoice_number: string; client_name: string; status: string;
    total_amount: string | number; due_date: string; service_type?: string;
    period_start?: string; period_end?: string;
  }>;

  const demoInvoices = invoices.length > 0 ? invoices : [
    { id: 1, invoice_number: "INV-2026-0042", client_name: "First Bank Nigeria", status: "overdue", total_amount: "2500000", due_date: "2026-03-15", service_type: "DPO-as-a-Service" },
    { id: 2, invoice_number: "INV-2026-0041", client_name: "Eko Hospital Group", status: "sent", total_amount: "1800000", due_date: "2026-04-10", service_type: "Data Audit" },
    { id: 3, invoice_number: "INV-2026-0040", client_name: "TechVault Solutions", status: "paid", total_amount: "950000", due_date: "2026-03-01", service_type: "Training" },
    { id: 4, invoice_number: "INV-2026-0039", client_name: "Greenleaf Academy", status: "draft", total_amount: "650000", due_date: "2026-04-30", service_type: "Policy Review" },
    { id: 5, invoice_number: "INV-2026-0038", client_name: "ShopRight Nigeria", status: "paid", total_amount: "3200000", due_date: "2026-02-28", service_type: "DPO-as-a-Service" },
  ] as typeof invoices;

  const totals = demoInvoices.reduce(
    (acc, inv) => {
      const amt = Number(inv.total_amount);
      acc.total += amt;
      if (inv.status === "paid") acc.paid += amt;
      if (inv.status === "overdue") acc.overdue += amt;
      if (inv.status === "sent") acc.pending += amt;
      return acc;
    },
    { total: 0, paid: 0, overdue: 0, pending: 0 }
  );

  const selected = demoInvoices.find((i) => i.id === selectedId);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">Billing</h2>
        <Link href="/dpco/billing">
          <Button size="sm" className="h-7 text-[10px] bg-cyan-500 hover:bg-cyan-400 text-foreground font-semibold gap-1 px-2.5">
            <Plus className="h-3 w-3" />New Invoice
          </Button>
        </Link>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="Total Billed" value={NGN(totals.total)} color="cyan" />
        <KpiCard label="Collected" value={NGN(totals.paid)} color="emerald" />
        <KpiCard label="Overdue" value={NGN(totals.overdue)} color="amber" />
        <KpiCard label="Pending" value={NGN(totals.pending)} color="violet" />
      </div>

      {/* Invoice list */}
      <div className="space-y-2">
        {demoInvoices.map((inv) => (
          <div
            key={inv.id}
            onClick={() => setSelectedId(inv.id === selectedId ? null : inv.id)}
            className={`bg-card/60 border rounded-xl px-3 py-2.5 cursor-pointer transition-all ${
              selectedId === inv.id ? "border-cyan-500/50 bg-muted/60" : "border-border/40"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{inv.client_name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{inv.invoice_number}</p>
                {inv.service_type && <p className="text-[9px] text-muted-foreground mt-0.5">{inv.service_type}</p>}
              </div>
              <div className="text-right flex-shrink-0 space-y-1">
                <p className="text-sm font-bold text-foreground">{NGN(Number(inv.total_amount))}</p>
                <StatusBadge status={inv.status} />
              </div>
            </div>

            {/* Expanded detail */}
            {selectedId === inv.id && (
              <div className="mt-2.5 pt-2.5 border-t border-border/40 space-y-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                  <div><span className="text-muted-foreground">Due:</span> <span className="text-muted-foreground">{new Date(inv.due_date).toLocaleDateString("en-NG")}</span></div>
                  <div><span className="text-muted-foreground">Net:</span> <span className="text-emerald-400">{NGN(Number(inv.total_amount) * 0.88)}</span></div>
                  <div><span className="text-muted-foreground">Platform fee:</span> <span className="text-amber-400">{NGN(Number(inv.total_amount) * 0.12)}</span></div>
                  <div><span className="text-muted-foreground">VAT (7.5%):</span> <span className="text-muted-foreground">{NGN(Number(inv.total_amount) * 0.075)}</span></div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); window.open(`/api/invoices/${inv.id}/invoice.pdf`, "_blank"); }}
                    className="flex-1 text-[10px] bg-muted/60 hover:bg-muted text-cyan-400 rounded-lg py-1.5 flex items-center justify-center gap-1"
                  >
                    <Download className="h-3 w-3" /> PDF
                  </button>
                  {inv.status !== "paid" && (
                    <Link href="/dpco/billing" className="flex-1">
                      <button className="w-full text-[10px] bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded-lg py-1.5 flex items-center justify-center gap-1">
                        <Zap className="h-3 w-3" /> Pay Online
                      </button>
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── AUDIT TAB ────────────────────────────────────────────────────────────────
function AuditTab() {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const demoAudits = [
    {
      id: 1, client: "First Bank Nigeria", type: "Annual NDPA Compliance",
      status: "in-progress", progress: 65, dueDate: "2026-04-30",
      items: ["Data mapping complete", "Policy review in progress", "Staff training pending", "Technical controls pending"],
      score: null,
    },
    {
      id: 2, client: "Eko Hospital Group", type: "Data Processing Audit",
      status: "completed", progress: 100, dueDate: "2026-03-15",
      items: ["Data mapping complete", "Policy review complete", "Staff training complete", "Technical controls complete"],
      score: 87,
    },
    {
      id: 3, client: "TechVault Solutions", type: "Initial Onboarding Audit",
      status: "open", progress: 10, dueDate: "2026-05-15",
      items: ["Data mapping pending", "Policy review pending", "Staff training pending", "Technical controls pending"],
      score: null,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">Audit Workspace</h2>
        <Link href="/dpco/audit">
          <Button size="sm" className="h-7 text-[10px] bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 border border-violet-500/30 gap-1 px-2.5">
            <ExternalLink className="h-3 w-3" />Full View
          </Button>
        </Link>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-cyan-500/10 border border-border/40 rounded-xl p-2 text-center">
          <p className="text-lg font-bold text-cyan-400">1</p>
          <p className="text-[9px] text-muted-foreground">Active</p>
        </div>
        <div className="bg-emerald-500/10 border border-border/40 rounded-xl p-2 text-center">
          <p className="text-lg font-bold text-emerald-400">1</p>
          <p className="text-[9px] text-muted-foreground">Done</p>
        </div>
        <div className="bg-amber-500/10 border border-border/40 rounded-xl p-2 text-center">
          <p className="text-lg font-bold text-amber-400">1</p>
          <p className="text-[9px] text-muted-foreground">Open</p>
        </div>
      </div>

      {/* Audit cards */}
      <div className="space-y-2">
        {demoAudits.map((audit) => (
          <div
            key={audit.id}
            onClick={() => setExpandedId(audit.id === expandedId ? null : audit.id)}
            className={`bg-card/60 border rounded-xl p-3 cursor-pointer transition-all ${
              expandedId === audit.id ? "border-violet-500/50" : "border-border/40"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">{audit.client}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{audit.type}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={audit.status} />
                {audit.score !== null && (
                  <span className="text-[9px] font-bold text-emerald-400">{audit.score}/100</span>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-2">
              <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
                <span>Progress</span>
                <span>{audit.progress}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    audit.status === "completed" ? "bg-emerald-500" :
                    audit.status === "in-progress" ? "bg-cyan-500" : "bg-muted"
                  }`}
                  style={{ width: `${audit.progress}%` }}
                />
              </div>
            </div>

            {/* Expanded checklist */}
            {expandedId === audit.id && (
              <div className="mt-2.5 pt-2.5 border-t border-border/40 space-y-1.5">
                <p className="text-[10px] text-muted-foreground font-medium">Checklist</p>
                {audit.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {i < Math.floor(audit.progress / 25) ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className={`text-[10px] ${i < Math.floor(audit.progress / 25) ? "text-muted-foreground line-through" : "text-muted-foreground"}`}>{item}</span>
                  </div>
                ))}
                <div className="flex items-center gap-1 text-[9px] text-muted-foreground mt-1">
                  <Calendar className="h-3 w-3" />
                  Due: {new Date(audit.dueDate).toLocaleDateString("en-NG")}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SETTINGS TAB ─────────────────────────────────────────────────────────────
function SettingsTab() {
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  const settingsGroups = [
    {
      title: "Organisation",
      items: [
        { label: "DPCO Registry", icon: Building2, href: "/dpco/registry", desc: "Organisation details & licence" },
        { label: "Subscription Plan", icon: CreditCard, href: "/dpco/subscription", desc: "Professional · 10% fee rate" },
        { label: "Team Members", icon: Users, href: "/dpco/team", desc: "Manage staff access" },
      ],
    },
    {
      title: "Notifications",
      items: [
        { label: "Push Notifications", icon: Bell, toggle: true, value: pushEnabled, onToggle: () => setPushEnabled(!pushEnabled), desc: "Invoice & audit alerts" },
      ],
    },
    {
      title: "Security",
      items: [
        { label: "PIN Lock", icon: Lock, toggle: true, value: pinEnabled, onToggle: () => setPinEnabled(!pinEnabled), desc: "5-min inactivity lock" },
        { label: "Biometric Auth", icon: Fingerprint, toggle: true, value: biometricEnabled, onToggle: () => setBiometricEnabled(!biometricEnabled), desc: "Fingerprint / Face ID" },
      ],
    },
    {
      title: "Resources",
      items: [
        { label: "NDPA Policy Hub", icon: BookOpen, href: "/dpco/policy", desc: "Data protection frameworks" },
        { label: "Training Centre", icon: Award, href: "/dpco/training", desc: "Compliance courses" },
        { label: "Platform Dashboard", icon: BarChart3, href: "/pwa-dashboard", desc: "NDPC enforcement overview" },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-foreground">Settings</h2>

      {/* Profile card */}
      <div className="bg-card/60 border border-border/40 rounded-xl p-3 flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-cyan-500/20 border-2 border-cyan-500/40 flex items-center justify-center flex-shrink-0">
          <Shield className="h-6 w-6 text-cyan-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">DataGuard Ltd</p>
          <p className="text-[10px] text-muted-foreground">NDPC-DPCO-2024-0042</p>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[9px] bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-full">Professional</span>
            <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full">Active</span>
          </div>
        </div>
      </div>

      {settingsGroups.map((group) => (
        <div key={group.title}>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5 px-1">{group.title}</p>
          <div className="bg-card/60 border border-border/40 rounded-xl overflow-hidden divide-y divide-slate-700/40">
            {group.items.map((item) => (
              "toggle" in item ? (
                <div key={item.label} className="flex items-center justify-between px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <item.icon className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs font-medium text-foreground">{item.label}</p>
                      <p className="text-[9px] text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                  <button
                    onClick={item.onToggle}
                    className={`w-9 h-5 rounded-full transition-colors relative ${item.value ? "bg-cyan-500" : "bg-muted"}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-background rounded-full shadow transition-transform ${item.value ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </div>
              ) : (
                <Link key={item.label} href={(item as { href: string }).href}>
                  <div className="flex items-center justify-between px-3 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2.5">
                      <item.icon className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs font-medium text-foreground">{item.label}</p>
                        <p className="text-[9px] text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </Link>
              )
            ))}
          </div>
        </div>
      ))}

      {/* App info */}
      <div className="text-center space-y-0.5 pb-2">
        <p className="text-[9px] text-muted-foreground">NDSEP DPCO Portal · v1.0.0 · PWA</p>
        <p className="text-[9px] text-muted-foreground">© 2026 National Data Protection Commission</p>
      </div>
    </div>
  );
}

// ─── PHONE FRAME ─────────────────────────────────────────────────────────────
function PhoneFrame({ tab, active, onSelect, dpcoOrgId }: { tab: Tab; active: Tab; onSelect: (t: Tab) => void; dpcoOrgId: number }) {
  const tabContent: Record<Tab, React.ReactNode> = {
    home: <HomeTab dpcoOrgId={dpcoOrgId} />,
    clients: <ClientsTab dpcoOrgId={dpcoOrgId} />,
    billing: <BillingTab dpcoOrgId={dpcoOrgId} />,
    audit: <AuditTab />,
    settings: <SettingsTab />,
  };

  const tabInfo = TABS.find((t) => t.id === tab)!;
  const isActive = tab === active;

  return (
    <div
      onClick={() => onSelect(tab)}
      className={`relative cursor-pointer transition-all duration-300 ${isActive ? "scale-100 z-10" : "scale-95 opacity-70 hover:opacity-90 hover:scale-97"}`}
    >
      {/* Phone shell */}
      <div className="w-72 bg-background rounded-[2.5rem] border-4 border-border shadow-2xl overflow-hidden" style={{ height: 580 }}>
        {/* Status bar */}
        <div className="bg-background px-5 pt-3 pb-1 flex items-center justify-between">
          <span className="text-[9px] text-muted-foreground font-medium">9:41</span>
          <div className="w-16 h-5 bg-background rounded-full" />
          <div className="flex items-center gap-1">
            <Signal className="h-2.5 w-2.5 text-muted-foreground" />
            <Wifi className="h-2.5 w-2.5 text-muted-foreground" />
            <Battery className="h-3 w-2.5 text-muted-foreground" />
          </div>
        </div>

        {/* App header */}
        <div className="bg-background px-4 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <Shield className="h-3.5 w-3.5 text-cyan-400" />
            </div>
            <span className="text-xs font-bold text-foreground">NDSEP DPCO</span>
          </div>
          <Bell className="h-4 w-4 text-muted-foreground" />
        </div>

        {/* Tab content */}
        <div className="overflow-y-auto px-3 py-3 bg-background" style={{ height: 460 }}>
          {tabContent[tab]}
        </div>

        {/* Bottom nav */}
        <div className="bg-background border-t border-border px-2 py-1.5 flex items-center justify-around">
          {TABS.map((t) => (
            <div key={t.id} className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl transition-colors ${t.id === tab ? "bg-cyan-500/15" : ""}`}>
              <t.icon className={`h-4 w-4 ${t.id === tab ? "text-cyan-400" : "text-muted-foreground"}`} />
              <span className={`text-[7px] font-medium ${t.id === tab ? "text-cyan-400" : "text-muted-foreground"}`}>{t.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Active indicator */}
      {isActive && (
        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-8 h-1 bg-cyan-500 rounded-full" />
      )}
    </div>
  );
}

// ─── MAIN SHOWCASE PAGE ───────────────────────────────────────────────────────
export default function DpcoPwaUI() {
  const { user } = useAuth();
  const DEMO_ORG_ID = (user as any)?.dpcoOrgId ?? 1;
  const [activeTab, setActiveTab] = useState<Tab>("home");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <div className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
              <Shield className="h-4 w-4 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-foreground">NDSEP DPCO PWA</h1>
              <p className="text-[10px] text-muted-foreground">Progressive Web App · All Screens</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dpco-app">
              <Button size="sm" className="h-7 text-[10px] bg-cyan-500 hover:bg-cyan-400 text-foreground font-semibold gap-1 px-3">
                <Zap className="h-3 w-3" />
                Launch PWA
              </Button>
            </Link>
            <Link href="/">
              <Button size="sm" variant="ghost" className="h-7 text-[10px] text-muted-foreground hover:text-foreground px-2">
                ← Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Tab selector */}
      <div className="max-w-7xl mx-auto px-4 pt-6 pb-2">
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-all ${
                activeTab === t.id
                  ? "bg-cyan-500 text-foreground"
                  : "bg-card/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground border border-border/40"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Phone frames grid */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Active phone — large center */}
        <div className="flex justify-center mb-8">
          <div className="w-72 bg-background rounded-[2.5rem] border-4 border-cyan-500/40 shadow-[0_0_60px_rgba(6,182,212,0.15)] overflow-hidden" style={{ height: 620 }}>
            {/* Status bar */}
            <div className="bg-background px-5 pt-3 pb-1 flex items-center justify-between">
              <span className="text-[9px] text-muted-foreground font-medium">9:41</span>
              <div className="w-16 h-5 bg-background rounded-full" />
              <div className="flex items-center gap-1">
                <Signal className="h-2.5 w-2.5 text-muted-foreground" />
                <Wifi className="h-2.5 w-2.5 text-muted-foreground" />
                <Battery className="h-3 w-2.5 text-muted-foreground" />
              </div>
            </div>

            {/* App header */}
            <div className="bg-background px-4 pb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                  <Shield className="h-3.5 w-3.5 text-cyan-400" />
                </div>
                <span className="text-xs font-bold text-foreground">NDSEP DPCO</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <Bell className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            {/* Tab content */}
            <div className="overflow-y-auto px-3 py-3 bg-background" style={{ height: 500 }}>
              {activeTab === "home" && <HomeTab dpcoOrgId={DEMO_ORG_ID} />}
              {activeTab === "clients" && <ClientsTab dpcoOrgId={DEMO_ORG_ID} />}
              {activeTab === "billing" && <BillingTab dpcoOrgId={DEMO_ORG_ID} />}
              {activeTab === "audit" && <AuditTab />}
              {activeTab === "settings" && <SettingsTab />}
            </div>

            {/* Bottom nav */}
            <div className="bg-background border-t border-border px-2 py-1.5 flex items-center justify-around">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl transition-colors ${t.id === activeTab ? "bg-cyan-500/15" : ""}`}
                >
                  <t.icon className={`h-4 w-4 ${t.id === activeTab ? "text-cyan-400" : "text-muted-foreground"}`} />
                  <span className={`text-[7px] font-medium ${t.id === activeTab ? "text-cyan-400" : "text-muted-foreground"}`}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* All 5 screens mini-grid */}
        <div>
          <p className="text-center text-xs text-muted-foreground mb-4 uppercase tracking-widest">All Screens Preview</p>
          <div className="flex flex-wrap justify-center gap-4">
            {TABS.map((t) => (
              <div key={t.id} onClick={() => setActiveTab(t.id)} className={`cursor-pointer transition-all ${activeTab === t.id ? "ring-2 ring-cyan-500 ring-offset-2 ring-offset-slate-950 rounded-[2rem]" : "opacity-60 hover:opacity-80"}`}>
                <div className="w-44 bg-background rounded-[2rem] border-2 border-border overflow-hidden shadow-xl" style={{ height: 360 }}>
                  <div className="bg-background px-3 pt-2 pb-1 flex items-center justify-between">
                    <span className="text-[7px] text-muted-foreground">9:41</span>
                    <div className="w-8 h-3 bg-background rounded-full" />
                    <div className="flex gap-0.5">
                      <Signal className="h-1.5 w-1.5 text-muted-foreground" />
                      <Wifi className="h-1.5 w-1.5 text-muted-foreground" />
                    </div>
                  </div>
                  <div className="bg-background px-2 pb-1 flex items-center gap-1">
                    <Shield className="h-2.5 w-2.5 text-cyan-400" />
                    <span className="text-[7px] font-bold text-foreground">NDSEP DPCO</span>
                  </div>
                  <div className="overflow-hidden px-2 py-1.5 bg-background" style={{ height: 290, transform: "scale(0.6)", transformOrigin: "top left", width: "167%", pointerEvents: "none" }}>
                    {t.id === "home" && <HomeTab dpcoOrgId={DEMO_ORG_ID} />}
                    {t.id === "clients" && <ClientsTab dpcoOrgId={DEMO_ORG_ID} />}
                    {t.id === "billing" && <BillingTab dpcoOrgId={DEMO_ORG_ID} />}
                    {t.id === "audit" && <AuditTab />}
                    {t.id === "settings" && <SettingsTab />}
                  </div>
                  <div className="bg-background border-t border-border px-1 py-1 flex justify-around">
                    {TABS.map((tb) => (
                      <div key={tb.id} className={`flex flex-col items-center gap-0.5 ${tb.id === t.id ? "opacity-100" : "opacity-30"}`}>
                        <tb.icon className={`h-2.5 w-2.5 ${tb.id === t.id ? "text-cyan-400" : "text-muted-foreground"}`} />
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-center text-[9px] text-muted-foreground mt-1.5 font-medium">{t.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Feature badges */}
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {[
            "Service Worker", "Offline Cache", "Web Push", "PIN Lock", "WebAuthn",
            "Install Prompt", "6 Shortcuts", "Drag Reorder", "PDF Export", "Stripe Checkout",
          ].map((f) => (
            <span key={f} className="text-[10px] bg-card/60 border border-border/40 text-muted-foreground px-2.5 py-1 rounded-full">
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
