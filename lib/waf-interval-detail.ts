import type { WafTrendPoint } from "@/server/securityTelemetry";

export function filterWafIntervalDetail(point: WafTrendPoint, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return { threatTypes: point.threatTypes, sourceAddresses: point.sourceAddresses };
  return { threatTypes: point.threatTypes.filter((value) => value.toLowerCase().includes(needle)), sourceAddresses: point.sourceAddresses.filter((value) => value.toLowerCase().includes(needle)) };
}
