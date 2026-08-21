import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart2, TrendingUp, AlertTriangle } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const fmtNGN = (n:number) => `₦${(n/1e6).toFixed(1)}M`;

export default function AdvancedAnalytics() {
  const { data: sectorComp } = trpc.advancedAnalytics.sectorComparison.useQuery();
  const { data: penaltyData } = trpc.advancedAnalytics.penaltyAnalytics.useQuery();
  const { data: topRisks } = trpc.advancedAnalytics.topRisks.useQuery({ limit:10 });
  const scoreColor = (s:number) => s>=80?"text-green-600":s>=60?"text-yellow-600":"text-red-600";
  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Analytics", href: "/analytics" }, { label: "Advanced Analytics" }]} className="mb-4" />
      <div className="flex items-center gap-3"><BarChart2 className="h-7 w-7 text-primary"/><div><h1 className="text-2xl font-bold">Advanced Analytics</h1><p className="text-muted-foreground text-sm">Cross-sector compliance intelligence and penalty analytics</p></div></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card><CardHeader><CardTitle>Sector Compliance Comparison</CardTitle></CardHeader><CardContent>
          <div className="space-y-3">{(sectorComp??[]).map((s:any)=>(
            <div key={s.sector} className="flex items-center gap-3">
              <div className="w-24 text-sm capitalize font-medium">{s.sector}</div>
              <div className="flex-1"><div className="w-full bg-muted rounded-full h-3"><div className="h-3 rounded-full bg-primary" style={{width:`${s.avg_compliance_score??0}%`}}/></div></div>
              <span className={`text-sm font-bold w-8 text-right ${scoreColor(parseFloat(s.avg_compliance_score??'0'))}`}>{parseFloat(s.avg_compliance_score??'0').toFixed(0)}</span>
              <span className="text-xs text-muted-foreground w-16 text-right">{s.org_count} orgs</span>
            </div>
          ))}</div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Penalties by Sector</CardTitle></CardHeader><CardContent>
          <div className="space-y-3">{(penaltyData?.bySector??[]).slice(0,8).map((s:any)=>(
            <div key={s.sector} className="flex items-center justify-between">
              <span className="text-sm capitalize">{s.sector??'Unknown'}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{s.count} cases</span>
                <span className="text-sm font-bold">{fmtNGN(parseFloat(s.total_ngn??'0'))}</span>
              </div>
            </div>
          ))}</div>
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500"/>Top 10 Highest Risk Organizations</CardTitle></CardHeader><CardContent>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-muted-foreground text-left"><th className="pb-2 pr-3">#</th><th className="pb-2 pr-3">Organization</th><th className="pb-2 pr-3">Sector</th><th className="pb-2 pr-3">Compliance</th><th className="pb-2 pr-3">Open Violations</th><th className="pb-2 pr-3">Active Breaches</th><th className="pb-2">Total Penalties</th></tr></thead>
          <tbody>{(topRisks??[]).map((o:any,i:number)=>(
            <tr key={o.id} className="border-b hover:bg-muted/30">
              <td className="py-2 pr-3 text-muted-foreground">{i+1}</td>
              <td className="py-2 pr-3 font-medium">{o.name}</td>
              <td className="py-2 pr-3"><Badge variant="outline" className="text-xs">{o.sector}</Badge></td>
              <td className="py-2 pr-3"><span className={`font-bold ${scoreColor(o.compliance_score??0)}`}>{o.compliance_score??'—'}</span></td>
              <td className="py-2 pr-3">{o.open_violations??0}</td>
              <td className="py-2 pr-3">{o.active_breaches??0}</td>
              <td className="py-2">{fmtNGN(parseFloat(o.total_penalties_ngn??'0'))}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </CardContent></Card>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(penaltyData?.byStatus??[]).map((s:any)=>(
          <Card key={s.status}><CardContent className="pt-4"><p className="text-xs text-muted-foreground capitalize">{s.status?.replace(/_/g,' ')}</p><p className="text-2xl font-bold">{s.count}</p><p className="text-sm text-muted-foreground">{fmtNGN(parseFloat(s.total_ngn??'0'))}</p></CardContent></Card>
        ))}
      </div>
    </div>
  );
}
