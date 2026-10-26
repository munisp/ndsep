# Round 12 — Wave 7: Intelligent Assistance (roadmap §6)

**Status: implemented.** Auto-triage (assist mode), copilot drafting, form
copilot and next-best-action are live behind the Wave-1 feedback keystone:
every suggestion — LLM-generated or rule-based — is minted through
`mintPrediction()` and its human outcome (accept / edit / reject / ignore) is
appended via `decisionFeedback.record` / `client/src/lib/feedback.ts`. Nothing
is auto-applied: the model suggests, the officer decides.

## What was delivered

| Artifact | Path |
|---|---|
| LLM gateway client (fail-closed, timeout-bounded) | `server/services/llmGateway.ts` |
| Auto-triage service | `server/services/autoTriage.ts` |
| Auto-triage router | `server/routers/autoTriage.ts` (`autoTriageRouter`: `suggest`, `listPending`, `forComplaint`, `decide`) |
| Copilot drafting router | `server/routers/copilotDraft.ts` (`copilotDraftRouter.draft`) |
| Form copilot router | `server/routers/formCopilot.ts` (`formCopilotRouter.parse`) |
| Next-best-action service (pure) | `server/services/nextBestAction.ts` |
| Next-best-action router | `server/routers/nextBestAction.ts` (`nextBestActionRouter.forEntity`) |
| Triage suggestions migration | `drizzle/migrations/0135_triage_suggestions.sql` (sqlglot-validated, postgres dialect) |
| Draft modal | `client/src/components/CopilotDraftModal.tsx` |
| Form copilot input | `client/src/components/FormCopilotInput.tsx` |
| Next-best-action card | `client/src/components/NextBestActionCard.tsx` |
| Page mounts | `ComplaintTriage.tsx` (Suggested badge + confirm/edit + Draft-with-AI acknowledgement + NBA card), `SettlementWorkflow.tsx` (Draft-with-AI term proposal + NBA card), `DataSovereigntyDashboard.tsx` (hosting-declaration copilot), `CrossBorderDeclarationsReview.tsx` (cross-border copilot) |
| Tests (vitest) | `server/routers/__tests__/{autoTriage,copilotDraft,formCopilot,nextBestAction}.test.ts` — 56 tests, all passing |

## Design notes

### LLM gateway (`llmGateway.ts`)
Thin POST client for the local ollama wrapper (`LLM_GATEWAY_URL`, default
`http://127.0.0.1:8203`; `LLM_GATEWAY_TIMEOUT_MS`, default 8000) exposing
`/classify`, `/summarize`, `/compliance-qa`. Hard timeout via
`AbortSignal.timeout`; every failure mode raises `LlmGatewayError` with a
`kind` of `timeout | http | network | parse` so callers fail closed
deliberately. `extractJsonObject()` recovers JSON wrapped in prose/code
fences; `extractText()` normalises the gateway's response shapes.

### 1. Auto-triage (assist mode)
`suggestTriage(complaintId)` reads the complaint's subject/description (no
complainant PII columns), classifies via `/classify` against the
`COMPLAINT_CATEGORIES` vocabulary plus severity
(`routine|elevated|high|critical`) and team vocabularies. Out-of-vocabulary
or out-of-range model output is treated as unusable.

- confidence ≥ `AUTO_TRIAGE_CONFIDENCE` (default **0.75**) → a **PENDING**
  row in `triage_suggestions` (migration 0135) + a minted `decision_feedback`
  baseline (`surface='triage'`). The complaint row itself is never mutated.
- confidence below threshold, gateway error, timeout, or unusable output →
  `{ outcome: 'manual_queue', reason }`; the human queue is unchanged.
- `decide(suggestionId, accepted|edited|rejected, finalValue?)` updates the
  suggestion row (`decided_by`, `decided_at`) **and** appends the outcome to
  `decision_feedback` through the Wave-1 `record` procedure (double-write).
  Edited decisions validate `finalValue` against the same vocabularies.
- Client: the complaint detail panel shows a **"Suggested"** badge with
  category/severity/team/confidence, one-click **Confirm / Edit / Reject**;
  the edit flow reuses `OfficerPicker` (selecting an officer both assigns and
  becomes the edited `suggestedTeam`).

**Schema deviation (documented):** migration 0135 adds `prediction_id uuid`
to the roadmap's column list so the decide flow can append the feedback
outcome against the minted baseline. All specified columns are present as
specified. Migration 0136 was not needed.

### 2. Copilot drafting
`copilotDraft.draft({ template, entityId, tone, instructions? })` covers
`complaint_acknowledgment`, `enforcement_notice`, `settlement_terms`. Facts
are pulled server-side from `public_complaints` (no `complainant_*` PII
columns), `enforcement_cases`, and `settlements` + latest `settlement_terms`;
the structured prompt goes to `/compliance-qa`; the draft returns with a
`predictionId` (surface `copilot_draft`, or `settlement_terms` for that
template — a Wave-1 known surface). Gateway failure is a visible error, never
a fabricated draft. `CopilotDraftModal` offers Accept / Accept-edited
(normalised Levenshtein via `computeEditDistance`) / Reject, all recorded
through `client/src/lib/feedback.ts`. Mounted as "Draft with AI" on
ComplaintTriage (acknowledgement) and SettlementWorkflow (term proposal).

### 3. Form copilot
`formCopilot.parse({ form, text })` targets `hosting_declaration`
(16-field replica of `dataSovereignty.declarationInputSchema`) and
`cross_border_declaration` (12-field replica of
`crossBorderDeclarations.DECLARATION_INPUT`, enum vocab imported from
`services/transferValidation`). The gateway is constrained to the schema's
field list; the extracted object is **zod-validated field-by-field
server-side** — invalid fields are dropped and reported in `invalid[]`,
never coerced past validation; unfillable required fields are reported in
`missing[]`. Returns `{ predictionId, fields, fieldConfidence, confidence,
missing, invalid }` (surface `form_copilot`). **Nothing is ever
auto-submitted**: `FormCopilotInput` only prefills the parent form on
explicit "Apply prefill" (accept) or "Discard" (reject); per-field confidence
is colour-highlighted. Mounted in the hosting-declaration tab of
DataSovereigntyDashboard and the new-declaration tab of
CrossBorderDeclarationsReview.

### 4. Next-best-action
`nextBestAction(entityType, state)` is a pure, fully unit-tested state
machine returning `{ action, label, mutationHint, rationale } | null`:

- **complaint** by status (`received→acknowledge`, `acknowledged→assign`/
  `start_review` depending on assignee, `under_review→link_or_resolve`,
  `linked_to_case→resolve`, `resolved→close`, `closed→null`);
- **settlement** by lifecycle (`proposal→await_or_counter`, `counter→decide`,
  `agreement→submit_for_approval`, `approval→approve_or_reject`,
  `active→record_payment`, `defaulted→waive_or_escalate`,
  `fulfilled|void→null`);
- **publication** by workbench stage (`draft→submit_redaction`,
  `redaction→complete_redaction`, `approval→publish`,
  `published/corrected` + `correction_pending→process_correction`, else null);
- **finding** by status (`open→start_investigation`, `referred→await`,
  `under_investigation→resolve_or_dismiss`, terminal→null).

`nextBestAction.forEntity` loads state server-side, mints a prediction
(`surface='next_best_action'`, `model_version='rules:v1'`) and returns the
action. `NextBestActionCard` records **accept** when the officer clicks the
action and **ignore** when dismissed. Mounted on the ComplaintTriage and
SettlementWorkflow detail views.

## Feedback-loop wiring summary

| Surface | Suggestion minted at | Outcome recorded via |
|---|---|---|
| `triage` | `suggestTriage` (above threshold) | `autoTriage.decide` → `decisionFeedback.record` (double-write with suggestion row) |
| `copilot_draft` / `settlement_terms` | `copilotDraft.draft` | `CopilotDraftModal` accept / edit-accept (edit distance) / reject |
| `form_copilot` | `formCopilot.parse` | `FormCopilotInput` apply (accept) / discard (reject) |
| `next_best_action` | `nextBestAction.forEntity` | `NextBestActionCard` click (accept) / dismiss (ignore) |

## Verification

- **Vitest: 56/56 passing** across the four new test files (threshold gating,
  fail-closed paths, decide double-write, prompt/fact wiring, zod failure
  paths, NBA state-machine coverage); the Wave-1 `decisionFeedback.test.ts`
  suite (9 tests) still passes.
- Migration 0135 parsed cleanly with sqlglot 30.24.0 (postgres dialect).
- All new/edited TS/TSX files pass esbuild TSX/TS transforms.
- The r12 `node_modules` copy was still in progress (another agent), so tests
  ran in a shadow workspace (`/tmp/ndsep-w7-test`) against r12 sources with a
  complete sibling `node_modules`; `npm`/`tsc` were not run per constraints.

## Integration notes for the round integrator

- Mount `autoTriageRouter`, `copilotDraftRouter`, `formCopilotRouter`,
  `nextBestActionRouter` in `server/routers.ts` under the `autoTriage`,
  `copilotDraft`, `formCopilot`, `nextBestAction` namespaces (client code
  uses `(trpc as any)` structural typing until then — same pattern as Wave-1
  `bulkOps` / `savedViews`).
- Apply migration `0135_triage_suggestions.sql`.
- Env: `LLM_GATEWAY_URL` (default `http://127.0.0.1:8203`),
  `LLM_GATEWAY_TIMEOUT_MS` (8000), `AUTO_TRIAGE_CONFIDENCE` (0.75).
