import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Database, Users, FileText, Shield, Activity, CheckCircle2, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316"];

export default function PlatformStats() {
  const { data: stats } = trpc.platformStats.getPublicStats.useQuery();
  const { data: health } = trpc.apiHealth.getMetrics.useQuery();

  const tables = stats?.tables ?? [];
  const sectorBreakdown = stats?.sectorBreakdown ?? [];
  const recentActivity = stats?.recentActivity ?? [];

  return (
    <>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-blue-600" />
            Platform Statistics
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Comprehensive platform-wide data metrics and health overview
          </p>
        </div>

        {/* API Health */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              API Health Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(health?.endpointMetrics ?? []).slice(0, 8).map((svc: any) => (
                <div key={svc.name} className="flex items-center gap-2 p-3 rounded-lg border bg-card">
                  {svc.status === "healthy" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                  )}
                  <div>
                    <div className="text-xs font-medium">{svc.name}</div>
                    <div className={`text-xs ${svc.status === "healthy" ? "text-green-600" : "text-red-600"}`}>
                      {svc.status} {svc.latencyMs ? `(${svc.latencyMs}ms)` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Database Table Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4" />
              Database Table Row Counts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium">Table</th>
                    <th className="text-right py-2 pr-4 font-medium">Row Count</th>
                    <th className="text-left py-2 font-medium">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.map((t: any) => (
                    <tr key={t.table_name} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="py-1.5 pr-4 font-mono text-xs">{t.table_name}</td>
                      <td className="py-1.5 pr-4 text-right font-semibold">{Number(t.row_count).toLocaleString()}</td>
                      <td className="py-1.5">
                        <Badge variant="outline" className="text-xs">{t.category ?? "core"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Sector Breakdown */}
          {sectorBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Organisations by Sector
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={sectorBreakdown}
                      dataKey="count"
                      nameKey="sector"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ sector, count }) => `${sector}: ${count}`}
                    >
                      {sectorBreakdown.map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Recent Activity */}
          {recentActivity.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Daily Activity (Last 14 Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={recentActivity} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="audit_logs" name="Audit Logs" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="alerts" name="Alerts" fill="#ef4444" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Organisations", value: stats?.totals?.organisations ?? 0, icon: Users },
            { label: "Audit Log Entries", value: stats?.totals?.audit_logs ?? 0, icon: FileText },
            { label: "Security Alerts", value: stats?.totals?.security_alerts ?? 0, icon: Shield },
            { label: "Breach Incidents", value: stats?.totals?.breach_incidents ?? 0, icon: AlertTriangle },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <kpi.icon className="h-4 w-4 text-blue-600" />
                  <span className="text-xs text-muted-foreground">{kpi.label}</span>
                </div>
                <div className="text-2xl font-bold mt-1">{Number(kpi.value).toLocaleString()}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
