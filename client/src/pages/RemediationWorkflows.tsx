import React, { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wrench, CheckCircle2, Clock, AlertCircle, RotateCcw, Trash2, Plus } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-500/20 text-red-400",
  in_progress: "bg-yellow-500/20 text-yellow-400",
  resolved: "bg-green-500/20 text-green-400",
  closed: "bg-muted0/20 text-muted-foreground",
};

const STATUS_ICONS: Record<string, React.ReactElement> = {
  open: <AlertCircle className="w-3 h-3" />,
  in_progress: <Clock className="w-3 h-3" />,
  resolved: <CheckCircle2 className="w-3 h-3" />,
  closed: <RotateCcw className="w-3 h-3" />,
};

export default function RemediationWorkflows() {
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [updateTarget, setUpdateTarget] = useState<{ id: number; currentStatus: string } | null>(null);
  const [updateForm, setUpdateForm] = useState({ status: "", notes: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ orgId: "", actionType: "", priority: "medium", description: "", notes: "" });
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: workflows = [], refetch } = trpc.remediation.list.useQuery({ status: filterStatus === "all" ? undefined : filterStatus || undefined });
  const { data: stats } = trpc.remediation.stats.useQuery();
  const utils = trpc.useUtils();

  const createMutation = trpc.remediation.create.useMutation({
    onSuccess: () => {
      toast.success("Remediation workflow created");
      setShowCreate(false);
      setCreateForm({ orgId: "", actionType: "", priority: "medium", description: "", notes: "" });
      utils.remediation.list.invalidate().catch(() => {});
      utils.remediation.stats.invalidate().catch(() => {});
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e)) || "Failed to create"),
  });

  const updateMutation = trpc.remediation.update.useMutation({
    onSuccess: () => {
      toast.success("Remediation workflow updated");
      setUpdateTarget(null);
      setUpdateForm({ status: "", notes: "" });
      refetch();
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const deleteMutation = trpc.remediation.delete.useMutation({
    onSuccess: () => {
      toast.success("Remediation workflow deleted successfully");
      setDeleteId(null);
      utils.remediation.list.invalidate().catch(() => {});
      utils.remediation.stats.invalidate().catch(() => {});
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete remediation workflow"),
  });

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Remediation Workflows" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Remediation Workflows</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track and manage automated remediation actions triggered by compliance violations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-foreground" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-1" />New Workflow
          </Button>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40 bg-card border-border text-sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">Total</div>
          <div className="text-2xl font-bold text-foreground">{(stats as any)?.total ?? 0}</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">Open</div>
          <div className="text-2xl font-bold text-red-400">{(stats as any)?.open ?? 0}</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">In Progress</div>
          <div className="text-2xl font-bold text-yellow-400">{(stats as any)?.in_progress ?? 0}</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">Resolved</div>
          <div className="text-2xl font-bold text-green-400">{(stats as any)?.resolved ?? 0}</div>
        </div>
      </div>

      {/* Workflows Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-background/50">
            <tr>
              {["ID", "Organization", "Violation", "Action Type", "Status", "Notes", "Created", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-3 text-muted-foreground font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(workflows as any[]).length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-muted-foreground">
                  <Wrench className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No remediation workflows found</p>
                </td>
              </tr>
            ) : (workflows as any[]).map((w: any) => (
              <tr key={w.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-4 py-3 font-mono text-xs text-blue-400">RW-{String(w.id).padStart(5, "0")}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{w.orgId ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs font-mono">#{w.violationId ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                    {w.actionType?.replace(/_/g, " ") ?? "—"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge className={`text-xs flex items-center gap-1 w-fit ${STATUS_COLORS[w.status] ?? "bg-muted0/20 text-muted-foreground"}`}>
                    {STATUS_ICONS[w.status]}
                    {w.status?.replace("_", " ")}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs max-w-xs truncate">{w.notes ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {w.createdAt ? new Date(w.createdAt).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-3 flex items-center gap-1">
                  {w.status !== "resolved" && w.status !== "closed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs border-border h-7"
                      onClick={() => {
                        setUpdateTarget({ id: w.id, currentStatus: w.status });
                        setUpdateForm({ status: w.status === "open" ? "in_progress" : "resolved", notes: "" });
                      }}
                    >
                      Update
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="text-xs border-red-800 text-red-400 hover:bg-red-900/30 h-7 w-7 p-0" onClick={() => setDeleteId(w.id)} aria-label="Delete">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader><DialogTitle>Create Remediation Workflow</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Organization ID *</Label>
              <Input type="number" className="bg-card border-border mt-1" value={createForm.orgId} onChange={e => setCreateForm(p => ({ ...p, orgId: e.target.value }))} placeholder="Organization ID" />
            </div>
            <div>
              <Label>Action Type *</Label>
              <Input className="bg-card border-border mt-1" value={createForm.actionType} onChange={e => setCreateForm(p => ({ ...p, actionType: e.target.value }))} placeholder="e.g. data_breach_response, policy_update" />
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={createForm.priority} onValueChange={v => setCreateForm(p => ({ ...p, priority: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea className="bg-card border-border mt-1 text-sm" rows={2} value={createForm.description} onChange={e => setCreateForm(p => ({ ...p, description: e.target.value }))} placeholder="Describe the remediation action..." />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea className="bg-card border-border mt-1 text-sm" rows={2} value={createForm.notes} onChange={e => setCreateForm(p => ({ ...p, notes: e.target.value }))} placeholder="Additional notes..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              disabled={!createForm.orgId || !createForm.actionType || createMutation.isPending}
              onClick={() => createMutation.mutate({ orgId: Number(createForm.orgId), actionType: createForm.actionType, priority: createForm.priority as any, description: createForm.description || undefined, notes: createForm.notes || undefined })}
            >
              {createMutation.isPending ? "Creating..." : "Create Workflow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Dialog */}
      <Dialog open={!!updateTarget} onOpenChange={() => setUpdateTarget(null)}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader><DialogTitle>Update Remediation Workflow RW-{String(updateTarget?.id ?? 0).padStart(5, "0")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>New Status</Label>
              <Select value={updateForm.status} onValueChange={v => setUpdateForm(p => ({ ...p, status: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                className="bg-card border-border mt-1 text-sm"
                rows={3}
                placeholder="Describe the remediation actions taken..."
                value={updateForm.notes}
                onChange={e => setUpdateForm(p => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateTarget(null)}>Cancel</Button>
            <Button
              disabled={!updateForm.status || updateMutation.isPending}
              onClick={() => updateMutation.mutate({ id: updateTarget!.id, status: updateForm.status, notes: updateForm.notes || undefined })}
            >
              {updateMutation.isPending ? "Updating..." : "Update Workflow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-background border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Remediation Workflow</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">This will permanently delete this remediation workflow. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
