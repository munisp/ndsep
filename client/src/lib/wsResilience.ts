/**
 * Resilient WebSocket Manager
 * =============================
 * Production-grade WebSocket client optimized for unreliable networks
 * in rural/developing regions of Africa.
 *
 * Features:
 * - Automatic reconnection with exponential backoff + jitter
 * - Message queuing during disconnection
 * - Message deduplication (idempotency)
 * - Heartbeat/ping-pong to detect dead connections
 * - Graceful degradation to HTTP long-polling
 * - Connection state machine with event emitter
 * - Maximum reconnection attempts with fallback
 */

export type WsState = "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";

interface WsMessage {
  id: string;
  type: string;
  payload: unknown;
  timestamp: number;
}

interface ResilientWsOptions {
  url: string;
  maxReconnectAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxQueueSize?: number;
  enableFallback?: boolean;
  fallbackPollIntervalMs?: number;
}

type EventCallback = (data: unknown) => void;

export class ResilientWebSocket {
  private ws: WebSocket | null = null;
  private state: WsState = "disconnected";
  private reconnectAttempts = 0;
  private messageQueue: WsMessage[] = [];
  private processedIds = new Set<string>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Map<string, EventCallback[]>();
  private fallbackPolling = false;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;

  private readonly options: Required<ResilientWsOptions>;

  constructor(opts: ResilientWsOptions) {
    this.options = {
      url: opts.url,
      maxReconnectAttempts: opts.maxReconnectAttempts ?? 20,
      initialBackoffMs: opts.initialBackoffMs ?? 1000,
      maxBackoffMs: opts.maxBackoffMs ?? 60_000,
      heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 30_000,
      heartbeatTimeoutMs: opts.heartbeatTimeoutMs ?? 10_000,
      maxQueueSize: opts.maxQueueSize ?? 500,
      enableFallback: opts.enableFallback ?? true,
      fallbackPollIntervalMs: opts.fallbackPollIntervalMs ?? 30_000,
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────

  connect(): void {
    if (this.state === "connected" || this.state === "connecting") return;
    this.setState("connecting");
    this.createConnection();
  }

  disconnect(): void {
    this.cleanup();
    this.setState("disconnected");
  }

  send(type: string, payload: unknown): string {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const message: WsMessage = { id, type, payload, timestamp: Date.now() };

    if (this.state === "connected" && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue for later delivery
      if (this.messageQueue.length < this.options.maxQueueSize) {
        this.messageQueue.push(message);
      } else {
        // Drop oldest non-critical messages
        this.messageQueue.shift();
        this.messageQueue.push(message);
      }
    }

    return id;
  }

  on(event: string, callback: EventCallback): () => void {
    const cbs = this.listeners.get(event) ?? [];
    cbs.push(callback);
    this.listeners.set(event, cbs);
    return () => {
      const current = this.listeners.get(event) ?? [];
      this.listeners.set(event, current.filter(cb => cb !== callback));
    };
  }

  getState(): WsState { return this.state; }
  getQueueSize(): number { return this.messageQueue.length; }
  getReconnectAttempts(): number { return this.reconnectAttempts; }

  // ── Connection lifecycle ────────────────────────────────────────────────

  private createConnection(): void {
    try {
      this.ws = new WebSocket(this.options.url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setState("connected");
        this.startHeartbeat();
        this.flushQueue();
        this.stopFallbackPolling();
      };

      this.ws.onmessage = (event) => {
        this.resetHeartbeatTimeout();

        try {
          const message = JSON.parse(event.data) as WsMessage;

          // Heartbeat response
          if (message.type === "pong") return;

          // Deduplication
          if (message.id && this.processedIds.has(message.id)) return;
          if (message.id) {
            this.processedIds.add(message.id);
            // Keep set bounded
            if (this.processedIds.size > 10000) {
              const arr = Array.from(this.processedIds);
              this.processedIds = new Set(arr.slice(-5000));
            }
          }

          this.emit(message.type, message.payload);
          this.emit("message", message);
        } catch {
          // Non-JSON message (likely ping)
        }
      };

      this.ws.onclose = (event) => {
        this.stopHeartbeat();

        if (event.code === 1000) {
          // Normal close
          this.setState("disconnected");
          return;
        }

        // Abnormal close — attempt reconnection
        this.attemptReconnect();
      };

      this.ws.onerror = () => {
        // Error is always followed by close event
      };
    } catch {
      this.attemptReconnect();
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.setState("failed");
      if (this.options.enableFallback) {
        this.startFallbackPolling();
      }
      return;
    }

    this.setState("reconnecting");
    this.reconnectAttempts++;

    // Exponential backoff with jitter
    const baseDelay = Math.min(
      this.options.initialBackoffMs * Math.pow(2, this.reconnectAttempts - 1),
      this.options.maxBackoffMs
    );
    const jitter = baseDelay * 0.3 * Math.random();
    const delay = baseDelay + jitter;

    this.reconnectTimer = setTimeout(() => {
      if (!navigator.onLine) {
        // Wait for online event before reconnecting
        const handler = () => {
          window.removeEventListener("online", handler);
          this.createConnection();
        };
        window.addEventListener("online", handler);
        return;
      }
      this.createConnection();
    }, delay);
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
        this.heartbeatTimeout = setTimeout(() => {
          // No pong received — connection is dead
          this.ws?.close(4000, "Heartbeat timeout");
        }, this.options.heartbeatTimeoutMs);
      }
    }, this.options.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.heartbeatTimeout) { clearTimeout(this.heartbeatTimeout); this.heartbeatTimeout = null; }
  }

  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeout) { clearTimeout(this.heartbeatTimeout); this.heartbeatTimeout = null; }
  }

  // ── Fallback HTTP long-polling ──────────────────────────────────────────

  private startFallbackPolling(): void {
    if (this.fallbackPolling) return;
    this.fallbackPolling = true;

    const httpUrl = this.options.url
      .replace("wss://", "https://")
      .replace("ws://", "http://")
      .replace("/ws", "/api/events/poll");

    this.fallbackTimer = setInterval(async () => {
      try {
        const response = await fetch(httpUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lastEventId: Array.from(this.processedIds).pop() }),
          credentials: "include",
        });

        if (response.ok) {
          const events = await response.json();
          if (Array.isArray(events)) {
            for (const event of events) {
              if (event.id && !this.processedIds.has(event.id)) {
                this.processedIds.add(event.id);
                this.emit(event.type, event.payload);
              }
            }
          }
        }
      } catch {
        // Polling failure — continue trying
      }
    }, this.options.fallbackPollIntervalMs);

    this.emit("fallback", { mode: "polling", interval: this.options.fallbackPollIntervalMs });
  }

  private stopFallbackPolling(): void {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    this.fallbackPolling = false;
  }

  // ── Queue flush ─────────────────────────────────────────────────────────

  private flushQueue(): void {
    while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.messageQueue.shift();
      if (msg) this.ws.send(JSON.stringify(msg));
    }
  }

  // ── Event emitter ───────────────────────────────────────────────────────

  private emit(event: string, data: unknown): void {
    const cbs = this.listeners.get(event) ?? [];
    for (const cb of cbs) {
      try { cb(data); } catch { /* non-fatal */ }
    }
  }

  private setState(state: WsState): void {
    const prev = this.state;
    this.state = state;
    this.emit("stateChange", { from: prev, to: state });
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  private cleanup(): void {
    this.stopHeartbeat();
    this.stopFallbackPolling();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN) this.ws.close(1000);
      this.ws = null;
    }
  }
}
