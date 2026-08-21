import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, Clock, AlertTriangle, FileText,
  ArrowRight, Shield, RefreshCw, Ban
} from "lucide-react";
import { SkeletonTable } from "@/components/SkeletonTable";
import { Pagination } from "@/components/Pagination";

import { Breadcrumbs } from "@/components/Breadcrumbs";
// ─── 9-State Machine ─────────────────────────────────────────────────────────

type AccreditationState =
  | "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "COMMITTEE_REVIEW"
  | "APPROVED" | "REJECTED" | "SUSPENDED" | "REVOKED" | "APPEALING";

const STATE_CONFIG: Record<AccreditationState, {
  label: string;
  color: string;
  icon: React.ReactNode;
  description: string;
}> = {
  DRAFT:            { label: "Draft",            color: "bg-muted text-foreground",   icon: <FileText className="h-4 w-4" />,       description: "Application being prepared" },
  SUBMITTED:        { label: "Submitted",        color: "bg-blue-500/15 text-blue-600 dark:text-blue-400",   icon: <Clock className="h-4 w-4" />,          description: "Awaiting initial review" },
  UNDER_REVIEW:     { label: "Under Review",     color: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400", icon: <RefreshCw className="h-4 w-4" />,    description: "Staff reviewing application" },
  COMMITTEE_REVIEW: { label: "Committee Review", color: "bg-purple-500/15 text-purple-600 dark:text-purple-400", icon: <Shield className="h-4 w-4" />,       description: "Committee deliberating" },
  APPROVED:         { label: "Approved",         color: "bg-green-500/15 text-green-600 dark:text-green-400", icon: <CheckCircle2 className="h-4 w-4" />,   description: "Accreditation granted" },
  REJECTED:         { label: "Rejected",         color: "bg-red-500/15 text-red-600 dark:text-red-400",     icon: <XCircle className="h-4 w-4" />,        description: "Application rejected" },
  SUSPENDED:        { label: "Suspended",        color: "bg-orange-500/15 text-orange-600 dark:text-orange-400", icon: <AlertTriangle className="h-4 w-4" />, description: "Accreditation suspended" },
  REVOKED:          { label: "Revoked",          color: "bg-red-500/20 text-red-600 dark:text-red-400",     icon: <Ban className="h-4 w-4" />,            description: "Accreditation revoked" },
  APPEALING:        { label: "Appealing",        color: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400", icon: <ArrowRight className="h-4 w-4" />,   description: "Appeal in progress" },
};

const VALID_TRANSITIONS: Record<AccreditationState, AccreditationState[]> = {
  DRAFT:            ["SUBMITTED"],
  SUBMITTED:        ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW:     ["COMMITTEE_REVIEW", "REJECTED"],
  COMMITTEE_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED:         ["SUSPENDED", "REVOKED"],
  REJECTED:         ["APPEALING"],
  SUSPENDED:        ["APPROVED", "REVOKED"],
  REVOKED:          [],
  APPEALING:        ["UNDER_REVIEW", "REJECTED"],
};

function StateBadge({ state }: { state: AccreditationState }) {
  const cfg = STATE_CONFIG[state] ?? STATE_CONFIG.DRAFT;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AccreditationWorkflow() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<AccreditationState | null>(null);
  const [transitionNote, setTransitionNote] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.accreditation.adminListApplications.useQuery({
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const transitionMutation = trpc.accreditation.adminMakeDecision.useMutation({
    onSuccess: () => {
      toast.success(`Application moved to ${transitionTarget ?? "next state"}`);
      utils.accreditation.adminListApplications.invalidate();
      setDialogOpen(false);
      setTransitionNote("");
    },
    onError: (err) => {
      toast.error((err as unknown as Error).message ?? "An error occurred");
    },
  });

  const items = (data as any)?.items ?? data ?? [];
  const total = (data as any)?.total ?? items.length;

  const selectedItem = items.find((i: any) => i.id === selectedId);
  const currentState: AccreditationState = selectedItem?.status ?? "DRAFT";
  const availableTransitions = VALID_TRANSITIONS[currentState] ?? [];

  const handleTransition = (target: AccreditationState) => {
    setTransitionTarget(target);
    setDialogOpen(true);
  };

  const confirmTransition = () => {
    if (!selectedId || !transitionTarget) return;
    // Map state transitions to adminMakeDecision decisions
    const decisionMap: Record<string, "approved" | "conditionally_approved" | "rejected"> = {
      APPROVED: "approved",
      REJECTED: "rejected",
      COMMITTEE_REVIEW: "conditionally_approved",
    };
    const decision = decisionMap[transitionTarget] ?? "conditionally_approved";
    transitionMutation.mutate({
      id: selectedId,
      decision,
      reason: transitionNote || `Transitioned to ${transitionTarget}`,
    });
  };

  return (
    <div className="space-y-6 p-6">
      <Breadcrumbs items={[{ label: "Admin", href: "/accreditation" }, { label: "Accreditation Workflow" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Accreditation Workflow</h1>
          <p className="text-sm text-muted-foreground">
            9-state accreditation lifecycle management with Temporal workflow integration
          </p>
        </div>
      </div>

      {/* State machine diagram */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">State Machine Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(STATE_CONFIG) as AccreditationState[]).map((state) => (
              <div key={state} className="flex flex-col items-center gap-1">
                <StateBadge state={state} />
                {VALID_TRANSITIONS[state].length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    → {VALID_TRANSITIONS[state].join(", ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Applications table */}
      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SkeletonTable rows={5} cols={5} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">ID</th>
                      <th className="pb-2 pr-4 font-medium">Organization</th>
                      <th className="pb-2 pr-4 font-medium">Type</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 pr-4 font-medium">Submitted</th>
                      <th className="pb-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted-foreground">
                          No accreditation applications found
                        </td>
                      </tr>
                    ) : (
                      items.map((item: any) => (
                        <tr
                          key={item.id}
                          className={`border-b border-border/50 hover:bg-muted/30 ${
                            selectedId === item.id ? "bg-muted/50" : ""
                          }`}
                        >
                          <td className="py-2 pr-4 font-mono text-xs">{item.id}</td>
                          <td className="py-2 pr-4">{item.org_name ?? item.organization_name ?? "—"}</td>
                          <td className="py-2 pr-4">{item.accreditation_type ?? item.type ?? "—"}</td>
                          <td className="py-2 pr-4">
                            <StateBadge state={(item.status ?? "DRAFT") as AccreditationState} />
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {item.created_at
                              ? new Date(item.created_at).toLocaleDateString()
                              : "—"}
                          </td>
                          <td className="py-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedId(selectedId === item.id ? null : item.id)}
                            >
                              {selectedId === item.id ? "Deselect" : "Select"}
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Transition panel */}
      {selectedItem && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-sm">
              Transition: {selectedItem.org_name ?? `Application #${selectedId}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Current state:</span>
              <StateBadge state={currentState} />
            </div>
            {availableTransitions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This application is in a terminal state (REVOKED) and cannot be transitioned.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availableTransitions.map((target) => (
                  <Button
                    key={target}
                    variant="outline"
                    size="sm"
                    onClick={() => handleTransition(target)}
                    className="gap-1"
                  >
                    <ArrowRight className="h-3 w-3" />
                    Move to {STATE_CONFIG[target].label}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Transition confirmation dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm State Transition</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm">
              <StateBadge state={currentState} />
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              {transitionTarget && <StateBadge state={transitionTarget} />}
            </div>
            <div className="space-y-1">
              <Label htmlFor="note">Transition Note (optional)</Label>
              <Textarea
                id="note"
                placeholder="Add a note explaining this transition…"
                value={transitionNote}
                onChange={(e) => setTransitionNote(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmTransition} disabled={transitionMutation?.isPending}>
              Confirm Transition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
