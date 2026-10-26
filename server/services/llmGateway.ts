/**
 * LLM gateway client (round 12, wave 7 — roadmap §6 intelligent assistance)
 * =========================================================================
 * Thin, fail-closed HTTP client for the local ollama wrapper service
 * (default http://127.0.0.1:8203) exposing the structured endpoints:
 *
 *   POST /classify        { text, labels?... }        -> { category, severity, team, confidence, model_version? }
 *   POST /summarize       { text, instruction? }      -> { summary | text | response }
 *   POST /compliance-qa   { question, context? }      -> { answer | text | response, model_version? }
 *
 * Every call:
 *   - honours a hard timeout (AbortSignal.timeout) — a hung model must never
 *     wedge a request handler;
 *   - throws LlmGatewayError on network error / timeout / non-2xx / malformed
 *     JSON, so callers can fail closed (auto-triage -> manual queue) or fail
 *     visibly (copilot drafting -> officer-facing error).
 *
 * The gateway base URL and timeout are env-configurable:
 *   LLM_GATEWAY_URL        (default http://127.0.0.1:8203)
 *   LLM_GATEWAY_TIMEOUT_MS (default 8000)
 */

export class LlmGatewayError extends Error {
  readonly kind: "timeout" | "http" | "network" | "parse";
  constructor(kind: LlmGatewayError["kind"], message: string) {
    super(message);
    this.name = "LlmGatewayError";
    this.kind = kind;
  }
}

export function llmGatewayUrl(): string {
  return (process.env.LLM_GATEWAY_URL || "http://127.0.0.1:8203").replace(/\/+$/, "");
}

export function llmGatewayTimeoutMs(): number {
  const v = parseInt(process.env.LLM_GATEWAY_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(v) && v >= 250 ? v : 8000;
}

/** Injectable fetch for tests. */
export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

let _fetchImpl: FetchLike | null = null;
/** Test hook: swap the fetch implementation. Pass null to restore global fetch. */
export function setLlmFetch(impl: FetchLike | null): void {
  _fetchImpl = impl;
}

function fetchImpl(): FetchLike {
  return _fetchImpl ?? ((globalThis.fetch as unknown) as FetchLike);
}

/**
 * POST to a gateway endpoint and return the parsed JSON body.
 * Throws LlmGatewayError on any failure — callers decide how to degrade.
 */
export async function callLlm<T = Record<string, unknown>>(
  endpoint: "/classify" | "/summarize" | "/compliance-qa",
  body: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const url = `${llmGatewayUrl()}${endpoint}`;
  const timeoutMs = opts.timeoutMs ?? llmGatewayTimeoutMs();
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl()(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const kind = /abort|timeout/i.test(msg) ? "timeout" : "network";
    throw new LlmGatewayError(kind, `LLM gateway ${endpoint} ${kind}: ${msg}`);
  }
  if (!res.ok) {
    throw new LlmGatewayError("http", `LLM gateway ${endpoint} returned HTTP ${res.status}`);
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new LlmGatewayError("parse", `LLM gateway ${endpoint} returned malformed JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Best-effort extraction of the first balanced JSON object from a model
 * string response (LLMs frequently wrap JSON in prose or code fences).
 * Returns null when no parseable object is found.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (typeof text !== "string" || !text.length) return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Pull the free-text payload out of a gateway response, whatever its shape. */
export function extractText(res: Record<string, unknown>): string {
  for (const key of ["answer", "summary", "draft", "text", "response", "output"]) {
    const v = res[key];
    if (typeof v === "string" && v.trim().length) return v.trim();
  }
  return "";
}
