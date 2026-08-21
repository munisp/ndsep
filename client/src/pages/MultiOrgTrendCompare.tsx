import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { TrendingUp, Plus, X, BarChart3 } from "lucide-react";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function MultiOrgTrendCompare() {
  const [selectedOrgIds, setSelectedOrgIds] = useState<number[]>([]);
  const [days, setDays] = useState(30);
  const [pendingOrgId, setPendingOrgId] = useState<string>("");

  const { data: allOrgs } = trpc.complianceTrend.listOrgs.useQuery();

  const { data: compareData, isLoading } = trpc.trendCompare.compare.useQuery(
    { orgIds: selectedOrgIds, days },
    { enabled: selectedOrgIds.length >= 2 }
  );

  // Build chart data: merge all org series by date
  const chartData = useMemo(() => {
    if (!compareData) return [];
    const dateMap: Record<string, Record<string, number>> = {};
    for (const org of compareData) {
      for (const point of org.data) {
        if (!dateMap[point.date]) dateMap[point.date] = {};
        dateMap[point.date][`org_${org.orgId}`] = point.score;
      }
    }
    return Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, scores]) => ({ date: date.slice(5), ...scores }));
  }, [compareData]);

  const addOrg = () => {
    const id = parseInt(pendingOrgId);
    if (!id || selectedOrgIds.includes(id) || selectedOrgIds.length >= 5) return;
    setSelectedOrgIds((prev) => [...prev, id]);
    setPendingOrgId("");
  };

  const removeOrg = (id: number) => setSelectedOrgIds((prev) => prev.filter((x) => x !== id));

  const getOrgName = (id: number) => allOrgs?.find((o) => o.id === id)?.name ?? `Org ${id}`;

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-blue-600" />
              Multi-Organisation Trend Compare
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Compare compliance score trends across up to 5 organisations side-by-side
            </p>
          </div>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="14">14 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="60">60 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Org Selector */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select Organisations to Compare</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap mb-3">
              {selectedOrgIds.map((id, i) => (
                <Badge key={id} style={{ backgroundColor: COLORS[i] + "20", color: COLORS[i], borderColor: COLORS[i] }} className="border gap-1 px-3 py-1">
                  <span className="w-2 h-2 rounded-full inline-block mr-1" style={{ backgroundColor: COLORS[i] }} />
                  {getOrgName(id)}
                  <button aria-label="Remove" onClick={() => removeOrg(id)} className="ml-1 hover:opacity-70">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {selectedOrgIds.length === 0 && (
                <span className="text-sm text-muted-foreground">No organisations selected. Add at least 2 to compare.</span>
              )}
            </div>
            <div className="flex gap-2">
              <Select value={pendingOrgId} onValueChange={setPendingOrgId}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select an organisation…" />
                </SelectTrigger>
                <SelectContent>
                  {allOrgs
                    ?.filter((o) => !selectedOrgIds.includes(o.id))
                    .map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>
                        {o.name} — {o.sector}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button onClick={addOrg} disabled={!pendingOrgId || selectedOrgIds.length >= 5} size="sm" className="gap-1">
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
            {selectedOrgIds.length >= 5 && (
              <p className="text-xs text-muted-foreground mt-2">Maximum 5 organisations can be compared at once.</p>
            )}
          </CardContent>
        </Card>

        {/* Chart */}
        {selectedOrgIds.length >= 2 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                {days}-Day Compliance Score Comparison
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground">Loading chart data…</div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        const orgId = parseInt(name.replace("org_", ""));
                        return [`${value.toFixed(1)}%`, getOrgName(orgId)];
                      }}
                    />
                    <Legend
                      formatter={(value: string) => {
                        const orgId = parseInt(value.replace("org_", ""));
                        return getOrgName(orgId);
                      }}
                    />
                    <ReferenceLine y={80} stroke="#10b981" strokeDasharray="4 4" label={{ value: "Compliant threshold (80%)", position: "insideTopLeft", fontSize: 10 }} />
                    {selectedOrgIds.map((id, i) => (
                      <Line
                        key={id}
                        type="monotone"
                        dataKey={`org_${id}`}
                        stroke={COLORS[i]}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>Select at least 2 organisations above to see the comparison chart.</p>
            </CardContent>
          </Card>
        )}

        {/* Summary Table */}
        {compareData && compareData.length >= 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-medium">Organisation</th>
                      <th className="text-left py-2 pr-4 font-medium">Sector</th>
                      <th className="text-right py-2 pr-4 font-medium">Latest Score</th>
                      <th className="text-right py-2 pr-4 font-medium">Period Avg</th>
                      <th className="text-right py-2 pr-4 font-medium">Min</th>
                      <th className="text-right py-2 font-medium">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareData.map((org, i) => {
                      const scores = org.data.map((d) => d.score);
                      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
                      const min = scores.length ? Math.min(...scores) : 0;
                      const max = scores.length ? Math.max(...scores) : 0;
                      const latest = scores[scores.length - 1] ?? 0;
                      return (
                        <tr key={org.orgId} className="border-b last:border-0">
                          <td className="py-2 pr-4">
                            <span className="w-3 h-3 rounded-full inline-block mr-2" style={{ backgroundColor: COLORS[i] }} />
                            {org.orgName}
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground capitalize">{org.sector}</td>
                          <td className="py-2 pr-4 text-right font-semibold">{latest.toFixed(1)}%</td>
                          <td className="py-2 pr-4 text-right">{avg.toFixed(1)}%</td>
                          <td className="py-2 pr-4 text-right text-red-600">{min.toFixed(1)}%</td>
                          <td className="py-2 text-right text-green-600">{max.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
