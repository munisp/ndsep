import { Link } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { WafBlockTrendChart } from "@/components/waf-block-trend-chart";
import { trpc } from "@/lib/trpc";

export default function SecurityPostureScreen() {
  const trend = trpc.system.wafBlockTrend.useQuery(undefined, { refetchInterval: 15_000, retry: false });
  const live = trend.data?.source === "live_configured_telemetry";
  return <ScreenContainer className="p-5"><ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 32 }}><Link href="/(tabs)/profile" asChild><Pressable><Text className="text-sm font-semibold text-primary">‹ Profile</Text></Pressable></Link><View><Text className="text-2xl font-bold text-foreground">Security posture</Text><Text className="mt-2 text-sm leading-5 text-muted">WAF data appears only from an authenticated, HTTPS allowlisted APISIX/OpenAppSec telemetry endpoint. It is never estimated from application traffic.</Text></View><View className="rounded-3xl border border-border bg-surface p-5"><Text className="text-lg font-semibold text-foreground">WAF blocks — last 24 hours</Text><Text className={`mt-2 text-sm font-semibold ${live ? "text-success" : "text-warning"}`}>{live ? "Live configured telemetry" : "Telemetry unavailable"}</Text>{trend.data?.reason ? <Text className="mt-1 text-xs leading-5 text-muted">{trend.data.reason}</Text> : null}<WafBlockTrendChart points={trend.data?.points ?? []} /></View></ScrollView></ScreenContainer>;
}
