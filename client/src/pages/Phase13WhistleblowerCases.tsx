import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Eye, Search, AlertTriangle, CheckCircle, UserX } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EmptyState } from "@/components/EmptyState";

type WBStatus = "new" | "under_investigation" | "resolved" | "closed" | "escalated";

export default function Phase13WhistleblowerCases() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [selectedCase, setSelectedCase] = useState<any>(null);
  const [updateForm, setUpdateForm] = useState({ status: "" as WBStatus | "", assigned_to: "", investigation_notes: "", resolution: "" });

  const utils = trpc.useUtils();
  const { data: cases, isLoading } = trpc.phase13.whistleblowerCases.list.useQuery({
    search: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter || undefined,
    severity: severityFilter === "all" ? undefined : severityFilter || undefined,
  });
  const { data: stats } = trpc.phase13.whistleblowerCases.getStats.useQuery();
  const updateStatus = trpc.phase13.whistleblowerCases.updateStatus.useMutation({
    onSuccess: () => {
      utils.phase13.whistleblowerCases.list.invalidate();
      utils.phase13.whistleblowerCases.getStats.invalidate();
      setSelectedCase(null);
      toast.success("Case status updated");
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const list = (cases as any[]) ?? [];
  const statsData = stats as any;

  const statusColor: Record<string, "default" | "secondary" | "destructive"> = {
    resolved: "default",
    closed: "default",
    under_investigation: "secondary",
    new: "secondary",
    escalated: "destructive",
  };

  const severityColor: Record<string, string> = {
    critical: "bg-red-500/15 text-red-600 dark:text-red-400",
    high: "text-red-600 bg-red-50 dark:bg-red-950/20",
    medium: "text-orange-600 bg-orange-50 dark:bg-orange-950/20",
    low: "text-green-600 bg-green-50 dark:bg-green-950/20",
  };

  return (
    <>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Eye className="h-6 w-6 text-amber-600" />
            Whistleblower Case Management
          </h1>
          <p className="text-muted-foreground mt-1">Confidential NDPA violation reports and investigation tracking</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[
            { label: "Total Cases", value: statsData?.total ?? "—", color: "text-blue-600" },
            { label: "New", value: statsData?.new_cases ?? "—", color: "text-orange-600" },
            { label: "Investigating", value: statsData?.investigating ?? "—", color: "text-purple-600" },
            { label: "Resolved", value: statsData?.resolved ?? "—", color: "text-green-600" },
            { label: "Critical", value: statsData?.critical ?? "—", color: "text-red-600" },
          ].map((card) => (
            <Card key={card.label}>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by case reference or description..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="under_investigation">Under Investigation</SelectItem>
              <SelectItem value="escalated">Escalated</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All Severities" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader><CardTitle>Cases ({list.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading cases...</div>
            ) : list.length === 0 ? (
              <EmptyState title="No whistleblower cases" description="No whistleblower reports have been filed" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Case Reference</th>
                      <th className="text-left py-2 px-3">Category</th>
                      <th className="text-left py-2 px-3">Severity</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Assigned To</th>
                      <th className="text-left py-2 px-3">Opened</th>
                      <th className="text-left py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c: any) => (
                      <tr key={c.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-mono text-xs font-semibold">{c.case_reference ?? `WB-${c.id}`}</td>
                        <td className="py-2 px-3">{c.category?.replace(/_/g, " ") ?? "—"}</td>
                        <td className="py-2 px-3">
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${severityColor[c.severity] ?? ""}`}>
                            {c.severity ?? "—"}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant={statusColor[c.status] ?? "secondary"}>{c.status?.replace(/_/g, " ")}</Badge>
                        </td>
                        <td className="py-2 px-3">{c.assigned_to ?? "Unassigned"}</td>
                        <td className="py-2 px-3 text-muted-foreground">{c.opened_at ? new Date(c.opened_at).toLocaleDateString() : "—"}</td>
                        <td className="py-2 px-3">
                          <Button size="sm" variant="ghost" onClick={() => {
                            setSelectedCase(c);
                            setUpdateForm({ status: c.status, assigned_to: c.assigned_to ?? "", investigation_notes: c.investigation_notes ?? "", resolution: c.resolution ?? "" });
                          }}>
                            <Eye className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!selectedCase} onOpenChange={() => setSelectedCase(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Update Case: {selectedCase?.case_reference ?? `WB-${selectedCase?.id}`}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              <div className="bg-muted/50 rounded p-3 text-sm">
                <p className="font-medium mb-1">Description</p>
                <p className="text-muted-foreground">{selectedCase?.description ?? "No description provided"}</p>
              </div>
              <Select value={updateForm.status} onValueChange={v => setUpdateForm(f => ({ ...f, status: v as WBStatus }))}>
                <SelectTrigger><SelectValue placeholder="Update Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="under_investigation">Under Investigation</SelectItem>
                  <SelectItem value="escalated">Escalated</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Assign to (investigator name)" value={updateForm.assigned_to} onChange={e => setUpdateForm(f => ({ ...f, assigned_to: e.target.value }))} />
              <textarea
                className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Investigation notes..."
                value={updateForm.investigation_notes}
                onChange={e => setUpdateForm(f => ({ ...f, investigation_notes: e.target.value }))}
              />
              <textarea
                className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Resolution (if resolved/closed)..."
                value={updateForm.resolution}
                onChange={e => setUpdateForm(f => ({ ...f, resolution: e.target.value }))}
              />
              <Button className="w-full"
                onClick={() => updateStatus.mutate({
                  id: selectedCase.id,
                  status: updateForm.status as WBStatus,
                  assigned_to: updateForm.assigned_to || undefined,
                  investigation_notes: updateForm.investigation_notes || undefined,
                  resolution: updateForm.resolution || undefined,
                })}
                disabled={updateStatus.isPending || !updateForm.status}>
                {updateStatus.isPending ? "Updating..." : "Update Case"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
