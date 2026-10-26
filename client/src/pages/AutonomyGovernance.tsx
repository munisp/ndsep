/**
 * Autonomy Governance dashboard (round 12, wave 9 — roadmap §7)
 * =============================================================
 * Acceptance-gated promotion console for graduated autonomy:
 *  - tier cards per surface with live acceptance stats and progress bars
 *    toward the next promotion gate (1→2: ≥85% over ≥500 decided;
 *    2→3: ≥95% over ≥2000 decided + 30 days stable),
 *  - promote/demote overrides (admin; queued through the dual-control
 *    maker-checker queue — two distinct approvers, requester may not approve),
 *  - the pending-undo queue with live countdowns and Undo buttons,
 *  - transition history from the anti-wipe audit ledger.
 */
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ArrowDown, ArrowUp, History, RefreshCw, ShieldCheck, Undo2 } from "lucide-react";

const gov = trpc.autonomyGovernance;

const TIER_COLORS: Record<number, string> = {
  1: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  2: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  3: "bg-green-500/20 text-green-300 border-green-500/40",
};
const TIER_NAMES: Record<number, string> = { 1: "Suggest-only", 2: "Guarded auto-action", 3: "Trusted auto-action" };

const STATUS_COLORS: Record<string, string> = {
  pending_undo: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  executed: "bg-green-500/20 text-green-300 border-green-500/40",
  undone: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  expired: "bg-muted text-muted-foreground border-border",
};

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function Countdown({ deadline, now }: { deadline: string; now: number }) {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return <span className="text-muted-foreground">due — awaiting executor</span>;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return <span className="font-mono">{h}h {String(m).padStart(2, "0")}m {String(s).padStart(2, "0")}s</span>;
}

export default function AutonomyGovernance() {
  const now = useNow();
  const utils = trpc.useUtils();
  const status = gov.tierStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const pendingUndo = gov.listAutonomyActions.useQuery({ status: "pending_undo" }, { refetchInterval: 15_000 });
  const [historyTab, setHistoryTab] = useState<"executed" | "undone" | "expired">("executed");
  const actions = gov.listAutonomyActions.useQuery({ status: historyTab });
  const transitions = gov.transitionHistory.useQuery({ limit: 50 });

  const [overrideForm, setOverrideForm] = useState<{ surface: "scan_findings" | "duplicate_merge"; direction: "promote" | "demote"; reason: string } | null>(null);

  const refreshAll = () => {
    status.refetch();
    pendingUndo.refetch();
    actions.refetch();
    transitions.refetch();
    utils.invalidate();
  };

  const onOverrideSuccess = (r: any) => {
    if (r?.queued) {
      toast.info(`Tier change queued for dual control (request #${r.requestId}) — two distinct admin approvers required.`);
    } else {
      toast.success(`Tier override applied (request #${r?.dualControlRequestId}).`);
    }
    setOverrideForm(null);
    refreshAll();
  };
  const promote = gov.promote.useMutation({ onSuccess: onOverrideSuccess, onError: (e: any) => toast.error(e.message) });
  const demote = gov.demote.useMutation({ onSuccess: onOverrideSuccess, onError: (e: any) => toast.error(e.message) });
  const undo = gov.undoAction.useMutation({
    onSuccess: () => { toast.success("Action undone — snapshot restored."); refreshAll(); },
    onError: (e: any) => toast.error(e.message),
  });

  const surfaces: any[] = useMemo(() => status.data?.surfaces ?? [], [status.data]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Breadcrumbs items={[{ label: "Autonomy Governance" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="h-6 w-6" /> Autonomy Governance</h1>
          <p className="text-muted-foreground text-sm">
            Graduated autonomy for AI surfaces — acceptance-gated promotion, guarded auto-actions with a 24h undo window,
            dual-control overrides, full audit trail.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
      </div>

      {/* ── Tier cards ──────────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        {surfaces.map((s) => (
          <Card key={s.surface}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{s.label ?? s.surface}</CardTitle>
                <Badge className={TIER_COLORS[s.tier] ?? ""}>Tier {s.tier} · {TIER_NAMES[s.tier] ?? "?"}</Badge>
              </div>
              <CardDescription>
                {s.failedClosed && <span className="text-red-400">fail-closed — evaluation error, held at tier 1. </span>}
                {s.gates?.windowDays}-day window · {s.decided} decided / {s.suggestions} suggestions · trailing {s.trailing?.window}:{" "}
                {pct(s.trailing?.acceptance)} ({s.trailing?.count ?? 0})
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-6 text-sm">
                <div>Acceptance: <span className="font-semibold">{pct(s.acceptanceRate)}</span></div>
                {s.promotedAt && <div>In tier since: {new Date(s.promotedAt).toLocaleDateString()}</div>}
                {s.demotedAt && <div className="text-orange-400">Last demoted: {new Date(s.demotedAt).toLocaleDateString()}</div>}
              </div>
              {s.nextGate ? (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Progress toward tier {s.nextGate.targetTier}</div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span>Acceptance ({pct(s.nextGate.acceptance)} / {pct(s.nextGate.minAcceptance)})</span>
                    </div>
                    <Progress value={(s.nextGate.acceptanceProgress ?? 0) * 100} />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span>Decided suggestions ({s.nextGate.decided} / {s.nextGate.minSuggestions})</span>
                    </div>
                    <Progress value={(s.nextGate.suggestionsProgress ?? 0) * 100} />
                  </div>
                  {s.nextGate.minStableDays != null && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span>Stability ({Math.floor(s.nextGate.stableDays ?? 0)} / {s.nextGate.minStableDays} days in tier 2)</span>
                      </div>
                      <Progress value={(s.nextGate.stableProgress ?? 0) * 100} />
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Maximum tier reached.</div>
              )}
              <div className="text-xs text-muted-foreground">
                Auto-demotion: trailing {s.gates?.demote?.trailingCount} decided acceptance below {pct(s.gates?.demote?.belowAcceptance)}.
              </div>
              <div className="flex gap-2 pt-1">
                {s.tier < 3 && (
                  <Button size="sm" variant="outline" onClick={() => setOverrideForm({ surface: s.surface, direction: "promote", reason: "" })}>
                    <ArrowUp className="h-4 w-4 mr-1" /> Promote
                  </Button>
                )}
                {s.tier > 1 && (
                  <Button size="sm" variant="outline" onClick={() => setOverrideForm({ surface: s.surface, direction: "demote", reason: "" })}>
                    <ArrowDown className="h-4 w-4 mr-1" /> Demote
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Override form (dual control) ────────────────────────────────── */}
      {overrideForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {overrideForm.direction === "promote" ? "Promote" : "Demote"} {overrideForm.surface} — dual-control request
            </CardTitle>
            <CardDescription>
              Tier overrides are governance-sensitive: this queues a maker-checker request — two DISTINCT admin
              approvers (neither being you) must approve before the change applies.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="Reason (min 10 chars) — recorded in the audit ledger"
              value={overrideForm.reason}
              onChange={(e) => setOverrideForm({ ...overrideForm, reason: e.target.value })}
            />
            <div className="flex gap-2">
              <Button
                disabled={overrideForm.reason.trim().length < 10 || promote.isPending || demote.isPending}
                onClick={() =>
                  (overrideForm.direction === "promote" ? promote : demote).mutate({
                    surface: overrideForm.surface,
                    reason: overrideForm.reason.trim(),
                  })
                }
              >
                Queue dual-control request
              </Button>
              <Button variant="ghost" onClick={() => setOverrideForm(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Pending-undo queue ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pending undo window</CardTitle>
          <CardDescription>Tier-2 auto-actions waiting out their 24h undo window. Undo cancels the proposal before it executes.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Surface / action</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Executes in</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(pendingUndo.data?.rows ?? []).map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-mono text-xs">{a.surface}</div>
                    <Badge className={STATUS_COLORS[a.status] ?? ""}>{a.actionType}</Badge>
                  </TableCell>
                  <TableCell className="text-sm max-w-md truncate">{String(a.payload?.reason ?? "")}</TableCell>
                  <TableCell><Countdown deadline={a.undoDeadline} now={now} /></TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" disabled={undo.isPending} onClick={() => undo.mutate({ id: a.id })}>
                      <Undo2 className="h-4 w-4 mr-1" /> Undo
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(pendingUndo.data?.rows ?? []).length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-muted-foreground text-sm">No actions pending undo.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── History ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><History className="h-5 w-5" /> History</CardTitle>
          <CardDescription>Executed actions can still be undone (snapshot restore). Transitions come from the hash-chained audit ledger.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={historyTab} onValueChange={(v) => setHistoryTab(v as typeof historyTab)}>
            <TabsList>
              <TabsTrigger value="executed">Executed</TabsTrigger>
              <TabsTrigger value="undone">Undone</TabsTrigger>
              <TabsTrigger value="expired">Expired</TabsTrigger>
            </TabsList>
            <TabsContent value={historyTab}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Surface / action</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead>Status</TableHead>
                    {historyTab === "executed" && <TableHead></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(actions.data?.rows ?? []).map((a: any) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{new Date(a.createdAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="font-mono text-xs">{a.surface}</div>
                        <div className="text-xs">{a.actionType}</div>
                      </TableCell>
                      <TableCell className="text-sm max-w-md truncate">{String(a.payload?.reason ?? "")}</TableCell>
                      <TableCell><Badge className={STATUS_COLORS[a.status] ?? ""}>{a.status}</Badge></TableCell>
                      {historyTab === "executed" && (
                        <TableCell>
                          <Button size="sm" variant="outline" disabled={undo.isPending} onClick={() => undo.mutate({ id: a.id })}>
                            <Undo2 className="h-4 w-4 mr-1" /> Undo
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {(actions.data?.rows ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-muted-foreground text-sm">No {historyTab} actions.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>

          <div className="mt-6">
            <div className="text-sm font-semibold mb-2">Tier transitions &amp; audit trail</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Seq</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>Actor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(transitions.data ?? []).map((t: any) => (
                  <TableRow key={t.seq}>
                    <TableCell className="font-mono text-xs">#{t.seq}</TableCell>
                    <TableCell className="text-xs">{new Date(t.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="text-xs font-mono">{t.action}</TableCell>
                    <TableCell className="text-xs max-w-md truncate">
                      {String(t.payload?.surface ?? "")} {t.payload?.fromTier != null ? `t${t.payload.fromTier}→t${t.payload.toTier}` : ""} {String(t.payload?.reason ?? "")}
                    </TableCell>
                    <TableCell className="text-xs">{t.actor ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {(transitions.data ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-muted-foreground text-sm">No autonomy events recorded yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
