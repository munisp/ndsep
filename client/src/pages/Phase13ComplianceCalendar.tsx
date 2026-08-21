import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Calendar, Plus, CheckCircle, Bell, Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default function Phase13ComplianceCalendar() {
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState({ title: "", event_type: "deadline", due_date: "", description: "", priority: "medium" as "low" | "medium" | "high" | "critical", reminder_days: 14 });

  const utils = trpc.useUtils();
  const { data: upcoming } = trpc.phase13.complianceCalendar.getUpcoming.useQuery({ days: 30 });
  const { data: events, isLoading } = trpc.phase13.complianceCalendar.list.useQuery({ status: statusFilter === "all" ? undefined : statusFilter || undefined });
  const create = trpc.phase13.complianceCalendar.create.useMutation({
    onSuccess: () => {
      utils.phase13.complianceCalendar.list.invalidate();
      utils.phase13.complianceCalendar.getUpcoming.invalidate();
      setOpen(false);
      toast.success("Compliance event created");
      setForm({ title: "", event_type: "deadline", due_date: "", description: "", priority: "medium", reminder_days: 14 });
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const complete = trpc.phase13.complianceCalendar.complete.useMutation({
    onSuccess: () => { utils.phase13.complianceCalendar.list.invalidate(); toast.success("Event marked complete"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteEvent = trpc.phase13.complianceCalendar.delete.useMutation({
    onSuccess: () => { utils.phase13.complianceCalendar.list.invalidate(); toast.success("Event deleted"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const eventList = (events as any[]) ?? [];
  const upcomingList = (upcoming as any[]) ?? [];
  const priorityColor: Record<string, string> = { critical: "text-red-700", high: "text-red-600", medium: "text-orange-500", low: "text-green-600" };

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Calendar className="h-6 w-6 text-blue-600" />
              Compliance Calendar
            </h1>
            <p className="text-muted-foreground mt-1">Track regulatory deadlines, audits, and compliance events</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Event</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>New Compliance Event</DialogTitle></DialogHeader>
              <div className="space-y-3 mt-2">
                <Input placeholder="Event Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                <Select value={form.event_type} onValueChange={v => setForm(f => ({ ...f, event_type: v }))}>
                  <SelectTrigger><SelectValue placeholder="Event Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deadline">Regulatory Deadline</SelectItem>
                    <SelectItem value="audit">Audit</SelectItem>
                    <SelectItem value="review">Policy Review</SelectItem>
                    <SelectItem value="training">Staff Training</SelectItem>
                    <SelectItem value="report">Report Submission</SelectItem>
                    <SelectItem value="renewal">Certificate Renewal</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as "low" | "medium" | "high" | "critical" }))}>
                  <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                <div>
                  <label className="text-sm font-medium">Reminder Days Before</label>
                  <Input type="number" value={form.reminder_days} onChange={e => setForm(f => ({ ...f, reminder_days: Number(e.target.value) }))} min={1} max={90} />
                </div>
                <Button className="w-full" onClick={() => create.mutate({ title: form.title, event_type: form.event_type, due_date: form.due_date, priority: form.priority, description: form.description || undefined, reminder_days: form.reminder_days })} disabled={create.isPending || !form.title || !form.due_date}>
                  {create.isPending ? "Creating..." : "Create Event"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {upcomingList.length > 0 && (
          <Card className="border-orange-500/20 bg-orange-50 dark:bg-orange-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-orange-700 dark:text-orange-400 flex items-center gap-2 text-base">
                <Bell className="h-4 w-4" />
                {upcomingList.length} Upcoming Events (Next 30 Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {upcomingList.slice(0, 5).map((e: any) => (
                  <div key={e.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{e.title}</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${priorityColor[e.priority] ?? ""}`}>{e.priority}</span>
                      <Badge variant="outline">{e.due_date ? new Date(e.due_date).toLocaleDateString() : "—"}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader><CardTitle>All Events ({eventList.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading events...</div>
            ) : eventList.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No compliance events scheduled</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Title</th>
                      <th className="text-left py-2 px-3">Type</th>
                      <th className="text-left py-2 px-3">Due Date</th>
                      <th className="text-left py-2 px-3">Priority</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventList.map((e: any) => (
                      <tr key={e.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">{e.title}</td>
                        <td className="py-2 px-3">{e.event_type?.replace(/_/g, " ")}</td>
                        <td className="py-2 px-3">{e.due_date ? new Date(e.due_date).toLocaleDateString() : "—"}</td>
                        <td className="py-2 px-3">
                          <span className={`font-medium ${priorityColor[e.priority] ?? ""}`}>{e.priority}</span>
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant={e.status === "completed" ? "default" : e.status === "overdue" ? "destructive" : "secondary"}>
                            {e.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            {e.status !== "completed" && (
                              <Button size="sm" variant="ghost" title="Mark Complete" onClick={() => complete.mutate({ id: e.id })}>
                                <CheckCircle className="h-3 w-3 text-green-600" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" title="Delete" onClick={() => deleteEvent.mutate({ id: e.id })}>
                              <Trash2 className="h-3 w-3 text-red-600" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
