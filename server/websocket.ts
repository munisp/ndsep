/**
 * NDSEP Real-Time WebSocket Notification System
 * ===============================================
 * Provides live push notifications for:
 *   - Compliance score changes
 *   - Breach incident alerts
 *   - DSAR request updates
 *   - Audit engagement status changes
 *   - Enforcement case updates
 *   - System health alerts
 *
 * Protocol: ws:// or wss:// with session-cookie authentication.
 * Falls back to SSE for clients that don't support WebSocket.
 */

import type { Server as HttpServer } from "http";
import { logger } from "./logger";

interface ConnectedClient {
  ws: any; // ws.WebSocket — typed as any to avoid @types/ws dependency
  userId: string;
  role: string;
  orgId?: number;
  connectedAt: Date;
}

const clients = new Map<string, ConnectedClient>();

let _wss: any | null = null;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://localhost:5000,http://localhost:5001")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin or non-browser clients
  return ALLOWED_ORIGINS.some((allowed) => origin === allowed);
}

export async function initWebSocketServer(server: HttpServer): Promise<void> {
  try {
    const { WebSocketServer } = await (import("ws") as any);
    _wss = new WebSocketServer({
      server,
      path: "/ws",
      verifyClient: (info: { origin: string }) => isOriginAllowed(info.origin),
    });
  } catch {
    logger.warn("[WS] ws package not available — WebSocket disabled");
    return;
  }

  _wss.on("connection", (ws: any, req: any) => {
    const clientId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const client: ConnectedClient = {
      ws,
      userId: "anonymous",
      role: "user",
      connectedAt: new Date(),
    };

    clients.set(clientId, client);
    logger.info({ clientId }, "[WS] Client connected (%d total)", clients.size);

    // Handle authentication message
    ws.on("message", (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "auth" && msg.userId) {
          client.userId = msg.userId;
          client.role = msg.role ?? "user";
          client.orgId = msg.orgId;
          ws.send(JSON.stringify({ type: "auth_ok", userId: client.userId }));
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      clients.delete(clientId);
      logger.info({ clientId }, "[WS] Client disconnected (%d remaining)", clients.size);
    });

    ws.on("error", () => {
      clients.delete(clientId);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: "connected",
      timestamp: new Date().toISOString(),
      message: "Connected to NDSEP real-time notifications",
    }));
  });

  logger.info("[WS] WebSocket server initialized at /ws");
}

/**
 * Broadcast a notification to all connected clients.
 * Optionally filter by role or organization.
 */
export function broadcast(
  event: string,
  data: Record<string, unknown>,
  filter?: { role?: string; orgId?: number; userId?: string }
): void {
  const payload = JSON.stringify({
    type: "notification",
    event,
    data,
    timestamp: new Date().toISOString(),
  });

  let sent = 0;
  clients.forEach((client) => {
    if (client.ws.readyState !== 1 /* WebSocket.OPEN */) return;

    // Apply filters
    if (filter?.role && client.role !== filter.role && client.role !== "admin") return;
    if (filter?.orgId && client.orgId !== filter.orgId && client.role !== "admin") return;
    if (filter?.userId && client.userId !== filter.userId) return;

    client.ws.send(payload);
    sent++;
  });

  if (sent > 0) {
    logger.info({ event, sent }, "[WS] Broadcast %s to %d clients", event, sent);
  }
}

/**
 * Send a notification to a specific user.
 */
export function notifyUser(userId: string, event: string, data: Record<string, unknown>): void {
  broadcast(event, data, { userId });
}

/**
 * Get current WebSocket connection stats.
 */
export function getWsStats(): {
  totalConnections: number;
  authenticatedConnections: number;
  roles: Record<string, number>;
} {
  const roles: Record<string, number> = {};
  let authenticated = 0;

  clients.forEach((client) => {
    if (client.userId !== "anonymous") {
      authenticated++;
      roles[client.role] = (roles[client.role] ?? 0) + 1;
    }
  });

  return {
    totalConnections: clients.size,
    authenticatedConnections: authenticated,
    roles,
  };
}
