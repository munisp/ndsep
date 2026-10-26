/**
 * CopilotDraftModal (round 12, wave 7 — roadmap §6)
 * =================================================
 * "Draft with AI" modal over copilotDraftRouter.draft. The server returns
 * { predictionId, draft }; the officer edits freely, then:
 *
 *   Accept       → acceptSuggestion(predictionId, { surface })
 *   Edit-accept  → editSuggestion(predictionId, { surface, finalValue, editDistance })
 *                  (normalized Levenshtein via computeEditDistance)
 *   Reject       → rejectSuggestion(predictionId, { surface })
 *
 * Every outcome flows through the Wave-1 feedback loop (client/src/lib/feedback.ts).
 * The router namespace is typed via AppRouter (copilotDraft mounted in
 * server/routers.ts by the round-12 integrator).
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { acceptSuggestion, editSuggestion, rejectSuggestion, computeEditDistance } from "@/lib/feedback";

export type CopilotTemplate = "complaint_acknowledgment" | "enforcement_notice" | "settlement_terms";

const SURFACE_FOR: Record<CopilotTemplate, string> = {
  complaint_acknowledgment: "copilot_draft",
  enforcement_notice: "copilot_draft",
  settlement_terms: "settlement_terms",
};

const TITLE_FOR: Record<CopilotTemplate, string> = {
  complaint_acknowledgment: "Draft complaint acknowledgement",
  enforcement_notice: "Draft enforcement notice",
  settlement_terms: "Draft settlement term proposal",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: CopilotTemplate;
  entityId: number | null;
  /** Optional callback after Accept / Edit-accept with the final text. */
  onAccepted?: (finalText: string) => void;
}

export function CopilotDraftModal({ open, onOpenChange, template, entityId, onAccepted }: Props) {
  const [tone, setTone] = useState<"formal" | "neutral" | "firm">("formal");
  const [instructions, setInstructions] = useState("");
  const [predictionId, setPredictionId] = useState<string | null>(null);
  const [modelVersion, setModelVersion] = useState<string | undefined>(undefined);
  const [suggested, setSuggested] = useState("");
  const [edited, setEdited] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  const draft = trpc.copilotDraft.draft.useMutation({
    onSuccess: (res: any) => {
      setPredictionId(res.predictionId);
      setModelVersion(res.modelVersion ?? undefined);
      setSuggested(res.draft);
      setEdited(res.draft);
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Reset per open / entity change.
  useEffect(() => {
    if (open) {
      setPredictionId(null);
      setSuggested("");
      setEdited("");
      setInstructions("");
      setTone("formal");
    }
  }, [open, entityId, template]);

  const requestDraft = () => {
    if (entityId == null) return;
    draft.mutate({ template, entityId, tone, instructions: instructions.trim() || undefined });
  };

  const record = async (fn: () => Promise<unknown>, success: string) => {
    setFeedbackBusy(true);
    try {
      await fn();
      toast.success(success);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record feedback");
    } finally {
      setFeedbackBusy(false);
    }
  };

  const surface = SURFACE_FOR[template];
  const dirty = edited !== suggested;

  const onAccept = () =>
    predictionId &&
    record(async () => {
      await acceptSuggestion(predictionId, { surface, modelVersion });
      onAccepted?.(suggested);
    }, "Draft accepted — feedback recorded");

  const onEditAccept = () =>
    predictionId &&
    record(async () => {
      await editSuggestion(predictionId, {
        surface,
        modelVersion,
        finalValue: { draft: edited },
        editDistance: computeEditDistance(suggested, edited),
      });
      onAccepted?.(edited);
    }, "Edited draft accepted — feedback recorded");

  const onReject = () =>
    predictionId &&
    record(async () => {
      await rejectSuggestion(predictionId, { surface, modelVersion });
    }, "Draft rejected — feedback recorded");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> {TITLE_FOR[template]}</DialogTitle>
          <DialogDescription>
            AI-assisted draft. Review and edit before use — your decision is recorded for acceptance analytics.
          </DialogDescription>
        </DialogHeader>

        {!predictionId ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tone</Label>
                <Select value={tone} onValueChange={(v) => setTone(v as typeof tone)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="formal">Formal</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                    <SelectItem value="firm">Firm</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Instructions (optional)</Label>
              <Textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. emphasise the 72-hour acknowledgement window" />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={requestDraft} disabled={draft.isPending || entityId == null}>
                {draft.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Generate draft
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              rows={14}
              value={edited}
              onChange={(e) => setEdited(e.target.value)}
              className="font-mono text-sm"
              aria-label="Draft text"
            />
            {dirty && <p className="text-xs text-muted-foreground">Edited — edit distance {(computeEditDistance(suggested, edited)).toFixed(3)} will be recorded.</p>}
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => { setPredictionId(null); setSuggested(""); setEdited(""); }}>Regenerate</Button>
              <Button variant="destructive" onClick={onReject} disabled={feedbackBusy}>Reject</Button>
              {dirty ? (
                <Button onClick={onEditAccept} disabled={feedbackBusy}>
                  {feedbackBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Accept edited draft
                </Button>
              ) : (
                <Button onClick={onAccept} disabled={feedbackBusy}>
                  {feedbackBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Accept draft
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
