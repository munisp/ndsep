import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

function nairaToKobo(value: string) {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
}

export default function OfflinePaymentScreen() {
  const [reference, setReference] = useState("");
  const [amountNaira, setAmountNaira] = useState("");
  const [service, setService] = useState("Certificate of Occupancy statutory fee");
  const [jurisdiction, setJurisdiction] = useState<"lagos" | "fct" | "kano">("lagos");
  const [evidenceDescription, setEvidenceDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const submitPayment = trpc.paymentOperations.submitOfflinePayment.useMutation({
    onSuccess: async (payment) => {
      await Promise.all([utils.paymentOperations.myAlerts.invalidate(), utils.paymentOperations.pendingSummary.invalidate(), utils.paymentOperations.listPending.invalidate()]);
      setMessage(`Declaration ${payment.reference} was submitted for administrator review. It is not an approved payment or bank-settlement confirmation.`);
      setReference("");
      setAmountNaira("");
      setEvidenceDescription("");
    },
    onError: (error) => setMessage(error.message || "The payment declaration could not be submitted."),
  });

  function submit() {
    const amountKobo = nairaToKobo(amountNaira);
    if (!amountKobo || reference.trim().length < 3 || service.trim().length < 3 || evidenceDescription.trim().length < 3) {
      setMessage("Enter the transfer or cash-deposit reference, a positive NGN amount, the fee service, and concise evidence details.");
      return;
    }
    submitPayment.mutate({ jurisdiction, reference: reference.trim(), amountKobo, service: service.trim(), evidenceDescription: evidenceDescription.trim() });
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View className="rounded-[28px] bg-surface p-5"><Text className="text-sm text-muted">Payment declaration</Text><Text className="mt-2 text-3xl font-bold text-foreground">Declare an offline payment</Text><Text className="mt-2 text-sm leading-5 text-muted">Use this only for an existing cash deposit or bank transfer. The declaration is held for authorised administrator review. It never confirms bank settlement, gateway capture, or issuance of a title.</Text></View>
        <View className="rounded-3xl border border-warning bg-warning/5 p-5"><Text className="font-semibold text-warning">Review required</Text><Text className="mt-2 text-sm leading-5 text-muted">Do not submit the same banking reference twice. A duplicate is rejected and every submission is recorded in the payment audit trail.</Text></View>
        <View className="rounded-3xl border border-border bg-surface p-5"><Text className="text-lg font-semibold text-foreground">Transfer or deposit details</Text><Text className="mt-3 text-xs text-muted">Governing land-administration jurisdiction</Text><View className="mt-2 flex-row gap-2">{(["lagos", "fct", "kano"] as const).map((state) => <Pressable key={state} onPress={() => setJurisdiction(state)} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.75 : 1 }]}><View className={`rounded-xl border px-2 py-3 ${jurisdiction === state ? "border-primary bg-primary/10" : "border-border bg-background"}`}><Text className={`text-center text-xs font-semibold ${jurisdiction === state ? "text-primary" : "text-muted"}`}>{state.toUpperCase()}</Text></View></Pressable>)}</View><TextInput value={reference} onChangeText={setReference} autoCapitalize="characters" placeholder="Bank transfer or cash-deposit reference" placeholderTextColor="#94A3B8" className="mt-4 rounded-xl border border-border bg-background px-3 py-3 text-foreground" /><TextInput value={amountNaira} onChangeText={setAmountNaira} keyboardType="decimal-pad" placeholder="Amount paid (NGN)" placeholderTextColor="#94A3B8" className="mt-3 rounded-xl border border-border bg-background px-3 py-3 text-foreground" /><TextInput value={service} onChangeText={setService} placeholder="Fee service" placeholderTextColor="#94A3B8" className="mt-3 rounded-xl border border-border bg-background px-3 py-3 text-foreground" /><TextInput value={evidenceDescription} onChangeText={setEvidenceDescription} placeholder="Evidence details, bank, date, or deposit context" placeholderTextColor="#94A3B8" multiline className="mt-3 min-h-[108px] rounded-xl border border-border bg-background px-3 py-3 text-foreground" /><Pressable onPress={submit} disabled={submitPayment.isPending} style={({ pressed }) => [{ opacity: pressed || submitPayment.isPending ? 0.75 : 1 }]}><View className="mt-4 rounded-2xl bg-primary px-4 py-4"><Text className="text-center font-semibold text-white">{submitPayment.isPending ? "Submitting declaration…" : "Submit for administrator review"}</Text></View></Pressable></View>
        {message ? <View className={`rounded-2xl border p-4 ${submitPayment.isError ? "border-error bg-error/5" : "border-primary bg-primary/5"}`}><Text className="text-sm leading-5 text-foreground">{message}</Text></View> : null}
        <Link href={"/payment-notifications" as never} asChild><View className="rounded-2xl border border-border bg-surface px-4 py-4"><Text className="text-center font-semibold text-primary">Open payment alerts</Text></View></Link>
      </ScrollView>
    </ScreenContainer>
  );
}
