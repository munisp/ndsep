/**
 * OSIRIS SSE intel subscriber (Round-13 P1.7)
 * ============================================
 * Server-side subscriber that upgrades the OSIRIS integration from polling
 * to Server-Sent-Events streaming for sanctions / threat updates.
 *
 * Connects to the OSIRIS SSE endpoint (env OSIRIS_SSE_PATH, default
 * `/api/osint/stream`; `/api/sse` accepted as an alternate) and consumes
 * event types:
 *
 *   sanctions-update   → snapshotStore 'sanctions' (getSanctionsSnapshot)
 *   threat-update      → snapshotStore 'threats'   (getThreatSnapshot)
 *   <anything else>    → tolerated: counted, debug-logged, never fatal
 *
 * Reconnect: on ANY disconnect (network error, non-2xx, stream end) the
 * subscriber resubscribes with exponential backoff (1s → 30s cap) and sends
 * `Last-Event-ID` so the server resumes the stream without replay gaps.
 *
 * Lifecycle: startOsirisStream() is idempotent and is wired by the
 * integrator at server boot (NOT auto-started here — importing this module
 * must have no side effects); stopOsirisStream() is for graceful shutdown.
 * Stream health is surfaced via getIntelStreamHealth() and the
 * `intelStreamStatus` tRPC procedure (server/routers/transferForecast.ts).
 *
 * Consumers read snapshots from snapshotStore BEFORE falling back to the
 * cached polling GET — see the integrator note in snapshotStore.ts.
 */
import pino from "pino";
import { setSnapshot, type SnapshotStream } from "./snapshotStore";

const logger = pino({ name: "osiris-sse-subscriber" });

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const CONNECT_TIMEOUT_MS = 20_000;

// ── Health state ─────────────────────────────────────────────────────────────

export interface IntelStreamHealth {
  /** Whether the subscriber has been started. */
  running: boolean;
  /** Whether a stream connection is currently open. */
  connected: boolean;
  endpoint: string;
  /** Last SSE event id received (sent as Last-Event-ID on reconnect). */
  lastEventId: string | null;
  /** When the last event was received (ISO) or null. */
  lastEventAt: string | null;
  /** When the current connection epoch started (ISO) or null. */
  connectedAt: string | null;
  reconnectCount: number;
  unknownEventCount: number;
  lastError: string | null;
}

const health: IntelStreamHealth = {
  running: false,
  connected: false,
  endpoint: "",
  lastEventId: null,
  lastEventAt: null,
  connectedAt: null,
  reconnectCount: 0,
  unknownEventCount: 0,
  lastError: null,
};

export function getIntelStreamHealth(): IntelStreamHealth {
  return { ...health };
}

/** Exponential backoff with cap. Exported for tests. */
export function nextBackoffMs(current: number): number {
  if (current < BACKOFF_MIN_MS) return BACKOFF_MIN_MS;
  return Math.min(current * 2, BACKOFF_MAX_MS);
}

export function sseEndpoint(): string {
  const base = (process.env.OSIRIS_URL ?? "https://osirisai.live").replace(/\/+$/, "");
  const path = (process.env.OSIRIS_SSE_PATH ?? "/api/osint/stream").replace(/^\/+/, "");
  return `${base}/${path}`;
}

// ── SSE frame parsing (pure, exported for tests) ─────────────────────────────

export interface SseEvent {
  event: string;
  data: string;
  id: string | null;
}

/**
 * Incremental SSE parser: feed raw text chunks, receive complete events.
 * Handles multi-line data:, CRLF/LF, comment lines (':') and BOM.
 */
export function createSseParser(onEvent: (e: SseEvent) => void): { push: (chunk: string) => void } {
  let buffer = "";
  let eventType = "message";
  let dataLines: string[] = [];
  let eventId: string | null = null;

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventType = "message";
      eventId = null;
      return;
    }
    onEvent({ event: eventType, data: dataLines.join("\n"), id: eventId });
    eventType = "message";
    dataLines = [];
    eventId = null;
  };

  const handleLine = (line: string) => {
    if (line === "") return dispatch();
    if (line.startsWith(":")) return; // comment / keep-alive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventType = value;
    else if (field === "data") dataLines.push(value);
    else if (field === "id") eventId = value;
    // unknown fields ignored per spec
  };

  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1);
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    },
  };
}

// ── Event dispatch ───────────────────────────────────────────────────────────

const EVENT_TO_STREAM: Record<string, SnapshotStream> = {
  "sanctions-update": "sanctions",
  "threat-update": "threats",
};

/**
 * Route one SSE event into the snapshot store. Unknown event types are
 * tolerated (counted + debug-logged). Unparseable JSON payloads never
 * overwrite a good snapshot.
 */
export function handleStreamEvent(e: SseEvent): void {
  health.lastEventAt = new Date().toISOString();
  if (e.id) health.lastEventId = e.id;
  const stream = EVENT_TO_STREAM[e.event];
  if (!stream) {
    health.unknownEventCount += 1;
    logger.debug({ event: e.event }, "OSIRIS SSE: unknown event type — tolerated");
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(e.data);
  } catch {
    logger.warn({ event: e.event }, "OSIRIS SSE: unparseable event payload — snapshot NOT overwritten");
    return;
  }
  setSnapshot(stream, payload, e.id);
}

// ── Connection loop ──────────────────────────────────────────────────────────

let stopController: AbortController | null = null;
let loopPromise: Promise<void> | null = null;

export interface StreamStartOptions {
  fetchFn?: typeof fetch;
}

async function connectOnce(fetchFn: typeof fetch, signal: AbortSignal): Promise<void> {
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (health.lastEventId) headers["Last-Event-ID"] = health.lastEventId;
  const scannerKey = process.env.OSIRIS_SCANNER_KEY?.trim();
  if (scannerKey) headers["X-Scanner-Key"] = scannerKey;

  const res = await fetchFn(health.endpoint, {
    headers,
    signal: AbortSignal.any([signal, AbortSignal.timeout(CONNECT_TIMEOUT_MS * 6)]),
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE connect failed: HTTP ${res.status}`);
  }
  health.connected = true;
  health.connectedAt = new Date().toISOString();
  health.lastError = null;
  logger.info({ endpoint: health.endpoint, lastEventId: health.lastEventId }, "OSIRIS SSE stream connected");

  const parser = createSseParser(handleStreamEvent);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}

async function runLoop(fetchFn: typeof fetch, signal: AbortSignal): Promise<void> {
  let backoff = 0;
  while (!signal.aborted) {
    try {
      await connectOnce(fetchFn, signal);
      // Clean EOF: reconnect quickly (server may cycle connections).
      backoff = BACKOFF_MIN_MS;
    } catch (e) {
      if (signal.aborted) break;
      health.lastError = e instanceof Error ? e.message : String(e);
      logger.warn({ err: health.lastError, backoffMs: backoff || BACKOFF_MIN_MS }, "OSIRIS SSE disconnected — reconnecting");
      backoff = nextBackoffMs(backoff);
    } finally {
      health.connected = false;
      health.connectedAt = null;
    }
    if (signal.aborted) break;
    health.reconnectCount += 1;
    await new Promise((r) => setTimeout(r, backoff));
  }
}

/**
 * Start the subscriber. Idempotent: a second call while running is a no-op.
 * The loop runs in the background; this returns immediately.
 */
export function startOsirisStream(opts: StreamStartOptions = {}): void {
  if (loopPromise) return;
  health.running = true;
  health.endpoint = sseEndpoint();
  stopController = new AbortController();
  const signal = stopController.signal;
  loopPromise = runLoop(opts.fetchFn ?? fetch, signal)
    .catch((e) => logger.error({ err: e instanceof Error ? e.message : String(e) }, "OSIRIS SSE loop crashed"))
    .finally(() => {
      health.running = false;
      health.connected = false;
      loopPromise = null;
      stopController = null;
    });
}

/** Graceful stop (server shutdown / tests). */
export async function stopOsirisStream(): Promise<void> {
  stopController?.abort();
  await loopPromise;
}

/** Test hook: reset health counters between tests. */
export function __resetStreamHealth(): void {
  health.running = false;
  health.connected = false;
  health.endpoint = "";
  health.lastEventId = null;
  health.lastEventAt = null;
  health.connectedAt = null;
  health.reconnectCount = 0;
  health.unknownEventCount = 0;
  health.lastError = null;
}
