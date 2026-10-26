/**
 * NextBestActionCard (round 12, wave 7 — roadmap §6)
 * ==================================================
 * Shows the deterministic next-best-action for an entity (complaint,
 * settlement, publication, finding) from nextBestActionRouter.forEntity.
 *
 * Feedback loop (surface 'next_best_action', model 'rules:v1'):
 *   clicking the action  → acceptSuggestion(predictionId)
 *   dismissing the card  → ignoreSuggestion(predictionId)
 *
 * Router namespace `nextBestAction` is mounted in server/routers.ts
 * (round-12 integration); access is fully typed via AppRouter.
 */
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Compass, X } from "lucide-react";
import { acceptSuggestion, ignoreSuggestion } from "@/lib/feedback";

export type NbaEntityType = "complaint" | "settlement" | "publication" | "finding";

interface Props {
  entityType: NbaEntityType;
  entityId: number | null;
  /** Called after the officer accepts the action (e.g. to focus a form). */
  onAction?: (action: string, mutationHint: string) => void;
}

export function NextBestActionCard({ entityType, entityId, onAction }: Props) {
  const query = trpc.nextBestAction.forEntity.useQuery(
    { entityType, entityId: entityId ?? 0 },
    { enabled: entityId != null, refetchOnWindowFocus: false },
  );

  const data: any = query.data;
  if (entityId == null || !data?.action || !data?.predictionId) return null;

  const onAccept = () => {
    acceptSuggestion(data.predictionId, { surface: "next_best_action", modelVersion: "rules:v1" }).catch(() => {});
    onAction?.(data.action, data.mutationHint);
  };
  const onDismiss = () => {
    ignoreSuggestion(data.predictionId, { surface: "next_best_action", modelVersion: "rules:v1" }).catch(() => {});
    query.refetch();
  };

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="py-3 flex items-start gap-3">
        <Compass className="h-5 w-5 mt-0.5 shrink-0" />
        <div className="flex-1 space-y-1">
          <p className="text-sm font-medium">Suggested next step: {data.label}</p>
          <p className="text-xs text-muted-foreground">{data.rationale}</p>
          <p className="text-xs font-mono text-muted-foreground">{data.mutationHint}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" onClick={onAccept}>
            {data.label} <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Dismiss suggestion" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
