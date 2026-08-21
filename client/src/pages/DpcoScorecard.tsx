import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Trophy, TrendingUp, TrendingDown, Minus, Search, Download,
  AlertTriangle, CheckCircle, XCircle, BarChart3, Users, FileText, Shield
} from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const TIER_COLORS: Record<string, string> = {
  platinum: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  gold:     "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  silver:   "bg-muted text-foreground border-border",
  bronze:   "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  watch:    "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
};

const TIER_LABELS: Record<string, string> = {
  platinum: "Platinum",
  gold:     "Gold",
  silver:   "Silver",
  bronze:   "Bronze",
  watch:    "Under Review",
};

function scoreTier(score: number): string {
  if (score >= 90) return "platinum";
  if (score >= 80) return "gold";
  if (score >= 65) return "silver";
  if (score >= 50) return "bronze";
  return "watch";
}

function TrendIcon({ trend }: { trend: number }) {
  if (trend > 2) return <TrendingUp className="w-4 h-4 text-green-600" />;
  if (trend < -2) return <TrendingDown className="w-4 h-4 text-red-600" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-2xl">🥇</span>;
  if (rank === 2) return <span className="text-2xl">🥈</span>;
  if (rank === 3) return <span className="text-2xl">🥉</span>;
  return <span className="text-sm font-bold text-muted-foreground w-8 text-center">#{rank}</span>;
}

export default function DpcoScorecard() {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [sortBy, setSortBy] = useState("score");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const { data, isLoading } = trpc.dpco.listOrganisations.useQuery({
    status: "active",
    limit: 200,
  });

  const scorecardRows = useMemo(() => {
    if (!data?.rows) return [];
    return (data.rows as any[]).map((d: any, idx: number) => {
      const clientCount   = d.client_count ?? 0;
      const carRate       = d.car_submission_rate ?? 0;
      const slaBreachRate = d.sla_breach_rate ?? 0;
      const avgScore      = d.avg_client_score ?? 0;
      const trend         = d.score_trend ?? 0;
      const composite     = Math.round(
        avgScore * 0.4 + carRate * 0.3 + (100 - slaBreachRate) * 0.2 + Math.min(clientCount, 50) * 0.1 * 2
      );
      return {
        id: d.id,
        name: d.name,
        licenceNumber: d.licence_number,
        state: d.state,
        clientCount,
        carRate,
        slaBreachRate,
        avgScore,
        trend,
        composite,
        tier: scoreTier(composite),
        licenceExpiry: d.licence_expiry,
        status: d.status,
      };
    });
  }, [data]);

  const filtered = useMemo(() => {
    let rows = scorecardRows;
    if (search) rows = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || r.licenceNumber?.toLowerCase().includes(search.toLowerCase()));
    if (tierFilter !== "all") rows = rows.filter(r => r.tier === tierFilter);
    rows = [...rows].sort((a: any, b: any) => {
      if (sortBy === "score")    return b.composite - a.composite;
      if (sortBy === "clients")  return b.clientCount - a.clientCount;
      if (sortBy === "car_rate") return b.carRate - a.carRate;
      if (sortBy === "sla")      return a.slaBreachRate - b.slaBreachRate;
      if (sortBy === "trend")    return b.trend - a.trend;
      return b.composite - a.composite;
    });
    return rows;
  }, [scorecardRows, search, tierFilter, sortBy]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  // Summary stats
  const platinum = scorecardRows.filter(r => r.tier === "platinum").length;
  const gold     = scorecardRows.filter(r => r.tier === "gold").length;
  const watch    = scorecardRows.filter(r => r.tier === "watch").length;
  const avgComposite = scorecardRows.length
    ? Math.round(scorecardRows.reduce((s, r) => s + r.composite, 0) / scorecardRows.length)
    : 0;

  function exportCSV() {
    const header = "Rank,Name,Licence,State,Composite Score,Tier,Clients,CAR Rate (%),SLA Breach Rate (%),Avg Client Score,Trend\n";
    const rows = (filtered as any[]).map((r: any, i: number) =>
      `${i + 1},"${r.name}",${r.licenceNumber ?? ""},${r.state ?? ""},${r.composite},${TIER_LABELS[r.tier]},${r.clientCount},${r.carRate},${r.slaBreachRate},${r.avgScore},${r.trend > 0 ? "+" : ""}${r.trend}`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ndsep-dpco-scorecard-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Scorecard exported as CSV");
  }

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Dpco Scorecard" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-600" />
            DPCO Performance Scorecard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            NDPC league table — composite ranking of all licensed Data Protection Compliance Organisations
          </p>
        </div>
        <Button variant="outline" onClick={exportCSV} className="gap-2">
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-purple-600" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Platinum DPCOs</span>
            </div>
            <div className="text-3xl font-bold text-purple-700">{platinum}</div>
            <div className="text-xs text-muted-foreground">Score ≥ 90</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="w-4 h-4 text-yellow-600" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Gold DPCOs</span>
            </div>
            <div className="text-3xl font-bold text-yellow-700">{gold}</div>
            <div className="text-xs text-muted-foreground">Score 80–89</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Under Review</span>
            </div>
            <div className="text-3xl font-bold text-red-700">{watch}</div>
            <div className="text-xs text-muted-foreground">Score &lt; 50</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Sector Average</span>
            </div>
            <div className="text-3xl font-bold text-blue-700">{avgComposite}</div>
            <div className="text-xs text-muted-foreground">Composite score</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search DPCO name or licence number..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={tierFilter} onValueChange={v => { setTierFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All tiers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="platinum">Platinum</SelectItem>
            <SelectItem value="gold">Gold</SelectItem>
            <SelectItem value="silver">Silver</SelectItem>
            <SelectItem value="bronze">Bronze</SelectItem>
            <SelectItem value="watch">Under Review</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="score">Composite Score</SelectItem>
            <SelectItem value="clients">Client Count</SelectItem>
            <SelectItem value="car_rate">CAR Submission Rate</SelectItem>
            <SelectItem value="sla">SLA Compliance</SelectItem>
            <SelectItem value="trend">Score Trend</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* League Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {filtered.length} DPCOs — Page {page} of {totalPages}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading scorecard data...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground w-12">Rank</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">DPCO Name</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tier</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Score</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Clients</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">CAR Rate</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">SLA Breach</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Avg Client Score</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginated.map((row, i) => {
                    const globalRank = (page - 1) * PAGE_SIZE + i + 1;
                    return (
                      <tr key={row.id} className="hover:bg-muted transition-colors">
                        <td className="px-4 py-3">
                          <RankBadge rank={globalRank} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{row.name}</div>
                          <div className="text-xs text-muted-foreground">{row.licenceNumber} · {row.state}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs ${TIER_COLORS[row.tier]}`}>
                            {TIER_LABELS[row.tier]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Progress value={row.composite} className="w-16 h-1.5" />
                            <span className="font-bold text-foreground w-8">{row.composite}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Users className="w-3 h-3 text-muted-foreground" />
                            <span>{row.clientCount}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={row.carRate >= 90 ? "text-green-700 font-medium" : row.carRate >= 70 ? "text-yellow-700" : "text-red-700"}>
                            {row.carRate}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={row.slaBreachRate <= 5 ? "text-green-700 font-medium" : row.slaBreachRate <= 15 ? "text-yellow-700" : "text-red-700"}>
                            {row.slaBreachRate}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Progress value={row.avgScore} className="w-16 h-1.5" />
                            <span className="w-8">{row.avgScore}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <TrendIcon trend={row.trend} />
                            <span className={`text-xs ${row.trend > 0 ? "text-green-600" : row.trend < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                              {row.trend > 0 ? "+" : ""}{row.trend}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            Next
          </Button>
        </div>
      )}

      {/* Scoring Methodology */}
      <Card className="bg-blue-50 border-blue-500/20">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <BarChart3 className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-blue-900 mb-1">Composite Score Methodology</div>
              <div className="text-sm text-blue-800 grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                <div className="bg-background rounded p-2 border border-blue-100">
                  <div className="font-bold">40%</div>
                  <div className="text-xs">Average client NDPA compliance score</div>
                </div>
                <div className="bg-background rounded p-2 border border-blue-100">
                  <div className="font-bold">30%</div>
                  <div className="text-xs">CAR submission rate (on-time filing)</div>
                </div>
                <div className="bg-background rounded p-2 border border-blue-100">
                  <div className="font-bold">20%</div>
                  <div className="text-xs">SLA compliance (72h NDPC notification)</div>
                </div>
                <div className="bg-background rounded p-2 border border-blue-100">
                  <div className="font-bold">10%</div>
                  <div className="text-xs">Active client portfolio size (capped at 50)</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
