import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Building2, Scale, Gavel, Wrench } from "lucide-react";

const SECTOR_COLORS: Record<string, string> = {
  Banking: "#3b82f6",
  Fintech: "#8b5cf6",
  Telecom: "#10b981",
  Healthcare: "#f59e0b",
  Government: "#ef4444",
  Energy: "#f97316",
  Insurance: "#06b6d4",
  Unknown: "#6b7280",
};

function getColor(sector: string): string {
  for (const [key, color] of Object.entries(SECTOR_COLORS)) {
    if (sector.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return "#6b7280";
}

function StatCard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <Card className="border border-border/50">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className="text-2xl font-bold" style={{ color }}>{value}</p>
            {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: color + "20" }}>
            <Icon className="h-4 w-4" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <span className="font-medium">{typeof p.value === "number" && p.value > 1000 ? p.value.toLocaleString() : p.value}</span>
        </p>
      ))}
    </div>
  );
};

export default function SectorBenchmark() {
  const { data: rawData, isLoading } = trpc.sectors.benchmark.useQuery();
  const benchmarks = (rawData as any[]) ?? [];

  const totalOrgs = benchmarks.reduce((s, b) => s + b.orgCount, 0);
  const totalPenalties = benchmarks.reduce((s, b) => s + b.totalPenaltyAmount, 0);
  const totalViolations = benchmarks.reduce((s, b) => s + b.violationCount, 0);
  const avgScore = benchmarks.length
    ? Math.round(benchmarks.reduce((s, b) => s + b.avgComplianceScore, 0) / benchmarks.length)
    : 0;

  const complianceData = benchmarks.map(b => ({
    sector: b.sector,
    "Avg Score": b.avgComplianceScore,
    "Certified %": b.orgCount > 0 ? Math.round((b.certifiedCount / b.orgCount) * 100) : 0,
    fill: getColor(b.sector),
  }));

  const penaltyData = benchmarks.map(b => ({
    sector: b.sector,
    "Penalties (₦M)": Math.round(b.totalPenaltyAmount / 1_000_000),
    "Penalty Count": b.penaltyCount,
    fill: getColor(b.sector),
  }));

  const violationData = benchmarks.map(b => ({
    sector: b.sector,
    Violations: b.violationCount,
    "Open Cases": b.openEnforcementCases,
    "Avg Remediation (days)": b.avgRemediationDays,
    fill: getColor(b.sector),
  }));

  const radarData = benchmarks.map(b => ({
    sector: b.sector.length > 10 ? b.sector.slice(0, 10) + "…" : b.sector,
    Compliance: b.avgComplianceScore,
    Certified: b.orgCount > 0 ? Math.round((b.certifiedCount / b.orgCount) * 100) : 0,
    Violations: Math.min(100, b.violationCount),
    Penalties: Math.min(100, Math.round(b.totalPenaltyAmount / 1_000_000)),
  }));

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Sector Compliance Benchmark</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Cross-sector comparison of compliance scores, penalties, violations, and enforcement activity
            </p>
          </div>
          <Badge variant="outline" className="text-xs">
            {benchmarks.length} sectors · {totalOrgs} organisations
          </Badge>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Building2} label="Total Organisations" value={totalOrgs.toLocaleString()} color="#3b82f6" />
          <StatCard icon={CheckCircle2} label="Platform Avg Score" value={`${avgScore}%`} sub="Across all sectors" color="#10b981" />
          <StatCard icon={Scale} label="Total Penalties" value={`₦${(totalPenalties / 1_000_000).toFixed(1)}M`} sub="Year-to-date" color="#f59e0b" />
          <StatCard icon={AlertTriangle} label="Total Violations" value={totalViolations.toLocaleString()} sub="All sectors" color="#ef4444" />
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            Loading benchmark data…
          </div>
        )}

        {!isLoading && benchmarks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Building2 className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">No sector data available yet. Seed organisations to populate benchmarks.</p>
          </div>
        )}

        {!isLoading && benchmarks.length > 0 && (
          <>
            {/* Compliance Score Chart */}
            <Card className="border border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  Average Compliance Score by Sector
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={complianceData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis dataKey="sector" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Avg Score" radius={[4, 4, 0, 0]}>
                      {complianceData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                    <Bar dataKey="Certified %" fill="#10b981" radius={[4, 4, 0, 0]} opacity={0.7} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Penalties Chart */}
            <Card className="border border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Scale className="h-4 w-4 text-amber-400" />
                  Financial Penalties by Sector (₦ Millions)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={penaltyData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis dataKey="sector" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Penalties (₦M)" radius={[4, 4, 0, 0]}>
                      {penaltyData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                    <Bar dataKey="Penalty Count" fill="#f59e0b" radius={[4, 4, 0, 0]} opacity={0.7} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Violations & Enforcement Chart */}
            <Card className="border border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Gavel className="h-4 w-4 text-red-400" />
                  Violations & Enforcement Activity by Sector
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={violationData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis dataKey="sector" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Violations" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Open Cases" fill="#f97316" radius={[4, 4, 0, 0]} opacity={0.8} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Remediation Days Chart */}
            <Card className="border border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-blue-400" />
                  Average Remediation Time by Sector (Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={violationData.filter(d => d["Avg Remediation (days)"] > 0)}
                    layout="vertical"
                    margin={{ top: 4, right: 24, left: 60, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis type="number" tick={{ fontSize: 11 }} unit=" d" />
                    <YAxis dataKey="sector" type="category" tick={{ fontSize: 11 }} width={60} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="Avg Remediation (days)" radius={[0, 4, 4, 0]}>
                      {violationData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Sector Table */}
            <Card className="border border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Sector Summary Table</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/50 bg-muted/30">
                        <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Sector</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Orgs</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Avg Score</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Certified</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Penalties (₦)</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Violations</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Open Cases</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Avg Rem. (d)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmarks.map((b, i) => (
                        <tr key={i} className="border-b border-border/30 hover:bg-accent/30 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full" style={{ background: getColor(b.sector) }} />
                              <span className="font-medium">{b.sector}</span>
                            </div>
                          </td>
                          <td className="text-right px-4 py-2.5">{b.orgCount}</td>
                          <td className="text-right px-4 py-2.5">
                            <span className={`font-semibold ${b.avgComplianceScore >= 70 ? "text-emerald-400" : b.avgComplianceScore >= 50 ? "text-amber-400" : "text-red-400"}`}>
                              {b.avgComplianceScore}%
                            </span>
                          </td>
                          <td className="text-right px-4 py-2.5">
                            {b.certifiedCount} / {b.orgCount}
                          </td>
                          <td className="text-right px-4 py-2.5">
                            {b.totalPenaltyAmount > 0 ? `₦${(b.totalPenaltyAmount / 1_000_000).toFixed(2)}M` : "—"}
                          </td>
                          <td className="text-right px-4 py-2.5">{b.violationCount}</td>
                          <td className="text-right px-4 py-2.5">
                            {b.openEnforcementCases > 0 ? (
                              <span className="text-orange-400 font-semibold">{b.openEnforcementCases}</span>
                            ) : "0"}
                          </td>
                          <td className="text-right px-4 py-2.5">
                            {b.avgRemediationDays > 0 ? `${b.avgRemediationDays}d` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
