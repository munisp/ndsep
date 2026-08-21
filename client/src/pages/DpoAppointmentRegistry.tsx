import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, UserCheck, AlertTriangle, CheckCircle, Clock } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
export default function DpoAppointmentRegistry() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ organizationId:"", dpoName:"", dpoEmail:"", dpoPhone:"", dpcoId:"", trainingHoursCompleted:"0", notes:"" });
  const { data: stats } = trpc.dpoAppointments.stats.useQuery();
  const { data: list, refetch } = trpc.dpoAppointments.list.useQuery({ page, limit:20 });
  const orgs = trpc.organizations.list.useQuery({ limit:200 }).data ?? [];
  const createM = trpc.dpoAppointments.create.useMutation({ onSuccess:()=>{ toast.success("DPO appointment registered"); setOpen(false); refetch(); }, onError:(e)=>toast.error((e instanceof Error ? e.message : String(e))) });
  const verifyM = trpc.dpoAppointments.verify.useMutation({ onSuccess:()=>{ toast.success("DPO verified"); refetch(); }, onError:(e)=>toast.error((e instanceof Error ? e.message : String(e))) });
  const CRED_COLORS: Record<string,string> = { verified:"bg-green-500/15 text-green-600 dark:text-green-400", pending:"bg-yellow-500/15 text-yellow-600 dark:text-yellow-400", expired:"bg-red-500/15 text-red-600 dark:text-red-400", suspended:"bg-muted text-foreground" };
  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Dpo Appointment Registry" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">DPO Appointment Registry</h1><p className="text-muted-foreground text-sm">NDPA 2023 — Data Protection Officer appointment & credential tracking</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1"/>Register DPO</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Register DPO Appointment</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Organization</Label><Select onValueChange={v=>setForm(f=>({...f,organizationId:v}))}><SelectTrigger><SelectValue placeholder="Select org"/></SelectTrigger><SelectContent>{orgs.map((o:any)=><SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>DPO Name</Label><Input value={form.dpoName} onChange={e=>setForm(f=>({...f,dpoName:e.target.value}))}/></div>
                <div><Label>DPO Email</Label><Input type="email" value={form.dpoEmail} onChange={e=>setForm(f=>({...f,dpoEmail:e.target.value}))}/></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Phone</Label><Input value={form.dpoPhone} onChange={e=>setForm(f=>({...f,dpoPhone:e.target.value}))}/></div>
                <div><Label>DPCO ID</Label><Input value={form.dpcoId} onChange={e=>setForm(f=>({...f,dpcoId:e.target.value}))} placeholder="DPCO-XXXX"/></div>
              </div>
              <div><Label>Training Hours Completed</Label><Input type="number" value={form.trainingHoursCompleted} onChange={e=>setForm(f=>({...f,trainingHoursCompleted:e.target.value}))}/></div>
              <div><Label>Notes</Label><Input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></div>
              <Button className="w-full" disabled={!form.organizationId||!form.dpoName||!form.dpoEmail||createM.isPending} onClick={()=>createM.mutate({ organizationId:parseInt(form.organizationId), dpoName:form.dpoName, dpoEmail:form.dpoEmail, dpoPhone:form.dpoPhone||undefined, dpcoId:form.dpcoId||undefined, trainingHoursCompleted:parseInt(form.trainingHoursCompleted)||0, notes:form.notes||undefined })}>{createM.isPending?"Registering...":"Register DPO"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[{l:"Total DPOs",v:stats?.total??0,I:UserCheck,c:"text-blue-600"},{l:"Active",v:stats?.active??0,I:CheckCircle,c:"text-green-600"},{l:"Verified",v:stats?.verified??0,I:CheckCircle,c:"text-green-600"},{l:"Expired",v:stats?.expired??0,I:AlertTriangle,c:"text-red-600"},{l:"Expiring Soon",v:stats?.expiring_soon??0,I:Clock,c:"text-orange-600"}].map(({l,v,I,c})=>(
          <Card key={l}><CardContent className="pt-4"><div className="flex items-center gap-2"><I className={`h-4 w-4 ${c}`}/><div><p className="text-xs text-muted-foreground">{l}</p><p className="text-lg font-bold">{v}</p></div></div></CardContent></Card>
        ))}
      </div>
      <Card><CardHeader><CardTitle>DPO Appointments ({list?.total??0})</CardTitle></CardHeader><CardContent>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-muted-foreground text-left"><th className="pb-2 pr-3">DPO Name</th><th className="pb-2 pr-3">Organization</th><th className="pb-2 pr-3">Email</th><th className="pb-2 pr-3">DPCO ID</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3">Training Hrs</th><th className="pb-2">Actions</th></tr></thead>
          <tbody>{(list?.data??[]).map((d:any)=>(
            <tr key={d.id} className="border-b hover:bg-muted/30">
              <td className="py-2 pr-3 font-medium">{d.dpo_name}</td>
              <td className="py-2 pr-3 text-xs">{d.org_name??'—'}</td>
              <td className="py-2 pr-3 text-xs">{d.dpo_email}</td>
              <td className="py-2 pr-3 text-xs">{d.dpco_id??'—'}</td>
              <td className="py-2 pr-3"><Badge className={CRED_COLORS[d.credential_status]??''}>{d.credential_status}</Badge></td>
              <td className="py-2 pr-3">{d.training_hours_completed??0}h</td>
              <td className="py-2">{d.credential_status!=='verified'&&<Button size="sm" className="h-7 text-xs" onClick={()=>verifyM.mutate({id:d.id,independenceVerified:true})}>Verify</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="flex justify-between mt-4"><p className="text-sm text-muted-foreground">Page {page}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Prev</Button><Button variant="outline" size="sm" disabled={(list?.data?.length??0)<20} onClick={()=>setPage(p=>p+1)}>Next</Button></div></div>
      </CardContent></Card>
    </div>
  );
}
