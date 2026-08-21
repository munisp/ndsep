/**
 * Sector Benchmark Dashboard
 * Compare compliance scores across sectors with automated benchmarking
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart2, TrendingUp, Award, RefreshCw } from "lucide-react";

const SECTORS = ["fintech", "healthcare", "telecom", "energy", "insurance", "ecommerce", "government", "education"];

export default function SectorBenchmarkDashboard() {
  const [period, setPeriod] = useState("30");

  const { data: benchmarks, isLoading, refetch } = trpc.sectorBenchmarkP11.getSectorAverages.useQuery();
  const { data: leaders } = trpc.sectorBenchmarkP11.getLeaderboard.useQuery({});

  const benchData = (benchmarks as any) ?? [];
  const leadersData = (leaders as any) ?? [];

  const barData = benchData.map((b: any) => ({
    sector: b.sector,
    avg_score: Math.round(b.avg_score ?? 0),
    max_score: Math.round(b.max_score ?? 0),
    min_score: Math.round(b.min_score ?? 0),
    org_count: b.org_count ?? 0,
  }));

  const radarData = SECTORS.map(s => {
    const found = benchData.find((b: any) => b.sector === s);
    return { sector: s.charAt(0).toUpperCase() + s.slice(1), score: Math.round(found?.avg_score ?? 0) };
  });

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart2 className="w-6 h-6 text-indigo-600" />
              Sector Benchmark Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Automated compliance benchmarking across all regulated sectors</p>
          </div>
          <div className="flex gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => refetch()} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {benchData.slice(0, 4).map((b: any) => (
            <div key={b.sector} className="border rounded-lg p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">{b.sector}</div>
              <div className="text-3xl font-bold mt-1">{Math.round(b.avg_score ?? 0)}<span className="text-sm font-normal text-muted-foreground">/100</span></div>
              <div className="text-xs text-muted-foreground mt-1">{b.org_count} organisations</div>
              <Badge className={b.avg_score >= 75 ? "bg-green-500/15 text-green-600 dark:text-green-400 mt-2" : b.avg_score >= 50 ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 mt-2" : "bg-red-500/15 text-red-600 dark:text-red-400 mt-2"}>
                {b.avg_score >= 75 ? "Compliant" : b.avg_score >= 50 ? "At Risk" : "Non-Compliant"}
              </Badge>
            </div>
          ))}
        </div>

        {/* Bar chart */}
        <div className="border rounded-lg p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4" />Sector Compliance Scores (Avg / Max / Min)</h2>
          {isLoading ? <div className="h-64 flex items-center justify-center text-muted-foreground">Loading...</div> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="sector" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar dataKey="avg_score" fill="#6366f1" name="Average" />
                <Bar dataKey="max_score" fill="#22c55e" name="Maximum" />
                <Bar dataKey="min_score" fill="#ef4444" name="Minimum" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Radar chart */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border rounded-lg p-4">
            <h2 className="font-semibold mb-4">Sector Compliance Radar</h2>
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="sector" tick={{ fontSize: 11 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} />
                <Radar name="Avg Score" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Sector leaders */}
          <div className="border rounded-lg p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2"><Award className="w-4 h-4 text-yellow-500" />Sector Leaders</h2>
            <div className="space-y-3">
              {leadersData.length === 0 ? (
                <p className="text-muted-foreground text-sm">No data available</p>
              ) : leadersData.map((l: any, i: number) => (
                <div key={l.org_id} className="flex items-center justify-between p-2 rounded bg-muted/30">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-muted-foreground">#{i + 1}</span>
                    <div>
                      <div className="font-medium text-sm">{l.org_name}</div>
                      <div className="text-xs text-muted-foreground capitalize">{l.sector}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-green-600">{Math.round(l.score)}</div>
                    <div className="text-xs text-muted-foreground">score</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
