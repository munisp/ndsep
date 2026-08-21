import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Users, Plus, Play, XCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

type JobType = "data_export" | "erasure" | "portability" | "consent_withdrawal" | "rectification";

export default function Phase13BulkDsar() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    job_name: "", job_type: "data_export" as JobType, total_subjects: "", input_file_url: ""
  });

  const utils = trpc.useUtils();
  const { data: jobsData, isLoading } = trpc.phase13.bulkDsar.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter || undefined,
    search: searchQuery || undefined,
    page: currentPage,
    limit: 20,
  });

  // Handle both paginated { items, total, totalPages } and legacy flat array responses
  const list: any[] = (jobsData as any)?.items ?? (Array.isArray(jobsData) ? (jobsData as any[]) : []);
  const totalPages: number = (jobsData as any)?.totalPages ?? 1;
  const totalJobs: number = (jobsData as any)?.total ?? list.length;

  const create = trpc.phase13.bulkDsar.create.useMutation({
    onSuccess: () => {
      utils.phase13.bulkDsar.list.invalidate();
      setOpen(false);
      toast.success("Bulk DSAR job created");
      setForm({ job_name: "", job_type: "data_export", total_subjects: "", input_file_url: "" });
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const process = trpc.phase13.bulkDsar.process.useMutation({
    onSuccess: (data: any) => {
      utils.phase13.bulkDsar.list.invalidate();
      toast.success(`Job processed: ${data.processed} subjects`);
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const cancel = trpc.phase13.bulkDsar.cancel.useMutation({
    onSuccess: () => { utils.phase13.bulkDsar.list.invalidate(); toast.success("Job cancelled"); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const statusColor: Record<string, "default" | "secondary" | "destructive"> = {
    completed: "default",
    in_progress: "secondary",
    pending: "secondary",
    cancelled: "destructive",
    failed: "destructive",
  };

  const jobTypeLabels: Record<string, string> = {
    data_export: "Data Export",
    erasure: "Erasure (Right to be Forgotten)",
    portability: "Data Portability",
    consent_withdrawal: "Consent Withdrawal",
    rectification: "Data Rectification",
  };

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-violet-600" />
              Bulk DSAR Processing
            </h1>
            <p className="text-muted-foreground mt-1">Batch process Data Subject Access Requests — NDPA Section 34</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />New Job</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Create Bulk DSAR Job</DialogTitle></DialogHeader>
              <div className="space-y-3 mt-2">
                <Input placeholder="Job Name (e.g. Q1-2026-Erasure-Batch)" value={form.job_name} onChange={e => setForm(f => ({ ...f, job_name: e.target.value }))} />
                <Select value={form.job_type} onValueChange={v => setForm(f => ({ ...f, job_type: v as JobType }))}>
                  <SelectTrigger><SelectValue placeholder="Job Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="data_export">Data Export</SelectItem>
                    <SelectItem value="erasure">Erasure (Right to be Forgotten)</SelectItem>
                    <SelectItem value="portability">Data Portability</SelectItem>
                    <SelectItem value="consent_withdrawal">Consent Withdrawal</SelectItem>
                    <SelectItem value="rectification">Data Rectification</SelectItem>
                  </SelectContent>
                </Select>
                <div>
                  <label className="text-sm font-medium">Total Data Subjects</label>
                  <Input type="number" placeholder="e.g. 500" value={form.total_subjects} onChange={e => setForm(f => ({ ...f, total_subjects: e.target.value }))} />
                </div>
                <Input placeholder="Input File URL (optional)" value={form.input_file_url} onChange={e => setForm(f => ({ ...f, input_file_url: e.target.value }))} />
                <Button className="w-full"
                  onClick={() => create.mutate({
                    job_name: form.job_name,
                    job_type: form.job_type,
                    total_subjects: Number(form.total_subjects) || 0,
                    input_file_url: form.input_file_url || undefined,
                  })}
                  disabled={create.isPending || !form.job_name}>
                  {create.isPending ? "Creating..." : "Create Job"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Jobs", value: totalJobs, color: "text-blue-600" },
            { label: "Pending", value: list.filter((j: any) => j.status === "pending").length, color: "text-orange-600" },
            { label: "In Progress", value: list.filter((j: any) => j.status === "in_progress").length, color: "text-purple-600" },
            { label: "Completed", value: list.filter((j: any) => j.status === "completed").length, color: "text-green-600" },
          ].map((card) => (
            <Card key={card.label}>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <Input
            placeholder="Search jobs..."
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            className="w-56"
          />
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader><CardTitle>DSAR Jobs ({totalJobs})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading jobs...</div>
            ) : list.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No bulk DSAR jobs found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Job Name</th>
                      <th className="text-left py-2 px-3">Type</th>
                      <th className="text-left py-2 px-3">Total Subjects</th>
                      <th className="text-left py-2 px-3">Processed</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Created</th>
                      <th className="text-left py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((j: any) => {
                      const progress = j.total_subjects > 0 ? Math.round((j.processed_count / j.total_subjects) * 100) : 0;
                      return (
                        <tr key={j.id} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-3 font-medium">{j.job_name}</td>
                          <td className="py-2 px-3">{jobTypeLabels[j.job_type] ?? j.job_type}</td>
                          <td className="py-2 px-3">{j.total_subjects?.toLocaleString()}</td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <span>{j.processed_count ?? 0}</span>
                              {j.status === "completed" && (
                                <div className="flex-1 h-1.5 bg-muted rounded-full min-w-[40px]">
                                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${progress}%` }} />
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <Badge variant={statusColor[j.status] ?? "secondary"}>{j.status}</Badge>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">{j.created_at ? new Date(j.created_at).toLocaleDateString() : "—"}</td>
                          <td className="py-2 px-3">
                            <div className="flex gap-1">
                              {j.status === "pending" && (
                                <Button size="sm" variant="ghost" title="Process" onClick={() => process.mutate({ id: j.id })}>
                                  <Play className="h-3 w-3 text-green-600" />
                                </Button>
                              )}
                              {(j.status === "pending" || j.status === "in_progress") && (
                                <Button size="sm" variant="ghost" title="Cancel" onClick={() => cancel.mutate({ id: j.id })}>
                                  <XCircle className="h-3 w-3 text-red-600" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages} ({totalJobs} total jobs)
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
