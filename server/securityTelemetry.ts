import { getConfiguredIntegrationValue } from "./integrationSettingsRepository";

export type WafTrendPoint = { timestamp: string; blockedRequests: number; threatTypes: string[]; sourceAddresses: string[] };
export type WafTrend = { source: "live_configured_telemetry" | "unavailable"; reason: string | null; points: WafTrendPoint[] };

function allowlistedEndpoint(value: string) {
  const url = new URL(value); const hosts = (getConfiguredIntegrationValue("SECURITY_TELEMETRY_ALLOWED_HOSTS") ?? process.env.SECURITY_TELEMETRY_ALLOWED_HOSTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (url.protocol !== "https:" || !hosts.includes(url.hostname.toLowerCase())) throw new Error("WAF telemetry endpoint is not HTTPS allowlisted.");
  return url;
}

function redactSourceAddress(value: string) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return `${value.split(".").slice(0, 3).join(".")}.*`;
  if (value.includes(":")) return `${value.split(":").slice(0, 2).join(":")}::/32`;
  let hash = 0; for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0; return `redacted-${Math.abs(hash).toString(16)}`;
}

export async function getWafBlockTrend(): Promise<WafTrend> {
  const endpoint = getConfiguredIntegrationValue("WAF_TELEMETRY_URL")?.trim(); const token = getConfiguredIntegrationValue("WAF_TELEMETRY_BEARER_TOKEN")?.trim();
  if (!endpoint || !token) return { source: "unavailable", reason: "Authenticated APISIX/OpenAppSec telemetry is not configured.", points: [] };
  try {
    const response = await fetch(allowlistedEndpoint(endpoint), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(4_000) });
    if (!response.ok) throw new Error(`endpoint returned ${response.status}`);
    const payload = await response.json() as { history?: unknown }; const history = Array.isArray(payload.history) ? payload.history : [];
    const points = history.filter((item): item is { timestamp: string; blockedRequests: number; threatTypes?: unknown; sourceAddresses?: unknown } => Boolean(item) && typeof item === "object" && typeof (item as { timestamp?: unknown }).timestamp === "string" && typeof (item as { blockedRequests?: unknown }).blockedRequests === "number").map((item) => ({ timestamp: item.timestamp, blockedRequests: Math.max(0, Math.floor(item.blockedRequests)), threatTypes: Array.isArray(item.threatTypes) ? item.threatTypes.filter((value): value is string => typeof value === "string").slice(0, 5) : [], sourceAddresses: Array.isArray(item.sourceAddresses) ? item.sourceAddresses.filter((value): value is string => typeof value === "string").slice(0, 5).map(redactSourceAddress) : [] })).slice(-24);
    return { source: "live_configured_telemetry", reason: points.length ? null : "Endpoint returned no valid 24-hour WAF history.", points };
  } catch (error) { return { source: "unavailable", reason: `WAF history unavailable: ${error instanceof Error ? error.message : "unknown error"}`, points: [] }; }
}
