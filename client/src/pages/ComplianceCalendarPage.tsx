/**
 * Compliance Calendar & SLA Enforcement
 * Deadline tracking, SLA monitoring, overdue alerts
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, AlertTriangle, Clock, CheckCircle2, Plus } from "lucide-react";

const priorityColor: Record<string, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  medium: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  low: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
};

const deadlineTypeLabel: Record<string, string> = {
  dsar_response: "DSAR Response",
  breach_notification: "Breach Notification",
  car_submission: "CAR Submission",
  licence_renewal: "Licence Renewal",
  dpia_review: "DPIA Review",
  audit_return: "Audit Return",
};

export default function ComplianceCalendarPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: "", deadlineType: "dsar_response", dueDate: "", priority: "medium", notes: "" });

  const { data: deadlines, refetch } = trpc.complianceCalendarP11.getUpcomingDeadlines.useQuery({ days: 365 });
  const { data: slaStats } = trpc.slaEnforcement.getStats.useQuery();

  const addMut = trpc.complianceCalendarP11.createDeadline.useMutation({
    onSuccess: () => { toast.success("Deadline added"); setAddOpen(false); refetch(); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const completeMut = trpc.complianceCalendarP11.createDeadline.useMutation({
    onSuccess: () => { toast.success("Marked as complete"); refetch(); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const deadlinesData = (deadlines as any) ?? [];
  const overdueData = deadlinesData.filter((d: any) => new Date(d.due_date) < new Date() && d.status !== 'completed');
  const sla = slaStats as any;

  const daysUntil = (date: string) => {
    const diff = new Date(date).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Calendar className="w-6 h-6 text-purple-600" />
              Compliance Calendar & SLA Enforcement
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Regulatory deadlines, SLA monitoring, and automated overdue alerts</p>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />Add Deadline</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Compliance Deadline</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div><Label>Title</Label><Input value={form.title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, title: e.target.value }))} /></div>
                <div>
                  <Label>Type</Label>
                  <Select value={form.deadlineType} onValueChange={v => setForm(f => ({ ...f, deadlineType: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(deadlineTypeLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Due Date</Label><Input type="datetime-local" value={form.dueDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
                <div>
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="critical">Critical</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
                <Button className="w-full" onClick={() => addMut.mutate({ title: form.title, deadlineType: form.deadlineType as any, dueDate: form.dueDate, priority: form.priority as any, notes: form.notes })} disabled={addMut.isPending || !form.title || !form.dueDate}>
                  {addMut.isPending ? "Adding..." : "Add Deadline"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* SLA Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Deadlines", value: sla?.total ?? deadlinesData.length, icon: Calendar, color: "text-purple-600" },
            { label: "Overdue", value: overdueData.length, icon: AlertTriangle, color: "text-red-600" },
            { label: "Due This Week", value: sla?.due_this_week ?? 0, icon: Clock, color: "text-orange-600" },
            { label: "Completed", value: sla?.completed ?? 0, icon: CheckCircle2, color: "text-green-600" },
          ].map(s => (
            <div key={s.label} className="border rounded-lg p-4 flex items-center gap-3">
              <s.icon className={`w-8 h-8 ${s.color}`} />
              <div>
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Overdue alerts */}
        {overdueData.length > 0 && (
          <div className="border border-red-500/20 bg-red-50 rounded-lg p-4">
            <h3 className="font-semibold text-red-800 flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4" />{overdueData.length} Overdue Deadline{overdueData.length > 1 ? 's' : ''}
            </h3>
            <div className="space-y-2">
              {overdueData.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between bg-background rounded p-2 border border-red-100">
                  <div>
                    <div className="font-medium text-sm">{d.title}</div>
                    <div className="text-xs text-red-600">{Math.abs(daysUntil(d.due_date))} days overdue</div>
                  </div>
                  <Badge className="bg-red-500/15 text-red-600 dark:text-red-400">{deadlineTypeLabel[d.deadline_type] ?? d.deadline_type}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All deadlines */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3 font-medium">Title</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Due Date</th>
                <th className="text-left p-3 font-medium">Days Left</th>
                <th className="text-left p-3 font-medium">Priority</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {deadlinesData.length === 0 ? (
                <tr><td colSpan={7} className="text-center p-8 text-muted-foreground">No deadlines found</td></tr>
              ) : deadlinesData.map((d: any) => {
                const days = daysUntil(d.due_date);
                return (
                  <tr key={d.id} className="border-t hover:bg-muted/30">
                    <td className="p-3 font-medium">{d.title}</td>
                    <td className="p-3">{deadlineTypeLabel[d.deadline_type] ?? d.deadline_type}</td>
                    <td className="p-3">{new Date(d.due_date).toLocaleDateString()}</td>
                    <td className="p-3">
                      <span className={days < 0 ? "text-red-600 font-bold" : days <= 3 ? "text-orange-600 font-semibold" : "text-foreground"}>
                        {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                      </span>
                    </td>
                    <td className="p-3"><Badge className={priorityColor[d.priority] ?? "bg-muted"}>{d.priority}</Badge></td>
                    <td className="p-3"><Badge className={d.status === 'completed' ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"}>{d.status}</Badge></td>
                    <td className="p-3">
                      {d.status !== 'completed' && (
                        <Button size="sm" variant="outline" onClick={() => completeMut.mutate({ title: d.title, deadlineType: d.deadline_type, dueDate: d.due_date, priority: d.priority, notes: 'Completed' })} disabled={completeMut.isPending}>
                          <CheckCircle2 className="w-3 h-3 mr-1" />Complete
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
