import Svg, { Line, Polyline } from "react-native-svg";
import { Text, View } from "react-native";

import type { WafTrendPoint } from "@/server/securityTelemetry";

export function WafBlockTrendChart({ points }: { points: WafTrendPoint[] }) {
  if (!points.length) return <View className="mt-4 rounded-2xl border border-dashed border-border bg-background p-4"><Text className="text-sm text-muted">No verified 24-hour WAF history is available.</Text></View>;
  const width = 320; const height = 120; const max = Math.max(1, ...points.map((point) => point.blockedRequests));
  const coordinates = points.map((point, index) => `${(index / Math.max(1, points.length - 1)) * width},${height - (point.blockedRequests / max) * (height - 10)}`).join(" ");
  return <View className="mt-4 rounded-2xl border border-border bg-background p-3"><Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}><Line x1="0" y1={height} x2={width} y2={height} stroke="#D0D5DD" strokeWidth="1" /><Polyline points={coordinates} fill="none" stroke="#D92D20" strokeWidth="3" /></Svg><View className="mt-2 flex-row justify-between"><Text className="text-xs text-muted">{new Date(points[0]!.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text><Text className="text-xs text-muted">{new Date(points.at(-1)!.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text></View></View>;
}
