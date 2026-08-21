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
import { Plus, Users, CheckCircle, XCircle, Clock } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
export default function ConsentRecordManager() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ organizationId:"", dataSubjectName:"", dataSubjectEmail:"", purpose:"", lawfulBasis:"consent", dataCategories:"", thirdPartySharing:false, crossBorderTransfer:false });
  const { data: stats } = trpc.consentRecords.stats.useQuery();
  const { data: list, refetch } = trpc.consentRecords.list.useQuery({ page, limit:20, status: statusFilter!=="all"?statusFilter:undefined, search: search||undefined });
  const orgs = trpc.organizations.list.useQuery({ limit:200 }).data ?? [];
  const createM = trpc.consentRecords.create.useMutation({ onSuccess:()=>{ toast.success("Consent record created"); setOpen(false); refetch(); }, onError:(e)=>toast.error((e instanceof Error ? e.message : String(e))) });
  const withdrawM = trpc.consentRecords.withdraw.useMutation({ onSuccess:()=>{ toast.success("Consent withdrawn"); refetch(); }, onError:(e)=>toast.error((e instanceof Error ? e.message : String(e))) });
  const STATUS_COLORS: Record<string,string> = { active:"bg-green-500/15 text-green-600 dark:text-green-400", withdrawn:"bg-red-500/15 text-red-600 dark:text-red-400", expired:"bg-muted text-foreground", pending:"bg-yellow-500/15 text-yellow-600 dark:text-yellow-400" };
  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Consent Record Manager" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Consent Record Manager</h1><p className="text-muted-foreground text-sm">NDPA 2023 — Lawful basis & consent lifecycle management</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1"/>New Consent</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Consent Record</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Organization</Label><Select onValueChange={v=>setForm(f=>({...f,organizationId:v}))}><SelectTrigger><SelectValue placeholder="Select org"/></SelectTrigger><SelectContent>{orgs.map((o:any)=><SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Subject Name</Label><Input value={form.dataSubjectName} onChange={e=>setForm(f=>({...f,dataSubjectName:e.target.value}))}/></div>
                <div><Label>Subject Email</Label><Input type="email" value={form.dataSubjectEmail} onChange={e=>setForm(f=>({...f,dataSubjectEmail:e.target.value}))}/></div>
              </div>
              <div><Label>Purpose</Label><Input value={form.purpose} onChange={e=>setForm(f=>({...f,purpose:e.target.value}))} placeholder="e.g., Marketing communications"/></div>
              <div><Label>Lawful Basis</Label><Select value={form.lawfulBasis} onValueChange={v=>setForm(f=>({...f,lawfulBasis:v}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["consent","contract","legal_obligation","vital_interests","public_task","legitimate_interests"].map(b=><SelectItem key={b} value={b}>{b.replace(/_/g,' ')}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Data Categories (comma-separated)</Label><Input value={form.dataCategories} onChange={e=>setForm(f=>({...f,dataCategories:e.target.value}))} placeholder="name, email, phone"/></div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.thirdPartySharing} onChange={e=>setForm(f=>({...f,thirdPartySharing:e.target.checked}))}/>Third-party sharing</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.crossBorderTransfer} onChange={e=>setForm(f=>({...f,crossBorderTransfer:e.target.checked}))}/>Cross-border transfer</label>
              </div>
              <Button className="w-full" disabled={!form.organizationId||!form.dataSubjectName||!form.dataSubjectEmail||createM.isPending} onClick={()=>createM.mutate({ organizationId:parseInt(form.organizationId), dataSubjectName:form.dataSubjectName, dataSubjectEmail:form.dataSubjectEmail, purpose:form.purpose, lawfulBasis:form.lawfulBasis as any, dataCategories:form.dataCategories.split(',').map(s=>s.trim()).filter(Boolean), thirdPartySharing:form.thirdPartySharing, crossBorderTransfer:form.crossBorderTransfer })}>{createM.isPending?"Creating...":"Create Consent Record"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {[{l:"Total",v:stats?.total??0,I:Users,c:"text-blue-600"},{l:"Active",v:stats?.active??0,I:CheckCircle,c:"text-green-600"},{l:"Withdrawn",v:stats?.withdrawn??0,I:XCircle,c:"text-red-600"},{l:"Expired",v:stats?.expired??0,I:Clock,c:"text-muted-foreground"},{l:"Expiring Soon",v:stats?.expiring_soon??0,I:Clock,c:"text-orange-600"},{l:"Cross-Border",v:stats?.cross_border??0,I:Users,c:"text-purple-600"}].map(({l,v,I,c})=>(
          <Card key={l}><CardContent className="pt-4"><div className="flex items-center gap-2"><I className={`h-4 w-4 ${c}`}/><div><p className="text-xs text-muted-foreground">{l}</p><p className="text-lg font-bold">{v}</p></div></div></CardContent></Card>
        ))}
      </div>
      <div className="flex gap-3">
        <Input placeholder="Search by name or email..." value={search} onChange={e=>setSearch(e.target.value)} className="max-w-xs"/>
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-40"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem>{["active","withdrawn","expired","pending"].map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
      </div>
      <Card><CardHeader><CardTitle>Consent Records ({list?.total??0})</CardTitle></CardHeader><CardContent>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-muted-foreground text-left"><th className="pb-2 pr-3">Subject</th><th className="pb-2 pr-3">Organization</th><th className="pb-2 pr-3">Purpose</th><th className="pb-2 pr-3">Lawful Basis</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3">3rd Party</th><th className="pb-2">Actions</th></tr></thead>
          <tbody>{(list?.data??[]).map((c:any)=>(
            <tr key={c.id} className="border-b hover:bg-muted/30">
              <td className="py-2 pr-3"><div className="font-medium">{c.data_subject_name}</div><div className="text-xs text-muted-foreground">{c.data_subject_email}</div></td>
              <td className="py-2 pr-3 text-xs">{c.org_name??'—'}</td>
              <td className="py-2 pr-3 max-w-40 truncate text-xs">{c.purpose}</td>
              <td className="py-2 pr-3 text-xs">{c.lawful_basis?.replace(/_/g,' ')}</td>
              <td className="py-2 pr-3"><Badge className={STATUS_COLORS[c.consent_status]??''}>{c.consent_status}</Badge></td>
              <td className="py-2 pr-3 text-xs">{c.third_party_sharing?"Yes":"No"}</td>
              <td className="py-2">{c.consent_status==='active'&&<Button variant="destructive" size="sm" className="h-7 text-xs" onClick={()=>withdrawM.mutate({id:c.id})}>Withdraw</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="flex justify-between mt-4"><p className="text-sm text-muted-foreground">Page {page}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Prev</Button><Button variant="outline" size="sm" disabled={(list?.data?.length??0)<20} onClick={()=>setPage(p=>p+1)}>Next</Button></div></div>
      </CardContent></Card>
    </div>
  );
}
