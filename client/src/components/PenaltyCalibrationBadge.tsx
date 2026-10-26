/**
 * PenaltyCalibrationBadge (round 12, wave 8 — roadmap P2)
 * =======================================================
 * Advisory calibration badge for the NDPA s.48 penalty preview:
 * P(upheld on appeal | penalty_band, violation_type, org_size,
 * legal_basis_section) plus the median penalty-band midpoint of similar
 * decided enforcement precedents.
 *
 * HARD RULE: this badge NEVER alters the computed penalty — the s.48
 * computation is authoritative; the badge is context for the officer
 * ("penalties like this were upheld on appeal X% of the time").
 *
 * Feedback loop: the response carries a predictionId (decision_feedback,
 * surface='penalty_calibration'); Accept / Reject record the officer's
 * verdict via client/src/lib/feedback.ts.
 *
 * NOTE: the router is mounted under the `penaltyCalibration` namespace in
 * server/routers.ts (round-12 integration); access is fully typed via
 * AppRouter.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, Scale, X } from "lucide-react";
import { acceptSuggestion, rejectSuggestion } from "@/lib/feedback";

interface CalibrationBadge {
  predictionId: string;
  penaltyBand: string;
  upholdProbability: number | null;
  similarMedian: number | null;
  similarCount: number;
  modelVersion: string | null;
  degraded: boolean;
  reason: string | null;
  computedAmount: number;
}

const fmtNGN = (n: number) => `₦${n.toLocaleString("en-NG")}`;

export function PenaltyCalibrationBadge(props: {
  penaltyAmount: number;
  violationType?: string;
  orgSize?: string;
  legalBasisSection?: string;
  orgId?: number;
  queryText?: string;
}) {
  const { penaltyAmount, violationType, orgSize, legalBasisSection, orgId, queryText } = props;
  const [acted, setActed] = useState<"accept" | "reject" | null>(null);

  const calibrate = trpc.penaltyCalibration.calibratePreview.useMutation({
    onError: (err: any) => toast.error(err.message ?? "Calibration failed"),
  }) as {
    mutate: (v: unknown, opts?: unknown) => void;
    isPending: boolean;
    data?: CalibrationBadge;
  };
  const badge = calibrate.data;

  const run = () => {
    setActed(null);
    calibrate.mutate({ penaltyAmount, violationType, orgSize, legalBasisSection, orgId, queryText });
  };

  const record = async (action: "accept" | "reject") => {
    if (!badge?.predictionId) return;
    try {
      if (action === "accept") {
        await acceptSuggestion(badge.predictionId, { surface: "penalty_calibration", modelVersion: badge.modelVersion ?? undefined });
        toast.success("Calibration noted");
      } else {
        await rejectSuggestion(badge.predictionId, { surface: "penalty_calibration", modelVersion: badge.modelVersion ?? undefined });
        toast.success("Calibration dismissed");
      }
      setActed(action);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to record feedback");
    }
  };

  return (
    <div className="border border-dashed rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Scale className="h-4 w-4" />
        <span className="text-sm font-medium">Appeal-survival calibration</span>
        <Badge variant="outline" className="text-[10px]">advisory — does not change the amount</Badge>
        {badge?.degraded && (
          <Badge variant="outline" className="bg-yellow-500/20 text-yellow-300 border-yellow-500/40">degraded</Badge>
        )}
      </div>

      <Button type="button" size="sm" variant="secondary" disabled={calibrate.isPending || !penaltyAmount} onClick={run}>
        {calibrate.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        {badge ? "Re-calibrate" : "Calibrate appeal survival"}
      </Button>

      {badge && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            {badge.upholdProbability != null ? (
              <p>
                Similar penalties upheld on appeal:{" "}
                <span className="font-mono font-semibold">{(badge.upholdProbability * 100).toFixed(1)}%</span>
              </p>
            ) : (
              <p className="text-yellow-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Calibration model unavailable
              </p>
            )}
            <Badge variant="outline">{badge.penaltyBand.replaceAll("_", " ")}</Badge>
            {badge.similarMedian != null && (
              <p className="text-xs text-muted-foreground">
                median of {badge.similarCount} similar decided case(s): ~{fmtNGN(badge.similarMedian)}
              </p>
            )}
          </div>
          {acted ? (
            <p className="text-xs text-muted-foreground">Feedback recorded: {acted}</p>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => record("accept")}>
                <Check className="h-3.5 w-3.5 mr-1" /> Noted
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => record("reject")}>
                <X className="h-3.5 w-3.5 mr-1" /> Dismiss
              </Button>
            </div>
          )}
          {badge.reason && <p className="text-[11px] text-yellow-400/80">{badge.reason}</p>}
          <p className="text-[11px] text-muted-foreground">
            Advisory only — the s.48 computation ({fmtNGN(badge.computedAmount)}) is authoritative and unchanged.
            {badge.modelVersion ? ` Model ${badge.modelVersion}.` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

export default PenaltyCalibrationBadge;
