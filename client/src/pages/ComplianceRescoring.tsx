import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { RefreshCw, TrendingUp, BarChart3, Play } from "lucide-react";

export default function ComplianceRescoring() {
  const [orgId, setOrgId] = useState<number>(1);

  const { data: orgs = [] } = trpc.organizations.list.useQuery();
  const { data: history = [], refetch } = trpc.complianceRescoring.getHistory.useQuery({ orgId, limit: 12 });
  const runBatchMut = trpc.complianceRescoring.runBatch.useMutation({
    onSuccess: (d) => { toast.success(`Rescored ${d.updated} organizations`); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const scores = (history as any[]).map((h: any) => Number(h.score ?? 0));
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const trend = scores.length >= 2 ? scores[0] - scores[scores.length - 1] : 0;

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><BarChart3 className="w-6 h-6 text-teal-400" /> Compliance Rescoring</h1>
            <p className="text-muted-foreground text-sm mt-1">Track compliance score history and trigger batch rescoring runs</p>
          </div>
          <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => runBatchMut.mutate({})} disabled={runBatchMut.isPending}>
            <Play className={`w-4 h-4 mr-2 ${runBatchMut.isPending ? "animate-spin" : ""}`} />
            {runBatchMut.isPending ? "Running..." : "Run Rescore"}
          </Button>
        </div>

        <div className="flex items-center gap-4">
          <Select value={String(orgId)} onValueChange={v => setOrgId(Number(v))}>
            <SelectTrigger className="w-64 bg-muted border-border text-foreground"><SelectValue placeholder="Select Organization" /></SelectTrigger>
            <SelectContent className="bg-muted border-border">
              {(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-teal-400">{avgScore.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground mt-1">Average Score</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <p className={`text-3xl font-bold ${trend >= 0 ? "text-green-400" : "text-red-400"}`}>{trend >= 0 ? "+" : ""}{trend.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground mt-1">6-Month Trend</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-foreground">{(history as any[]).length}</p>
              <p className="text-xs text-muted-foreground mt-1">Score Records</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-foreground flex items-center gap-2"><TrendingUp className="w-5 h-5 text-teal-400" /> Score History</CardTitle></CardHeader>
          <CardContent>
            {(history as any[]).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>No score history available. Click "Run Rescore" to generate.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(history as any[]).map((h: any, i: number) => {
                  const score = Number(h.score ?? 0);
                  return (
                    <div key={i} className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                      <div className="text-muted-foreground text-xs w-24">{h.scored_at ? new Date(String(h.scored_at)).toLocaleDateString("en-NG") : "—"}</div>
                      <div className="flex-1 bg-muted rounded-full h-3">
                        <div className={`h-3 rounded-full transition-all ${score >= 80 ? "bg-green-500" : score >= 60 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${Math.min(100, score)}%` }} />
                      </div>
                      <div className={`text-sm font-bold w-16 text-right ${score >= 80 ? "text-green-400" : score >= 60 ? "text-yellow-400" : "text-red-400"}`}>{score.toFixed(1)}%</div>
                      <div className="text-xs text-muted-foreground w-16">{h.scored_by ?? "system"}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
