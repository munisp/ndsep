import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Checkbox } from "@/components/ui/checkbox";
import { Newspaper, RefreshCw, Siren } from "lucide-react";
import TelegramWatchPanel from "@/components/TelegramWatchPanel";
import OsirisFeedStatusCard from "@/components/OsirisFeedStatusCard";

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const SEV_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-300 border-red-500/40",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  low: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  info: "bg-muted text-muted-foreground border-border",
};

export default function AdverseMediaReview() {
  const [reviewStatus, setReviewStatus] = useState<"pending" | "confirmed" | "rejected">("pending");
  const [sevFilter, setSevFilter] = useState<string>("");
  const queue = trpc.adverseMedia.reviewQueue.useQuery({
    review_status: reviewStatus,
    severity: (sevFilter || undefined) as (typeof SEVERITIES)[number] | undefined,
    limit: 50,
  });
  const signals = trpc.adverseMedia.listSignals.useQuery({ limit: 100 });
  const sources = trpc.adverseMedia.listSources.useQuery();

  const refresh = () => { queue.refetch(); signals.refetch(); };

  const confirmItem = trpc.adverseMedia.confirmItem.useMutation({
    onSuccess: () => { toast.success("Item confirmed — entity matches promoted to supervision risk signals"); refresh(); },
    onError: (err) => toast.error(err.message),
  });
  const [rejectFor, setRejectFor] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const rejectItem = trpc.adverseMedia.rejectItem.useMutation({
    onSuccess: () => { toast.success("Item rejected"); setRejectFor(null); setRejectNote(""); refresh(); },
    onError: (err) => toast.error(err.message),
  });
  const reviewMatch = trpc.adverseMedia.reviewMatch.useMutation({
    onSuccess: () => { toast.success("Match reviewed"); refresh(); },
    onError: (err) => toast.error(err.message),
  });
  const [linkFor, setLinkFor] = useState<number | null>(null);
  const [linkOrgId, setLinkOrgId] = useState("");
  const linkToEntity = trpc.adverseMedia.linkToEntity.useMutation({
    onSuccess: () => { toast.success("Linked to organisation"); setLinkFor(null); setLinkOrgId(""); refresh(); },
    onError: (err) => toast.error(err.message),
  });
  const acknowledgeSignal = trpc.adverseMedia.acknowledgeSignal.useMutation({
    onSuccess: () => { toast.success("Signal acknowledged"); signals.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  // ── Bulk review (round 12 W2) ────────────────────────────────────────────
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [bulkNote, setBulkNote] = useState("");
  const bulkConfirm = trpc.bulkOps.bulkConfirmAdverseMedia.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Bulk confirm: ${r.succeeded}/${r.total} confirmed (${r.signals_promoted} signal(s) promoted)${r.failed.length ? ` — ${r.failed.length} skipped` : ""}`);
      setChecked(new Set()); refresh();
    },
    onError: (err: any) => toast.error(err.message),
  });
  const bulkReject = trpc.bulkOps.bulkRejectAdverseMedia.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Bulk reject: ${r.succeeded}/${r.total} rejected${r.failed.length ? ` — ${r.failed.length} skipped` : ""}`);
      setChecked(new Set()); setBulkNote(""); refresh();
    },
    onError: (err: any) => toast.error(err.message),
  });

  // ── Source filter chips (round 13 W4) — slice the queue by origin. ──────
  // Client-side filter over the already-fetched queue page (reviewQueue
  // carries s.source_key); known OSIRIS feeds are pinned, any other source
  // keys present in the data are appended.
  const PINNED_SOURCE_KEYS = ["osiris_telegram", "osiris_gdelt", "osiris_news"];
  const [srcFilter, setSrcFilter] = useState<string>("");
  const allQueueItems: any[] = (queue.data as any[]) ?? [];
  const sourceKeys = Array.from(new Set([
    ...PINNED_SOURCE_KEYS,
    ...allQueueItems.map((i) => i.source_key).filter(Boolean),
  ]));
  const queueItems = srcFilter ? allQueueItems.filter((i) => i.source_key === srcFilter) : allQueueItems;

  const toggle = (id: number, v: boolean) => setChecked((prev) => {
    const next = new Set(prev);
    if (v) next.add(id); else next.delete(id);
    return next;
  });

  // Manual ingest
  const [ingest, setIngest] = useState({ source_id: "", title: "", url: "", summary: "", published_at: "" });
  const ingestItem = trpc.adverseMedia.ingestManualItem.useMutation({
    onSuccess: () => { toast.success("Item ingested and classified"); setIngest({ source_id: "", title: "", url: "", summary: "", published_at: "" }); refresh(); },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Adverse Media" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Newspaper className="h-6 w-6" /> Adverse Media Review</h1>
        <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {/* Round-16 W4 — OSIRIS intel feed status strip (additive) */}
      <OsirisFeedStatusCard />

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Review queue</TabsTrigger>
          <TabsTrigger value="signals">Supervision signals</TabsTrigger>
          <TabsTrigger value="telegram">Telegram watch</TabsTrigger>
          <TabsTrigger value="ingest">Manual ingest</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4 space-y-4">
          <div className="flex gap-2 items-end">
            <div>
              <Label>Review status</Label>
              <Select value={reviewStatus} onValueChange={(v) => setReviewStatus(v as typeof reviewStatus)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["pending", "confirmed", "rejected"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Severity</Label>
              <Select value={sevFilter || "all"} onValueChange={(v) => setSevFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-1.5 flex-wrap items-center" aria-label="Source filter">
            <span className="text-xs text-muted-foreground mr-1">Source:</span>
            <Badge
              variant={srcFilter === "" ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setSrcFilter("")}
            >All</Badge>
            {sourceKeys.map((k) => (
              <Badge
                key={k}
                variant={srcFilter === k ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setSrcFilter(srcFilter === k ? "" : k)}
              >{k}</Badge>
            ))}
          </div>

          {reviewStatus === "pending" && queueItems.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap rounded-md border px-3 py-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label="Select all items"
                  checked={queueItems.length > 0 && queueItems.every((i) => checked.has(i.id))}
                  onCheckedChange={(v) => setChecked(v ? new Set(queueItems.map((i) => i.id)) : new Set())}
                />
                Select all ({queueItems.length})
              </label>
              {checked.size > 0 && (
                <>
                  <span className="text-sm font-medium">{checked.size} selected</span>
                  <Button
                    size="sm"
                    disabled={bulkConfirm.isPending || bulkReject.isPending}
                    onClick={() => bulkConfirm.mutate({ itemIds: Array.from(checked), note: bulkNote.trim() || undefined })}
                  >Confirm selected</Button>
                  <Input
                    value={bulkNote}
                    onChange={(e) => setBulkNote(e.target.value)}
                    placeholder="Review note (required to reject, min 3 chars)"
                    className="w-64 h-8"
                  />
                  <Button
                    size="sm" variant="destructive"
                    disabled={bulkReject.isPending || bulkConfirm.isPending || bulkNote.trim().length < 3}
                    onClick={() => bulkReject.mutate({ itemIds: Array.from(checked), note: bulkNote.trim() })}
                  >Reject selected</Button>
                  <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>Clear</Button>
                </>
              )}
            </div>
          )}

          {queueItems.map((item: any) => (
            <Card key={item.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  {reviewStatus === "pending" && (
                    <Checkbox
                      aria-label={`Select item ${item.id}`}
                      checked={checked.has(item.id)}
                      onCheckedChange={(v) => toggle(item.id, Boolean(v))}
                    />
                  )}
                  <Badge variant="outline" className={SEV_COLORS[item.severity] ?? ""}>{item.severity}</Badge>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline">{item.title}</a>
                  ) : item.title}
                </CardTitle>
                <CardDescription>
                  {item.source_name} · {item.published_at ? String(item.published_at).slice(0, 10) : "date n/a"}
                  {item.triage_label ? ` · ${item.triage_label}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {item.summary && <p className="text-muted-foreground">{item.summary}</p>}

                {(item.matches ?? []).length > 0 && (
                  <div>
                    <p className="font-medium mb-1">Entity matches</p>
                    <ul className="space-y-1">
                      {item.matches.map((m: any) => (
                        <li key={m.match_id} className="flex items-center gap-2 text-xs">
                          <span>{m.matched_name} (org #{m.organization_id}) · {m.match_method} · confidence {Number(m.confidence).toFixed(2)}</span>
                          <Badge variant="outline">{m.status}</Badge>
                          {m.status === "pending" && (
                            <>
                              <Button size="sm" variant="ghost" disabled={reviewMatch.isPending} onClick={() => reviewMatch.mutate({ match_id: m.match_id, decision: "confirmed" })}>Confirm</Button>
                              <Button size="sm" variant="ghost" className="text-red-400" disabled={reviewMatch.isPending} onClick={() => reviewMatch.mutate({ match_id: m.match_id, decision: "rejected" })}>Reject</Button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {reviewStatus === "pending" && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={confirmItem.isPending} onClick={() => confirmItem.mutate({ id: item.id })}>Confirm item</Button>
                    <Button size="sm" variant="destructive" onClick={() => { setRejectFor(item.id); setRejectNote(""); }}>Reject item</Button>
                    <Button size="sm" variant="outline" onClick={() => { setLinkFor(item.id); setLinkOrgId(""); }}>Link to organisation</Button>
                  </div>
                )}

                {rejectFor === item.id && (
                  <div className="border border-red-500/40 rounded p-3 flex gap-2 items-end">
                    <div className="flex-1">
                      <Label htmlFor={`am-reject-${item.id}`}>Rejection note (min 3 chars)</Label>
                      <Input id={`am-reject-${item.id}`} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
                    </div>
                    <Button size="sm" variant="destructive" disabled={rejectItem.isPending || rejectNote.trim().length < 3} onClick={() => rejectItem.mutate({ id: item.id, note: rejectNote.trim() })}>Reject</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRejectFor(null)}>Cancel</Button>
                  </div>
                )}

                {linkFor === item.id && (
                  <div className="border rounded p-3 flex gap-2 items-end">
                    <div className="flex-1">
                      <Label htmlFor={`am-link-${item.id}`}>Organisation ID</Label>
                      <Input id={`am-link-${item.id}`} type="number" value={linkOrgId} onChange={(e) => setLinkOrgId(e.target.value)} />
                    </div>
                    <Button size="sm" disabled={linkToEntity.isPending || !linkOrgId} onClick={() => linkToEntity.mutate({ item_id: item.id, organization_id: Number(linkOrgId) })}>Link</Button>
                    <Button size="sm" variant="ghost" onClick={() => setLinkFor(null)}>Cancel</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {queueItems.length === 0 && (
            <p className="text-sm text-muted-foreground">No {reviewStatus} items{sevFilter ? ` at ${sevFilter} severity` : ""}.</p>
          )}
        </TabsContent>

        <TabsContent value="signals" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Siren className="h-5 w-5 text-orange-400" /> Supervision risk signals</CardTitle>
              <CardDescription>Confirmed adverse-media items promoted into the risk-scoring signal feed.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organisation</TableHead><TableHead>Signal</TableHead><TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((signals.data as any[]) ?? []).map((sig: any) => (
                    <TableRow key={sig.id}>
                      <TableCell>Org #{sig.organization_id}</TableCell>
                      <TableCell className="max-w-[280px] truncate">{sig.signal_type ?? sig.title ?? sig.summary ?? "—"}</TableCell>
                      <TableCell>{sig.severity ? <Badge variant="outline" className={SEV_COLORS[sig.severity] ?? ""}>{sig.severity}</Badge> : "—"}</TableCell>
                      <TableCell><Badge variant="outline">{sig.status}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{sig.created_at ? new Date(sig.created_at).toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-right">
                        {sig.status === "open" && (
                          <Button size="sm" variant="outline" disabled={acknowledgeSignal.isPending} onClick={() => acknowledgeSignal.mutate({ id: sig.id })}>Acknowledge</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {((signals.data as any[]) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No signals.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="telegram" className="mt-4">
          <TelegramWatchPanel />
        </TabsContent>

        <TabsContent value="ingest" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Manually ingest a media item</CardTitle>
              <CardDescription>Keyword-classified and entity-matched on ingest.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Source</Label>
                  <Select value={ingest.source_id} onValueChange={(v) => setIngest({ ...ingest, source_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                    <SelectContent>
                      {((sources.data as any[]) ?? []).map((s: any) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="am-published">Published at (optional)</Label>
                  <Input id="am-published" type="date" value={ingest.published_at} onChange={(e) => setIngest({ ...ingest, published_at: e.target.value })} />
                </div>
              </div>
              <div>
                <Label htmlFor="am-title">Title</Label>
                <Input id="am-title" value={ingest.title} onChange={(e) => setIngest({ ...ingest, title: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="am-url">URL (optional)</Label>
                <Input id="am-url" type="url" value={ingest.url} onChange={(e) => setIngest({ ...ingest, url: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="am-summary">Summary</Label>
                <Textarea id="am-summary" value={ingest.summary} onChange={(e) => setIngest({ ...ingest, summary: e.target.value })} rows={3} />
              </div>
              <Button
                disabled={ingestItem.isPending || !ingest.source_id || ingest.title.trim().length < 3}
                onClick={() => ingestItem.mutate({
                  source_id: Number(ingest.source_id),
                  title: ingest.title.trim(),
                  url: ingest.url || undefined,
                  summary: ingest.summary || undefined,
                  published_at: ingest.published_at || undefined,
                })}
              >Ingest</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
