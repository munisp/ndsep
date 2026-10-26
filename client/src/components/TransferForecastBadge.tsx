/**
 * TransferForecastBadge (Round-13 P1.6)
 * ======================================
 * Blended geopolitical risk chip for a transfer destination country, with a
 * popover showing the OI forecast rationale, source links (auditable
 * provenance — preserved verbatim from OI), forecast age, and staff
 * agree/disagree feedback wired to decision_feedback (surface
 * 'transfer_forecast').
 *
 * COST DISCIPLINE: the badge NEVER auto-triggers a forecast run — it reads
 * the latest persisted reading (transferForecast.latestForCountry, cheap
 * DB-only). A staff member explicitly refreshes via "Run forecast"
 * (transferForecast.forecastForCountry mutation; the service still
 * 24h-caches per country).
 *
 * The transferForecast router is mounted in server/routers.ts (Round-13
 * integration) — calls are fully typed.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { ExternalLink, Loader2, RefreshCw, ThumbsDown, ThumbsUp, TrendingUp } from "lucide-react";

const api = trpc;

const LEVEL_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-300 border-red-500/40",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  elevated: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  none: "bg-green-500/20 text-green-300 border-green-500/40",
};

function sourceUrl(s: unknown): string | null {
  if (typeof s === "string") return s;
  if (s && typeof s === "object") {
    const u = (s as Record<string, unknown>).url;
    if (typeof u === "string" && u) return u;
  }
  return null;
}

function sourceLabel(s: unknown): string {
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    if (typeof o.title === "string" && o.title) return o.title;
    if (typeof o.publisher === "string" && o.publisher) return o.publisher;
  }
  const u = sourceUrl(s);
  if (u) {
    try {
      return new URL(u).hostname;
    } catch {
      return u.slice(0, 48);
    }
  }
  return "source";
}

export function TransferForecastBadge({ iso }: { iso: string }) {
  const upper = iso.trim().toUpperCase();
  const [open, setOpen] = useState(false);

  const latest = api.transferForecast.latestForCountry.useQuery(
    { iso: upper },
    { enabled: /^[A-Z]{2}$/.test(upper), retry: false }
  );

  const runForecast = api.transferForecast.forecastForCountry.useMutation({
    onSuccess: () => {
      toast.success(`Forecast updated for ${upper}`);
      latest.refetch();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const agree = api.transferForecast.agreeForecast.useMutation({
    onSuccess: () => toast.success("Feedback recorded — you agree with the blended reading"),
    onError: (err: any) => toast.error(err.message),
  });
  const disagree = api.transferForecast.disagreeForecast.useMutation({
    onSuccess: () => toast.success("Feedback recorded — you disagree with the blended reading"),
    onError: (err: any) => toast.error(err.message),
  });

  const forecast = latest.data?.forecast ?? null;
  const level = forecast?.blendedLevel ?? null;

  if (!/^[A-Z]{2}$/.test(upper)) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex" title="Transfer risk forecast">
          {latest.isLoading ? (
            <Badge variant="outline" className="text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
            </Badge>
          ) : level ? (
            <Badge variant="outline" className={LEVEL_COLORS[level] ?? ""}>
              <TrendingUp className="h-3 w-3 mr-1" />
              {level}
              {forecast?.forecastProbability != null && (
                <span className="ml-1 font-mono text-[10px] opacity-80">
                  {(forecast.forecastProbability * 100).toFixed(0)}%
                </span>
              )}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              <TrendingUp className="h-3 w-3 mr-1" /> no forecast
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 space-y-3" align="start">
        <div className="flex items-center justify-between">
          <div className="font-medium text-sm">Transfer risk forecast — {upper}</div>
          {level && (
            <Badge variant="outline" className={LEVEL_COLORS[level] ?? ""}>
              {level}
            </Badge>
          )}
        </div>

        {forecast ? (
          <>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Static conflict risk</span>
              <span className="font-mono text-foreground">{forecast.staticRisk}</span>
              <span>Forecast probability (12mo adverse)</span>
              <span className="font-mono text-foreground">
                {forecast.forecastProbability != null ? forecast.forecastProbability.toFixed(2) : "—"}
              </span>
              <span>Reading</span>
              <span className="font-mono text-foreground">
                {forecast.forecastStatus}
                {forecast.fromCache ? " (cached)" : ""}
              </span>
              <span>Run at</span>
              <span className="font-mono text-foreground">
                {forecast.createdAt ? new Date(forecast.createdAt).toLocaleString() : "—"}
              </span>
            </div>
            {forecast.rationale && (
              <p className="text-xs leading-relaxed border-l-2 border-muted pl-2">{forecast.rationale}</p>
            )}
            {Array.isArray(forecast.sources) && forecast.sources.length > 0 && (
              <div>
                <div className="text-xs font-medium mb-1">Sources ({forecast.sources.length})</div>
                <ul className="space-y-1 max-h-32 overflow-y-auto">
                  {forecast.sources.slice(0, 12).map((s: unknown, i: number) => {
                    const url = sourceUrl(s);
                    return (
                      <li key={i} className="text-xs">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-blue-400 hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" /> {sourceLabel(s)}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">{sourceLabel(s)}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {forecast.forecastId && forecast.predictionId && (
              <div className="flex items-center gap-2 pt-1 border-t">
                <span className="text-xs text-muted-foreground">Officer review:</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={agree?.isPending || disagree?.isPending}
                  onClick={() => agree.mutate({ forecastId: forecast.forecastId as string })}
                >
                  <ThumbsUp className="h-3 w-3 mr-1" /> Agree
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={agree?.isPending || disagree?.isPending}
                  onClick={() => disagree.mutate({ forecastId: forecast.forecastId as string })}
                >
                  <ThumbsDown className="h-3 w-3 mr-1" /> Disagree
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            No forecast reading yet for {upper}. Forecasts run on demand (they are expensive swarm
            simulations) and are then cached for 24h.
          </p>
        )}

        <Button
          size="sm"
          variant="secondary"
          className="w-full h-8 text-xs"
          disabled={runForecast?.isPending}
          onClick={() => runForecast.mutate({ iso: upper })}
        >
          {runForecast?.isPending ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3 mr-1" />
          )}
          {forecast ? "Refresh forecast" : "Run forecast"}
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Blended = static conflict-zone risk + OSIRIS OI Forecast. Model keys are held server-side
          only; sources are preserved verbatim for audit.
        </p>
      </PopoverContent>
    </Popover>
  );
}
