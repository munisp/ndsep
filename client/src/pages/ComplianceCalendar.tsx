import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CalendarDays, Clock, AlertTriangle, Plus, Pencil, Trash2, Search, RefreshCw } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20",
  warning: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  info: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
};
const STATUS_COLORS: Record<string, string> = {
  upcoming: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  in_progress: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  completed: "bg-green-500/15 text-green-600 dark:text-green-400",
  cancelled: "bg-muted text-muted-foreground",
};
const EVENT_TYPES = ["deadline","renewal","audit","training","reporting"];
const PRIORITIES = ["critical","warning","info"];
const STATUSES = ["upcoming","in_progress","completed","cancelled"];
const SECTORS = ["all","banking","telecom","healthcare","energy","insurance","fintech"];
const RECURRENCES = ["none","weekly","monthly","quarterly","annually"];

function fmt(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}

function EventForm({ initial, onSave, onClose, loading }: { initial?: any; onSave: (d: any) => void; onClose: () => void; loading: boolean }) {
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    eventType: initial?.event_type ?? "deadline",
    priority: initial?.priority ?? "info",
    eventDate: initial?.event_date ? new Date(initial.event_date).toISOString().slice(0,16) : "",
    sector: initial?.sector ?? "all",
    assignedTo: initial?.assigned_to ?? "",
    status: initial?.status ?? "upcoming",
    recurrence: initial?.recurrence ?? "none",
    reminderDays: initial?.reminder_days ?? 7,
    notes: initial?.notes ?? "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Title *</Label><Input value={form.title} onChange={e=>set("title",e.target.value)} placeholder="Event title"/></div>
        <div><Label>Event Date *</Label><Input type="datetime-local" value={form.eventDate} onChange={e=>set("eventDate",e.target.value)}/></div>
        <div><Label>Priority</Label><Select value={form.priority} onValueChange={v=>set("priority",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{PRIORITIES.map(p=><SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Event Type</Label><Select value={form.eventType} onValueChange={v=>set("eventType",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{EVENT_TYPES.map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Sector</Label><Select value={form.sector} onValueChange={v=>set("sector",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{SECTORS.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Status</Label><Select value={form.status} onValueChange={v=>set("status",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{STATUSES.map(s=><SelectItem key={s} value={s}>{s.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Recurrence</Label><Select value={form.recurrence} onValueChange={v=>set("recurrence",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{RECURRENCES.map(r=><SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Reminder (days before)</Label><Input type="number" min={1} max={90} value={form.reminderDays} onChange={e=>set("reminderDays",parseInt(e.target.value)||7)}/></div>
        <div><Label>Assigned To</Label><Input value={form.assignedTo} onChange={e=>set("assignedTo",e.target.value)} placeholder="Officer name or team"/></div>
        <div className="col-span-2"><Label>Description</Label><Textarea value={form.description} onChange={e=>set("description",e.target.value)} rows={2} placeholder="Event description..."/></div>
        <div className="col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={e=>set("notes",e.target.value)} rows={2} placeholder="Additional notes..."/></div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!form.title||!form.eventDate||loading} onClick={()=>onSave(form)}>{loading?"Saving...":"Save Event"}</Button>
      </div>
    </div>
  );
}

export default function ComplianceCalendar() {
  
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSector, setFilterSector] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<any>(null);

  const { data: upcoming, refetch: refetchUpcoming } = trpc.complianceCalendar.upcomingDeadlines.useQuery({ days: 60 });
  const { data: customEvents, refetch } = trpc.complianceCalendar.listCustom.useQuery({
    page, limit: 20,
    search: search || undefined,
    priority: filterPriority !== "all" ? filterPriority : undefined,
    status: filterStatus !== "all" ? filterStatus : undefined,
    sector: filterSector !== "all" ? filterSector : undefined,
  });

  const createM = trpc.complianceCalendar.createEvent.useMutation({
    onSuccess: () => { toast.success("Event created"); setCreateOpen(false); utils.complianceCalendar.listCustom.invalidate(); utils.complianceCalendar.upcomingDeadlines.invalidate(); },
    onError: (e) => toast.error("Error", { description: (e instanceof Error ? e.message : String(e)) }),
  });
  const updateM = trpc.complianceCalendar.updateEvent.useMutation({
    onSuccess: () => { toast.success("Event updated"); setEditEvent(null); utils.complianceCalendar.listCustom.invalidate(); utils.complianceCalendar.upcomingDeadlines.invalidate(); },
    onError: (e) => toast.error("Error", { description: (e instanceof Error ? e.message : String(e)) }),
  });
  const deleteM = trpc.complianceCalendar.deleteEvent.useMutation({
    onSuccess: () => { toast.success("Event deleted"); utils.complianceCalendar.listCustom.invalidate(); utils.complianceCalendar.upcomingDeadlines.invalidate(); },
    onError: (e) => toast.error("Error", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const handleCreate = (form: any) => createM.mutate({ title: form.title, description: form.description||undefined, eventType: form.eventType, priority: form.priority, eventDate: new Date(form.eventDate).toISOString(), sector: form.sector||undefined, assignedTo: form.assignedTo||undefined, status: form.status, recurrence: form.recurrence!=="none"?form.recurrence:undefined, reminderDays: form.reminderDays, notes: form.notes||undefined });
  const handleUpdate = (form: any) => updateM.mutate({ id: editEvent.id, title: form.title, description: form.description||undefined, priority: form.priority, eventDate: new Date(form.eventDate).toISOString(), status: form.status, assignedTo: form.assignedTo||undefined, notes: form.notes||undefined });

  const now = new Date();
  const critical7 = (upcoming??[]).filter((e:any)=>e.priority==="critical"&&new Date(e.deadline)<new Date(now.getTime()+7*24*60*60*1000)).length;
  const warning30 = (upcoming??[]).filter((e:any)=>e.priority==="warning").length;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Compliance Calendar" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-7 w-7 text-primary"/>
          <div><h1 className="text-2xl font-bold">Compliance Calendar</h1><p className="text-muted-foreground text-sm">Regulatory deadlines, DPO renewals, and compliance milestones</p></div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={()=>{refetch();refetchUpcoming();}}><RefreshCw className="h-4 w-4 mr-1"/>Refresh</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1"/>Add Event</Button></DialogTrigger>
            <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Create Compliance Event</DialogTitle></DialogHeader><EventForm onSave={handleCreate} onClose={()=>setCreateOpen(false)} loading={createM.isPending}/></DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500"/><div><p className="text-xs text-muted-foreground">Critical (next 7 days)</p><p className="text-2xl font-bold text-red-600">{critical7}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Clock className="h-4 w-4 text-yellow-500"/><div><p className="text-xs text-muted-foreground">Warnings (next 30 days)</p><p className="text-2xl font-bold text-yellow-600">{warning30}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-blue-500"/><div><p className="text-xs text-muted-foreground">Total Events (60 days)</p><p className="text-2xl font-bold">{(upcoming??[]).length}</p></div></div></CardContent></Card>
      </div>

      {(upcoming??[]).length>0&&(
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Upcoming Deadlines (Next 60 Days)</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {(upcoming??[]).slice(0,10).map((item:any,i:number)=>(
                <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-xs ${PRIORITY_COLORS[item.priority]??""}`}>{item.priority}</Badge>
                    <span className="font-medium">{item.title}</span>
                    {item.org_name&&<span className="text-muted-foreground">— {item.org_name}</span>}
                  </div>
                  <span className="text-muted-foreground text-xs">{fmt(item.deadline)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Compliance Events Registry</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"/>
              <Input className="pl-8 h-9 text-sm" placeholder="Search events..." value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
            </div>
            <Select value={filterPriority} onValueChange={v=>{setFilterPriority(v);setPage(1);}}>
              <SelectTrigger className="w-32 h-9 text-sm"><SelectValue placeholder="Priority"/></SelectTrigger>
              <SelectContent><SelectItem value="all">All Priorities</SelectItem>{PRIORITIES.map(p=><SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={v=>{setFilterStatus(v);setPage(1);}}>
              <SelectTrigger className="w-32 h-9 text-sm"><SelectValue placeholder="Status"/></SelectTrigger>
              <SelectContent><SelectItem value="all">All Statuses</SelectItem>{STATUSES.map(s=><SelectItem key={s} value={s}>{s.replace(/_/g," ")}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filterSector} onValueChange={v=>{setFilterSector(v);setPage(1);}}>
              <SelectTrigger className="w-32 h-9 text-sm"><SelectValue placeholder="Sector"/></SelectTrigger>
              <SelectContent><SelectItem value="all">All Sectors</SelectItem>{SECTORS.filter(s=>s!=="all").map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Title</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Priority</th><th className="py-2 pr-3">Sector</th><th className="py-2 pr-3">Event Date</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Assigned To</th><th className="py-2">Actions</th></tr></thead>
              <tbody>
                {(customEvents?.data??[]).length===0?(
                  <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">No events found</td></tr>
                ):(customEvents?.data??[]).map((ev:any)=>(
                  <tr key={ev.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 pr-3 font-medium max-w-[200px] truncate">{ev.title}</td>
                    <td className="py-2 pr-3 capitalize">{ev.event_type}</td>
                    <td className="py-2 pr-3"><Badge className={`text-xs ${PRIORITY_COLORS[ev.priority]??""}`}>{ev.priority}</Badge></td>
                    <td className="py-2 pr-3 capitalize">{ev.sector??"—"}</td>
                    <td className="py-2 pr-3">{fmt(ev.event_date)}</td>
                    <td className="py-2 pr-3"><Badge className={`text-xs ${STATUS_COLORS[ev.status]??""}`}>{ev.status?.replace(/_/g," ")}</Badge></td>
                    <td className="py-2 pr-3 text-muted-foreground">{ev.assigned_to??"—"}</td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={()=>setEditEvent(ev)} aria-label="Edit event"><Pencil className="h-3.5 w-3.5"/></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700" onClick={()=>{if(confirm("Delete this event?"))deleteM.mutate({id:ev.id});}} aria-label="Delete event"><Trash2 className="h-3.5 w-3.5"/></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center mt-4">
            <p className="text-sm text-muted-foreground">{customEvents?.total??0} events total</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Prev</Button>
              <span className="text-sm px-2 py-1">Page {page}</span>
              <Button variant="outline" size="sm" disabled={(customEvents?.data?.length??0)<20} onClick={()=>setPage(p=>p+1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {editEvent&&(
        <Dialog open={!!editEvent} onOpenChange={()=>setEditEvent(null)}>
          <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Edit Compliance Event</DialogTitle></DialogHeader><EventForm initial={editEvent} onSave={handleUpdate} onClose={()=>setEditEvent(null)} loading={updateM.isPending}/></DialogContent>
        </Dialog>
      )}
    </div>
  );
}
