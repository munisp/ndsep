import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View, Platform, Alert } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { formatNaira, type PaymentRecord, type PaymentStatus } from "@/lib/payment-domain";

/** Seeded payment history for demonstration — all records are explicitly gateway-unverified */
const DEMO_HISTORY: PaymentRecord[] = [
  { id: "pay-demo-1", referenceNumber: "IDLR-M1A2B3-XY4Z", amount: 50000, currency: "NGN", feeCategory: "c_of_o_application", description: "C of O Application Fee", status: "pending_gateway", method: "card", parcelId: "lagos-parcel-001", permitId: null, applicantId: "demo-user", createdAt: "2026-08-10T09:00:00Z", updatedAt: "2026-08-10T09:00:00Z", gatewayReference: null, gatewayProvider: null, receiptUrl: null, gatewayVerified: false, verificationNote: "Gateway not configured" },
  { id: "pay-demo-2", referenceNumber: "IDLR-N5C6D7-QR8S", amount: 75000, currency: "NGN", feeCategory: "survey_fee", description: "Survey Fee", status: "pending_gateway", method: "bank_transfer", parcelId: "fct-parcel-003", permitId: null, applicantId: "demo-user", createdAt: "2026-08-08T14:30:00Z", updatedAt: "2026-08-08T14:30:00Z", gatewayReference: null, gatewayProvider: null, receiptUrl: null, gatewayVerified: false, verificationNote: "Gateway not configured" },
  { id: "pay-demo-3", referenceNumber: "IDLR-P9E0F1-GH2I", amount: 250000, currency: "NGN", feeCategory: "permit_mining", description: "Mining Permit Fee", status: "pending_gateway", method: "ussd", parcelId: null, permitId: "permit-mining-001", applicantId: "demo-user", createdAt: "2026-08-05T11:15:00Z", updatedAt: "2026-08-05T11:15:00Z", gatewayReference: null, gatewayProvider: null, receiptUrl: null, gatewayVerified: false, verificationNote: "Gateway not configured" },
];

const STATUS_LABELS: Record<PaymentStatus, { label: string; color: string }> = {
  pending_gateway: { label: "Pending Gateway", color: "text-warning" },
  initiated: { label: "Initiated", color: "text-muted" },
  processing: { label: "Processing", color: "text-primary" },
  completed: { label: "Completed", color: "text-success" },
  failed: { label: "Failed", color: "text-error" },
  refunded: { label: "Refunded", color: "text-muted" },
};

export default function PaymentHistoryScreen() {
  const [filter, setFilter] = useState<"all" | PaymentStatus>("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "highest" | "lowest">("newest");
  const filtered = (filter === "all" ? DEMO_HISTORY : DEMO_HISTORY.filter((p) => p.status === filter))
    .sort((a, b) => sortBy === "newest" ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() : sortBy === "oldest" ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() : sortBy === "highest" ? b.amount - a.amount : a.amount - b.amount);
  const [selectedReceipt, setSelectedReceipt] = useState<PaymentRecord | null>(null);

  async function downloadReceiptPdf(record: PaymentRecord) {
    const content = [
      "IDLR-PTS PAYMENT RECEIPT",
      "========================",
      "",
      `Reference: ${record.referenceNumber}`,
      `Amount: ${formatNaira(record.amount)}`,
      `Fee: ${record.description}`,
      `Category: ${record.feeCategory}`,
      `Method: ${record.method ?? "Not selected"}`,
      `Date: ${new Date(record.createdAt).toLocaleString("en-NG")}`,
      `Status: ${record.status}`,
      "",
      `Gateway Verified: ${record.gatewayVerified ? "YES" : "NO"}`,
      `Verification Note: ${record.verificationNote}`,
      "",
      "---",
      "This receipt is generated locally and does NOT constitute",
      "proof of payment until verified by a connected payment gateway.",
      "---",
      `Generated: ${new Date().toISOString()}`,
    ].join("\n");

    if (Platform.OS === "web") {
      Alert.alert("PDF Export", "PDF download is available on native devices. Receipt content:\n\n" + content.slice(0, 200));
      return;
    }

    const path = `${FileSystem.documentDirectory}receipt-${record.referenceNumber}.txt`;
    await FileSystem.writeAsStringAsync(path, content);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: "text/plain", dialogTitle: "Save Payment Receipt" });
    }
  }

  return (
    <ScreenContainer className="p-6">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="flex-1 gap-6">
          <View className="gap-1">
            <Text className="text-2xl font-bold text-foreground">Payment History</Text>
            <Text className="text-sm text-muted">All fee payments and their verification status</Text>
          </View>

          <View className="rounded-2xl border border-warning bg-warning/5 p-4">
            <Text className="text-xs font-bold text-warning">⚠ NO GATEWAY CONNECTED</Text>
            <Text className="mt-1 text-xs text-muted">All records below are pending real payment gateway verification. No money has been collected or transferred.</Text>
          </View>

          <View className="flex-row flex-wrap gap-2 mb-2">
            <Text className="text-xs font-semibold text-foreground self-center mr-1">Sort:</Text>
            {(["newest", "oldest", "highest", "lowest"] as const).map((s) => (
              <Pressable key={s} onPress={() => setSortBy(s)}>
                <View className={`rounded-full px-3 py-1 border ${sortBy === s ? "border-primary bg-primary/10" : "border-border"}`}>
                  <Text className={`text-[10px] ${sortBy === s ? "text-primary font-semibold" : "text-muted"}`}>{s.charAt(0).toUpperCase() + s.slice(1)}</Text>
                </View>
              </Pressable>
            ))}
          </View>

          <View className="flex-row flex-wrap gap-2">
            {(["all", "pending_gateway", "completed", "failed"] as const).map((f) => (
              <Pressable key={f} onPress={() => setFilter(f)}>
                <View className={`rounded-full px-3 py-1 border ${filter === f ? "border-primary bg-primary/10" : "border-border bg-background"}`}>
                  <Text className={`text-xs font-semibold ${filter === f ? "text-primary" : "text-muted"}`}>{f === "all" ? "All" : STATUS_LABELS[f].label}</Text>
                </View>
              </Pressable>
            ))}
          </View>

          <View className="gap-3">
            {filtered.map((payment) => (
              <Pressable key={payment.id} onPress={() => setSelectedReceipt(payment)} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}>
              <View className="rounded-2xl border border-border bg-surface p-4 gap-2">
                <View className="flex-row justify-between items-center">
                  <Text className="text-sm font-semibold text-foreground">{payment.description}</Text>
                  <Text className={`text-xs font-bold ${STATUS_LABELS[payment.status].color}`}>{STATUS_LABELS[payment.status].label}</Text>
                </View>
                <Text className="text-lg font-bold text-foreground">{formatNaira(payment.amount)}</Text>
                <Text className="text-xs text-muted">Ref: {payment.referenceNumber}</Text>
                <Text className="text-xs text-muted">Method: {payment.method ?? "Not selected"}</Text>
                <Text className="text-xs text-muted">Date: {new Date(payment.createdAt).toLocaleDateString("en-NG")}</Text>
                {!payment.gatewayVerified && (
                  <View className="mt-2 rounded-xl border border-warning/30 bg-warning/5 p-2">
                    <Text className="text-[10px] text-warning">Not verified — {payment.verificationNote}</Text>
                  </View>
                )}
                <Text className="mt-1 text-[10px] text-primary">Tap for receipt details →</Text>
              </View>
              </Pressable>
            ))}
            {filtered.length === 0 && (
              <View className="items-center p-8">
                <Text className="text-3xl mb-2">💳</Text>
                <Text className="text-sm text-muted">No payments match the selected filter.</Text>
              </View>
            )}
          </View>

          <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
            <View className="px-4 py-3">
              <Text className="text-center font-semibold text-muted">Return</Text>
            </View>
          </Pressable>

          {/* Receipt Detail Modal */}
          <Modal visible={Boolean(selectedReceipt)} animationType="slide" onRequestClose={() => setSelectedReceipt(null)}>
            <View className="flex-1 bg-background p-6 pt-16">
              <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
                {selectedReceipt && (
                  <View className="gap-4">
                    <Text className="text-2xl font-bold text-foreground">Transaction Receipt</Text>
                    <View className="rounded-2xl border border-warning bg-warning/5 p-3">
                      <Text className="text-[10px] font-bold text-warning">⚠ UNVERIFIED — No gateway connected</Text>
                    </View>
                    <View className="rounded-2xl border border-border bg-surface p-4 gap-3">
                      <View className="flex-row justify-between"><Text className="text-xs text-muted">Reference</Text><Text className="text-xs font-semibold text-foreground">{selectedReceipt.referenceNumber}</Text></View>
                      <View className="flex-row justify-between"><Text className="text-xs text-muted">Amount</Text><Text className="text-sm font-bold text-foreground">{formatNaira(selectedReceipt.amount)}</Text></View>
                      <View className="flex-row justify-between"><Text className="text-xs text-muted">Fee Type</Text><Text className="text-xs text-foreground">{selectedReceipt.description}</Text></View>
                      <View className="flex-row justify-between"><Text className="text-xs text-muted">Method</Text><Text className="text-xs text-foreground">{selectedReceipt.method ?? "—"}</Text></View>
                      <View className="flex-row justify-between"><Text className="text-xs text-muted">Date</Text><Text className="text-xs text-foreground">{new Date(selectedReceipt.createdAt).toLocaleString("en-NG")}</Text></View>
                      <View className="flex-row justify-between"><Text className="text-xs text-muted">Status</Text><Text className={`text-xs font-bold ${STATUS_LABELS[selectedReceipt.status].color}`}>{STATUS_LABELS[selectedReceipt.status].label}</Text></View>
                      <View className="flex-row justify-between"><Text className="text-xs text-muted">Gateway Verified</Text><Text className="text-xs font-bold text-error">No</Text></View>
                    </View>
                    <Pressable onPress={() => downloadReceiptPdf(selectedReceipt)} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
                      <View className="rounded-xl bg-foreground px-4 py-4">
                        <Text className="text-center font-semibold text-background">Download Receipt</Text>
                      </View>
                    </Pressable>
                    <Pressable onPress={() => setSelectedReceipt(null)} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
                      <View className="px-4 py-3">
                        <Text className="text-center font-semibold text-muted">Close</Text>
                      </View>
                    </Pressable>
                  </View>
                )}
              </ScrollView>
            </View>
          </Modal>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
