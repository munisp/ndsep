import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PageSkeleton } from "@/components/SkeletonLoaders";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Plus, Search, Clock, Shield, Bell, CalendarDays, X, ExternalLink, CheckCircle2, Download, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-blue-500/20 text-primary border-blue-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  high: "bg-orange-500/20 text-primary border-orange-500/30",
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
};
const STATUS_COLORS: Record<string, string> = {
  detected: "bg-red-500/20 text-red-400 border-red-500/30",
  assessing: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  ndpc_notified: "bg-blue-500/20 text-primary border-blue-500/30",
  individuals_notified: "bg-purple-500/20 text-primary border-purple-500/30",
  contained: "bg-teal-500/20 text-primary border-teal-500/30",
  resolved: "bg-green-500/20 text-green-400 border-green-500/30",
  closed: "bg-muted/400/20 text-muted-foreground border-border/30",
};

function BreachSlaHeatmap() {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const { data: heatmapData = [] } = trpc.ndpaStats.breachSlaHeatmap.useQuery({ days: 365 });
  const { data: drilldownData = [], isLoading: drillLoading } = trpc.ndpaStats.breachDrilldown.useQuery(
    { date: selectedDay! },
    { enabled: !!selectedDay }
  );
  const markNotifiedMutation = trpc.breaches.update.useMutation({
    onSuccess: () => { toast.success("Marked as NDPC Notified"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  if (heatmapData.length === 0) return null;

  // Build a full 52-week grid
  const today = new Date(); today.setHours(0,0,0,0);
  const startDate = new Date(today); startDate.setDate(today.getDate() - 364);
  const dayMap = new Map<string, typeof heatmapData[0]>();
  heatmapData.forEach(d => {
    const key = new Date(String(d.day)).toISOString().slice(0,10);
    dayMap.set(key, d);
  });
  const weeks: Array<Array<{ date: Date; key: string; data: typeof heatmapData[0] | null }>> = [];
  let current = new Date(startDate);
  while (current <= today) {
    const week: Array<{ date: Date; key: string; data: typeof heatmapData[0] | null }> = [];
    for (let d = 0; d < 7; d++) {
      const key = current.toISOString().slice(0,10);
      week.push({ date: new Date(current), key, data: dayMap.get(key) ?? null });
      current.setDate(current.getDate() + 1);
      if (current > today) break;
    }
    weeks.push(week);
  }
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const getCellColor = (d: typeof heatmapData[0] | null) => {
    if (!d || d.totalBreaches === 0) return 'bg-muted/30';
    if (d.slaBreached > 0) return 'bg-red-500/70';
    if (d.slaRate >= 100) return 'bg-green-500/70';
    if (d.slaRate >= 80) return 'bg-yellow-500/70';
    return 'bg-orange-500/70';
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <CalendarDays className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Breach SLA Heatmap — 12 Month View</h3>
        <span className="ml-auto mono text-[10px] text-muted-foreground">72h NDPC SLA compliance per day</span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        <div className="flex flex-col gap-1 mr-1 pt-5">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
            <div key={d} className="h-3 text-[9px] text-muted-foreground mono w-6 leading-3">{d}</div>
          ))}
        </div>
        <TooltipProvider delayDuration={100}>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {wi === 0 || (week[0] && week[0].date.getDate() <= 7) ? (
                <div className="h-4 text-[9px] text-muted-foreground mono text-center">
                  {week[0] ? months[week[0].date.getMonth()] : ''}
                </div>
              ) : <div className="h-4" />}
              {week.map(({ date, key, data }) => (
                <Tooltip key={key}>
                  <TooltipTrigger asChild>
                    <div
                      className={`h-3 w-3 rounded-sm cursor-pointer transition-transform hover:scale-125 ${getCellColor(data)} ${data && data.totalBreaches > 0 ? 'ring-1 ring-white/10 hover:ring-white/40' : ''}`}
                      onClick={() => data && data.totalBreaches > 0 ? setSelectedDay(key) : undefined}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs font-mono">
                    <div className="font-semibold">{date.toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' })}</div>
                    {data ? (
                      <>
                        <div>Breaches: {data.totalBreaches} ({data.criticalCount} critical)</div>
                        <div>SLA Met: {data.slaMet} / Breached: {data.slaBreached}</div>
                        <div>SLA Rate: {data.slaRate}%</div>
                      </>
                    ) : <div>No incidents</div>}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          ))}
        </TooltipProvider>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <span className="text-[10px] text-muted-foreground">SLA Status:</span>
        {[{color:'bg-muted/30',label:'No incidents'},{color:'bg-green-500/70',label:'100% SLA'},{color:'bg-yellow-500/70',label:'80–99%'},{color:'bg-orange-500/70',label:'<80%'},{color:'bg-red-500/70',label:'SLA breached'}].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <div className={`h-3 w-3 rounded-sm ${l.color}`} />
            <span className="text-[10px] text-muted-foreground">{l.label}</span>
          </div>
        ))}
      </div>
      {/* Drill-down slide-over */}
      <Sheet open={!!selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl bg-background border-border overflow-y-auto">
          <SheetHeader className="mb-4">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-foreground flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" />
                Breach Incidents — {selectedDay ? new Date(selectedDay + 'T00:00:00').toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''}
              </SheetTitle>
              {drilldownData.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs shrink-0"
                  onClick={() => {
                    const headers = ['Title', 'Organisation', 'Severity', 'Status', 'Detected At', 'Affected Individuals', '72h Deadline', 'SLA Status', 'NDPC Ref'];
                    const rows = (drilldownData as any[]).map(r => [
                      `"${(r.title ?? '').replace(/"/g, '""')}"`,
                      `"${(r.orgName ?? `Org #${r.id}`).replace(/"/g, '""')}"`,
                      r.severity ?? '',
                      (r.status ?? '').replace('_', ' '),
                      r.detectedAt ? new Date(r.detectedAt).toISOString() : '',
                      r.affectedCount ?? 0,
                      r.ndpcDeadline ? new Date(r.ndpcDeadline).toISOString() : '',
                      r.slaBreached ? 'BREACHED' : 'MET',
                      r.ndpcRef ?? '',
                    ]);
                    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `ndsep-breaches-${selectedDay}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="w-3 h-3 mr-1" />Download CSV
                </Button>
              )}
            </div>
          </SheetHeader>
          {drillLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading incidents...</div>
          ) : drilldownData.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No breach incidents found for this day.</div>
          ) : (
            <div className="space-y-3">
              {(drilldownData as any[]).map((r: any) => (
                <div key={r.id} className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground text-sm truncate">{r.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{r.orgName ?? `Org #${r.id}`}</div>
                    </div>
                    <div className="flex gap-1.5 ml-2 shrink-0">
                      <Badge className={`text-xs border ${SEVERITY_COLORS[r.severity] ?? ''}`}>{r.severity}</Badge>
                      <Badge className={`text-xs border ${STATUS_COLORS[r.status] ?? ''}`}>{r.status?.replace('_',' ')}</Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground mb-3">
                    <div>Detected: {new Date(r.detectedAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</div>
                    <div>Affected: {r.affectedCount.toLocaleString()} individuals</div>
                    {r.ndpcDeadline && <div className={r.slaBreached ? 'text-red-400 font-medium' : 'text-green-400'}>72h Deadline: {new Date(r.ndpcDeadline).toLocaleString('en-NG', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</div>}
                    {r.ndpcRef && <div>NDPC Ref: <span className="font-mono">{r.ndpcRef}</span></div>}
                  </div>
                  {r.slaBreached && (
                    <div className="flex items-center gap-1.5 text-xs text-red-400 mb-3">
                      <AlertTriangle className="w-3 h-3" />
                      <span>72h SLA BREACHED — NDPC notification overdue</span>
                    </div>
                  )}
                  {r.ndpcNotifiedAt && (
                    <div className="flex items-center gap-1.5 text-xs text-green-400 mb-3">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>NDPC notified at {new Date(r.ndpcNotifiedAt).toLocaleString('en-NG', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {!r.ndpcNotifiedAt && (
                      <Button
                        size="sm"
                        className="text-xs bg-primary hover:bg-primary/90"
                        onClick={() => markNotifiedMutation.mutate({ id: r.id, status: 'ndpc_notified' })}
                        disabled={markNotifiedMutation.isPending}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" />Mark NDPC Notified
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => window.location.href = '/breach-notification'}
                    >
                      <ExternalLink className="w-3 h-3 mr-1" />View Full Incident
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default function BreachNotification() {
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ organizationId: "", title: "", description: "", severity: "medium", breachCause: "", affectedIndividualsCount: "" });

  const { data: incidents = [], refetch, isLoading } = trpc.breaches.list.useQuery({ status: statusFilter === "all" ? undefined : statusFilter });
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const createMutation = trpc.breaches.create.useMutation({ onSuccess: () => { toast.success("Breach incident created — 72-hour NDPC notification countdown started"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const utils = trpc.useUtils();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const updateMutation = trpc.breaches.update.useMutation({ onSuccess: () => { toast.success("Breach status updated"); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const deleteMutation = trpc.breaches.delete.useMutation({ onSuccess: () => { toast.success("Breach incident deleted"); setDeleteId(null); utils.breaches.list.invalidate().catch(() => {}); }, onError: (err) => toast.error(err.message || "Failed to delete") });

  const filtered = (incidents as any[]).filter((r: any) => !searchQuery || r.title?.toLowerCase().includes(searchQuery.toLowerCase()));
  const getTimeRemaining = (deadline: string) => {
    const diff = new Date(deadline).getTime() - Date.now();
    if (diff <= 0) return "OVERDUE";
    const hours = Math.floor(diff / 3600000);
    return `${hours}h remaining`;
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Breach Notification" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-red-400" /></div>
            <div>
              <div className="text-xs text-red-400 font-mono uppercase tracking-widest">NDPA S.47 / GAID Art. 31-36</div>
              <h1 className="text-2xl font-bold text-foreground">Data Breach Notification</h1>
            </div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">72-hour NDPC notification tracking, breach lifecycle management, and affected individual notification per NDPA requirements.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Incidents", value: (incidents as any[]).length, icon: AlertTriangle, color: "text-red-400" },
            { label: "Active", value: (incidents as any[]).filter((i: any) => !["resolved","closed"].includes(i.breach_incident_status)).length, icon: Bell, color: "text-yellow-400" },
            { label: "NDPC Notified", value: (incidents as any[]).filter((i: any) => i.ndpc_notified_at).length, icon: Shield, color: "text-primary" },
            { label: "Overdue", value: (incidents as any[]).filter((i: any) => i.ndpc_notification_deadline && new Date(i.ndpc_notification_deadline) < new Date() && !i.ndpc_notified_at).length, icon: Clock, color: "text-red-400" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <BreachSlaHeatmap />
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search incidents..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-background border-border"><SelectItem value="all" className="text-foreground">All Status</SelectItem>
              {Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace("_"," ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => setShowCreate(true)} className="bg-destructive hover:bg-destructive/90 text-foreground"><Plus className="w-4 h-4 mr-2" />Report Breach</Button>
        </div>
        <div className="space-y-3">
          {isLoading ? <PageSkeleton />
          : filtered.length === 0 ? <div className="text-center py-8 text-muted-foreground/70">No breach incidents found</div>
          : filtered.map((r: any) => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-medium text-foreground">{r.title}</div>
                  <div className="text-xs text-muted-foreground/70 mt-1">{r.org_name ?? `Org #${r.organization_id}`} &middot; Detected {new Date(r.detected_at).toLocaleString()}</div>
                </div>
                <div className="flex gap-2">
                  <Badge className={`text-xs border ${SEVERITY_COLORS[r.breach_incident_severity] ?? ""}`}>{r.breach_incident_severity}</Badge>
                  <Badge className={`text-xs border ${STATUS_COLORS[r.breach_incident_status] ?? ""}`}>{r.breach_incident_status?.replace("_"," ")}</Badge>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-3">
                <div className={`text-xs font-mono ${r.ndpc_notification_deadline && new Date(r.ndpc_notification_deadline) < new Date() && !r.ndpc_notified_at ? "text-red-400" : "text-yellow-400"}`}>
                  <Clock className="w-3 h-3 inline mr-1" />NDPC Deadline: {r.ndpc_notification_deadline ? getTimeRemaining(r.ndpc_notification_deadline) : "N/A"}
                </div>
                {r.affected_individuals_count > 0 && <div className="text-xs text-muted-foreground">{r.affected_individuals_count.toLocaleString()} individuals affected</div>}
                <div className="flex gap-2 ml-auto">
                  {r.breach_incident_status === "detected" && <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: r.id, status: "assessing" })}>Begin Assessment</Button>}
                  {r.breach_incident_status === "assessing" && <Button size="sm" className="text-xs bg-primary hover:bg-primary/90" onClick={() => updateMutation.mutate({ id: r.id, status: "ndpc_notified" })}>Notify NDPC</Button>}
                  {r.breach_incident_status === "ndpc_notified" && <Button size="sm" className="text-xs bg-primary hover:bg-primary/90" onClick={() => updateMutation.mutate({ id: r.id, status: "individuals_notified" })}>Notify Individuals</Button>}
                  {["individuals_notified","contained"].includes(r.breach_incident_status) && <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700" onClick={() => updateMutation.mutate({ id: r.id, status: "resolved" })}>Resolve</Button>}
                  <Button size="sm" variant="outline" className="text-xs border-red-800 text-red-400 hover:bg-red-900/30" onClick={() => setDeleteId(r.id)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-xl">
          <DialogHeader><DialogTitle>Report Data Breach</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-muted-foreground text-sm">Organization *</Label>
              <Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-muted-foreground text-sm">Title *</Label><Input value={form.title} onChange={e => setForm(p => ({...p, title: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div><Label className="text-muted-foreground text-sm">Description</Label><Textarea value={form.description} onChange={e => setForm(p => ({...p, description: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={3} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Severity</Label>
                <Select value={form.severity} onValueChange={v => setForm(p => ({...p, severity: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-background border-border">{["low","medium","high","critical"].map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-muted-foreground text-sm">Affected Individuals</Label><Input type="number" value={form.affectedIndividualsCount} onChange={e => setForm(p => ({...p, affectedIndividualsCount: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Breach Cause</Label><Input value={form.breachCause} onChange={e => setForm(p => ({...p, breachCause: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-3 text-xs text-red-300">A 72-hour NDPC notification deadline will be automatically set from the time of creation.</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: Number(form.organizationId), title: form.title, description: form.description || undefined, severity: form.severity as any, breachCause: form.breachCause || undefined, affectedIndividualsCount: form.affectedIndividualsCount ? Number(form.affectedIndividualsCount) : undefined })}
              disabled={!form.organizationId || !form.title || createMutation.isPending} className="bg-destructive hover:bg-destructive/90 text-foreground">
              {createMutation.isPending ? "Reporting..." : "Report Breach"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
