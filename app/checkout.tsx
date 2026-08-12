import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { NIGERIA_FEE_SCHEDULE, formatNaira, generatePaymentReference, type FeeCategory, type PaymentMethod, type PaymentRecord } from "@/lib/payment-domain";

export default function CheckoutScreen() {
  const params = useLocalSearchParams<{ category?: string; parcelId?: string; permitId?: string }>();
  const feeCategory = (params.category ?? "c_of_o_application") as FeeCategory;
  const feeItem = NIGERIA_FEE_SCHEDULE.find((f) => f.category === feeCategory) ?? NIGERIA_FEE_SCHEDULE[0];

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<PaymentRecord | null>(null);

  const methods: { key: PaymentMethod; label: string; description: string }[] = [
    { key: "card", label: "Debit/Credit Card", description: "Visa, Mastercard, Verve" },
    { key: "bank_transfer", label: "Bank Transfer", description: "Direct bank transfer with reference" },
    { key: "ussd", label: "USSD", description: "Pay via USSD code from any phone" },
    { key: "mobile_money", label: "Mobile Money", description: "MTN MoMo, Airtel Money" },
  ];

  function initiatePayment() {
    if (!selectedMethod) { Alert.alert("Select a payment method"); return; }
    setProcessing(true);

    // This creates a PENDING record. No real money moves.
    // A real implementation would call Paystack/Flutterwave initialize endpoint here.
    const record: PaymentRecord = {
      id: `pay-${Date.now()}`,
      referenceNumber: generatePaymentReference(),
      amount: feeItem.baseAmount,
      currency: "NGN",
      feeCategory,
      description: feeItem.label,
      status: "pending_gateway",
      method: selectedMethod,
      parcelId: params.parcelId ?? null,
      permitId: params.permitId ?? null,
      applicantId: "current-user",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      gatewayReference: null,
      gatewayProvider: null,
      receiptUrl: null,
      gatewayVerified: false,
      verificationNote: "Payment gateway not configured. This record is pending real gateway integration (Paystack or Flutterwave).",
    };

    setTimeout(() => {
      setResult(record);
      setProcessing(false);
    }, 800);
  }

  if (result) {
    return (
      <ScreenContainer className="p-6">
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          <View className="flex-1 gap-6">
            <View className="items-center gap-3">
              <Text className="text-5xl">⏳</Text>
              <Text className="text-xl font-bold text-foreground">Payment Pending</Text>
              <Text className="text-sm text-muted text-center">This payment record has been created but cannot be processed until a payment gateway is configured.</Text>
            </View>

            <View className="rounded-2xl border border-warning bg-warning/5 p-4">
              <Text className="text-xs font-bold text-warning">⚠ GATEWAY NOT CONNECTED</Text>
              <Text className="mt-2 text-xs text-muted">{result.verificationNote}</Text>
            </View>

            <View className="rounded-2xl border border-border bg-surface p-4 gap-2">
              <Text className="text-sm font-semibold text-foreground">Payment Details</Text>
              <Text className="text-xs text-muted">Reference: {result.referenceNumber}</Text>
              <Text className="text-xs text-muted">Amount: {formatNaira(result.amount)}</Text>
              <Text className="text-xs text-muted">Fee: {result.description}</Text>
              <Text className="text-xs text-muted">Method: {result.method}</Text>
              <Text className="text-xs text-muted">Status: {result.status}</Text>
              <Text className="text-xs text-muted">Gateway verified: {result.gatewayVerified ? "Yes" : "No"}</Text>
            </View>

            <Pressable onPress={() => router.push("/payment-history" as any)} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
              <View className="rounded-xl bg-foreground px-4 py-4">
                <Text className="text-center font-semibold text-background">View Payment History</Text>
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

  return (
    <ScreenContainer className="p-6">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="flex-1 gap-6">
          <View className="gap-1">
            <Text className="text-2xl font-bold text-foreground">Secure Checkout</Text>
            <Text className="text-sm text-muted">Nigeria Land Administration — Fee Payment</Text>
          </View>

          <View className="rounded-2xl border border-warning bg-warning/5 p-4">
            <Text className="text-xs font-bold text-warning">⚠ PAYMENT GATEWAY NOT CONFIGURED</Text>
            <Text className="mt-2 text-xs text-muted">No real payment will be processed. This screen demonstrates the checkout experience. A Paystack or Flutterwave integration is required for live transactions.</Text>
          </View>

          <View className="rounded-2xl border border-border bg-surface p-4 gap-2">
            <Text className="text-lg font-bold text-foreground">{feeItem.label}</Text>
            <Text className="text-sm text-muted">{feeItem.description}</Text>
            <Text className="text-2xl font-bold text-primary mt-2">{formatNaira(feeItem.baseAmount)}</Text>
            <Text className="text-xs text-muted">Required for: {feeItem.requiredFor}</Text>
          </View>

          <View className="gap-3">
            <Text className="text-sm font-semibold text-foreground">Select Payment Method</Text>
            {methods.map((m) => (
              <Pressable key={m.key} onPress={() => setSelectedMethod(m.key)} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
                <View className={`rounded-xl border p-4 ${selectedMethod === m.key ? "border-primary bg-primary/5" : "border-border bg-background"}`}>
                  <Text className="text-sm font-semibold text-foreground">{m.label}</Text>
                  <Text className="text-xs text-muted">{m.description}</Text>
                </View>
              </Pressable>
            ))}
          </View>

          <Pressable onPress={initiatePayment} disabled={processing || !selectedMethod} style={({ pressed }) => [{ opacity: pressed || processing || !selectedMethod ? 0.5 : 1 }]}>
            <View className="rounded-xl bg-foreground px-4 py-4">
              <Text className="text-center font-semibold text-background">{processing ? "Processing…" : `Pay ${formatNaira(feeItem.baseAmount)}`}</Text>
            </View>
          </Pressable>

          <Text className="text-[10px] text-muted text-center">By proceeding you acknowledge that no real payment gateway is connected. This is a demonstration of the intended checkout flow.</Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
