import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Satellite, RefreshCw, Play } from "lucide-react";

/**
 * OsirisFeedStatusCard (Round-16 W4)
 * ==================================
 * Compact status strip over the OSIRIS-sourced adverse-media intel feeds
 * (osiris_gdelt / osiris_news). Surfaces per-source watermarks, last poll
 * timestamps and review-queue counts from `osirisIntelFeed.feedStatus`, plus
 * an admin-only `triggerPoll` run-now control (fail-closed on the server).
 *
 * Mounted at the top of AdverseMediaReview — purely additive.
 */

type SourceKey = "osiris_gdelt" | "osiris_news";

const SRC_LABELS: Record<string, string> = {
  osiris_gdelt: "GDELT",
  osiris_news: "Live News",
};

function fmtTs(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

export default function OsirisFeedStatusCard() {
  const status = trpc.osirisIntelFeed.feedStatus.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const [pollSource, setPollSource] = useState<string>("all");
  const triggerPoll = trpc.osirisIntelFeed.triggerPoll.useMutation({
    onSuccess: () => {
      toast.success("OSIRIS poll cycle completed");
      status.refetch();
    },
    onError: (err) => toast.error(`Poll failed: ${err.message}`),
  });

  const data: any = status.data;
  const watermarks: any[] = Array.isArray(data?.watermarks) ? data.watermarks : [];
  const sources: any[] = Array.isArray(data?.sources) ? data.sources : [];
  const counts: any[] = Array.isArray(data?.counts) ? data.counts : [];

  const lastPoll = watermarks
    .map((w) => w?.last_run_at)
    .filter(Boolean)
    .sort()
    .pop();

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <Satellite className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">OSIRIS Intel Feed</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => status.refetch()}
              aria-label="Refresh feed status"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${status.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {status.isLoading && <span className="text-xs text-muted-foreground">Loading feed status…</span>}
          {status.isError && (
            <span className="text-xs text-red-400">Feed status unavailable: {status.error.message}</span>
          )}

          {!status.isLoading && !status.isError && (
            <>
              <div className="flex items-center gap-4">
                {(["osiris_gdelt", "osiris_news"] as SourceKey[]).map((key) => {
                  const wm = watermarks.find((w) => w?.source === key);
                  const src = sources.find((s) => s?.source_key === key);
                  const cnt = counts.find((c) => c?.source_key === key);
                  const enabled = src?.enabled !== false;
                  return (
                    <div key={key} className="flex items-center gap-2 text-xs">
                      <Badge variant={enabled ? "default" : "outline"}>{SRC_LABELS[key] ?? key}</Badge>
                      <span className="text-muted-foreground">
                        watermark <span className="font-mono text-foreground">{wm?.last_seen_id ?? "—"}</span>
                      </span>
                      <span className="text-muted-foreground">
                        polled <span className="text-foreground">{fmtTs(src?.last_polled_at ?? wm?.last_run_at)}</span>
                      </span>
                      {cnt && (
                        <span className="text-muted-foreground">
                          {cnt.total ?? 0} items ·{" "}
                          <span className="text-yellow-300">{cnt.pending ?? 0} pending</span> ·{" "}
                          <span className="text-green-300">{cnt.confirmed ?? 0} confirmed</span> ·{" "}
                          <span className="text-red-300">{cnt.rejected ?? 0} rejected</span>
                        </span>
                      )}
                      {src?.last_status && src.last_status !== "ok" && (
                        <Badge variant="outline" className="border-red-500/40 text-red-300">
                          {String(src.last_status)}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Last poll: <span className="text-foreground">{fmtTs(lastPoll)}</span></span>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <Select value={pollSource} onValueChange={setPollSource}>
                  <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    <SelectItem value="osiris_gdelt">GDELT only</SelectItem>
                    <SelectItem value="osiris_news">Live News only</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={triggerPoll.isPending}
                  onClick={() =>
                    triggerPoll.mutate(
                      pollSource === "all" ? undefined : { source: pollSource as SourceKey },
                    )
                  }
                >
                  <Play className="h-3.5 w-3.5 mr-1" />
                  {triggerPoll.isPending ? "Polling…" : "Poll now"}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
