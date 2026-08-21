import { useState, type ReactElement } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Award, TrendingUp, Shield, Building2, Star, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { LineChart, Line, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const statusColor: Record<string, string> = {
  compliant: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  non_compliant: "bg-red-500/15 text-red-600 dark:text-red-400",
  under_review: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  remediation: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
};

const statusIcon: Record<string, ReactElement> = {
  compliant: <CheckCircle2 className="h-3 w-3" />,
  non_compliant: <XCircle className="h-3 w-3" />,
  under_review: <Clock className="h-3 w-3" />,
  remediation: <Clock className="h-3 w-3" />,
};

function ScoreBar({ score }: { score: number }) {
  const color = score >= 85 ? "#16a34a" : score >= 60 ? "#d97706" : "#dc2626";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 bg-muted rounded-full h-2 min-w-[60px]">
        <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(score, 100)}%`, background: color }} />
      </div>
      <span className="text-sm font-semibold tabular-nums" style={{ color }}>{score}</span>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-lg">🥇</span>;
  if (rank === 2) return <span className="text-lg">🥈</span>;
  if (rank === 3) return <span className="text-lg">🥉</span>;
  return <span className="text-sm font-bold text-muted-foreground tabular-nums w-6 text-center">{rank}</span>;
}

function Sparkline({ orgId, score }: { orgId: number; score: number }) {
  const { data = [] } = trpc.leaderboard.scoreTrend.useQuery({ orgId });
  const color = score >= 85 ? "#16a34a" : score >= 60 ? "#d97706" : "#dc2626";
  if (data.length === 0) {
    return <div className="w-24 h-8 bg-muted rounded animate-pulse" />;
  }
  return (
    <ResponsiveContainer width={96} height={32}>
      <LineChart data={data}>
        <Line
          type="monotone"
          dataKey="score"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip
          contentStyle={{ fontSize: 10, padding: "2px 6px", border: "1px solid #e5e7eb" }}
          formatter={(v: number) => [`${v}`, "Score"]}
          labelFormatter={(l: string) => l?.slice(5) ?? ""}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function LeaderboardRow({ org, expanded, onToggle }: {
  org: {
    id: number; rank: number; name: string; sector: string; country: string;
    complianceScore: number; riskScore: number; complianceStatus: string;
    certified: boolean; agentInstalled: boolean;
  };
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-border last:border-0">
      <div
        className="flex items-center gap-4 px-5 py-3 hover:bg-muted transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <div className="w-8 flex justify-center shrink-0">
          <RankBadge rank={org.rank} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground text-sm truncate">{org.name}</span>
            {org.certified && (
              <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] px-1.5 py-0 flex items-center gap-0.5">
                <Shield className="h-2.5 w-2.5" /> Certified
              </Badge>
            )}
            {org.agentInstalled && (
              <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[10px] px-1.5 py-0">Agent</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{org.sector} · {org.country}</p>
        </div>
        {/* 30-day sparkline */}
        <div className="w-24 shrink-0 hidden lg:block">
          <Sparkline orgId={org.id} score={org.complianceScore} />
        </div>
        <div className="w-40 shrink-0">
          <ScoreBar score={org.complianceScore} />
        </div>
        <div className="w-28 shrink-0 hidden sm:block">
          <Badge className={`text-[10px] px-2 py-0.5 flex items-center gap-1 w-fit ${statusColor[org.complianceStatus] ?? "bg-muted text-foreground"}`}>
            {statusIcon[org.complianceStatus]}
            {org.complianceStatus?.replace(/_/g, " ")}
          </Badge>
        </div>
        <div className="w-20 text-right shrink-0 hidden md:block">
          <span className={`text-xs font-medium ${org.riskScore > 70 ? "text-red-600" : org.riskScore > 40 ? "text-amber-600" : "text-emerald-600"}`}>
            Risk {org.riskScore}
          </span>
        </div>
        <div className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>
      {expanded && (
        <div className="px-5 pb-4 bg-muted border-t border-border">
          <div className="pt-3">
            <p className="text-xs font-semibold text-muted-foreground mb-2">30-Day Compliance Score Trend</p>
            <div className="bg-background border border-border rounded-lg p-3">
              <SparklineExpanded orgId={org.id} score={org.complianceScore} sector={org.sector} />
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="bg-background border border-border rounded p-2 text-center">
                <p className="text-xs text-muted-foreground">Compliance Score</p>
                <p className="text-lg font-bold text-foreground">{org.complianceScore}</p>
              </div>
              <div className="bg-background border border-border rounded p-2 text-center">
                <p className="text-xs text-muted-foreground">Risk Score</p>
                <p className={`text-lg font-bold ${org.riskScore > 70 ? "text-red-600" : org.riskScore > 40 ? "text-amber-600" : "text-emerald-600"}`}>{org.riskScore}</p>
              </div>
              <div className="bg-background border border-border rounded p-2 text-center">
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="text-sm font-semibold text-foreground capitalize">{org.complianceStatus?.replace(/_/g, " ")}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SparklineExpanded({ orgId, score, sector }: { orgId: number; score: number; sector: string }) {
  const { data: trendData = [] } = trpc.leaderboard.scoreTrend.useQuery({ orgId });
  const { data: sectorData = [] } = trpc.leaderboard.sectorAvgTrend.useQuery({ sector });
  const color = score >= 85 ? "#16a34a" : score >= 60 ? "#d97706" : "#dc2626";

  // Merge org trend (uses 'day' key) with sector avg (uses 'date' key) by date string
  const merged = trendData.map((d: { day: string; score: number }) => {
    const sectorPoint = sectorData.find((s: { date: string; avgScore: number }) => s.date === d.day);
    return { date: d.day, score: d.score, sectorAvg: sectorPoint?.avgScore ?? null };
  });

  if (merged.length === 0) return <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">No trend data yet</div>;

  return (
    <div>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={merged}>
          <Line type="monotone" dataKey="score" stroke={color} strokeWidth={2} dot={false} name="Organisation" />
          <Line type="monotone" dataKey="sectorAvg" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="Sector Avg" />
          <Tooltip
            contentStyle={{ fontSize: 11, padding: "4px 8px", border: "1px solid #e5e7eb" }}
            formatter={(v: number, name: string) => [`${v}`, name === "sectorAvg" ? "Sector Avg" : "Score"]}
            labelFormatter={(l: string) => l?.slice(5) ?? ""}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5" style={{ background: color }} /> This organisation</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 border-t border-dashed border-muted-foreground" /> Sector average</span>
      </div>
    </div>
  );
}

export default function ComplianceLeaderboard() {
  const [sector, setSector] = useState<string>("all");
  const [anonymise, setAnonymise] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const { data: stats } = trpc.leaderboard.stats.useQuery(
    sector === "all" ? undefined : { sector }
  );
  const { data: rows = [], isLoading } = trpc.leaderboard.list.useQuery({
    sector: sector === "all" ? undefined : sector,
    limit: 50,
    anonymise,
  });
  const recalcMutation = trpc.orchestration.triggerWorkflow.useMutation({
    onSuccess: () => {
      toast.success("Compliance recalculation triggered — scores will refresh in ~30 seconds");
      setTimeout(() => { utils.leaderboard.list.invalidate(); utils.leaderboard.stats.invalidate(); }, 30000);
    },
    onError: (e) => toast.error(`Recalculation failed: ${(e instanceof Error ? e.message : String(e))}`),
  });

  const sectors = stats?.sectors ?? [];
  const topCertified = rows.filter(r => r.certified).slice(0, 3);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Compliance Leaderboard" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Award className="h-6 w-6 text-amber-500" />
            Compliance Leaderboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Public ranking of organisations by NDSEP compliance score — updated every 15 minutes. Click any row to see the 30-day trend.
          </p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Switch id="anon" checked={anonymise} onCheckedChange={setAnonymise} />
            <Label htmlFor="anon" className="text-sm text-muted-foreground cursor-pointer">Anonymise names</Label>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => recalcMutation.mutate({ workflowType: "compliance-assessment", workflowId: `recalc-${Date.now()}`, input: { sector: sector === "all" ? "all" : sector } })}
            disabled={recalcMutation.isPending}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${recalcMutation.isPending ? "animate-spin" : ""}`} />
            {recalcMutation.isPending ? "Recalculating..." : "Recalculate Scores"}
          </Button>
          <Select value={sector} onValueChange={setSector}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All sectors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sectors</SelectItem>
              {sectors.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { icon: Building2, label: "Organisations", value: stats?.total ?? 0, color: "text-blue-600" },
          { icon: CheckCircle2, label: "Certified", value: stats?.certified ?? 0, color: "text-emerald-600" },
          { icon: TrendingUp, label: "Avg Score", value: `${stats?.avgScore ?? 0}/100`, color: "text-indigo-600" },
          { icon: Star, label: "Sectors", value: sectors.length, color: "text-amber-600" },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-background border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`h-4 w-4 ${color}`} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Top 3 podium */}
      {topCertified.length > 0 && (
        <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-500/20 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-1">
            <Star className="h-4 w-4" /> Top Certified Organisations
          </h2>
          <div className="flex gap-4 flex-wrap">
            {topCertified.map(org => (
              <div key={org.id} className="flex items-center gap-2 bg-background border border-amber-500/20 rounded-lg px-3 py-2 shadow-sm">
                <RankBadge rank={org.rank} />
                <div>
                  <p className="text-sm font-semibold text-foreground">{org.name}</p>
                  <p className="text-xs text-muted-foreground">{org.sector} · Score: {org.complianceScore}</p>
                </div>
                <Shield className="h-4 w-4 text-emerald-500 ml-1" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leaderboard table with sparklines */}
      <div className="bg-background border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">Full Rankings</span>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground hidden lg:block">30-Day Trend</span>
            <span className="text-xs text-muted-foreground">{rows.length} organisations</span>
          </div>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading rankings…</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No organisations found" description="No organisations match the current filters" />
        ) : (
          <div>
            {rows.map(org => (
              <LeaderboardRow
                key={org.id}
                org={org}
                expanded={expandedId === org.id}
                onToggle={() => setExpandedId(expandedId === org.id ? null : org.id)}
              />
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Scores are calculated by the NDSEP Compliance Engine and updated every 15 minutes.
        Organisations with a score ≥ 85 are eligible for the NDSEP Compliance Certificate.
        Click any row to view the 30-day compliance trend sparkline.
      </p>
    </div>
  );
}
