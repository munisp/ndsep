import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, TrendingDown, TrendingUp } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const riskColor = (s:number) => s>=80?"text-green-600 bg-green-50":s>=60?"text-yellow-600 bg-yellow-50":s>=40?"text-orange-600 bg-orange-50":"text-red-600 bg-red-50";
const riskLabel = (s:number) => s>=80?"Low Risk":s>=60?"Medium Risk":s>=40?"High Risk":"Critical Risk";

export default function RiskScorecard() {
  const [sector, setSector] = useState("all");
  const { data: leaderboard } = trpc.riskScorecard.leaderboard.useQuery({ sector:sector!=="all"?sector:undefined, limit:30 });
  const [selectedOrg, setSelectedOrg] = useState<number|null>(null);
  const { data: scorecard } = trpc.riskScorecard.orgScorecard.useQuery({ orgId: selectedOrg??0 }, { enabled:!!selectedOrg });
  const SECTORS = ["banking","telecom","healthcare","energy","insurance","fintech"];
  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Risk Scorecard" }]} className="mb-4" />
      <div className="flex items-center gap-3"><Shield className="h-7 w-7 text-primary"/><div><h1 className="text-2xl font-bold">Risk Scorecard</h1><p className="text-muted-foreground text-sm">Multi-dimensional compliance risk assessment across all organizations</p></div></div>
      <div className="flex gap-3">
        <Select value={sector} onValueChange={setSector}><SelectTrigger className="w-40"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All Sectors</SelectItem>{SECTORS.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <Card><CardHeader><CardTitle>Organization Risk Leaderboard</CardTitle></CardHeader><CardContent>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-muted-foreground text-left"><th className="pb-2 pr-3">#</th><th className="pb-2 pr-3">Organization</th><th className="pb-2 pr-3">Sector</th><th className="pb-2 pr-3">Score</th><th className="pb-2 pr-3">Violations</th><th className="pb-2 pr-3">Penalties</th><th className="pb-2">Breaches</th></tr></thead>
              <tbody>{(leaderboard??[]).map((o:any,i:number)=>(
                <tr key={o.id} className={`border-b hover:bg-muted/30 cursor-pointer ${selectedOrg===o.id?"bg-primary/5":""}`} onClick={()=>setSelectedOrg(o.id)}>
                  <td className="py-2 pr-3 text-muted-foreground">{i+1}</td>
                  <td className="py-2 pr-3 font-medium">{o.name}</td>
                  <td className="py-2 pr-3"><Badge variant="outline" className="text-xs">{o.sector}</Badge></td>
                  <td className="py-2 pr-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${riskColor(o.compliance_score??0)}`}>{o.compliance_score??'—'}</span></td>
                  <td className="py-2 pr-3">{o.open_violations??0}</td>
                  <td className="py-2 pr-3">{o.penalties??0}</td>
                  <td className="py-2">{o.breaches??0}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </CardContent></Card>
        </div>
        <div>
          {scorecard?<Card><CardHeader><CardTitle className="text-sm">{scorecard.organization?.name}</CardTitle></CardHeader><CardContent className="space-y-4">
            <div className={`text-center p-4 rounded-lg ${riskColor(scorecard.riskScore)}`}>
              <p className="text-4xl font-bold">{scorecard.riskScore}</p>
              <p className="text-sm font-medium">{riskLabel(scorecard.riskScore)}</p>
            </div>
            <div className="space-y-2">
              {Object.entries(scorecard.dimensions??{}).map(([k,v]:any)=>(
                <div key={k}><div className="flex justify-between text-xs mb-1"><span className="capitalize">{k.replace(/([A-Z])/g,' $1').trim()}</span><span>{v}</span></div><div className="w-full bg-muted rounded-full h-1.5"><div className="h-1.5 rounded-full bg-primary" style={{width:`${v}%`}}/></div></div>
              ))}
            </div>
            <div className="text-xs space-y-1 border-t pt-3">
              <div className="flex justify-between"><span className="text-muted-foreground">Open Violations</span><span>{(scorecard.violations??[]).reduce((a:number,v:any)=>a+parseInt(v.count??'0'),0)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total Penalties</span><span>{scorecard.penalties?.count??0}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Breach Incidents</span><span>{scorecard.breaches?.count??0}</span></div>
            </div>
          </CardContent></Card>:<Card><CardContent className="pt-8 text-center text-muted-foreground text-sm">Click an organization to view its detailed risk scorecard</CardContent></Card>}
        </div>
      </div>
    </div>
  );
}
