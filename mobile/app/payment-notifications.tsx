import { FlatList, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

function AlertStatus({ type }: { type: "offline_payment_approved" | "offline_payment_rejected" }) {
  const approved = type === "offline_payment_approved";
  return <View className={`rounded-full px-2 py-1 ${approved ? "bg-success/10" : "bg-error/10"}`}><Text className={`text-[10px] font-bold uppercase tracking-wide ${approved ? "text-success" : "text-error"}`}>{approved ? "Approved" : "Action required"}</Text></View>;
}

export default function PaymentNotificationsScreen() {
  const alerts = trpc.paymentOperations.myAlerts.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const markRead = trpc.paymentOperations.markAlertRead.useMutation({ onSuccess: () => utils.paymentOperations.myAlerts.invalidate() });

  return (
    <ScreenContainer className="bg-background">
      <FlatList
        data={alerts.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 20, gap: 12, flexGrow: 1 }}
        refreshing={alerts.isRefetching}
        onRefresh={() => void alerts.refetch()}
        ListHeaderComponent={<View className="mb-2 rounded-[28px] bg-surface p-5"><Text className="text-sm text-muted">Payment Alerts</Text><Text className="mt-2 text-3xl font-bold text-foreground">Payment review updates</Text><Text className="mt-2 text-sm leading-5 text-muted">Only decisions recorded by an authorised administrator are shown here. A status update is not a bank, gateway, or ledger settlement confirmation.</Text></View>}
        renderItem={({ item }) => <Pressable disabled={Boolean(item.readAt) || markRead.isPending} onPress={() => markRead.mutate({ alertId: item.id })} style={({ pressed }) => [{ opacity: pressed ? 0.78 : 1 }]}><View className={`rounded-3xl border p-4 ${item.readAt ? "border-border bg-surface" : "border-primary bg-primary/5"}`}><View className="flex-row items-start justify-between gap-3"><Text className="flex-1 text-base font-semibold text-foreground">{item.title}</Text><AlertStatus type={item.type} /></View><Text className="mt-2 text-sm leading-5 text-muted">{item.body}</Text><Text className="mt-3 text-xs text-muted">{new Date(item.createdAt).toLocaleString()}</Text>{!item.readAt ? <Text className="mt-2 text-xs font-semibold text-primary">Tap to mark as read</Text> : null}</View></Pressable>}
        ListEmptyComponent={alerts.isLoading ? <View className="items-center rounded-3xl border border-border bg-surface p-6"><Text className="text-sm text-muted">Loading your payment alerts…</Text></View> : alerts.isError ? <View className="rounded-3xl border border-warning bg-warning/5 p-5"><Text className="text-base font-semibold text-warning">Account session required</Text><Text className="mt-2 text-sm leading-5 text-muted">Payment alerts are only available to a signed-in account. No alert data is displayed without an authenticated session.</Text></View> : <View className="items-center rounded-3xl border border-border bg-surface p-6"><Text className="text-base font-semibold text-foreground">No payment alerts</Text><Text className="mt-2 text-center text-sm leading-5 text-muted">You will see administrator decisions about your submitted offline-payment declarations here.</Text></View>}
        ListFooterComponent={<Link href={"/(tabs)/profile" as never} asChild><View className="mt-2 rounded-2xl border border-border bg-background px-4 py-4"><Text className="text-center font-semibold text-foreground">Return to profile</Text></View></Link>}
      />
    </ScreenContainer>
  );
}
