import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BarChart3, TrendingUp, Download, Activity } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default function Phase13AdvancedAnalytics() {
  const [metric, setMetric] = useState("compliance_score");
  const [dimension, setDimension] = useState("sector");

  const { data: summary } = trpc.phase13.advancedAnalytics.getSummary.useQuery();
  const { data: snapshots, isLoading } = trpc.phase13.advancedAnalytics.getSnapshots.useQuery({ metric, dimension });
  const exportReport = trpc.phase13.advancedAnalytics.exportReport.useMutation({
    onSuccess: () => toast.success("Report exported successfully"),
    onError: () => toast.error("Export failed"),
  });

  const snapshotList = (snapshots as any[]) ?? [];
  const summaryData = summary as any;

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-blue-600" />
              Advanced Analytics
            </h1>
            <p className="text-muted-foreground mt-1">Deep-dive compliance metrics and trend analysis</p>
          </div>
          <Button onClick={() => exportReport.mutate({ format: "csv", metrics: [metric] })} disabled={exportReport.isPending}>
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { label: "Avg Compliance Score", value: summaryData?.avgScore ?? "—", color: "text-green-600" },
            { label: "Total Organizations", value: summaryData?.totalOrgs ?? "—", color: "text-blue-600" },
            { label: "High Risk Entities", value: summaryData?.highRisk ?? "—", color: "text-red-600" },
            { label: "Snapshots Captured", value: summaryData?.totalSnapshots ?? "—", color: "text-purple-600" },
          ].map((card) => (
            <Card key={card.label}>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle>Analytics Filters</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium mb-1 block">Metric</label>
                <Select value={metric} onValueChange={setMetric}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="compliance_score">Compliance Score</SelectItem>
                    <SelectItem value="breach_count">Breach Count</SelectItem>
                    <SelectItem value="dsar_response_time">DSAR Response Time</SelectItem>
                    <SelectItem value="penalty_amount">Penalty Amount</SelectItem>
                    <SelectItem value="risk_score">Risk Score</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="text-sm font-medium mb-1 block">Dimension</label>
                <Select value={dimension} onValueChange={setDimension}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sector">Sector</SelectItem>
                    <SelectItem value="region">Region</SelectItem>
                    <SelectItem value="org_size">Organization Size</SelectItem>
                    <SelectItem value="framework">Framework</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Analytics Snapshots ({snapshotList.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading analytics data...</div>
            ) : snapshotList.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No snapshots found for selected filters</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Organization</th>
                      <th className="text-left py-2 px-3">Sector</th>
                      <th className="text-left py-2 px-3">Value</th>
                      <th className="text-left py-2 px-3">Dimension</th>
                      <th className="text-left py-2 px-3">Captured</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshotList.map((s: any, i: number) => (
                      <tr key={i} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">{s.org_name ?? s.organization_name ?? "—"}</td>
                        <td className="py-2 px-3">{s.sector ?? "—"}</td>
                        <td className="py-2 px-3">
                          <Badge variant={Number(s.metric_value ?? s.value ?? 0) >= 80 ? "default" : "destructive"}>
                            {s.metric_value ?? s.value ?? "—"}
                          </Badge>
                        </td>
                        <td className="py-2 px-3">{s.dimension_value ?? s[dimension] ?? "—"}</td>
                        <td className="py-2 px-3 text-muted-foreground">
                          {s.captured_at ? new Date(s.captured_at).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
