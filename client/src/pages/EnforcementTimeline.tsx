import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gavel, Filter, TrendingUp, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const SECTOR_COLORS: Record<string, string> = {
  banking: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  telecom: "text-purple-400 bg-purple-500/10 border-purple-500/30",
  healthcare: "text-green-400 bg-green-500/10 border-green-500/30",
  energy: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  insurance: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
  fintech: "text-pink-400 bg-pink-500/10 border-pink-500/30",
};

const ACTION_ICONS: Record<string, typeof AlertCircle> = {
  warning: AlertCircle,
  fine: Gavel,
  suspension: Clock,
  revocation: AlertCircle,
  clearance: CheckCircle,
};

export default function EnforcementTimeline() {
  const [sector, setSector] = useState<string>("all");
  const [limit, setLimit] = useState(50);

  const { data: timeline = [] } = trpc.enforcementTimeline.timeline.useQuery({ limit });
  // stats derived from timeline
  const stats = { total: (timeline as any[]).length, warnings: (timeline as any[]).filter((a:any) => a.action_type === 'warning').length, fines: (timeline as any[]).filter((a:any) => a.action_type === 'fine').length, suspensions: (timeline as any[]).filter((a:any) => a.action_type === 'suspension').length, cleared: (timeline as any[]).filter((a:any) => a.action_type === 'clearance').length, total_fine_amount: (timeline as any[]).reduce((s:number, a:any) => s + Number(a.fine_amount ?? 0), 0) };

  const statCards = [
    { label: "Total Actions", value: String(stats?.total ?? 0), color: "text-foreground" },
    { label: "Warnings", value: String(stats?.warnings ?? 0), color: "text-yellow-400" },
    { label: "Fines Issued", value: String(stats?.fines ?? 0), color: "text-red-400" },
    { label: "Suspensions", value: String(stats?.suspensions ?? 0), color: "text-orange-400" },
    { label: "Cleared", value: String(stats?.cleared ?? 0), color: "text-green-400" },
    { label: "Total Fines (₦)", value: `₦${Number(stats?.total_fine_amount ?? 0).toLocaleString()}`, color: "text-red-400" },
  ];

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Gavel className="w-6 h-6 text-red-400" /> Enforcement Timeline</h1>
            <p className="text-muted-foreground text-sm mt-1">Chronological record of all regulatory enforcement actions across sectors</p>
          </div>
          <div className="flex items-center gap-3">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Select value={sector} onValueChange={setSector}>
              <SelectTrigger className="w-40 bg-muted border-border text-foreground"><SelectValue placeholder="All Sectors" /></SelectTrigger>
              <SelectContent className="bg-muted border-border">
                <SelectItem value="all">All Sectors</SelectItem>
                {Object.keys(SECTOR_COLORS).map(s => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {statCards.map(s => (
            <Card key={s.label} className="bg-card border-border">
              <CardContent className="p-3 text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-foreground flex items-center gap-2"><TrendingUp className="w-5 h-5 text-red-400" /> Enforcement Actions</CardTitle>
              <span className="text-xs text-muted-foreground">{(timeline as any[]).length} records</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <div className="absolute left-6 top-0 bottom-0 w-px bg-muted" />
              <div className="space-y-4 pl-14">
                {(timeline as any[]).length === 0 ? (
                  <EmptyState title="No enforcement actions" description="No enforcement timeline entries found" />
                ) : (timeline as any[]).map((action: any, i: number) => {
                  const Icon = ACTION_ICONS[String(action.action_type ?? "warning")] ?? AlertCircle;
                  const sectorColor = SECTOR_COLORS[String(action.sector ?? "banking")] ?? SECTOR_COLORS.banking;
                  return (
                    <div key={i} className="relative">
      <Breadcrumbs items={[{ label: "Enforcement", href: "/enforcement" }, { label: "Enforcement Timeline" }]} className="mb-4" />
                      <div className="absolute -left-8 top-1 w-4 h-4 rounded-full bg-muted border-2 border-border flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-red-400" />
                      </div>
                      <div className="bg-muted/50 rounded-lg p-4 border border-border hover:border-muted-foreground transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3">
                            <Icon className="w-5 h-5 text-red-400 mt-0.5" />
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-foreground font-medium">{action.org_name ?? "Unknown Organization"}</span>
                                <Badge className={`text-xs border ${sectorColor}`}>{String(action.sector ?? "").toUpperCase()}</Badge>
                              </div>
                              <p className="text-muted-foreground text-sm">{action.description ?? action.violation_type ?? "Enforcement action"}</p>
                              {action.fine_amount && Number(action.fine_amount) > 0 && (
                                <p className="text-red-400 text-sm font-medium mt-1">Fine: ₦{Number(action.fine_amount).toLocaleString()}</p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge variant="outline" className="text-xs border-border text-muted-foreground mb-1">{String(action.action_type ?? "warning").replace(/_/g, " ").toUpperCase()}</Badge>
                            <p className="text-xs text-muted-foreground">{action.created_at ? new Date(String(action.created_at)).toLocaleDateString("en-NG") : "—"}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {(timeline as any[]).length >= limit && (
              <div className="text-center mt-4">
                <Button variant="outline" className="border-border text-muted-foreground" onClick={() => setLimit(l => l + 50)}>Load More</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
