/**
 * OSIRIS MCP client — minimal spec-compliant MCP-over-HTTP (Round-13 P1.6)
 * ========================================================================
 * OSIRIS exposes an MCP server at `${OSIRIS_URL}/api/mcp` speaking JSON-RPC
 * 2.0 over HTTP POST. This is a MINIMAL client covering exactly the three
 * methods NDSEP needs to drive the OI Forecast engine:
 *
 *   initialize   handshake + protocol/capability negotiation
 *   tools/list   runtime tool discovery (names are NEVER hard-coded —
 *                callers discover e.g. run_forecast / get_forecast and
 *                tolerate their absence)
 *   tools/call   invoke a discovered tool with arguments
 *
 * FAIL-CLOSED contract:
 *   Every entry point returns a discriminated result ({ ok:true, value } |
 *   { ok:false, reason }) and NEVER throws on protocol deviation, network
 *   error, timeout, or malformed payloads. Any deviation from JSON-RPC 2.0
 *   (missing/echoed id mismatch, non-2xx, parse failure, JSON-RPC error
 *   object) yields ok:false with a human-auditable reason.
 *
 * Response framing: most MCP-over-HTTP servers answer with plain
 * application/json; some answer with text/event-stream (one `data:` frame
 * carrying the JSON-RPC message). Both are tolerated.
 *
 * Key custody: the OI key is read SERVER-SIDE from process.env.OSIRIS_OI_KEY
 * at call time and sent as a Bearer token. It is NEVER accepted from client
 * input. See forecastClient.ts for the custody policy.
 */
import pino from "pino";

const logger = pino({ name: "osiris-mcp-client" });

const MCP_PROTOCOL_VERSION = "2024-11-05";
const CLIENT_INFO = { name: "ndsep-mcp-client", version: "round13-p1.6" };
const DEFAULT_TIMEOUT_MS = 15_000;

export type McpResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpSession {
  /** Negotiated protocol version reported by the server. */
  protocolVersion: string;
  /** Server-reported identity (best-effort). */
  serverInfo?: { name?: string; version?: string };
  /** Discovered tools (from tools/list at session open). */
  tools: McpTool[];
}

export interface McpCallResult {
  /** MCP tools/call content blocks (text/image/resource ...). */
  content: Array<Record<string, unknown>>;
  /** True when the server flagged the call result as an error. */
  isError: boolean;
  /** Raw structured result payload when the server provides one. */
  structured?: unknown;
}

function osirisBaseUrl(): string {
  return (process.env.OSIRIS_URL ?? "https://osirisai.live").replace(/\/+$/, "");
}

export function mcpEndpoint(): string {
  return `${osirisBaseUrl()}/api/mcp`;
}

/** OI key presence — read at call time, never cached across env changes. */
export function oiKeyPresent(): boolean {
  return Boolean(process.env.OSIRIS_OI_KEY && process.env.OSIRIS_OI_KEY.trim());
}

let nextId = 1;
function rpcId(): number {
  return nextId++;
}

/**
 * Parse an MCP HTTP response body into a single JSON-RPC message.
 * Tolerates application/json bodies and text/event-stream bodies (uses the
 * LAST complete `data:` frame, which carries the terminal response).
 */
export function parseMcpPayload(contentType: string, body: string): unknown | null {
  const ct = contentType.toLowerCase();
  if (ct.includes("text/event-stream")) {
    let last: unknown | null = null;
    for (const block of body.split(/\r?\n\r?\n/)) {
      const dataLines = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""));
      if (!dataLines.length) continue;
      try {
        last = JSON.parse(dataLines.join("\n"));
      } catch {
        /* ignore partial frames */
      }
    }
    return last;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Structural validation of a JSON-RPC 2.0 response envelope. */
function validateRpcResponse(
  msg: unknown,
  expectedId: number
): McpResult<Record<string, unknown>> {
  if (msg === null || typeof msg !== "object" || Array.isArray(msg)) {
    return { ok: false, reason: "response is not a JSON-RPC object" };
  }
  const m = msg as Record<string, unknown>;
  if (m.jsonrpc !== "2.0") return { ok: false, reason: "missing/invalid jsonrpc '2.0' marker" };
  if (m.id !== expectedId) {
    return { ok: false, reason: `id mismatch (sent ${expectedId}, got ${String(m.id)})` };
  }
  if (m.error !== undefined && m.error !== null) {
    const e = m.error as Record<string, unknown>;
    return { ok: false, reason: `JSON-RPC error ${String(e?.code ?? "?")}: ${String(e?.message ?? "unknown")}` };
  }
  if (m.result === undefined) return { ok: false, reason: "response has neither result nor error" };
  if (typeof m.result !== "object" || m.result === null) {
    return { ok: false, reason: "result is not an object" };
  }
  return { ok: true, value: m.result as Record<string, unknown> };
}

/**
 * Single JSON-RPC POST with timeout. Returns the validated `result` object.
 * Never throws.
 */
export async function mcpRpc(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  fetchFn: typeof fetch = fetch
): Promise<McpResult<Record<string, unknown>>> {
  const id = rpcId();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const key = process.env.OSIRIS_OI_KEY?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  let res: Response;
  try {
    res = await fetchFn(mcpEndpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.debug({ err: msg, method }, "MCP call failed (network/timeout)");
    return { ok: false, reason: `mcp ${method}: ${/abort|timeout/i.test(msg) ? "timeout" : "network error"} (${msg})` };
  }

  if (!res.ok) {
    return { ok: false, reason: `mcp ${method}: HTTP ${res.status}` };
  }
  let body: string;
  try {
    body = await res.text();
  } catch (e) {
    return { ok: false, reason: `mcp ${method}: unreadable body (${e instanceof Error ? e.message : String(e)})` };
  }
  const parsed = parseMcpPayload(res.headers.get("content-type") ?? "", body);
  if (parsed === null) return { ok: false, reason: `mcp ${method}: unparseable response body` };
  return validateRpcResponse(parsed, id);
}

/**
 * Open an MCP session: initialize handshake + initialized notification +
 * tools/list discovery. Tolerates servers that have no tools (empty list)
 * and servers missing optional result fields; refuses only on protocol
 * deviation.
 */
export async function openMcpSession(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  fetchFn: typeof fetch = fetch
): Promise<McpResult<McpSession>> {
  const init = await mcpRpc(
    "initialize",
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    },
    timeoutMs,
    fetchFn
  );
  if (!init.ok) return { ok: false, reason: `initialize failed — ${init.reason}` };

  const protocolVersion =
    typeof init.value.protocolVersion === "string" ? init.value.protocolVersion : MCP_PROTOCOL_VERSION;
  const serverInfo =
    init.value.serverInfo && typeof init.value.serverInfo === "object"
      ? (init.value.serverInfo as { name?: string; version?: string })
      : undefined;

  // Best-effort `notifications/initialized` (no id, no response expected).
  // A failure here is NOT a protocol deviation — some minimal servers ignore
  // notifications entirely.
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = process.env.OSIRIS_OI_KEY?.trim();
    if (key) headers.Authorization = `Bearer ${key}`;
    await fetchFn(mcpEndpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      signal: AbortSignal.timeout(Math.min(timeoutMs, 5_000)),
    });
  } catch {
    /* notification delivery is best-effort */
  }

  const list = await mcpRpc("tools/list", {}, timeoutMs, fetchFn);
  if (!list.ok) return { ok: false, reason: `tools/list failed — ${list.reason}` };
  const rawTools = Array.isArray(list.value.tools) ? list.value.tools : [];
  const tools: McpTool[] = rawTools
    .filter((t): t is Record<string, unknown> => t !== null && typeof t === "object")
    .map((t) => ({
      name: String((t as Record<string, unknown>).name ?? ""),
      description: typeof t.description === "string" ? t.description : undefined,
      inputSchema:
        t.inputSchema && typeof t.inputSchema === "object"
          ? (t.inputSchema as Record<string, unknown>)
          : undefined,
    }))
    .filter((t) => t.name.length > 0);

  return { ok: true, value: { protocolVersion, serverInfo, tools } };
}

/**
 * Invoke a previously-discovered tool. Validates the tools/call result
 * shape (content blocks array) and surfaces server-flagged tool errors via
 * `isError` (still ok:true — the PROTOCOL succeeded).
 */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  fetchFn: typeof fetch = fetch
): Promise<McpResult<McpCallResult>> {
  const res = await mcpRpc("tools/call", { name, arguments: args }, timeoutMs, fetchFn);
  if (!res.ok) return { ok: false, reason: `tools/call ${name} failed — ${res.reason}` };
  const r = res.value;
  const content = Array.isArray(r.content) ? (r.content as Array<Record<string, unknown>>) : [];
  return {
    ok: true,
    value: {
      content: content.filter((c) => c !== null && typeof c === "object"),
      isError: r.isError === true,
      structured: r.structuredContent,
    },
  };
}
