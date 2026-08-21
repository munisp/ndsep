import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";
import { AlertTriangle, CheckCircle, Clock, DollarSign, TrendingUp, FileText, Award, Activity, ArrowLeft, Search, X } from "lucide-react";

const VIOLATION_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6",
];

const STATUS_COLORS: Record<string, string> = {
  draft: "#94a3b8",
  approved: "#22c55e",
  paid: "#3b82f6",
  appealed: "#f97316",
  waived: "#8b5cf6",
};

const formatNGN = (v: number | string) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "₦0";
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toFixed(0)}`;
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-sm">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} style={{ color: p.color }}>
            {p.name}: {p.name.toLowerCase().includes("amount") || p.name.toLowerCase().includes("penalty")
              ? formatNGN(p.value)
              : p.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

type DrillFilter = { violationType?: string; status?: string; orgName?: string; label: string };

export default function PenaltyDashboard() {
  const { data, isLoading } = trpc.phase13.penaltyCalculator.dashboardStats.useQuery();
  const [drillFilter, setDrillFilter] = useState<DrillFilter | null>(null);
  const [drillPage, setDrillPage] = useState(1);
  const [drillSearch, setDrillSearch] = useState("");

  const drillInput = useMemo(() => ({
    violationType: drillFilter?.violationType,
    status: drillFilter?.status,
    orgName: drillFilter?.orgName || (drillSearch || undefined),
    page: drillPage,
    limit: 20,
  }), [drillFilter, drillPage, drillSearch]);

  const { data: drillData } = trpc.phase13.penaltyCalculator.listFiltered.useQuery(drillInput, {
    enabled: !!drillFilter,
  });

  const openDrill = (filter: DrillFilter) => { setDrillFilter(filter); setDrillPage(1); setDrillSearch(""); };
  const closeDrill = () => { setDrillFilter(null); setDrillPage(1); setDrillSearch(""); };

  const totals = data?.totals ?? {};
  const byViolationType = data?.byViolationType ?? [];
  const byStatus = data?.byStatus ?? [];
  const monthlyTrend = data?.monthlyTrend ?? [];
  const topOrgs = data?.topOrgs ?? [];

  const pieData = useMemo(() =>
    (byStatus as any[]).map((s: any) => ({
      name: (s.status ?? "draft").replace(/_/g, " "),
      value: parseInt(s.count ?? "0"),
      amount: parseFloat(s.total_amount ?? "0"),
    })), [byStatus]);

  const barData = useMemo(() =>
    (byViolationType as any[]).map((v: any) => ({
      name: (v.violation_type ?? "unknown").replace(/_/g, " ").slice(0, 18),
      count: parseInt(v.count ?? "0"),
      amount: parseFloat(v.total_amount ?? "0"),
    })), [byViolationType]);

  const lineData = useMemo(() =>
    (monthlyTrend as any[]).map((m: any) => ({
      month: m.month ?? "",
      count: parseInt(m.count ?? "0"),
      amount: parseFloat(m.total_amount ?? "0"),
    })), [monthlyTrend]);

  const kpis = [
    {
      label: "Total Calculations",
      value: totals.total_calculations ?? 0,
      icon: FileText,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Approved Penalties",
      value: totals.approved_count ?? 0,
      icon: CheckCircle,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      label: "Pending Review",
      value: totals.draft_count ?? 0,
      icon: Clock,
      color: "text-yellow-600",
      bg: "bg-yellow-50",
    },
    {
      label: "Total Penalty Value",
      value: formatNGN(parseFloat(totals.total_penalty_value ?? "0")),
      icon: DollarSign,
      color: "text-red-600",
      bg: "bg-red-50",
    },
    {
      label: "Approved Value",
      value: formatNGN(parseFloat(totals.approved_penalty_value ?? "0")),
      icon: TrendingUp,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Average Penalty",
      value: formatNGN(parseFloat(totals.avg_penalty_value ?? "0")),
      icon: Activity,
      color: "text-purple-600",
      bg: "bg-purple-50",
    },
    {
      label: "Highest Penalty",
      value: formatNGN(parseFloat(totals.max_penalty_value ?? "0")),
      icon: AlertTriangle,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
    {
      label: "Paid",
      value: totals.paid_count ?? 0,
      icon: Award,
      color: "text-teal-600",
      bg: "bg-teal-50",
    },
  ];

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Penalty Calculations Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            NDPA 2023 Section 48 — Penalty metrics, violation trends, and enforcement analytics
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Activity className="h-6 w-6 animate-pulse mr-2" />
            Loading dashboard data...
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {kpis.map(({ label, value, icon: Icon, color, bg }) => (
                <Card key={label} className="border-0 shadow-sm">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${bg}`}>
                        <Icon className={`h-5 w-5 ${color}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xl font-bold truncate">{value}</p>
                        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Charts Row 1: Monthly Trend + Status Pie */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Monthly Trend Line Chart */}
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="text-sm">Monthly Penalty Trend (12 months)</CardTitle>
                </CardHeader>
                <CardContent>
                  {lineData.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No trend data yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={lineData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={v => `${v}`} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={v => formatNGN(v)} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend />
                        <Line yAxisId="left" type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Count" />
                        <Line yAxisId="right" type="monotone" dataKey="amount" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} name="Penalty Amount" />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {/* Status Pie Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Cases by Status</CardTitle>
                </CardHeader>
                <CardContent>
                  {pieData.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No data yet</div>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={160}>
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={45}
                            outerRadius={70}
                            paddingAngle={3}
                            dataKey="value"
                          >
                            {pieData.map((entry: any, index: number) => (
                              <Cell key={entry.name} fill={STATUS_COLORS[entry.name.replace(/ /g, "_")] ?? VIOLATION_COLORS[index % VIOLATION_COLORS.length]} cursor="pointer" onClick={() => openDrill({ status: entry.name.replace(/ /g, "_"), label: `Status: ${entry.name}` })} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: any, name: string) => [v, name]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-1 mt-2">
                        {pieData.map((entry: any, i: number) => (
                          <div key={entry.name} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: STATUS_COLORS[entry.name.replace(/ /g, "_")] ?? VIOLATION_COLORS[i % VIOLATION_COLORS.length] }} />
                              <span className="capitalize">{entry.name}</span>
                            </div>
                            <span className="font-semibold">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Charts Row 2: Violation Type Bar + Top Orgs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Violation Type Bar Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Penalties by Violation Type</CardTitle>
                </CardHeader>
                <CardContent>
                  {barData.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No data yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={barData} margin={{ top: 5, right: 10, left: 0, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="count" name="Count" radius={[3, 3, 0, 0]} cursor="pointer"
                          onClick={(d: any) => openDrill({ violationType: (byViolationType as any[])[barData.findIndex((b: any) => b.name === d.name)]?.violation_type, label: `Violation: ${d.name}` })}>
                          {barData.map((_: any, index: number) => (
                            <Cell key={`cell-${index}`} fill={VIOLATION_COLORS[index % VIOLATION_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {/* Top Organisations Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Top 10 Organisations by Penalty Value</CardTitle>
                </CardHeader>
                <CardContent>
                  {(topOrgs as any[]).length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No data yet</div>
                  ) : (
                    <div className="space-y-2">
                      {(topOrgs as any[]).map((org: any, i: number) => {
                        const maxAmount = parseFloat((topOrgs as any[])[0]?.total_penalties ?? "1");
                        const pct = maxAmount > 0 ? (parseFloat(org.total_penalties ?? "0") / maxAmount) * 100 : 0;
                        return (
                          <div key={org.org_name} className="space-y-1 cursor-pointer hover:bg-muted/30 rounded p-1 -mx-1" onClick={() => openDrill({ orgName: org.org_name, label: `Org: ${org.org_name}` })}>
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground w-4 text-right">{i + 1}.</span>
                                <span className="font-medium truncate max-w-32">{org.org_name}</span>
                                <Badge className="bg-muted text-muted-foreground text-xs">{org.case_count} cases</Badge>
                              </div>
                              <span className="font-semibold text-red-600">{formatNGN(parseFloat(org.total_penalties ?? "0"))}</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-1.5">
                              <div
                                className="h-1.5 rounded-full"
                                style={{
                                  width: `${pct}%`,
                                  backgroundColor: VIOLATION_COLORS[i % VIOLATION_COLORS.length],
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Violation Type Amount Bar Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Total Penalty Amount by Violation Type</CardTitle>
              </CardHeader>
              <CardContent>
                {barData.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">No data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={barData} margin={{ top: 5, right: 10, left: 20, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => formatNGN(v)} width={70} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="amount" name="Penalty Amount" radius={[3, 3, 0, 0]}>
                        {barData.map((_: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={VIOLATION_COLORS[index % VIOLATION_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Drill-Down Dialog */}
      <Dialog open={!!drillFilter} onOpenChange={(open) => { if (!open) closeDrill(); }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4 cursor-pointer" onClick={closeDrill} />
              Drill-Down: {drillFilter?.label}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-3 items-center">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Filter by org name…" value={drillSearch}
                  onChange={e => { setDrillSearch(e.target.value); setDrillPage(1); }} />
              </div>
              {drillSearch && <Button variant="ghost" size="sm" onClick={() => setDrillSearch("")}><X className="h-4 w-4" /></Button>}
              <Badge variant="secondary">{drillData?.total ?? 0} records</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="pb-2 pr-3">Organization</th>
                    <th className="pb-2 pr-3">Violation Type</th>
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2 pr-3">Final Penalty</th>
                    <th className="pb-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(drillData?.items ?? []).map((row: any) => (
                    <tr key={row.id} className="border-b hover:bg-muted/30">
                      <td className="py-2 pr-3 font-medium">{row.org_name}</td>
                      <td className="py-2 pr-3"><Badge variant="outline" className="text-xs">{row.violation_type?.replace(/_/g, " ")}</Badge></td>
                      <td className="py-2 pr-3"><Badge className="text-xs" style={{ backgroundColor: STATUS_COLORS[row.status] ?? "#94a3b8", color: "#fff" }}>{row.status}</Badge></td>
                      <td className="py-2 pr-3 font-semibold text-red-600">{formatNGN(parseFloat(row.final_penalty ?? "0"))}</td>
                      <td className="py-2 text-xs text-muted-foreground">{row.created_at ? new Date(row.created_at).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                  {(drillData?.items ?? []).length === 0 && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No records found</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Page {drillPage} of {Math.ceil((drillData?.total ?? 0) / 20) || 1}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={drillPage === 1} onClick={() => setDrillPage(p => p - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={(drillData?.items?.length ?? 0) < 20} onClick={() => setDrillPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
