import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Shield, AlertTriangle, CheckCircle, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line,
} from "recharts";

export default function ARTDashboard() {
  const [selectedModel, setSelectedModel] = useState("compliance_risk_rf");

  const { data: resultsData, isLoading, refetch } = trpc.art.getResults.useQuery({ modelName: selectedModel });
  const results = (resultsData as any)?.results ?? resultsData ?? [];
  const { data: healthData } = trpc.art.health.useQuery();
  const summary = (healthData as any)?.summary ?? null;

  const runTestMutation = trpc.art.runTest.useMutation({
    onSuccess: () => { toast.success("ART test queued — results will appear shortly"); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const chartData = (Array.isArray(results) ? results : []).map((r: any) => ({
    attack: r.attack_type.toUpperCase(),
    clean: parseFloat((r.clean_accuracy * 100).toFixed(1)),
    adversarial: parseFloat((r.adversarial_accuracy * 100).toFixed(1)),
    robustness: parseFloat((r.robustness_score * 100).toFixed(1)),
  }));

  const resultArr = Array.isArray(results) ? results : [];
  const avgRobustness = resultArr.length
    ? (resultArr.reduce((s: number, r: any) => s + r.robustness_score, 0) / resultArr.length * 100).toFixed(1)
    : "—";

  const robustnessColor = (score: number) =>
    score >= 75 ? "text-green-500" : score >= 50 ? "text-yellow-500" : "text-red-500";

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-7 w-7 text-primary" />
              ART Adversarial Robustness Testing
            </h1>
            <p className="text-muted-foreground mt-1">
              IBM Adversarial Robustness Toolbox — FGSM, PGD, DeepFool, Carlini-Wagner attack evaluation
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => runTestMutation.mutate({ modelName: selectedModel, attackType: "fgsm", epsilon: 0.1 })}
              disabled={runTestMutation.isPending}
            >
              <Zap className="h-4 w-4 mr-1" />
              {runTestMutation.isPending ? "Running..." : "Run Test"}
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Models Tested", value: summary?.models_tested ?? 0, icon: Shield },
            { label: "Attack Types", value: summary?.attack_types ?? 0, icon: AlertTriangle },
            { label: "Total Tests", value: summary?.total_tests ?? 0, icon: Zap },
            {
              label: "Avg Robustness",
              value: summary?.avg_robustness ? `${(summary.avg_robustness * 100).toFixed(1)}%` : "—",
              icon: CheckCircle,
            },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="text-2xl font-bold">{stat.value}</div>
                      <div className="text-xs text-muted-foreground">{stat.label}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Model Selector */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Model:</span>
          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="compliance_risk_rf">compliance_risk_rf</SelectItem>
              <SelectItem value="breach_probability_xgb">breach_probability_xgb</SelectItem>
              <SelectItem value="anomaly_isolation_forest">anomaly_isolation_forest</SelectItem>
            </SelectContent>
          </Select>
          {results?.length > 0 && (
            <Badge
              variant="outline"
              className={`${robustnessColor(parseFloat(avgRobustness as string))} border-current`}
            >
              Avg Robustness: {avgRobustness}%
            </Badge>
          )}
        </div>

        {/* Charts */}
        {!isLoading && resultArr.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Clean vs Adversarial Accuracy</CardTitle>
                <CardDescription>Accuracy drop under each attack type</CardDescription>
              </CardHeader>
              <CardContent>
                <div style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="attack" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => `${v}%`} />
                      <Legend />
                      <Bar dataKey="clean" name="Clean Accuracy" fill="#22c55e" />
                      <Bar dataKey="adversarial" name="Adversarial Accuracy" fill="#ef4444" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Robustness Score by Attack</CardTitle>
                <CardDescription>Higher is more robust (0–100)</CardDescription>
              </CardHeader>
              <CardContent>
                <div style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="attack" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => `${v}%`} />
                      <Line type="monotone" dataKey="robustness" name="Robustness" stroke="#6366f1" strokeWidth={2} dot />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Results Table */}
        <Card>
          <CardHeader>
            <CardTitle>Test Results — {selectedModel}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading results...</div>
            ) : resultArr.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No test results yet. Click "Run Test" to start an adversarial evaluation.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Attack Type</th>
                      <th className="pb-2 pr-4">Epsilon (ε)</th>
                      <th className="pb-2 pr-4">Clean Accuracy</th>
                      <th className="pb-2 pr-4">Adversarial Accuracy</th>
                      <th className="pb-2 pr-4">Robustness Score</th>
                      <th className="pb-2 pr-4">Success Rate</th>
                      <th className="pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultArr.map((r: any) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-4 font-medium uppercase">{r.attack_type}</td>
                        <td className="py-2 pr-4 font-mono text-xs">{r.epsilon}</td>
                        <td className="py-2 pr-4">{(r.clean_accuracy * 100).toFixed(1)}%</td>
                        <td className="py-2 pr-4">
                          <span className={r.adversarial_accuracy < 0.6 ? "text-red-500 font-medium" : ""}>
                            {(r.adversarial_accuracy * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          <span className={robustnessColor(r.robustness_score * 100)}>
                            {(r.robustness_score * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2 pr-4">{(r.success_rate * 100).toFixed(1)}%</td>
                        <td className="py-2">
                          <Badge variant="outline" className="text-xs bg-green-500/10 text-green-700 border-green-500/30">
                            {r.status}
                          </Badge>
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
