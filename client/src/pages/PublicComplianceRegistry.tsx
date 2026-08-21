import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, Search, TrendingUp } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
export default function PublicComplianceRegistry() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("all");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const { data: list } = trpc.publicRegistry.search.useQuery({ page, limit:20, query:debouncedQuery||undefined, sector:sector!=="all"?sector:undefined });
  const { data: sectorStats } = trpc.publicRegistry.sectorStats.useQuery();
  const SECTORS = ["banking","telecom","healthcare","energy","insurance","fintech","government","education"];
  const scoreColor = (s:number) => s>=80?"text-green-600":s>=60?"text-yellow-600":"text-red-600";
  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Public Compliance Registry" }]} className="mb-4" />
      <div className="flex items-center gap-3">
        <Globe className="h-7 w-7 text-primary"/>
        <div><h1 className="text-2xl font-bold">Public Compliance Registry</h1><p className="text-muted-foreground text-sm">Publicly searchable NDPA compliance status for all registered organizations</p></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(sectorStats??[]).slice(0,4).map((s:any)=>(
          <Card key={s.sector}><CardContent className="pt-4"><p className="text-xs text-muted-foreground capitalize">{s.sector}</p><p className={`text-2xl font-bold ${scoreColor(parseFloat(s.avg_score??'0'))}`}>{parseFloat(s.avg_score??'0').toFixed(0)}</p><p className="text-xs text-muted-foreground">{s.org_count} orgs · avg score</p></CardContent></Card>
        ))}
      </div>
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/>
          <Input className="pl-9" placeholder="Search by org name or RC number..." value={query} onChange={e=>{setQuery(e.target.value);setTimeout(()=>setDebouncedQuery(e.target.value),400);}}/>
        </div>
        <Select value={sector} onValueChange={setSector}><SelectTrigger className="w-40"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All Sectors</SelectItem>{SECTORS.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
      </div>
      <Card><CardHeader><CardTitle>Organizations ({list?.total??0})</CardTitle></CardHeader><CardContent>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-muted-foreground text-left"><th className="pb-2 pr-3">Organization</th><th className="pb-2 pr-3">Sector</th><th className="pb-2 pr-3">RC Number</th><th className="pb-2 pr-3">State</th><th className="pb-2 pr-3">NDPC Status</th><th className="pb-2">Compliance Score</th></tr></thead>
          <tbody>{(list?.data??[]).map((o:any)=>(
            <tr key={o.id} className="border-b hover:bg-muted/30">
              <td className="py-2 pr-3 font-medium">{o.name}</td>
              <td className="py-2 pr-3"><Badge variant="outline">{o.sector??'—'}</Badge></td>
              <td className="py-2 pr-3 text-xs font-mono">{o.rc_number??'—'}</td>
              <td className="py-2 pr-3 text-xs">{o.state??'—'}</td>
              <td className="py-2 pr-3"><Badge className={o.ndpc_registration_status==='registered'?"bg-green-500/15 text-green-600 dark:text-green-400":"bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"}>{o.ndpc_registration_status??'unknown'}</Badge></td>
              <td className="py-2"><div className="flex items-center gap-2"><div className="w-24 bg-muted rounded-full h-2"><div className="h-2 rounded-full bg-primary" style={{width:`${o.compliance_score??0}%`}}/></div><span className={`text-sm font-bold ${scoreColor(o.compliance_score??0)}`}>{o.compliance_score??'—'}</span></div></td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="flex justify-between mt-4"><p className="text-sm text-muted-foreground">Page {page}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Prev</Button><Button variant="outline" size="sm" disabled={(list?.data?.length??0)<20} onClick={()=>setPage(p=>p+1)}>Next</Button></div></div>
      </CardContent></Card>
    </div>
  );
}
