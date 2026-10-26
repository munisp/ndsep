/**
 * Form copilot router (round 12, wave 7 — roadmap §6)
 * ===================================================
 * Natural-language → structured-field prefill for the platform's two nastiest
 * declaration forms:
 *
 *   hosting_declaration      — dataSovereignty.submitDeclaration
 *                              (declarationInputSchema, ~16 fields)
 *   cross_border_declaration — crossBorderDeclarations.submit
 *                              (DECLARATION_INPUT, ~12 fields; enum vocab
 *                              imported from services/transferValidation)
 *
 * Flow: the officer pastes a free-text description; the server asks the local
 * LLM gateway (/compliance-qa) for a STRICT JSON object constrained to the
 * target zod schema's field list, extracts the JSON, validates it server-side
 * field-by-field against a local replica of the target schema (`.partial()`),
 * DROPS invalid fields (reported in `invalid`), and reports schema-required
 * fields that could not be extracted in `missing`.
 *
 * The copilot NEVER submits anything — it returns { predictionId, fields,
 * confidence, fieldConfidence, missing, invalid } for the form to prefill and
 * the user to review. The predictionId flows through the Wave-1 feedback
 * loop (surface 'form_copilot'): the UI records accept when the prefill is
 * applied, edit when the user changes prefilled values, reject when
 * discarded.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { logger } from "../logger";
import { mintPrediction } from "./decisionFeedback";
import { callLlm, extractJsonObject, extractText, LlmGatewayError } from "../services/llmGateway";
import { LEGAL_BASES, SUBJECT_COUNT_BANDS, VOLUME_BANDS } from "../services/transferValidation";

// ─── Target schema replicas (validated partials — source of truth lives in ───
//     dataSovereignty.declarationInputSchema / crossBorderDeclarations.DECLARATION_INPUT,
//     which are intentionally NOT modified per wave-7 constraints) ────────────

const ENTITY_TYPES = ["psp", "fintech", "bank", "switch", "mmo", "pssp", "ptsp", "super_agent", "other"] as const;

const locationSchema = z.object({
  name: z.string().max(256).optional(),
  city: z.string().max(128).optional(),
  country: z.string().length(2).toUpperCase(),
});

export const hostingDeclarationPrefillSchema = z
  .object({
    entity_ref: z.string().min(2).max(128),
    entity_name: z.string().min(2).max(256),
    entity_type: z.enum(ENTITY_TYPES),
    in_scope: z.boolean(),
    primary_dc_name: z.string().max(256),
    primary_dc_city: z.string().max(128),
    primary_dc_country: z.string().length(2).toUpperCase(),
    cloud_provider: z.string().max(64),
    cloud_regions: z.array(z.string().max(64)).max(100),
    backup_locations: z.array(locationSchema).max(50),
    dr_locations: z.array(locationSchema).max(50),
    admin_access_locations: z.array(locationSchema.extend({ team: z.string().max(128).optional() })).max(50),
    encryption_key_custody: z.object({
      country: z.string().length(2).toUpperCase(),
      hsm_provider: z.string().max(128).optional(),
      custody_model: z.enum(["own_hsm", "cloud_kms", "byok", "hyok"]).optional(),
    }),
    subprocessors: z.array(z.object({
      name: z.string().min(1).max(256),
      service: z.string().max(256).optional(),
      country: z.string().length(2).toUpperCase(),
      contract_ref: z.string().max(128).optional(),
    })).max(200),
  })
  .partial();

export const crossBorderDeclarationPrefillSchema = z
  .object({
    organization_id: z.number().int().positive(),
    declaration_type: z.enum(["annual", "on_change"]),
    period_start: z.string().min(8).max(10),
    period_end: z.string().min(8).max(10),
    destination_country: z.string().min(2).max(128),
    legal_basis: z.enum(LEGAL_BASES),
    data_categories: z.array(z.string().min(1).max(64)).max(50),
    subject_count_band: z.enum(SUBJECT_COUNT_BANDS),
    volume_band: z.enum(VOLUME_BANDS),
    volume_estimate_gb: z.number().min(0).max(1_000_000_000),
    processors: z.array(z.object({
      name: z.string().min(1).max(256),
      country: z.string().min(2).max(128),
      role: z.enum(["processor", "sub_processor"]),
    })).max(200),
    declares_no_transfers: z.boolean(),
  })
  .partial();

export const FORM_COPILOT_FORMS = ["hosting_declaration", "cross_border_declaration"] as const;
export type FormCopilotForm = (typeof FORM_COPILOT_FORMS)[number];

const SCHEMA_FOR: Record<FormCopilotForm, z.ZodObject<any>> = {
  hosting_declaration: hostingDeclarationPrefillSchema,
  cross_border_declaration: crossBorderDeclarationPrefillSchema,
};

/** Fields the target form cannot submit without (used for `missing`). */
const REQUIRED_FOR: Record<FormCopilotForm, string[]> = {
  hosting_declaration: ["entity_ref", "entity_name"],
  cross_border_declaration: [
    "organization_id",
    "period_start",
    "period_end",
    "destination_country",
    "legal_basis",
    "subject_count_band",
    "volume_band",
  ],
};

// ─── Extraction + validation (exported for tests) ────────────────────────────

export interface ParseResult {
  fields: Record<string, unknown>;
  fieldConfidence: Record<string, number>;
  missing: string[];
  invalid: { field: string; reason: string }[];
  confidence: number;
}

/**
 * Validate a raw model-extracted object field-by-field against the target
 * partial schema. Invalid fields are dropped (never silently coerced past
 * validation) and reported; valid fields carry a per-field confidence (from
 * the model's `_confidence` map when present, else a default).
 */
export function validateExtracted(form: FormCopilotForm, raw: Record<string, unknown>): ParseResult {
  const schema = SCHEMA_FOR[form];
  const modelConfidence =
    raw._confidence && typeof raw._confidence === "object" && !Array.isArray(raw._confidence)
      ? (raw._confidence as Record<string, unknown>)
      : {};

  const fields: Record<string, unknown> = {};
  const fieldConfidence: Record<string, number> = {};
  const invalid: { field: string; reason: string }[] = [];

  for (const key of Object.keys(schema.shape)) {
    if (!(key in raw) || raw[key] === undefined || raw[key] === null || raw[key] === "") continue;
    const check = schema.shape[key].safeParse(raw[key]);
    if (check.success) {
      fields[key] = check.data;
      const mc = Number(modelConfidence[key]);
      fieldConfidence[key] = Number.isFinite(mc) && mc >= 0 && mc <= 1 ? mc : 0.8;
    } else {
      invalid.push({
        field: key,
        reason: check.error.issues[0] ? `${check.error.issues[0].path.join(".") || key}: ${check.error.issues[0].message}` : "invalid",
      });
    }
  }

  const missing = REQUIRED_FOR[form].filter((k) => !(k in fields));
  const presentConfidences = Object.values(fieldConfidence);
  const meanConfidence = presentConfidences.length
    ? presentConfidences.reduce((a, b) => a + b, 0) / presentConfidences.length
    : 0;
  const coverage = REQUIRED_FOR[form].length
    ? (REQUIRED_FOR[form].length - missing.length) / REQUIRED_FOR[form].length
    : 1;
  const confidence = Math.round(meanConfidence * coverage * 1000) / 1000;

  return { fields, fieldConfidence, missing, invalid, confidence };
}

/** Prompt: constrain the model to the target field list, strict JSON out. */
export function buildExtractionPrompt(form: FormCopilotForm, text: string): string {
  const schema = SCHEMA_FOR[form];
  const fieldLines = Object.keys(schema.shape).map((k) => `- ${k}`);
  const enums =
    form === "hosting_declaration"
      ? `entity_type must be one of: ${ENTITY_TYPES.join(", ")}. custody_model must be one of: own_hsm, cloud_kms, byok, hyok. Countries are ISO-3166 alpha-2 codes.`
      : `legal_basis must be one of: ${LEGAL_BASES.join(", ")}. subject_count_band must be one of: ${SUBJECT_COUNT_BANDS.join(", ")}. volume_band must be one of: ${VOLUME_BANDS.join(", ")}. declaration_type must be one of: annual, on_change. Dates are YYYY-MM-DD.`;
  return [
    "Extract structured declaration fields from the officer's description.",
    `Target form: ${form}. Output STRICT JSON only — one object with a subset of these keys:`,
    ...fieldLines,
    enums,
    'Only include fields you can ground in the description — never guess identifiers. Optionally add a "_confidence" object mapping field name to a 0..1 confidence.',
    "Description:",
    text.slice(0, 6000),
  ].join("\n");
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const formCopilotRouter = router({
  parse: protectedProcedure
    .input(
      z.object({
        form: z.enum(FORM_COPILOT_FORMS),
        text: z.string().min(10).max(6000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const prompt = buildExtractionPrompt(input.form, input.text);

      let res: Record<string, unknown>;
      try {
        res = await callLlm<Record<string, unknown>>("/compliance-qa", { question: prompt });
      } catch (err) {
        const msg = err instanceof LlmGatewayError ? err.message : String(err);
        logger.warn({ err: msg, form: input.form }, "[formCopilot] gateway failure");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Form copilot unavailable (${msg}). Fill the form manually.`,
        });
      }

      // The gateway may return structured JSON directly, or JSON wrapped in
      // prose inside a text field.
      let raw: Record<string, unknown> | null = null;
      if (res && typeof res === "object" && Object.keys(res).some((k) => k in SCHEMA_FOR[input.form].shape)) {
        raw = res;
      } else {
        raw = extractJsonObject(extractText(res));
      }
      if (!raw) {
        throw new TRPCError({
          code: "UNPROCESSABLE_CONTENT",
          message: "Form copilot could not extract any structured fields from the description. Fill the form manually.",
        });
      }

      const parsed = validateExtracted(input.form, raw);
      const modelVersion = typeof res.model_version === "string" ? res.model_version : null;

      // Wave-1 feedback loop: mint the baseline prediction. Suggestion payload
      // holds only entity-level declaration fields — no data-subject identifiers.
      const predictionId = await mintPrediction({
        surface: "form_copilot",
        suggestion: { form: input.form, fields: parsed.fields, missing: parsed.missing },
        actorId: ctx.user.id,
        modelVersion,
      });

      return { predictionId, modelVersion, ...parsed };
    }),
});
