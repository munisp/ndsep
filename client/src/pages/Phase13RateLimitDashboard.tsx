import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, RefreshCw, Shield, AlertTriangle } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default function Phase13RateLimitDashboard() {
  const [hours, setHours] = useState(24);
  const [endpointFilter, setEndpointFilter] = useState("");

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.phase13.rateLimit.getStats.useQuery({ hours });
  const { data: timeline, isLoading: timelineLoading, refetch: refetchTimeline } = trpc.phase13.rateLimit.getTimeline.useQuery({ hours, endpoint: endpointFilter || undefined });
  const { data: summary } = trpc.phase13.rateLimit.getSummary.useQuery();

  const statsList = (stats as any[]) ?? [];
  const timelineList = (timeline as any[]) ?? [];
  const summaryData = summary as any;

  const handleRefresh = () => { refetchStats(); refetchTimeline(); };

  const blockRateColor = (rate: number) => rate >= 20 ? "text-red-600" : rate >= 10 ? "text-orange-600" : "text-green-600";

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-cyan-600" />
              API Rate Limit Dashboard
            </h1>
            <p className="text-muted-foreground mt-1">Monitor API rate limiting, blocked requests, and endpoint traffic</p>
          </div>
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { label: "Total Requests (24h)", value: summaryData?.total_requests_24h ?? "—", icon: <Activity className="h-4 w-4 text-blue-600" />, color: "text-blue-600" },
            { label: "Blocked Requests", value: summaryData?.total_blocked_24h ?? "—", icon: <Shield className="h-4 w-4 text-red-600" />, color: "text-red-600" },
            { label: "Monitored Endpoints", value: summaryData?.monitored_endpoints ?? "—", icon: <Activity className="h-4 w-4 text-purple-600" />, color: "text-purple-600" },
            { label: "Unique IPs", value: summaryData?.unique_ips ?? "—", icon: <AlertTriangle className="h-4 w-4 text-orange-600" />, color: "text-orange-600" },
          ].map((card) => (
            <Card key={card.label}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-1">
                  {card.icon}
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                </div>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex gap-3">
          <Select value={String(hours)} onValueChange={v => setHours(Number(v))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 1 Hour</SelectItem>
              <SelectItem value="6">Last 6 Hours</SelectItem>
              <SelectItem value="24">Last 24 Hours</SelectItem>
              <SelectItem value="48">Last 48 Hours</SelectItem>
              <SelectItem value="168">Last 7 Days</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Filter by endpoint (e.g. /api/trpc)..." className="flex-1" value={endpointFilter} onChange={e => setEndpointFilter(e.target.value)} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle>Top Endpoints by Traffic</CardTitle></CardHeader>
            <CardContent>
              {statsLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading stats...</div>
              ) : statsList.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No rate limit data in selected window</div>
              ) : (
                <div className="space-y-3">
                  {statsList.map((s: any, i: number) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-mono text-xs truncate">{s.endpoint}</span>
                          <span className={`text-xs font-semibold ${blockRateColor(Number(s.block_rate ?? 0))}`}>
                            {Number(s.block_rate ?? 0).toFixed(1)}% blocked
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${Math.min(100, (Number(s.total_requests) / (Number(statsList[0]?.total_requests) || 1)) * 100)}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
                          <span>{Number(s.total_requests).toLocaleString()} requests</span>
                          <span className="text-red-600">{Number(s.total_blocked ?? 0).toLocaleString()} blocked</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Request Timeline (Hourly)</CardTitle></CardHeader>
            <CardContent>
              {timelineLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading timeline...</div>
              ) : timelineList.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No timeline data available</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-1 px-2">Hour</th>
                        <th className="text-right py-1 px-2">Requests</th>
                        <th className="text-right py-1 px-2">Blocked</th>
                        <th className="text-right py-1 px-2">Block %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timelineList.slice(-24).map((t: any, i: number) => {
                        const blockPct = t.requests > 0 ? ((t.blocked / t.requests) * 100).toFixed(1) : "0.0";
                        return (
                          <tr key={i} className="border-b hover:bg-muted/50">
                            <td className="py-1 px-2 font-mono">{t.hour ? new Date(t.hour).toLocaleString("en-NG", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }) : "—"}</td>
                            <td className="py-1 px-2 text-right">{Number(t.requests ?? 0).toLocaleString()}</td>
                            <td className="py-1 px-2 text-right text-red-600">{Number(t.blocked ?? 0).toLocaleString()}</td>
                            <td className={`py-1 px-2 text-right font-semibold ${blockRateColor(Number(blockPct))}`}>{blockPct}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
