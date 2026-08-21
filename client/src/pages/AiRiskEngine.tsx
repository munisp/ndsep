import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Brain, Zap, TrendingUp, AlertTriangle, RefreshCw, Target } from "lucide-react";

const RISK_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-green-500/20 text-green-400 border-green-500/30",
};

export default function AiRiskEngine() {
  const [selectedOrg, setSelectedOrg] = useState<number | null>(null);

  const { data: leaderboard = [], refetch } = trpc.aiRiskScoring.getLeaderboard.useQuery({ limit: 30 });
  const scoreOrgMut = trpc.aiRiskScoring.scoreOrg.useMutation();
  const orgScore = scoreOrgMut.data;
  const scoreAllMut = trpc.aiRiskScoring.scoreAll.useMutation({
    onSuccess: (d) => { toast.success(`Scored ${d.scored} organizations`); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const riskDist = (leaderboard as any[]).reduce((acc: Record<string, number>, o: any) => {
    const lvl = String(o.risk_level ?? "low");
    acc[lvl] = (acc[lvl] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Brain className="w-6 h-6 text-violet-400" /> AI Risk Scoring Engine</h1>
            <p className="text-muted-foreground text-sm mt-1">Machine learning-powered compliance risk assessment across all regulated entities</p>
          </div>
          <Button className="bg-violet-600 hover:bg-violet-700" onClick={() => scoreAllMut.mutate()} disabled={scoreAllMut.isPending}>
            <RefreshCw className={`w-4 h-4 mr-2 ${scoreAllMut.isPending ? "animate-spin" : ""}`} />
            {scoreAllMut.isPending ? "Scoring..." : "Re-score All Orgs"}
          </Button>
        </div>

        {/* Risk Distribution */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {["critical", "high", "medium", "low"].map(lvl => (
            <Card key={lvl} className="bg-card border-border">
              <CardContent className="p-4 text-center">
                <AlertTriangle className={`w-6 h-6 mx-auto mb-2 ${lvl === "critical" ? "text-red-400" : lvl === "high" ? "text-orange-400" : lvl === "medium" ? "text-yellow-400" : "text-green-400"}`} />
                <p className={`text-2xl font-bold ${lvl === "critical" ? "text-red-400" : lvl === "high" ? "text-orange-400" : lvl === "medium" ? "text-yellow-400" : "text-green-400"}`}>{riskDist[lvl] ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">{lvl.toUpperCase()} RISK</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Leaderboard */}
          <Card className="bg-card border-border lg:col-span-2">
            <CardHeader><CardTitle className="text-foreground flex items-center gap-2"><TrendingUp className="w-5 h-5 text-violet-400" /> Risk Leaderboard</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-3">#</th><th className="text-left py-2 px-3">Organization</th>
                    <th className="text-left py-2 px-3">Sector</th><th className="text-left py-2 px-3">Risk Score</th>
                    <th className="text-left py-2 px-3">Level</th>
                  </tr></thead>
                  <tbody>
                    {(leaderboard as any[]).length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No risk scores available. Click "Re-score All Orgs" to generate.</td></tr>
                    ) : (leaderboard as any[]).map((o: any, i: number) => (
                      <tr key={o.id} className="border-b border-border/50 hover:bg-muted/30 cursor-pointer" onClick={() => { setSelectedOrg(o.id); scoreOrgMut.mutate({ orgId: Number(o.id) }); }}>
                        <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                        <td className="py-2 px-3 text-foreground font-medium">{o.name}</td>
                        <td className="py-2 px-3 text-muted-foreground">{String(o.sector ?? "").toUpperCase()}</td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-muted rounded-full h-2 w-20">
                              <div className={`h-2 rounded-full ${Number(o.risk_score ?? 0) > 0.7 ? "bg-red-500" : Number(o.risk_score ?? 0) > 0.4 ? "bg-yellow-500" : "bg-green-500"}`} style={{ width: `${Math.min(100, Number(o.risk_score ?? 0) * 100)}%` }} />
                            </div>
                            <span className="text-muted-foreground text-xs">{(Number(o.risk_score ?? 0) * 100).toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="py-2 px-3"><Badge className={`text-xs border ${RISK_COLORS[String(o.risk_level ?? "low")] ?? RISK_COLORS.low}`}>{String(o.risk_level ?? "low").toUpperCase()}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Org Detail */}
          <Card className="bg-card border-border">
            <CardHeader><CardTitle className="text-foreground flex items-center gap-2"><Target className="w-5 h-5 text-violet-400" /> Risk Breakdown</CardTitle></CardHeader>
            <CardContent>
              {!orgScore ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Brain className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Select an organization from the leaderboard to see detailed risk breakdown</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-center">
                    <div className={`text-4xl font-bold ${Number(orgScore.riskScore ?? 0) > 0.7 ? "text-red-400" : Number(orgScore.riskScore ?? 0) > 0.4 ? "text-yellow-400" : "text-green-400"}`}>
                      {(Number(orgScore.riskScore ?? 0) * 100).toFixed(1)}%
                    </div>
                    <Badge className={`mt-1 border ${RISK_COLORS[String(orgScore.riskLevel ?? "low")] ?? RISK_COLORS.low}`}>{String(orgScore.riskLevel ?? "low").toUpperCase()} RISK</Badge>
                  </div>
                  <div className="space-y-2">
                    {Object.entries(orgScore.factors ?? {}).map(([k, v]: [string, any]) => (
                      <div key={k}>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>{k.replace(/_/g, " ").toUpperCase()}</span>
                          <span>{(Number(v) * 100).toFixed(0)}%</span>
                        </div>
                        <div className="bg-muted rounded-full h-1.5">
                          <div className="bg-violet-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, Number(v) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {(orgScore.recommendations ?? []).length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-2">RECOMMENDATIONS</p>
                      <ul className="space-y-1">
                        {(orgScore.recommendations as string[]).map((r: string, i: number) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-start gap-1"><Zap className="w-3 h-3 text-violet-400 mt-0.5 shrink-0" />{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
