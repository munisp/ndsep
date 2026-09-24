/**
 * Insider-Threat & Fraud-Fusion console.
 *
 * Three tabs backed by the insiderThreat tRPC router:
 *   1. Risk register — fused insider-risk scores (GNN structural + Bayesian
 *      shrinkage + behavioral anomaly + process violations) with top
 *      contributing signals and the recommended process action.
 *   2. SoD violations — codified process-control findings (segregation of
 *      duties, maker-checker breaches, dormant reactivation, privilege
 *      escalation watches).
 *   3. Dual control — maker-checker queue for sensitive actions
 *      (fine settlement, DPCO approval, role grants, vault sealing
 *      overrides) with approve/reject buttons (admin).
 *
 * NOTE: the router is mounted by the integrator as `insiderThreat`
 * (see /tmp/wave4/insider_registration.md). The `trpc as any` casts keep
 * this page type-stable until the mount lands.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldAlert, Play, CheckCircle2, XCircle, AlertTriangle, Eye } from "lucide-react";
import { toast } from "sonner";

const api = trpc as any;

type ExplanationSignal = { signal: string; contribution: number; detail: string };
type RiskRow = {
  subject_id: string;
  subject_type: string;
  fused_score: number;
  components: Record<string, number>;
  explanation: ExplanationSignal[];
  recommended_action: string;
  computed_at: string;
};
type ViolationRow = {
  id: number;
  rule: string;
  subject_refs: Record<string, unknown>;
  evidence: Record<string, unknown>;
  status: string;
  detected_at: string;
};
type DualControlRow = {
  id: number;
  action_type: string;
  payload: Record<string, unknown>;
  requested_by: string;
  first_approver: string | null;
  second_approver: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  decision_reason: string | null;
};

const ACTION_STYLE: Record<string, string> = {
  monitor: "bg-slate-500/20 text-slate-300",
  require_dual_approval: "bg-yellow-500/20 text-yellow-400",
  suspend_privileges: "bg-orange-500/20 text-orange-400",
  investigate: "bg-red-500/20 text-red-400",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  approved: "bg-green-500/20 text-green-400",
  rejected: "bg-red-500/20 text-red-400",
  expired: "bg-slate-500/20 text-slate-400",
};

function scoreColor(score: number): string {
  if (score >= 0.75) return "text-red-400";
  if (score >= 0.55) return "text-orange-400";
  if (score >= 0.35) return "text-yellow-400";
  return "text-green-400";
}

function RiskRegisterTab() {
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading, refetch } = api.insiderThreat.riskRegister.useQuery({ limit: 100 });
  const detail = api.insiderThreat.officerDetail.useQuery(
    { subjectId: selected ?? "" },
    { enabled: !!selected },
  );
  const sweep = api.insiderThreat.runSweep.useMutation({
    onSuccess: (summary: any) => {
      toast.success(
        `Sweep complete: ${summary.n_subjects} subjects, ${summary.n_violations} violations`,
      );
      refetch();
    },
    onError: (e: any) => toast.error(`Sweep failed: ${e.message}`),
  });

  const rows: RiskRow[] = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {data?.note ?? `${rows.length} subjects scored (latest sweep)`}
        </div>
        <Button
          size="sm"
          onClick={() => sweep.mutate({ insert: true })}
          disabled={sweep.isPending}
        >
          <Play className="w-4 h-4 mr-1" />
          {sweep.isPending ? "Running sweep…" : "Run detection sweep"}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Fused score</TableHead>
                <TableHead>Recommended action</TableHead>
                <TableHead>Top signals</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={5}>Loading…</TableCell></TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No scores yet — run a detection sweep to populate the register.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.subject_id}>
                  <TableCell className="font-mono text-sm">{r.subject_id}</TableCell>
                  <TableCell className={`font-semibold ${scoreColor(r.fused_score)}`}>
                    {(r.fused_score * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell>
                    <Badge className={ACTION_STYLE[r.recommended_action] ?? ""}>
                      {r.recommended_action.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-md">
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {(r.explanation ?? []).slice(0, 2).map((s, i) => (
                        <li key={i} title={s.detail}>
                          {s.signal} ({(s.contribution * 100).toFixed(0)}%)
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(r.subject_id)}>
                      <Eye className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-mono">{selected}</CardTitle>
            <CardDescription>Component breakdown and contributing signals</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {detail.data?.score ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(detail.data.score.components ?? {}).map(([k, v]) => (
                    <div key={k} className="bg-card border rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">{k.replace(/_/g, " ")}</div>
                      <div className="text-lg font-semibold">{((v as number) * 100).toFixed(0)}%</div>
                    </div>
                  ))}
                </div>
                <ul className="text-sm space-y-1">
                  {(detail.data.score.explanation ?? []).map((s: ExplanationSignal, i: number) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted-foreground font-mono text-xs w-40 shrink-0">{s.signal}</span>
                      <span>{s.detail}</span>
                    </li>
                  ))}
                </ul>
                {(detail.data.violations ?? []).length > 0 && (
                  <div className="text-sm">
                    <span className="font-semibold">{detail.data.violations.length}</span>{" "}
                    process-control violation(s) reference this subject (see SoD tab).
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No score recorded for this subject.</div>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SodViolationsTab() {
  const { data, isLoading } = api.insiderThreat.sodViolations.useQuery({ status: "open", limit: 100 });
  const rows: ViolationRow[] = data?.rows ?? [];
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead>Detected</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5}>Loading…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  {data?.note ?? "No open process-control violations."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((v) => (
              <TableRow key={v.id}>
                <TableCell>
                  <Badge className="bg-red-500/20 text-red-400 font-mono text-xs">{v.rule}</Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {String(v.subject_refs?.actor_id ?? "—")}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {String(v.subject_refs?.scope_ref ?? v.evidence?.scope_ref ?? "—")}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-md truncate">
                  {JSON.stringify(v.evidence)}
                </TableCell>
                <TableCell className="text-xs">
                  {new Date(v.detected_at).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function DualControlTab() {
  const utils = (api as { useUtils?: () => any }).useUtils?.() ?? null;
  const { data, isLoading, refetch } = api.insiderThreat.dualControlQueue.useQuery({ includeDecided: true, limit: 100 });
  const approve = api.insiderThreat.approveDualControl.useMutation({
    onSuccess: (r: any) => {
      toast.success(r.status === "approved" ? "Request approved (second approval)" : "First approval recorded — one more required");
      refetch(); utils?.insiderThreat?.dualControlQueue?.invalidate?.();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const reject = api.insiderThreat.rejectDualControl.useMutation({
    onSuccess: () => { toast.success("Request rejected"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const rows: DualControlRow[] = data?.rows ?? [];
  const busy = approve.isPending || reject.isPending;

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Requested by</TableHead>
              <TableHead>Approvers</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7}>Loading…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  {data?.note ?? "No dual-control requests in the queue."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.id}</TableCell>
                <TableCell>
                  <div className="font-medium">{r.action_type.replace(/_/g, " ")}</div>
                  <div className="text-xs text-muted-foreground max-w-xs truncate">
                    {JSON.stringify(r.payload)}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{r.requested_by}</TableCell>
                <TableCell className="font-mono text-xs">
                  {[r.first_approver, r.second_approver].filter(Boolean).join(", ") || "—"}
                </TableCell>
                <TableCell>
                  <Badge className={STATUS_STYLE[r.status] ?? ""}>{r.status}</Badge>
                </TableCell>
                <TableCell className="text-xs">{new Date(r.expires_at).toLocaleString()}</TableCell>
                <TableCell>
                  {r.status === "pending" && (
                    <div className="flex gap-1">
                      <Button
                        size="sm" variant="outline" disabled={busy}
                        onClick={() => approve.mutate({ requestId: r.id })}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm" variant="outline" disabled={busy}
                        onClick={() => {
                          const reason = window.prompt("Rejection reason (optional)") ?? "";
                          reject.mutate({ requestId: r.id, reason });
                        }}
                      >
                        <XCircle className="w-4 h-4 mr-1" /> Reject
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function InsiderThreat() {
  const policy = api.insiderThreat.policyMatrix.useQuery();
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="w-7 h-7 text-red-400" />
        <div>
          <h1 className="text-2xl font-bold">Insider Threat &amp; Fraud Fusion</h1>
          <p className="text-sm text-muted-foreground">
            Fused AI + process-control detection for insider theft, collusion, abuse of
            company property/time, fraud and embezzlement.
          </p>
        </div>
      </div>

      {policy.data && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-400" />
              Enforced process controls
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground grid md:grid-cols-3 gap-2">
            {(policy.data.sodMatrix ?? []).map((m: any) => (
              <div key={m.process} className="border rounded p-2">
                <div className="font-semibold text-foreground">{m.process.replace(/_/g, " ")}</div>
                {m.description}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">Risk register</TabsTrigger>
          <TabsTrigger value="sod">SoD violations</TabsTrigger>
          <TabsTrigger value="dual">Dual control</TabsTrigger>
        </TabsList>
        <TabsContent value="register"><RiskRegisterTab /></TabsContent>
        <TabsContent value="sod"><SodViolationsTab /></TabsContent>
        <TabsContent value="dual"><DualControlTab /></TabsContent>
      </Tabs>
    </div>
  );
}
