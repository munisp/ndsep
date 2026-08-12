import { useState, useEffect } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { formatNaira } from "@/lib/payment-domain";
const API_BASE = "/api/trpc";

type OfflinePayment = {
  id: string;
  referenceNumber: string;
  amount: number;
  currency: string;
  feeCategory: string;
  description: string;
  method: string;
  applicantId: string;
  markedAt: string;
  status: "pending_review" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

export default function OfflinePaymentsScreen() {
  const [payments, setPayments] = useState<OfflinePayment[]>([]);
  const [filter, setFilter] = useState<"pending_review" | "approved" | "rejected" | "all">("pending_review");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPayments();
  }, [filter]);

  async function loadPayments() {
    setLoading(true);
    try {
      const input = filter === "all" ? undefined : { filter };
      const url = `${API_BASE}/listOfflinePayments` + (input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : "");
      const res = await fetch(url);
      const json = await res.json();
      setPayments((json?.result?.data ?? []) as OfflinePayment[]);
    } catch {
      // Admin access required — show empty state
      setPayments([]);
    }
    setLoading(false);
  }

  async function handleDecision(id: string, decision: "approved" | "rejected") {
    if (!reviewNote.trim()) {
      Alert.alert("Note Required", "Please provide a review note explaining your decision.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/reviewOfflinePayment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision, reviewedBy: "admin", note: reviewNote.trim() }),
      });
      if (!res.ok) throw new Error("Failed");
      Alert.alert(
        decision === "approved" ? "Payment Approved" : "Payment Rejected",
        `The offline payment has been ${decision}. The applicant will be notified.\n\n⚠ Note: This approval does NOT constitute gateway verification. The payment remains unverified by any external payment provider.`
      );
      setReviewingId(null);
      setReviewNote("");
      loadPayments();
    } catch (err) {
      Alert.alert("Error", "Failed to submit review. Administrator access is required.");
    }
  }

  const statusColors = {
    pending_review: "border-warning bg-warning/5",
    approved: "border-success bg-success/5",
    rejected: "border-error bg-error/5",
  };

  const statusLabels = {
    pending_review: "Pending Review",
    approved: "Approved (Unverified)",
    rejected: "Rejected",
  };

  return (
    <ScreenContainer className="p-6">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="flex-1 gap-6">
          <View className="gap-1">
            <Text className="text-2xl font-bold text-foreground">Offline Payments</Text>
            <Text className="text-sm text-muted">Review manually marked cash and bank transfer payments</Text>
          </View>

          <View className="rounded-2xl border border-warning bg-warning/5 p-4">
            <Text className="text-xs font-bold text-warning">⚠ ADMINISTRATOR REVIEW ONLY</Text>
            <Text className="mt-1 text-xs text-muted">Approving an offline payment does NOT verify it through a payment gateway. It only records an administrative decision that the payment was received through offline channels.</Text>
          </View>

          <View className="flex-row flex-wrap gap-2">
            {(["pending_review", "approved", "rejected", "all"] as const).map((f) => (
              <Pressable key={f} onPress={() => setFilter(f)}>
                <View className={`rounded-full px-3 py-1 border ${filter === f ? "border-primary bg-primary/10" : "border-border"}`}>
                  <Text className={`text-[10px] ${filter === f ? "text-primary font-semibold" : "text-muted"}`}>
                    {f === "all" ? "All" : f === "pending_review" ? "Pending" : f === "approved" ? "Approved" : "Rejected"}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>

          {loading && (
            <View className="items-center p-8">
              <Text className="text-sm text-muted">Loading…</Text>
            </View>
          )}

          {!loading && payments.length === 0 && (
            <View className="items-center p-8">
              <Text className="text-3xl mb-2">📋</Text>
              <Text className="text-sm text-muted">No offline payments match this filter.</Text>
            </View>
          )}

          <View className="gap-3">
            {payments.map((payment) => (
              <View key={payment.id} className={`rounded-2xl border p-4 gap-2 ${statusColors[payment.status]}`}>
                <View className="flex-row justify-between items-center">
                  <Text className="text-sm font-semibold text-foreground">{payment.description}</Text>
                  <Text className="text-[10px] font-bold text-muted">{statusLabels[payment.status]}</Text>
                </View>
                <Text className="text-lg font-bold text-foreground">{formatNaira(payment.amount)}</Text>
                <Text className="text-xs text-muted">Ref: {payment.referenceNumber}</Text>
                <Text className="text-xs text-muted">Method: {payment.method}</Text>
                <Text className="text-xs text-muted">Marked: {new Date(payment.markedAt).toLocaleString("en-NG")}</Text>

                {payment.reviewedBy && (
                  <View className="mt-2 rounded-xl border border-border bg-background p-2">
                    <Text className="text-[10px] text-muted">Reviewed by: {payment.reviewedBy} on {payment.reviewedAt ? new Date(payment.reviewedAt).toLocaleString("en-NG") : "—"}</Text>
                    <Text className="text-[10px] text-foreground mt-1">{payment.reviewNote}</Text>
                  </View>
                )}

                {payment.status === "pending_review" && (
                  <>
                    {reviewingId === payment.id ? (
                      <View className="mt-2 gap-2">
                        <TextInput
                          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
                          placeholder="Review note (required)…"
                          placeholderTextColor="#9BA1A6"
                          value={reviewNote}
                          onChangeText={setReviewNote}
                          multiline
                        />
                        <View className="flex-row gap-2">
                          <Pressable onPress={() => handleDecision(payment.id, "approved")} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.8 : 1 }]}>
                            <View className="rounded-xl bg-success px-3 py-3">
                              <Text className="text-center text-xs font-bold text-white">Approve</Text>
                            </View>
                          </Pressable>
                          <Pressable onPress={() => handleDecision(payment.id, "rejected")} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.8 : 1 }]}>
                            <View className="rounded-xl bg-error px-3 py-3">
                              <Text className="text-center text-xs font-bold text-white">Reject</Text>
                            </View>
                          </Pressable>
                        </View>
                        <Pressable onPress={() => { setReviewingId(null); setReviewNote(""); }}>
                          <Text className="text-center text-xs text-muted mt-1">Cancel</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable onPress={() => setReviewingId(payment.id)} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
                        <View className="mt-2 rounded-xl border border-primary px-3 py-2">
                          <Text className="text-center text-xs font-semibold text-primary">Review This Payment</Text>
                        </View>
                      </Pressable>
                    )}
                  </>
                )}
              </View>
            ))}
          </View>

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
