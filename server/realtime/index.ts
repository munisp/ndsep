/**
 * NDSEP Real-Time Engine — WebSocket + SSE for live data streaming
 *
 * Replaces polling with push-based subscriptions for:
 * - Network Intelligence (wiredigg packets/threats)
 * - SIEM events
 * - Compliance score changes
 * - Worker process status
 * - Streaming events
 */
import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { logger } from "../logger";
import crypto from "crypto";

// ── Channel Types ───────────────────────────────────────────────────────────

export type Channel =
  | "network:packets"
  | "network:threats"
  | "network:stats"
  | "siem:events"
  | "siem:alerts"
  | "compliance:scores"
  | "compliance:events"
  | "workers:status"
  | "streaming:events"
  | "enforcement:updates"
  | "breach:notifications"
  | "iot:devices"
  | "audit:trail";

export type RealtimeMessage = {
  channel: Channel;
  event: string;
  data: unknown;
  timestamp: string;
};

// ── Client Management ───────────────────────────────────────────────────────

type ClientInfo = {
  id: string;
  ws: WebSocket;
  channels: Set<Channel>;
  userId?: number;
  connectedAt: Date;
  lastPing: Date;
};

const clients = new Map<string, ClientInfo>();
const channelSubscribers = new Map<Channel, Set<string>>();

// ── WebSocket Server ────────────────────────────────────────────────────────

let wss: WebSocketServer | null = null;

export function initRealtimeServer(server: HttpServer): void {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const clientId = crypto.randomUUID();
    const client: ClientInfo = {
      id: clientId,
      ws,
      channels: new Set(),
      connectedAt: new Date(),
      lastPing: new Date(),
    };
    clients.set(clientId, client);

    logger.info({ clientId, ip: req.socket.remoteAddress }, "WS client connected");

    // Send welcome message
    send(ws, {
      channel: "workers:status" as Channel,
      event: "connected",
      data: { clientId, serverTime: new Date().toISOString() },
      timestamp: new Date().toISOString(),
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { action: string; channels?: Channel[] };

        if (msg.action === "subscribe" && msg.channels) {
          for (const ch of msg.channels) {
            client.channels.add(ch);
            if (!channelSubscribers.has(ch)) channelSubscribers.set(ch, new Set());
            channelSubscribers.get(ch)!.add(clientId);
          }
          send(ws, {
            channel: "workers:status" as Channel,
            event: "subscribed",
            data: { channels: Array.from(client.channels) },
            timestamp: new Date().toISOString(),
          });
        }

        if (msg.action === "unsubscribe" && msg.channels) {
          for (const ch of msg.channels) {
            client.channels.delete(ch);
            channelSubscribers.get(ch)?.delete(clientId);
          }
        }

        if (msg.action === "ping") {
          client.lastPing = new Date();
          send(ws, {
            channel: "workers:status" as Channel,
            event: "pong",
            data: { serverTime: new Date().toISOString() },
            timestamp: new Date().toISOString(),
          });
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      for (const ch of Array.from(client.channels)) {
        channelSubscribers.get(ch)?.delete(clientId);
      }
      clients.delete(clientId);
      logger.debug({ clientId }, "WS client disconnected");
    });

    ws.on("error", (err) => {
      logger.warn({ clientId, err: err.message }, "WS error");
    });
  });

  // Heartbeat — disconnect stale clients every 30s
  setInterval(() => {
    const staleThreshold = Date.now() - 60_000;
    for (const [id, client] of Array.from(clients.entries())) {
      if (client.lastPing.getTime() < staleThreshold) {
        (client.ws as unknown as { terminate: () => void }).terminate();
        clients.delete(id);
      }
    }
  }, 30_000);

  logger.info({ path: "/ws" }, "Real-time WebSocket server initialized");
}

// ── Publish to Channel ──────────────────────────────────────────────────────

export function publish(channel: Channel, event: string, data: unknown): void {
  const msg: RealtimeMessage = {
    channel,
    event,
    data,
    timestamp: new Date().toISOString(),
  };

  const subscribers = channelSubscribers.get(channel);
  if (!subscribers || subscribers.size === 0) return;

  const payload = JSON.stringify(msg);
  let delivered = 0;

  for (const clientId of Array.from(subscribers)) {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
      delivered++;
    }
  }

  logger.debug({ channel, event, subscribers: subscribers.size, delivered }, "Published");
}

// ── Batch Publish (for high-throughput channels like packets) ────────────────

export function publishBatch(channel: Channel, event: string, items: unknown[]): void {
  if (items.length === 0) return;
  const msg: RealtimeMessage = {
    channel,
    event,
    data: items,
    timestamp: new Date().toISOString(),
  };

  const subscribers = channelSubscribers.get(channel);
  if (!subscribers || subscribers.size === 0) return;

  const payload = JSON.stringify(msg);
  for (const clientId of Array.from(subscribers)) {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

// ── SSE Endpoint (for simpler one-way streaming) ────────────────────────────

import type { Request, Response } from "express";

export function sseHandler(channel: Channel) {
  return (req: Request, res: Response) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const clientId = crypto.randomUUID();
    const fakeWs = {
      readyState: WebSocket.OPEN,
      send: (data: string) => {
        const parsed = JSON.parse(data) as RealtimeMessage;
        res.write(`event: ${parsed.event}\ndata: ${JSON.stringify(parsed.data)}\n\n`);
      },
      terminate: () => res.end(),
    } as unknown as WebSocket;

    const client: ClientInfo = {
      id: clientId,
      ws: fakeWs,
      channels: new Set([channel]),
      connectedAt: new Date(),
      lastPing: new Date(),
    };
    clients.set(clientId, client);
    if (!channelSubscribers.has(channel)) channelSubscribers.set(channel, new Set());
    channelSubscribers.get(channel)!.add(clientId);

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);

    // Keep-alive
    const keepAlive = setInterval(() => {
      client.lastPing = new Date();
      res.write(":keepalive\n\n");
    }, 15_000);

    req.on("close", () => {
      clearInterval(keepAlive);
      channelSubscribers.get(channel)?.delete(clientId);
      clients.delete(clientId);
    });
  };
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function getRealtimeStats(): {
  totalClients: number;
  channels: { name: string; subscribers: number }[];
} {
  const channels: { name: string; subscribers: number }[] = [];
  for (const [name, subs] of Array.from(channelSubscribers.entries())) {
    channels.push({ name, subscribers: subs.size });
  }
  return { totalClients: clients.size, channels };
}

function send(ws: WebSocket, msg: RealtimeMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
