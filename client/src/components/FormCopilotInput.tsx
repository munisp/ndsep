/**
 * FormCopilotInput (round 12, wave 7 — roadmap §6)
 * ================================================
 * "Prefill from description" assistant for complex declaration forms. The
 * officer pastes a free-text description; the server (formCopilotRouter.parse)
 * extracts schema-validated fields and returns them with per-field confidence
 * plus the list of still-missing required fields.
 *
 * The component NEVER submits the form — "Apply prefill" hands the validated
 * fields to the parent form via onPrefill for human review, and records the
 * outcome through the Wave-1 feedback loop (surface 'form_copilot'):
 *   Apply → acceptSuggestion; Discard → rejectSuggestion.
 * Fields with low confidence (<0.6) are highlighted amber so the reviewer
 * knows where to look first.
 *
 * Router namespace `formCopilot` is mounted in server/routers.ts (round-12
 * integration); access is fully typed via AppRouter.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Wand2 } from "lucide-react";
import { acceptSuggestion, rejectSuggestion } from "@/lib/feedback";

export type FormCopilotFormKind = "hosting_declaration" | "cross_border_declaration";

export interface FormCopilotResult {
  predictionId: string;
  fields: Record<string, unknown>;
  fieldConfidence: Record<string, number>;
  missing: string[];
  invalid: { field: string; reason: string }[];
  confidence: number;
}

interface Props {
  form: FormCopilotFormKind;
  /** Called with the validated fields when the officer applies the prefill. */
  onPrefill: (fields: Record<string, unknown>, fieldConfidence: Record<string, number>) => void;
}

export function FormCopilotInput({ form, onPrefill }: Props) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<FormCopilotResult | null>(null);

  const parse = trpc.formCopilot.parse.useMutation({
    onSuccess: (res: any) => setResult(res as FormCopilotResult),
    onError: (err: any) => toast.error(err.message),
  });

  const confidenceClass = (c: number) =>
    c >= 0.8
      ? "bg-green-500/15 text-green-300 border-green-500/40"
      : c >= 0.6
        ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/40"
        : "bg-amber-600/25 text-amber-300 border-amber-500/50";

  const apply = async () => {
    if (!result) return;
    onPrefill(result.fields, result.fieldConfidence);
    try {
      await acceptSuggestion(result.predictionId, { surface: "form_copilot" });
    } catch {
      /* feedback is best-effort; prefill already applied */
    }
    toast.success("Prefill applied — review every highlighted field before submitting");
    setResult(null);
    setText("");
  };

  const discard = async () => {
    if (!result) return;
    try {
      await rejectSuggestion(result.predictionId, { surface: "form_copilot" });
    } catch {
      /* best-effort */
    }
    setResult(null);
  };

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-primary/5">
      <div className="flex items-center gap-2">
        <Wand2 className="h-4 w-4" />
        <p className="font-medium text-sm">Form copilot — prefill from a description</p>
      </div>
      <Textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Describe the entity's posture in plain language, e.g. 'RC123456, ExamplePay Ltd, a fintech. Primary DC in Lagos, backups in Lagos and DR in Abuja. AWS eu-west-1 for analytics. Keys in our own HSM in Nigeria…'"
      />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={parse.isPending || text.trim().length < 10}
          onClick={() => parse.mutate({ form, text: text.trim() })}
        >
          {parse.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
          Prefill from description
        </Button>
        {result && (
          <>
            <Button type="button" size="sm" onClick={apply}>Apply prefill</Button>
            <Button type="button" size="sm" variant="ghost" onClick={discard}>Discard</Button>
          </>
        )}
      </div>

      {result && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-muted-foreground">Extracted (overall confidence {result.confidence.toFixed(2)}):</span>
            {Object.keys(result.fields).map((k) => (
              <Badge key={k} variant="outline" className={confidenceClass(result.fieldConfidence[k] ?? 0)}>
                {k} {(result.fieldConfidence[k] ?? 0).toFixed(2)}
              </Badge>
            ))}
            {Object.keys(result.fields).length === 0 && <span className="text-muted-foreground">none</span>}
          </div>
          {result.missing.length > 0 && (
            <p className="text-yellow-400 text-xs">Still required: {result.missing.join(", ")}</p>
          )}
          {result.invalid.length > 0 && (
            <div className="text-red-400 text-xs space-y-0.5">
              {result.invalid.map((i) => (
                <p key={i.field}>Dropped invalid field {i.field}: {i.reason}</p>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Nothing is submitted automatically — review the prefilled form below before submitting.</p>
        </div>
      )}
    </div>
  );
}
