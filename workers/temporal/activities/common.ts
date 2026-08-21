import { Pool } from "pg";

let pool: Pool | null = null;

export function database(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for Temporal activities");
  pool ??= new Pool({ connectionString });
  return pool;
}

export async function postRequiredWebhook(kind: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const baseUrl = process.env.TEMPORAL_NOTIFICATION_URL;
  if (!baseUrl) throw new Error("TEMPORAL_NOTIFICATION_URL is required for workflow notifications");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.TEMPORAL_NOTIFICATION_TOKEN ? { Authorization: `Bearer ${process.env.TEMPORAL_NOTIFICATION_TOKEN}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Notification endpoint ${kind} returned HTTP ${response.status}`);
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { response: text }; }
}
