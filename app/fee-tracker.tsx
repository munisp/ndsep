import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { NIGERIA_FEE_SCHEDULE, formatNaira, type FeeCategory } from "@/lib/payment-domain";

/** C of O and permit fee status tracker — shows required fees and their payment state */
export default function FeeTrackerScreen() {
  // In production, this would query the payment ledger (TigerBeetle) for each fee's status.
  // Currently all fees show as "unpaid / gateway not connected".
  const feeStatus: Record<FeeCategory, "unpaid" | "pending" | "paid"> = {
    c_of_o_application: "unpaid",
    c_of_o_renewal: "unpaid",
    permit_mining: "unpaid",
    permit_oil_gas: "unpaid",
    survey_fee: "unpaid",
    stamp_duty: "unpaid",
    development_levy: "unpaid",
    consent_fee: "unpaid",
  };

  const statusColors = { unpaid: "border-error/30 bg-error/5", pending: "border-warning/30 bg-warning/5", paid: "border-success/30 bg-success/5" };
  const statusLabels = { unpaid: "Unpaid", pending: "Pending verification", paid: "Paid & verified" };

  return (
    <ScreenContainer className="p-6">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="flex-1 gap-6">
          <View className="gap-1">
            <Text className="text-2xl font-bold text-foreground">Fee Tracker</Text>
            <Text className="text-sm text-muted">C of O application and permit fee status</Text>
          </View>

          <View className="rounded-2xl border border-warning bg-warning/5 p-4">
            <Text className="text-xs font-bold text-warning">⚠ LEDGER NOT CONNECTED</Text>
            <Text className="mt-1 text-xs text-muted">Fee payment status requires TigerBeetle ledger integration. All fees currently show as unpaid because no payment infrastructure is configured.</Text>
          </View>

          <View className="gap-3">
            {NIGERIA_FEE_SCHEDULE.map((fee) => {
              const status = feeStatus[fee.category];
              return (
                <View key={fee.category} className={`rounded-2xl border p-4 ${statusColors[status]}`}>
                  <View className="flex-row justify-between items-center">
                    <Text className="text-sm font-semibold text-foreground flex-1">{fee.label}</Text>
                    <Text className={`text-xs font-bold ${status === "paid" ? "text-success" : status === "pending" ? "text-warning" : "text-error"}`}>{statusLabels[status]}</Text>
                  </View>
                  <Text className="mt-1 text-xs text-muted">{fee.description}</Text>
                  <View className="mt-3 flex-row justify-between items-center">
                    <Text className="text-lg font-bold text-foreground">{formatNaira(fee.baseAmount)}</Text>
                    <Pressable onPress={() => router.push({ pathname: "/checkout" as any, params: { category: fee.category } })} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
                      <View className="rounded-full border border-primary px-4 py-2">
                        <Text className="text-xs font-semibold text-primary">Pay Now</Text>
                      </View>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>

          <Pressable onPress={() => router.push("/payment-history" as any)} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
            <View className="rounded-xl border border-border px-4 py-4">
              <Text className="text-center font-semibold text-foreground">View Payment History</Text>
            </View>
          </Pressable>

          <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
            <View className="px-4 py-3">
              <Text className="text-center font-semibold text-muted">Return</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

