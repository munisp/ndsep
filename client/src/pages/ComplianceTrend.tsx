import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  ComposedChart,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  ArrowLeft,
  Award,
  Activity,
  Calendar,
  Target,
} from "lucide-react";

const SECTOR_COLORS: Record<string, string> = {
  banking: "#3b82f6",
  telecom: "#8b5cf6",
  healthcare: "#10b981",
  energy: "#f59e0b",
  insurance: "#ec4899",
  fintech: "#06b6d4",
};

const SECTOR_LABELS: Record<string, string> = {
  banking: "Banking",
  telecom: "Telecom",
  healthcare: "Healthcare",
  energy: "Energy",
  insurance: "Insurance",
  fintech: "FinTech",
};

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  color = "text-foreground",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          <Icon className={`h-8 w-8 opacity-20 ${color}`} />
        </div>
      </CardContent>
    </Card>
  );
}

// Custom dot to highlight anomaly points
const AnomalyDot = (props: any) => {
  const { cx, cy, payload, anomalyDates } = props;
  if (!anomalyDates?.has(payload.recorded_at)) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill="#ef4444"
      stroke="#fff"
      strokeWidth={2}
    />
  );
};

export default function ComplianceTrend() {
  const params = useParams<{ orgId?: string }>();
  const [, navigate] = useLocation();
  const [selectedOrgId, setSelectedOrgId] = useState<number>(
    params.orgId ? parseInt(params.orgId) : 1
  );
  const [days, setDays] = useState<number>(90);

  const { data: orgsData } = trpc.complianceTrend.listOrgs.useQuery();
  const { data: trendData, isLoading } = trpc.complianceTrend.getOrgTrend.useQuery(
    { orgId: selectedOrgId, days },
    { staleTime: 2 * 60 * 1000 }
  );

  // Group orgs by sector for the selector
  const orgsBySector = useMemo(() => {
    if (!orgsData) return {};
    return orgsData.reduce(
      (acc, org) => {
        if (!acc[org.sector]) acc[org.sector] = [];
        acc[org.sector].push(org);
        return acc;
      },
      {} as Record<string, typeof orgsData>
    );
  }, [orgsData]);

  // Merge org history + sector benchmark into a single chart dataset
  const chartData = useMemo(() => {
    if (!trendData) return [];
    const benchmarkMap = new Map(
      trendData.sectorBenchmark.map((b) => [b.recorded_at, Number(b.score)])
    );
    return trendData.history.map((h) => ({
      recorded_at: h.recorded_at,
      orgScore: Number(h.score),
      sectorAvg: benchmarkMap.get(h.recorded_at) ?? null,
    }));
  }, [trendData]);

  const anomalyDates = useMemo(
    () => new Set(trendData?.anomalies.map((a) => a.recorded_at) ?? []),
    [trendData]
  );

  const kpi = trendData?.kpi;
  const org = trendData?.org;
  const sectorColor = org ? (SECTOR_COLORS[org.sector] ?? "#94a3b8") : "#94a3b8";
  const trendIcon =
    (kpi?.delta ?? 0) > 2 ? TrendingUp : (kpi?.delta ?? 0) < -2 ? TrendingDown : Minus;
  const TrendIcon = trendIcon;
  const trendColor =
    (kpi?.delta ?? 0) > 2 ? "text-green-500" : (kpi?.delta ?? 0) < -2 ? "text-red-500" : "text-muted-foreground";

  return (
    <>
      <div className="p-6 space-y-6">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/my-dashboard" }, { label: "Compliance Trend" }]} />
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/my-dashboard")}
              className="shrink-0"
              aria-label="Go back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Compliance Trend Analysis</h1>
              <p className="text-sm text-muted-foreground">
                90-day compliance score history with sector benchmark and anomaly detection
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Org selector */}
            <Select
              value={String(selectedOrgId)}
              onValueChange={(v) => {
                setSelectedOrgId(parseInt(v));
                navigate(`/trends/${v}`);
              }}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select organisation" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(orgsBySector).map(([sector, orgs]) => (
                  <SelectGroup key={sector}>
                    <SelectLabel className="capitalize">{SECTOR_LABELS[sector] ?? sector}</SelectLabel>
                    {orgs.map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>

            {/* Days selector */}
            <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Org badge */}
        {org && (
          <div className="flex items-center gap-3">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: sectorColor }}
            />
            <span className="font-semibold text-lg">{org.name}</span>
            <Badge
              variant="outline"
              className="capitalize"
              style={{ borderColor: sectorColor, color: sectorColor }}
            >
              {SECTOR_LABELS[org.sector] ?? org.sector}
            </Badge>
            {anomalyDates.size > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                {anomalyDates.size} anomal{anomalyDates.size === 1 ? "y" : "ies"} detected
              </Badge>
            )}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Current Score"
            value={`${kpi?.currentScore?.toFixed(1) ?? "—"}%`}
            sub="Latest recorded"
            icon={Activity}
            color={
              (kpi?.currentScore ?? 0) >= 85
                ? "text-green-500"
                : (kpi?.currentScore ?? 0) >= 70
                ? "text-yellow-500"
                : "text-red-500"
            }
          />
          <KpiCard
            label={`${days}-Day Delta`}
            value={`${(kpi?.delta ?? 0) > 0 ? "+" : ""}${kpi?.delta?.toFixed(1) ?? "—"}%`}
            sub="vs. start of period"
            icon={TrendIcon}
            color={trendColor}
          />
          <KpiCard
            label="Best Score"
            value={`${kpi?.bestScore?.toFixed(1) ?? "—"}%`}
            sub={kpi?.bestDay ? new Date(String(kpi.bestDay)).toLocaleDateString() : undefined}
            icon={Award}
            color="text-green-500"
          />
          <KpiCard
            label="Worst Score"
            value={`${kpi?.worstScore?.toFixed(1) ?? "—"}%`}
            sub={kpi?.worstDay ? new Date(String(kpi.worstDay)).toLocaleDateString() : undefined}
            icon={Target}
            color="text-red-500"
          />
        </div>

        {/* Main Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Compliance Score — {days}-Day History
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-72 bg-muted animate-pulse rounded" />
            ) : chartData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">
                No data available for this organisation
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis
                    dataKey="recorded_at"
                    tickFormatter={(v) =>
                      new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                    }
                    tick={{ fontSize: 11 }}
                    interval={Math.floor(chartData.length / 6)}
                  />
                  <YAxis
                    domain={[40, 100]}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                    formatter={(value: number, name: string) => [
                      `${Number(value).toFixed(1)}%`,
                      name === "orgScore" ? org?.name ?? "Org" : "Sector Avg",
                    ]}
                    labelFormatter={(label: string) =>
                      label ? new Date(label).toLocaleDateString() : ""
                    }
                  />
                  <Legend
                    formatter={(value) =>
                      value === "orgScore" ? org?.name ?? "Organisation" : "Sector Average"
                    }
                  />
                  {/* Certificate eligibility threshold */}
                  <ReferenceLine
                    y={85}
                    stroke="#22c55e"
                    strokeDasharray="4 4"
                    label={{ value: "Certificate threshold (85%)", position: "insideTopRight", fontSize: 10, fill: "#22c55e" }}
                  />
                  {/* Sector benchmark line */}
                  <Line
                    type="monotone"
                    dataKey="sectorAvg"
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    connectNulls
                  />
                  {/* Org score line with anomaly dots */}
                  <Line
                    type="monotone"
                    dataKey="orgScore"
                    stroke={sectorColor}
                    strokeWidth={2}
                    dot={(props) => (
                      <AnomalyDot {...props} anomalyDates={anomalyDates} />
                    )}
                    activeDot={{ r: 4, fill: sectorColor }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Anomaly list */}
        {anomalyDates.size > 0 && trendData && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Detected Anomalies
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {trendData.anomalies.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded-lg border border-destructive/20 bg-destructive/5"
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-destructive" />
                      <span className="text-sm font-medium">
                        {new Date(a.recorded_at).toLocaleDateString(undefined, {
                          weekday: "long",
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                    <Badge variant="destructive">{Number(a.score).toFixed(1)}%</Badge>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Anomalies are data points that deviate more than 2 standard deviations from the
                rolling 10-day mean, indicating unusual compliance score changes.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
