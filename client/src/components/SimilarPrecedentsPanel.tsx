/**
 * SimilarPrecedentsPanel (round 12, wave 6 — roadmap §4.3)
 * ========================================================
 * Collapsible "similar precedents" panel backed by the casePrecedents tRPC
 * router, which retrieves the Commission's own decided cases from the Qdrant
 * `ndsep_cases` collection (populated by workers/python/case_embedder_worker.py
 * from closed complaints, decided enforcement cases, completed settlements,
 * and decided tribunal escalations).
 *
 * Each retrieval response carries a `predictionId` (decision_feedback,
 * surface='precedents'); the per-card helpful / not-helpful buttons call
 * logPrecedentOutcome so precedent usefulness feeds the acceptance-rate
 * analytics like every other AI surface.
 *
 * Fail-closed UX: when retrieval is degraded (vector worker unreachable or
 * no cases embedded yet) the panel renders an explicit notice instead of
 * fabricated precedents.
 *
 * NOTE: the router is mounted under the `casePrecedents` namespace in
 * server/routers.ts (round-12 integration); access is fully typed via
 * AppRouter.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { BookOpen, ChevronDown, ChevronRight, Loader2, ThumbsDown, ThumbsUp, AlertTriangle } from "lucide-react";

export type PrecedentCaseType = "complaint" | "enforcement" | "settlement" | "tribunal";

export interface PrecedentCard {
  caseType: string;
  caseId: string;
  reference: string;
  category: string;
  sector: string;
  outcome: string;
  penaltyBand: string;
  decidedAt: string;
  score: number;
}

const OUTCOME_COLORS: Record<string, string> = {
  resolved: "bg-green-500/20 text-green-300 border-green-500/40",
  closed: "bg-muted text-muted-foreground border-border",
  settled: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  fulfilled: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  defaulted: "bg-red-500/20 text-red-300 border-red-500/40",
  decided: "bg-purple-500/20 text-purple-300 border-purple-500/40",
};

export function SimilarPrecedentsPanel(props: {
  caseType?: PrecedentCaseType;
  queryText?: string;
  complaintId?: number;
  limit?: number;
  title?: string;
  /** Start expanded (default: collapsed). */
  defaultOpen?: boolean;
}) {
  const { caseType, queryText, complaintId, limit = 5, title, defaultOpen = false } = props;
  const [open, setOpen] = useState(defaultOpen);
  // Only fetch when expanded and we have something to search with.
  const enabled = open && (Boolean(queryText && queryText.trim().length >= 3) || Boolean(complaintId));

  const query = trpc.casePrecedents.similarCases.useQuery(
    {
      caseType,
      queryText: queryText && queryText.trim().length >= 3 ? queryText.trim().slice(0, 4000) : undefined,
      complaintId,
      limit,
    },
    { enabled, staleTime: 60_000, retry: false },
  ) as {
    data?: {
      predictionId: string | null;
      results: PrecedentCard[];
      degraded: boolean;
      reason: string | null;
    };
    isFetching: boolean;
    isError: boolean;
    error?: { message?: string };
  };

  const outcome = trpc.casePrecedents.logPrecedentOutcome.useMutation({
    onSuccess: (_r: any, vars: any) =>
      toast.success(vars?.helpful ? "Marked precedent helpful" : "Marked precedent not helpful"),
    onError: (err: any) => toast.error(err.message ?? "Failed to record feedback"),
  }) as { mutate: (v: any) => void; isPending: boolean };

  // Track one verdict per card (caseType:caseId) so a user can't double-vote.
  const [voted, setVoted] = useState<Record<string, "helpful" | "not_helpful">>({});

  const data = query.data;
  const results = data?.results ?? [];

  const vote = (card: PrecedentCard, helpful: boolean) => {
    if (!data?.predictionId) {
      toast.error("No prediction id on this result set — refresh the panel");
      return;
    }
    const key = `${card.caseType}:${card.caseId}`;
    setVoted((prev) => ({ ...prev, [key]: helpful ? "helpful" : "not_helpful" }));
    outcome.mutate({
      predictionId: data.predictionId,
      helpful,
      caseType: card.caseType,
      caseId: card.caseId,
    });
  };

  return (
    <Card>
      <CardHeader className="py-3">
        <button
          type="button"
          className="flex items-center gap-2 text-left w-full"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <BookOpen className="h-4 w-4" />
          <CardTitle className="text-base">{title ?? "Similar precedents"}</CardTitle>
          {data?.degraded && (
            <Badge variant="outline" className="ml-2 bg-yellow-500/20 text-yellow-300 border-yellow-500/40">
              degraded
            </Badge>
          )}
          {!data?.degraded && results.length > 0 && (
            <Badge variant="outline" className="ml-2">{results.length}</Badge>
          )}
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2 pt-0">
          {query.isFetching && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching decided cases…
            </p>
          )}
          {query.isError && !query.isFetching && (
            <p className="text-sm text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> {query.error?.message ?? "Precedent search failed."}
            </p>
          )}
          {!query.isFetching && data?.degraded && (
            <p className="text-sm text-yellow-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> {data.reason ?? "Precedent retrieval degraded."}
            </p>
          )}
          {!query.isFetching && !query.isError && !data?.degraded && results.length === 0 && (
            <p className="text-sm text-muted-foreground">No similar decided cases found.</p>
          )}
          <ul className="space-y-2">
            {results.map((card) => {
              const key = `${card.caseType}:${card.caseId}`;
              const verdict = voted[key];
              return (
                <li key={key} className="border rounded-md px-3 py-2 text-sm space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-mono text-xs">{card.reference || `#${card.caseId}`}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{card.caseType}</Badge>
                      <Badge variant="outline" className={OUTCOME_COLORS[card.outcome] ?? ""}>{card.outcome}</Badge>
                      {card.penaltyBand && card.penaltyBand !== "none" && (
                        <Badge variant="outline" className="bg-orange-500/20 text-orange-300 border-orange-500/40">
                          {card.penaltyBand.replaceAll("_", " ")}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground font-mono" title="cosine similarity">
                        {card.score.toFixed(3)}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[card.category, card.sector, card.decidedAt].filter(Boolean).join(" · ")}
                  </p>
                  <div className="flex items-center gap-1 pt-1">
                    {verdict ? (
                      <span className="text-xs text-muted-foreground">
                        Feedback recorded: {verdict === "helpful" ? "helpful" : "not helpful"}
                      </span>
                    ) : (
                      <>
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2"
                          disabled={outcome.isPending || !data?.predictionId}
                          onClick={() => vote(card, true)}
                          title="This precedent is helpful"
                        >
                          <ThumbsUp className="h-3.5 w-3.5 mr-1" /> Helpful
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2"
                          disabled={outcome.isPending || !data?.predictionId}
                          onClick={() => vote(card, false)}
                          title="This precedent is not helpful"
                        >
                          <ThumbsDown className="h-3.5 w-3.5 mr-1" /> Not helpful
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Precedents are redacted cards of the Commission's decided cases (no party PII). Similarity is semantic, not legal advice.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

export default SimilarPrecedentsPanel;
