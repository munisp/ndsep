import { fallbackRateLimitTelemetry } from "./httpSecurity";

function approvedTelemetryUrl(value: string) {
  const url = new URL(value); if (url.protocol !== "https:") throw new Error("WAF telemetry requires an HTTPS endpoint.");
  const allowlist = process.env.SECURITY_TELEMETRY_ALLOWED_HOSTS?.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) ?? [];
  if (!allowlist.includes(url.hostname.toLowerCase())) throw new Error("WAF telemetry endpoint is not allowlisted.");
  return url;
}

export async function getSecurityPosture() {
  const applicationRateLimit = fallbackRateLimitTelemetry();
  const endpoint = process.env.WAF_TELEMETRY_URL?.trim(); const token = process.env.WAF_TELEMETRY_BEARER_TOKEN?.trim();
  if (!endpoint || !token) return { applicationRateLimit, waf: { state: "unavailable" as const, blockedRequestsLast5m: null, detail: "Authenticated gateway/WAF telemetry is not configured." }, sampledAt: new Date().toISOString() };
  try {
    const url = approvedTelemetryUrl(endpoint); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: controller.signal }); clearTimeout(timeout);
    if (!response.ok) throw new Error("Telemetry endpoint rejected the request."); const payload = await response.json() as { blockedRequestsLast5m?: unknown }; const blocks = payload.blockedRequestsLast5m;
    if (typeof blocks !== "number" || !Number.isFinite(blocks) || blocks < 0) throw new Error("Telemetry response did not contain a valid blockedRequestsLast5m number.");
    return { applicationRateLimit, waf: { state: "connected" as const, blockedRequestsLast5m: blocks, detail: "Authenticated gateway/WAF telemetry response received." }, sampledAt: new Date().toISOString() };
  } catch { return { applicationRateLimit, waf: { state: "degraded" as const, blockedRequestsLast5m: null, detail: "Configured gateway/WAF telemetry could not be verified." }, sampledAt: new Date().toISOString() }; }
}
