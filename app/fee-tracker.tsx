import { Alert, Pressable, ScrollView, Text, View, Platform } from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { NIGERIA_FEE_SCHEDULE, formatNaira, type FeeCategory } from "@/lib/payment-domain";

/** C of O and permit fee status tracker — shows required fees and their payment state */
export default function FeeTrackerScreen() {
  /** C of O Application Progress Timeline */
  const cofOStages = [
    { id: "application", label: "Application Submitted", status: "complete" as const, date: "2026-07-15", tooltip: "Submit completed application form with parcel details and supporting documents to the State Land Bureau.", actionBadge: null, actionRoute: null },
    { id: "fee_payment", label: "Application Fee Payment", status: "current" as const, date: null, tooltip: "Pay the prescribed application processing fee via approved payment channels.", actionBadge: "Payment Required", actionRoute: "/checkout" as const },
    { id: "survey", label: "Survey & Demarcation", status: "pending" as const, date: null, tooltip: "Licensed surveyor conducts physical boundary survey and produces a survey plan.", actionBadge: "Upload Survey Plan", actionRoute: "/onboarding" as const },
    { id: "review", label: "State Land Bureau Review", status: "pending" as const, date: null, tooltip: "Land Bureau officers verify documentation, confirm no encumbrances, and prepare recommendation.", actionBadge: null, actionRoute: null },
    { id: "consent", label: "Governor's Consent", status: "pending" as const, date: null, tooltip: "The State Governor (or delegate) reviews and grants formal consent for the land allocation.", actionBadge: null, actionRoute: null },
    { id: "issuance", label: "C of O Issuance", status: "pending" as const, date: null, tooltip: "Certificate of Occupancy is printed, signed, and issued to the applicant.", actionBadge: "Collect Document", actionRoute: null },
  ];

  const completedStages = cofOStages.filter((s) => s.status === "complete").length;
  const progressPercent = Math.round((completedStages / cofOStages.length) * 100);

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

          {/* C of O Progress Timeline */}
          <View className="rounded-2xl border border-border bg-surface p-4 gap-3">
            <Text className="text-sm font-semibold text-foreground">C of O Application Progress</Text>
            <View className="flex-row items-center gap-2">
              <View className="flex-1 h-2 rounded-full bg-border overflow-hidden">
                <View className="h-full rounded-full bg-primary" style={{ width: `${progressPercent}%` }} />
              </View>
              <Text className="text-xs font-bold text-primary">{progressPercent}%</Text>
            </View>
            <View className="gap-2 mt-2">
              {cofOStages.map((stage, index) => (
                <View key={stage.id} className="flex-row items-start gap-3">
                  <View className="items-center">
                    <View className={`w-5 h-5 rounded-full items-center justify-center ${stage.status === "complete" ? "bg-success" : stage.status === "current" ? "bg-primary" : "bg-border"}`}>
                      <Text className="text-[9px] text-white font-bold">{stage.status === "complete" ? "✓" : index + 1}</Text>
                    </View>
                    {index < cofOStages.length - 1 && <View className={`w-0.5 h-4 mt-1 ${stage.status === "complete" ? "bg-success" : "bg-border"}`} />}
                  </View>
                  <View className="flex-1 pb-1">
                    <Text className={`text-xs font-semibold ${stage.status === "complete" ? "text-success" : stage.status === "current" ? "text-primary" : "text-muted"}`}>{stage.label}</Text>
                    {stage.date && <Text className="text-[10px] text-muted">{stage.date}</Text>}
                    {stage.status === "current" && <Text className="text-[10px] text-primary mt-0.5">← Action required</Text>}
                    {"tooltip" in stage && <Text className="text-[10px] text-muted mt-0.5">{(stage as any).tooltip}</Text>}
                    {(stage as any).actionBadge && (
                      <Pressable
                        onPress={() => {
                          const route = (stage as any).actionRoute;
                          if (route) {
                            router.push({ pathname: route });
                          } else {
                            Alert.alert("Action Required", `"${(stage as any).actionBadge}" — this action will be available when the relevant stage is reached.`);
                          }
                        }}
                        style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
                      >
                        <View className="mt-1 self-start flex-row items-center rounded-full border border-warning bg-warning/10 px-2 py-0.5">
                          <Text className="text-[9px] font-bold text-warning">{(stage as any).actionBadge} →</Text>
                        </View>
                      </Pressable>
                    )}
                  </View>
                </View>
              ))}
            </View>
            <Text className="text-[10px] text-muted mt-1">Timeline stages are illustrative. Real progression requires connected state land bureau systems.</Text>
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
