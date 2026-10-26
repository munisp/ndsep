/**
 * SettlementRecommendationCard (round 12, wave 8 — roadmap P2)
 * ============================================================
 * Advisory "Recommendation" card for the settlement proposal panel: scores
 * the current term sheet with the learned fulfillment model
 * (server/services/settlementRecommender.ts) and shows precedent-derived
 * suggested adjustments (median instalments / reduction of FULFILLED similar
 * settlements from the ndsep_cases collection).
 *
 * Feedback loop (roadmap §4.1 keystone): the response carries a
 * predictionId (decision_feedback, surface='settlement_terms'); the
 * Accept / Edit / Reject buttons record the officer's outcome through
 * client/src/lib/feedback.ts.
 *
 * Advisory only: nothing here mutates the proposal form or the settlement —
 * the officer's term sheet stays authoritative.
 *
 * NOTE: the router is mounted under the `settlementRecommender` namespace
 * in server/routers.ts (round-12 integration); access is fully typed via
 * AppRouter.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { acceptSuggestion, editSuggestion, rejectSuggestion } from "@/lib/feedback";

export interface SettlementTermsPayload {
  monetaryAmount: number;
  currency: string;
  nonMonetaryObligations: string[];
  instalmentSchedule: Array<{ seq?: number; dueDate?: string; amount?: number }>;
  confidentialityFlag: boolean;
  transparencyRationale?: string;
}

interface SuggestedAdjustment {
  parameter: string;
  current: number | string;
  suggested: number | string;
  rationale: string;
}

interface Recommendation {
  predictionId: string;
  fulfillmentProbability: number | null;
  suggestedAdjustments: SuggestedAdjustment[];
  precedentStats: {
    fulfilledCases: number;
    medianInstalments: number | null;
    medianReductionRatio: number | null;
  };
  modelVersion: string | null;
  degraded: boolean;
  reason: string | null;
}

export function SettlementRecommendationCard(props: {
  terms: SettlementTermsPayload;
  originalAmount?: number | null;
  orgSector?: string;
  orgDataVolumeClass?: string;
  queryText?: string;
}) {
  const { terms, originalAmount, orgSector, orgDataVolumeClass, queryText } = props;
  const [acted, setActed] = useState<"accept" | "edit" | "reject" | null>(null);

  const recommend = trpc.settlementRecommender.recommendTerms.useMutation({
    onError: (err: any) => toast.error(err.message ?? "Recommendation failed"),
  }) as {
    mutate: (v: unknown, opts?: { onSuccess?: (d: Recommendation) => void }) => void;
    isPending: boolean;
    data?: Recommendation;
  };

  const rec = recommend.data;

  const score = () => {
    setActed(null);
    recommend.mutate({
      monetaryAmount: terms.monetaryAmount,
      originalAmount: originalAmount ?? null,
      instalmentSchedule: terms.instalmentSchedule,
      nonMonetaryObligations: terms.nonMonetaryObligations,
      confidentialityFlag: terms.confidentialityFlag,
      orgSector,
      orgDataVolumeClass,
      queryText,
    });
  };

  const record = async (action: "accept" | "edit" | "reject") => {
    if (!rec?.predictionId) return;
    try {
      if (action === "accept") {
        await acceptSuggestion(rec.predictionId, { surface: "settlement_terms", modelVersion: rec.modelVersion ?? undefined });
        toast.success("Recommendation accepted — apply the adjustments to the term sheet above");
      } else if (action === "edit") {
        await editSuggestion(rec.predictionId, {
          surface: "settlement_terms",
          modelVersion: rec.modelVersion ?? undefined,
          finalValue: {
            monetary_amount: terms.monetaryAmount,
            n_instalments: terms.instalmentSchedule.length,
            n_obligations: terms.nonMonetaryObligations.length,
            confidential: terms.confidentialityFlag,
          },
        });
        toast.success("Recorded: proceeding with edited terms");
      } else {
        await rejectSuggestion(rec.predictionId, { surface: "settlement_terms", modelVersion: rec.modelVersion ?? undefined });
        toast.success("Recommendation rejected");
      }
      setActed(action);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to record feedback");
    }
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="py-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Recommendation
          <Badge variant="outline" className="text-[10px]">advisory</Badge>
          {rec?.degraded && (
            <Badge variant="outline" className="bg-yellow-500/20 text-yellow-300 border-yellow-500/40">degraded</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {!rec && (
          <p className="text-sm text-muted-foreground">
            Score the proposed terms against fulfilled settlement outcomes and
            get precedent-based adjustments before opening the negotiation.
          </p>
        )}
        <Button
          type="button" size="sm" variant="secondary"
          disabled={recommend.isPending || !terms.monetaryAmount}
          onClick={score}
        >
          {recommend.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {rec ? "Re-score terms" : "Score these terms"}
        </Button>

        {rec && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {rec.fulfillmentProbability != null ? (
                <p className="text-sm">
                  Estimated fulfillment probability:{" "}
                  <span className="font-mono font-semibold">
                    {(rec.fulfillmentProbability * 100).toFixed(1)}%
                  </span>
                </p>
              ) : (
                <p className="text-sm text-yellow-400 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Model score unavailable
                </p>
              )}
              {rec.precedentStats.fulfilledCases > 0 && (
                <p className="text-xs text-muted-foreground">
                  {rec.precedentStats.fulfilledCases} fulfilled similar case(s)
                  {rec.precedentStats.medianInstalments != null
                    ? ` · median ${Math.round(rec.precedentStats.medianInstalments)} instalments`
                    : ""}
                </p>
              )}
            </div>

            {rec.suggestedAdjustments.length > 0 ? (
              <ul className="space-y-2">
                {rec.suggestedAdjustments.map((a, i) => (
                  <li key={i} className="border rounded-md px-3 py-2 text-sm">
                    <p className="font-medium">
                      {a.parameter.replaceAll("_", " ")}: {String(a.current)} → {String(a.suggested)}
                    </p>
                    <p className="text-xs text-muted-foreground">{a.rationale}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No adjustments suggested — the proposal is in line with fulfilled similar cases.
              </p>
            )}

            {acted ? (
              <p className="text-xs text-muted-foreground">
                Feedback recorded: {acted}
                {acted === "accept" ? " — apply the adjustments to the term sheet" : ""}
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => record("accept")}>
                  <Check className="h-3.5 w-3.5 mr-1" /> Accept
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => record("edit")}>
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit terms
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => record("reject")}>
                  <X className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
              </div>
            )}
            {rec.reason && (
              <p className="text-[11px] text-yellow-400/80">{rec.reason}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Advisory only — the officer's term sheet is authoritative.
              {rec.modelVersion ? ` Model ${rec.modelVersion}.` : ""}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SettlementRecommendationCard;
