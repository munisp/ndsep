import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Clock, CheckCircle, AlertTriangle, XCircle, RefreshCw, Download, Shield } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const timerColor: Record<string,string> = { completed:"bg-green-500/15 text-green-600 dark:text-green-400", on_track:"bg-blue-500/15 text-blue-600 dark:text-blue-400", warning:"bg-yellow-500/15 text-yellow-600 dark:text-yellow-400", critical:"bg-orange-500/15 text-orange-600 dark:text-orange-400", overdue:"bg-red-500/15 text-red-600 dark:text-red-400" };

export default function Article40Tracker() {
  const { data: timers, refetch, isRefetching } = trpc.article40Tracker.activeTimers.useQuery(undefined, { refetchInterval: 60_000 });
  const { data: sla } = trpc.article40Tracker.slaMetrics.useQuery();
  const notifyM = trpc.article40Tracker.notifyNdpc.useMutation({ onSuccess:(r)=>{ toast.success(`NDPC notified — Ref: ${r.referenceNumber}`); refetch(); }, onError:(e)=>toast.error((e instanceof Error ? e.message : String(e))) });
  const fmtH = (h:number) => h<0?`${Math.abs(Math.round(h))}h overdue`:h<1?`${Math.round(h*60)}m left`:`${Math.round(h)}h left`;
  const slaRate = sla ? Math.round((parseInt(sla.on_time??'0')/Math.max(1,parseInt(sla.notified??'0')))*100) : 0;
  const timerProgress = (hrs: number) => Math.max(0, Math.min(100, ((72 - hrs) / 72) * 100));

  const exportCsv = () => {
    if (!timers?.length) return;
    const rows = [["ID","Title","Org","Sector","Status","Hours Remaining","Detected At","Deadline","Notified At"]];
    for (const t of timers as Record<string, unknown>[]) {
      rows.push([String(t.id), String(t.title ?? ''), String(t.org_name ?? ''), String(t.sector ?? ''), String(t.timer_status ?? ''), String(t.hours_remaining ?? ''), String(t.detected_at ?? ''), String(t.ndpc_notification_deadline ?? ''), String(t.ndpc_notified_at ?? '')]);
    }
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `article40-timers-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Article40 Tracker" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Clock className="h-7 w-7 text-primary"/>
          <div>
            <h1 className="text-2xl font-bold">NDPA Article 40 Tracker</h1>
            <p className="text-muted-foreground text-sm">72-hour breach notification SLA monitoring — real-time countdown with auto-refresh</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isRefetching ? 'animate-spin' : ''}`}/>Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!(timers?.length)}>
            <Download className="h-4 w-4 mr-1"/>Export CSV
          </Button>
        </div>
      </div>

      {/* SLA Compliance Gauge */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Shield className={`h-5 w-5 ${slaRate >= 90 ? 'text-green-600' : slaRate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}/>
              <span className="text-sm font-medium">NDPA Art. 40 SLA Compliance</span>
            </div>
            <span className={`text-2xl font-bold ${slaRate >= 90 ? 'text-green-600' : slaRate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>{slaRate}%</span>
          </div>
          <Progress value={slaRate} className="h-3"/>
          <p className="text-xs text-muted-foreground mt-1">Target: 100% of breaches notified to NDPC within 72 hours</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[{l:"Total Breaches",v:sla?.total_breaches??0,I:AlertTriangle,c:"text-blue-600"},{l:"Notified",v:sla?.notified??0,I:CheckCircle,c:"text-green-600"},{l:"Overdue",v:sla?.overdue??0,I:XCircle,c:"text-red-600"},{l:"On-Time Rate",v:`${slaRate}%`,I:Clock,c:"text-green-600"},{l:"Avg Notify Time",v:`${Math.round(parseFloat(sla?.avg_notification_hours??'0'))}h`,I:Clock,c:"text-blue-600"}].map(({l,v,I,c})=>(
          <Card key={l}><CardContent className="pt-4"><div className="flex items-center gap-2"><I className={`h-4 w-4 ${c}`}/><div><p className="text-xs text-muted-foreground">{l}</p><p className="text-lg font-bold">{v}</p></div></div></CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active 72-Hour Timers ({(timers??[]).length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(timers??[]).map((b: Record<string, unknown>)=>{
              const hrs = parseFloat(String(b.hours_remaining ?? '0'));
              return (
                <div key={String(b.id)} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{String(b.title ?? '')}</p>
                      <Badge className={timerColor[String(b.timer_status ?? '')]??''}>{String(b.timer_status ?? '').replace(/_/g,' ')}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{String(b.org_name ?? '')} · {String(b.sector ?? '')} · Detected: {b.detected_at ? new Date(String(b.detected_at)).toLocaleString() : ''}</p>
                    {!b.ndpc_notified_at && (
                      <div className="mt-1.5">
                        <Progress value={timerProgress(hrs)} className={`h-1.5 ${hrs < 12 ? '[&>div]:bg-red-500' : hrs < 36 ? '[&>div]:bg-orange-500' : '[&>div]:bg-blue-500'}`}/>
                      </div>
                    )}
                  </div>
                  <div className="text-right mr-4">
                    {b.ndpc_notified_at ? <p className="text-green-600 text-sm font-semibold">Notified</p> : <>
                      <p className={`text-sm font-bold ${hrs<0?"text-red-600":hrs<12?"text-orange-600":"text-blue-600"}`}>{fmtH(hrs)}</p>
                      <p className="text-xs text-muted-foreground">Deadline: {b.ndpc_notification_deadline ? new Date(String(b.ndpc_notification_deadline)).toLocaleString() : ''}</p>
                    </>}
                  </div>
                  {!b.ndpc_notified_at && <Button size="sm" className="h-8" onClick={() => notifyM.mutate({breachId: b.id as number})} disabled={notifyM.isPending}>Notify NDPC</Button>}
                </div>
              );
            })}
            {(timers??[]).length===0 && <p className="text-center text-muted-foreground py-8">No active breach timers — all breaches notified or no recent incidents</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
