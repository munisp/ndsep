/**
 * OSIRIS OI Forecast client (Round-13 P1.6)
 * ==========================================
 * Drives OSIRIS's OI Forecast swarm-simulation engine to produce predictive
 * geopolitical risk assessments for cross-border transfer review.
 *
 * Transport strategy (runForecast):
 *   1. MCP — discover the forecast tool via tools/list on `${OSIRIS_URL}/api/mcp`
 *      (names discovered at runtime — e.g. run_forecast / get_forecast — and
 *      their absence is tolerated), then tools/call.
 *   2. REST fallback — POST `${OSIRIS_URL}/api/oi/forecast` when MCP is
 *      unavailable or exposes no forecast tool; poll GET
 *      `/api/oi/forecast/:id` until the job completes.
 *   Both paths honour one HARD DEADLINE (default 120s, env
 *   OSIRIS_FORECAST_DEADLINE_MS) — a hung simulation must never wedge a
 *   review request.
 *
 * KEY CUSTODY (data sovereignty):
 *   OI is bring-your-own-key. The key is read SERVER-SIDE from
 *   process.env.OSIRIS_OI_KEY at call time and sent as a Bearer token. It is
 *   NEVER accepted from client requests, never logged, and never persisted.
 *   With no key configured, runForecast returns status:'unavailable' and
 *   performs ZERO network calls.
 *
 *   PRODUCTION GUIDANCE: where possible, route forecasts through NDSEP's
 *   LOCAL ollama instance as the OI model (OSIRIS supports operator-chosen
 *   model backends) so simulation inputs never leave sovereign
 *   infrastructure. An external provider key is an explicit operator choice,
 *   not a default.
 *
 * Normalized result: { forecastProbability, rationale, sources[], completedAt }.
 * Sources are preserved verbatim (auditable provenance) — never dropped or
 * rewritten.
 */
import pino from "pino";
import {
  openMcpSession,
  callMcpTool,
  oiKeyPresent,
  type McpTool,
} from "./mcpClient";

const logger = pino({ name: "osiris-forecast-client" });

const DEFAULT_DEADLINE_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;
const HTTP_TIMEOUT_MS = 15_000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ForecastSource {
  url?: string;
  title?: string;
  publisher?: string;
  /** Extra provider-specific fields are preserved verbatim. */
  [k: string]: unknown;
}

export interface NormalizedForecast {
  /** 0..1 probability of the adverse outcome named in the question. */
  forecastProbability: number;
  rationale: string;
  sources: ForecastSource[];
  completedAt: string; // ISO
}

export type ForecastOutcome =
  | { status: "completed"; transport: "mcp" | "rest"; forecast: NormalizedForecast; modelKeyPresent: true }
  | { status: "unavailable" | "timeout" | "error"; reason: string; modelKeyPresent: boolean };

export interface RunForecastOptions {
  deadlineMs?: number;
  fetchFn?: typeof fetch;
  /** Skip the MCP attempt (forces REST). Test/ops escape hatch. */
  forceRest?: boolean;
}

export function forecastDeadlineMs(): number {
  const v = parseInt(process.env.OSIRIS_FORECAST_DEADLINE_MS ?? "", 10);
  return Number.isFinite(v) && v >= 1_000 ? v : DEFAULT_DEADLINE_MS;
}

function osirisBaseUrl(): string {
  return (process.env.OSIRIS_URL ?? "https://osirisai.live").replace(/\/+$/, "");
}

// ── Normalization ────────────────────────────────────────────────────────────

function clampProbability(raw: unknown): number | null {
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  if (n > 1 && n <= 100) return Math.min(1, n / 100); // percent-style
  if (n > 100) return null;
  return n;
}

function normalizeSources(raw: unknown): ForecastSource[] {
  if (!Array.isArray(raw)) return [];
  const out: ForecastSource[] = [];
  for (const s of raw) {
    if (typeof s === "string") {
      out.push({ url: s });
    } else if (s !== null && typeof s === "object") {
      // Preserve the entry verbatim (provenance), only widening the type.
      out.push({ ...(s as Record<string, unknown>) } as ForecastSource);
    }
  }
  return out.slice(0, 200);
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/**
 * Normalize a raw OI payload (MCP structuredContent, MCP text-block JSON, or
 * REST response body) into the canonical forecast shape. Returns null when
 * no probability can be extracted — a forecast without a probability is not
 * a forecast.
 */
export function normalizeForecastPayload(raw: unknown): NormalizedForecast | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const nested =
    obj.forecast && typeof obj.forecast === "object" ? (obj.forecast as Record<string, unknown>) : null;

  const prob =
    clampProbability(obj.forecastProbability) ??
    clampProbability(obj.probability) ??
    clampProbability(obj.p) ??
    (nested ? clampProbability(nested.forecastProbability) ?? clampProbability(nested.probability) : null);
  if (prob === null) return null;

  const rationale =
    firstString(obj, ["rationale", "reasoning", "summary", "explanation", "analysis"]) ??
    (nested ? firstString(nested, ["rationale", "reasoning", "summary"]) : null) ??
    "";

  const sources =
    normalizeSources(obj.sources).length > 0
      ? normalizeSources(obj.sources)
      : normalizeSources(obj.citations).length > 0
        ? normalizeSources(obj.citations)
        : normalizeSources(obj.references);

  const completedAt =
    firstString(obj, ["completedAt", "completed_at", "finishedAt", "finished_at"]) ??
    new Date().toISOString();

  return { forecastProbability: prob, rationale, sources, completedAt };
}

/** Extract a job/forecast id from an asynchronous submission response. */
function extractJobId(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  for (const k of ["id", "forecastId", "forecast_id", "jobId", "job_id"]) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function isPendingStatus(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const s = String((raw as Record<string, unknown>).status ?? "").toLowerCase();
  return ["pending", "running", "queued", "in_progress", "processing"].includes(s);
}

function isFailedStatus(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const s = String((raw as Record<string, unknown>).status ?? "").toLowerCase();
  return ["failed", "error", "cancelled", "canceled"].includes(s);
}

// ── MCP transport ────────────────────────────────────────────────────────────

/** Pick the forecast tool from a discovered list; tolerate absence (null). */
export function findForecastTool(tools: McpTool[]): McpTool | null {
  const preferRun = tools.find((t) => /run[_-]?forecast/i.test(t.name));
  if (preferRun) return preferRun;
  return tools.find((t) => /forecast/i.test(t.name)) ?? null;
}

/** Pull a normalizable payload out of a tools/call result. */
function payloadFromMcpCall(call: { content: Array<Record<string, unknown>>; structured?: unknown }): unknown {
  if (call.structured !== undefined && call.structured !== null) return call.structured;
  for (const block of call.content) {
    if (block.type === "text" && typeof block.text === "string") {
      try {
        return JSON.parse(block.text);
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

async function runViaMcp(
  question: string,
  context: Record<string, unknown> | undefined,
  deadlineAt: number,
  fetchFn: typeof fetch
): Promise<ForecastOutcome | null> {
  const remaining = () => Math.max(1, deadlineAt - Date.now());

  const session = await openMcpSession(Math.min(remaining(), HTTP_TIMEOUT_MS), fetchFn);
  if (!session.ok) {
    logger.debug({ reason: session.reason }, "OI MCP session unavailable — will try REST");
    return null; // fall back to REST
  }
  const tool = findForecastTool(session.value.tools);
  if (!tool) {
    logger.debug({ tools: session.value.tools.map((t) => t.name) }, "OI MCP exposes no forecast tool — will try REST");
    return null;
  }
  if (Date.now() >= deadlineAt) {
    return { status: "timeout", reason: "forecast deadline exceeded before MCP tools/call", modelKeyPresent: true };
  }
  const call = await callMcpTool(
    tool.name,
    { question, ...(context ? { context } : {}) },
    remaining(),
    fetchFn
  );
  if (!call.ok) return { status: "error", reason: call.reason, modelKeyPresent: true };
  if (call.value.isError) {
    const detail = call.value.content
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join("; ");
    return { status: "error", reason: `OI tool '${tool.name}' returned an error${detail ? `: ${detail.slice(0, 300)}` : ""}`, modelKeyPresent: true };
  }
  const forecast = normalizeForecastPayload(payloadFromMcpCall(call.value));
  if (!forecast) {
    return { status: "error", reason: `OI tool '${tool.name}' result had no extractable probability`, modelKeyPresent: true };
  }
  return { status: "completed", transport: "mcp", forecast, modelKeyPresent: true };
}

// ── REST transport ───────────────────────────────────────────────────────────

async function restRequest(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch
): Promise<{ ok: true; body: unknown } | { ok: false; reason: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const key = process.env.OSIRIS_OI_KEY?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  let res: Response;
  try {
    res = await fetchFn(`${osirisBaseUrl()}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: /abort|timeout/i.test(msg) ? `timeout (${msg})` : `network error (${msg})` };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  try {
    return { ok: true, body: await res.json() };
  } catch {
    return { ok: false, reason: "unparseable JSON body" };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runViaRest(
  question: string,
  context: Record<string, unknown> | undefined,
  deadlineAt: number,
  fetchFn: typeof fetch
): Promise<ForecastOutcome> {
  const remaining = () => Math.max(1, deadlineAt - Date.now());

  const submit = await restRequest(
    "/api/oi/forecast",
    { method: "POST", body: JSON.stringify({ question, ...(context ? { context } : {}) }) },
    Math.min(remaining(), HTTP_TIMEOUT_MS),
    fetchFn
  );
  if (!submit.ok) return { status: "error", reason: `OI REST submit failed — ${submit.reason}`, modelKeyPresent: true };

  // Synchronous completion: the POST itself returned the finished forecast.
  const direct = normalizeForecastPayload(submit.body);
  if (direct && !isPendingStatus(submit.body)) {
    return { status: "completed", transport: "rest", forecast: direct, modelKeyPresent: true };
  }
  if (isFailedStatus(submit.body)) {
    return { status: "error", reason: "OI REST forecast job failed at submission", modelKeyPresent: true };
  }
  const jobId = extractJobId(submit.body);
  if (!jobId) {
    return { status: "error", reason: "OI REST submit returned neither a forecast nor a job id", modelKeyPresent: true };
  }

  // Poll until complete / failed / hard deadline.
  while (Date.now() < deadlineAt) {
    await sleep(Math.min(POLL_INTERVAL_MS, remaining()));
    if (Date.now() >= deadlineAt) break;
    const poll = await restRequest(
      `/api/oi/forecast/${encodeURIComponent(jobId)}`,
      { method: "GET" },
      Math.min(remaining(), HTTP_TIMEOUT_MS),
      fetchFn
    );
    if (!poll.ok) {
      logger.debug({ reason: poll.reason, jobId }, "OI REST poll failed — retrying until deadline");
      continue; // transient poll failures don't kill the job; the deadline does
    }
    const done = normalizeForecastPayload(poll.body);
    if (done && !isPendingStatus(poll.body)) {
      return { status: "completed", transport: "rest", forecast: done, modelKeyPresent: true };
    }
    if (isFailedStatus(poll.body)) {
      return { status: "error", reason: `OI REST forecast job ${jobId} failed`, modelKeyPresent: true };
    }
  }
  return { status: "timeout", reason: `forecast deadline (${forecastDeadlineMs()}ms) exceeded waiting for job ${jobId}`, modelKeyPresent: true };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run an OI forecast. Prefers MCP transport; falls back to REST. Hard
 * deadline across both. NEVER calls out when OSIRIS_OI_KEY is unset.
 */
export async function runForecast(
  question: string,
  context?: Record<string, unknown>,
  opts: RunForecastOptions = {}
): Promise<ForecastOutcome> {
  if (!oiKeyPresent()) {
    return {
      status: "unavailable",
      reason:
        "OSIRIS_OI_KEY not configured — OI Forecast is bring-your-own-key; key custody is server-side only (env). " +
        "Production deployments should prefer NDSEP's local ollama as the OI model backend (data sovereignty).",
      modelKeyPresent: false,
    };
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const deadlineAt = Date.now() + (opts.deadlineMs ?? forecastDeadlineMs());

  if (!opts.forceRest) {
    const viaMcp = await runViaMcp(question, context, deadlineAt, fetchFn);
    if (viaMcp) return viaMcp;
    if (Date.now() >= deadlineAt) {
      return { status: "timeout", reason: "forecast deadline exceeded during MCP attempt", modelKeyPresent: true };
    }
  }
  return runViaRest(question, context, deadlineAt, fetchFn);
}
