/**
 * TelegramWatchPanel (round 13, P0.1)
 * ===================================
 * Staff review panel for OSIRIS Telegram breach early-warning signals
 * (server/routers/telegramWatch.ts, surface='telegram_watch'):
 *   - signal queue with confirm / reject (each decision writes
 *     decision_feedback via the router — the mutation returns the reviewed
 *     row including prediction_id);
 *   - breach-lag list: entities with breach_notification_overdue signals
 *     (NDPA 72-hour self-report rule) with days-overdue badges.
 *
 * The router is mounted by the integrator as `telegramWatch`; until the
 * AppRouter type is regenerated we access it via a structural cast (same
 * `as any` convention used across this page for tRPC data).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RefreshCw, Send, ShieldAlert } from "lucide-react";

const SEV_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-300 border-red-500/40",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  low: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  info: "bg-muted text-muted-foreground border-border",
};

// telegramWatchRouter is mounted in server/routers.ts (Round-13 integration).
const tg = trpc.telegramWatch;

export default function TelegramWatchPanel() {
  const [status, setStatus] = useState<"pending" | "confirmed" | "rejected">("pending");
  const [page, setPage] = useState(0);
  const limit = 25;

  const signals = tg.listSignals.useQuery({ status, limit, offset: page * limit });
  const lag = tg.breachLagList.useQuery({ status: "open", limit: 100 });
  const stats = tg.stats.useQuery();

  const refresh = () => { signals.refetch(); lag.refetch(); stats.refetch(); };

  const confirmSignal = tg.confirmSignal.useMutation({
    onSuccess: () => { toast.success("Signal confirmed — feedback recorded (surface: telegram_watch)"); refresh(); },
    onError: (err: { message: string }) => toast.error(err.message),
  });
  const [rejectFor, setRejectFor] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const rejectSignal = tg.rejectSignal.useMutation({
    onSuccess: () => { toast.success("Signal rejected — feedback recorded"); setRejectFor(null); setRejectNote(""); refresh(); },
    onError: (err: { message: string }) => toast.error(err.message),
  });
  const acknowledgeLag = tg.acknowledgeLagSignal.useMutation({
    onSuccess: () => { toast.success("Breach-lag signal acknowledged"); lag.refetch(); stats.refetch(); },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = signals.data?.rows ?? [];
  const total = Number(signals.data?.total ?? 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lagRows: any[] = lag.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="outline">pending {stats.data?.signals?.pending ?? 0}</Badge>
          <Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/40">
            breach-lag open {stats.data?.breachLag?.open ?? 0}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {/* ── Breach-lag (overdue NDPA 72h self-reports) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-400" /> Breach notification overdue
          </CardTitle>
          <CardDescription>
            Telegram posts name these entities in breach contexts, but no breach self-report
            exists within 72 hours of the post (NDPA 72-hour rule).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entity</TableHead><TableHead>Post date</TableHead>
                <TableHead>Deadline</TableHead><TableHead>Days overdue</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lagRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.organization_name ?? `Org #${r.organization_id}`}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.post_ts ? new Date(r.post_ts).toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.notification_deadline ? new Date(r.notification_deadline).toLocaleString() : "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={Number(r.days_overdue) > 7 ? SEV_COLORS.critical : SEV_COLORS.high}>
                      {r.days_overdue}d overdue
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" disabled={acknowledgeLag.isPending}
                      onClick={() => acknowledgeLag.mutate({ id: r.id })}>Acknowledge</Button>
                  </TableCell>
                </TableRow>
              ))}
              {lagRows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No overdue breach-notification signals.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Signal queue ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Send className="h-5 w-5 text-sky-400" /> Telegram breach signals
          </CardTitle>
          <CardDescription>
            Matched posts from the OSIRIS Telegram layer (PII-redacted at ingestion). Confirm / reject
            decisions feed decision_feedback (surface: telegram_watch).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-end">
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(0); }}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["pending", "confirmed", "rejected"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span>page {page + 1} · {total} total</span>
              <Button size="sm" variant="outline" disabled={(page + 1) * limit >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>

          {rows.map((sig) => (
            <Card key={sig.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={SEV_COLORS[sig.severity] ?? ""}>{sig.severity}</Badge>
                  <Badge variant="outline">@{sig.channel}</Badge>
                  {sig.post_url ? (
                    <a href={sig.post_url} target="_blank" rel="noreferrer" className="hover:underline text-sm font-normal">
                      {sig.post_url}
                    </a>
                  ) : <span className="text-sm font-normal">post {sig.post_id}</span>}
                </CardTitle>
                <CardDescription>
                  {sig.post_ts ? new Date(sig.post_ts).toLocaleString() : "date n/a"}
                  {sig.classifier?.method ? ` · classifier: ${sig.classifier.method}` : ""}
                  {sig.classifier?.ambiguous ? " · ambiguous (LLM-confirmed)" : ""}
                  {sig.geo?.place ? ` · ${sig.geo.place}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground whitespace-pre-wrap">{sig.text_redacted}</p>
                {(sig.classifier?.entities ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {sig.classifier.entities.map((e: { organization_id: number; matched_name: string; match_method: string }, i: number) => (
                      <Badge key={i} variant="outline">{e.matched_name} (org #{e.organization_id} · {e.match_method})</Badge>
                    ))}
                  </div>
                )}
                {sig.status === "pending" && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={confirmSignal.isPending} onClick={() => confirmSignal.mutate({ id: sig.id })}>Confirm signal</Button>
                    <Button size="sm" variant="destructive" onClick={() => { setRejectFor(sig.id); setRejectNote(""); }}>Reject signal</Button>
                  </div>
                )}
                {rejectFor === sig.id && (
                  <div className="border border-red-500/40 rounded p-3 flex gap-2 items-end">
                    <div className="flex-1">
                      <Label htmlFor={`tw-reject-${sig.id}`}>Rejection note (min 3 chars)</Label>
                      <Input id={`tw-reject-${sig.id}`} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
                    </div>
                    <Button size="sm" variant="destructive" disabled={rejectSignal.isPending || rejectNote.trim().length < 3}
                      onClick={() => rejectSignal.mutate({ id: sig.id, note: rejectNote.trim() })}>Reject</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRejectFor(null)}>Cancel</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No {status} telegram watch signals.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
