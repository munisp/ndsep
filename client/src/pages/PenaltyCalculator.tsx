import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Calculator, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const fmtNGN = (n:number) => `₦${n.toLocaleString()}`;

export default function PenaltyCalculator() {
  const [form, setForm] = useState({ violationType:"data_breach", sector:"banking", severity:"medium", organizationRevenue:"", affectedIndividuals:"0", isRepeatOffender:false, hasCooperated:true });
  const [result, setResult] = useState<any>(null);
  const { data: history } = trpc.penaltyCalculator.history.useQuery({ limit:10 });
  const calcM = trpc.penaltyCalculator.calculate.useMutation({ onSuccess:(r)=>setResult(r), onError:(e)=>toast.error((e instanceof Error ? e.message : String(e))) });
  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Enforcement", href: "/enforcement" }, { label: "Penalty Calculator" }]} className="mb-4" />
      <div className="flex items-center gap-3"><Calculator className="h-7 w-7 text-primary"/><div><h1 className="text-2xl font-bold">Penalty Calculator</h1><p className="text-muted-foreground text-sm">NDPA 2023 Section 48 — Administrative fine estimation tool</p></div></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card><CardHeader><CardTitle>Calculate Penalty</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Violation Type</Label><Select value={form.violationType} onValueChange={v=>setForm(f=>({...f,violationType:v}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["data_breach","unauthorized_processing","failure_to_notify","inadequate_security","cross_border_violation","consent_violation"].map(t=><SelectItem key={t} value={t}>{t.replace(/_/g,' ')}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Sector</Label><Select value={form.sector} onValueChange={v=>setForm(f=>({...f,sector:v}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["banking","telecom","healthcare","energy","insurance","fintech"].map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div><Label>Severity</Label><Select value={form.severity} onValueChange={v=>setForm(f=>({...f,severity:v}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["low","medium","high","critical"].map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Annual Revenue (NGN) — optional</Label><Input type="number" value={form.organizationRevenue} onChange={e=>setForm(f=>({...f,organizationRevenue:e.target.value}))} placeholder="e.g., 5000000000"/></div>
          <div><Label>Affected Individuals</Label><Input type="number" value={form.affectedIndividuals} onChange={e=>setForm(f=>({...f,affectedIndividuals:e.target.value}))}/></div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isRepeatOffender} onChange={e=>setForm(f=>({...f,isRepeatOffender:e.target.checked}))}/>Repeat offender</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.hasCooperated} onChange={e=>setForm(f=>({...f,hasCooperated:e.target.checked}))}/>Has cooperated</label>
          </div>
          <Button className="w-full" disabled={calcM.isPending} onClick={()=>calcM.mutate({ violationType:form.violationType, sector:form.sector, severity:form.severity as any, organizationRevenue:form.organizationRevenue?parseFloat(form.organizationRevenue):undefined, affectedIndividuals:parseInt(form.affectedIndividuals)||0, isRepeatOffender:form.isRepeatOffender, hasCooperated:form.hasCooperated })}>{calcM.isPending?"Calculating...":"Calculate Penalty"}</Button>
        </CardContent></Card>
        {result&&<Card className="border-primary/30"><CardHeader><CardTitle className="text-primary">Penalty Estimate</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="text-center py-4"><p className="text-4xl font-bold text-primary">{fmtNGN(result.finalPenalty)}</p><p className="text-sm text-muted-foreground mt-1">Estimated Administrative Fine</p></div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Base Penalty</span><span>{fmtNGN(result.basePenalty)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Multiplier</span><span>{result.multiplier.toFixed(2)}×</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Calculated</span><span>{fmtNGN(result.calculatedPenalty)}</span></div>
            {result.revenueCap&&<div className="flex justify-between"><span className="text-muted-foreground">Revenue Cap (2%)</span><span>{fmtNGN(result.revenueCap)}</span></div>}
            <div className="border-t pt-2 flex justify-between font-semibold"><span>Final Penalty</span><span className="text-primary">{fmtNGN(result.finalPenalty)}</span></div>
          </div>
          <div className="bg-muted/50 rounded p-3 text-xs"><p className="font-medium">Regulatory Basis</p><p className="text-muted-foreground">{result.regulatoryBasis}</p><p className="font-medium mt-2">Appeal Period</p><p className="text-muted-foreground">{result.appealPeriod}</p></div>
        </CardContent></Card>}
      </div>
      <Card><CardHeader><CardTitle>Recent Penalties</CardTitle></CardHeader><CardContent>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-muted-foreground text-left"><th className="pb-2 pr-3">Organization</th><th className="pb-2 pr-3">Sector</th><th className="pb-2 pr-3">Amount</th><th className="pb-2 pr-3">Status</th><th className="pb-2">Date</th></tr></thead>
          <tbody>{(history??[]).map((p:any)=>(
            <tr key={p.id} className="border-b hover:bg-muted/30">
              <td className="py-2 pr-3 font-medium">{p.org_name??'—'}</td>
              <td className="py-2 pr-3 text-xs">{p.sector??'—'}</td>
              <td className="py-2 pr-3 font-mono text-sm">{fmtNGN(parseFloat(p.amount??'0'))}</td>
              <td className="py-2 pr-3 text-xs">{p.payment_status??p.status??'—'}</td>
              <td className="py-2 text-xs">{p.created_at?new Date(p.created_at).toLocaleDateString():''}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </CardContent></Card>
    </div>
  );
}
