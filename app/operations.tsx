import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

function Metric({ label, value, detail, tone = "primary" }: { label: string; value: string; detail: string; tone?: "primary" | "warning" | "error" | "success" }) {
  const color = tone === "error" ? "text-error" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-primary";
  return <View className="min-w-[155px] flex-1 rounded-2xl border border-border bg-background p-4"><Text className="text-xs uppercase tracking-wide text-muted">{label}</Text><Text className={`mt-2 text-2xl font-bold ${color}`}>{value}</Text><Text className="mt-2 text-xs leading-4 text-muted">{detail}</Text></View>;
}

export default function OperationsScreen() {
  const fieldEvidence = trpc.fieldEvidence.list.useQuery();
  const providerHealth = trpc.trust.providerHealth.useQuery();
  const integrationStatus = trpc.integrationSettings.status.useQuery();
  const digests = trpc.permitting.listSupervisorDigests.useQuery();
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const reviewMutation = trpc.fieldEvidence.review.useMutation({
    onSuccess: async (result) => {
      await fieldEvidence.refetch();
      setReviewMessage(result.status === "reviewed" ? `Manifest ${result.evidence.id} was ${result.evidence.verificationState}.` : "This manifest was already reviewed.");
    },
    onError: (error) => setReviewMessage(error.message || "Review requires a configured administrator session."),
  });
  const evidence = fieldEvidence.data ?? [];
  const providers = providerHealth.data ?? [];
  const unavailableProviders = providers.filter((provider) => provider.state !== "ready").length;
  const configuredSettings = integrationStatus.data?.fields.filter((field) => field.configured).length ?? 0;
  const unverifiedEvidence = evidence.filter((item) => item.verificationState === "unverified").length;
  function submitReview(id: string, decision: "approved" | "rejected") {
    const reason = reviewNotes[id]?.trim() ?? "";
    if (reason.length < 3) {
      setReviewMessage("Enter a concise review reason before approving or rejecting a manifest.");
      return;
    }
    reviewMutation.mutate({ id, decision, reason });
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View className="rounded-[28px] bg-surface p-5"><Text className="text-sm text-muted">Administrator operations</Text><Text className="mt-2 text-3xl font-bold text-foreground">Control center</Text><Text className="mt-2 text-sm leading-5 text-muted">A transparent operational view of local evidence, workflow pressure, and external-service posture. “Unavailable” means no provider result is being used.</Text></View>

        <View className="flex-row flex-wrap gap-3">
          <Metric label="Unverified field evidence" value={String(unverifiedEvidence)} detail="Offline and online manifests still require authorised review." tone={unverifiedEvidence > 0 ? "warning" : "success"} />
          <Metric label="Provider services unavailable" value={String(unavailableProviders)} detail="Unavailable integrations fail closed and cannot issue verification outcomes." tone={unavailableProviders > 0 ? "warning" : "success"} />
          <Metric label="Configured secret fields" value={String(configuredSettings)} detail={integrationStatus.data?.secureStorageAvailable ? "Encrypted settings storage is ready." : "Secure settings storage is not configured."} tone={integrationStatus.data?.secureStorageAvailable ? "success" : "warning"} />
          <Metric label="Supervisor digests" value={String(digests.data?.length ?? 0)} detail="Current agency backlog digests available to operational supervisors." />
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5"><Text className="text-lg font-semibold text-foreground">Evidence review queue</Text><Text className="mt-2 text-sm text-muted">Every field observation is intentionally recorded as unverified. Reconciliation proves delivery only; it does not confirm a land, identity, or permit claim. Approve or reject controls require a configured administrator session.</Text>{reviewMessage ? <Text className="mt-3 text-xs leading-4 text-muted">{reviewMessage}</Text> : null}<View className="mt-4 gap-3">{evidence.slice(0, 5).map((item) => <View key={item.id} className={`rounded-2xl border p-4 ${item.verificationState === "unverified" ? "border-warning bg-warning/5" : item.verificationState === "approved" ? "border-success bg-success/5" : "border-error bg-error/5"}`}><Text className="text-sm font-semibold text-foreground">{item.observationType.replace(/_/g, " ")} · {item.verificationState}</Text><Text className="mt-1 text-xs text-muted">Mission {item.missionId} · Parcel {item.parcelId} · {item.attachments.length} attachment{item.attachments.length === 1 ? "" : "s"}</Text><Text className="mt-2 text-xs leading-4 text-muted">{item.notes}</Text>{item.verificationState === "unverified" ? <><TextInput value={reviewNotes[item.id] ?? ""} onChangeText={(value) => setReviewNotes((current) => ({ ...current, [item.id]: value }))} placeholder="Required administrator review reason" placeholderTextColor="#94A3B8" multiline className="mt-3 min-h-[72px] rounded-xl border border-border bg-background px-3 py-2 text-foreground" /><View className="mt-3 flex-row gap-3"><Pressable onPress={() => submitReview(item.id, "approved")} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.8 : 1 }]}><View className="rounded-xl bg-success px-3 py-3"><Text className="text-center font-semibold text-white">Approve</Text></View></Pressable><Pressable onPress={() => submitReview(item.id, "rejected")} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.8 : 1 }]}><View className="rounded-xl bg-error px-3 py-3"><Text className="text-center font-semibold text-white">Reject</Text></View></Pressable></View></> : <Text className="mt-3 text-xs text-muted">Reviewed by {item.reviewedBy ?? "administrator"} · {item.reviewReason ?? "No reason recorded"}</Text>}</View>)}{evidence.length === 0 ? <Text className="text-sm text-muted">No reconciled field evidence manifests are currently recorded.</Text> : null}</View></View>

        <View className="rounded-3xl border border-border bg-surface p-5"><Text className="text-lg font-semibold text-foreground">External verification posture</Text><View className="mt-4 gap-3">{providers.map((provider) => <View key={provider.provider} className="rounded-2xl border border-border bg-background p-4"><Text className="text-sm font-semibold text-foreground">{provider.provider.replace(/_/g, " ")}</Text><Text className={`mt-1 text-xs font-semibold ${provider.state === "ready" ? "text-success" : "text-warning"}`}>{provider.state === "ready" ? "Available" : "Unavailable"}</Text><Text className="mt-1 text-xs leading-4 text-muted">{provider.reason ?? "Configured provider; final outcomes still require authorized review."}</Text></View>)}</View></View>

        <Link href={"/audit-verify" as never} asChild><View className="rounded-2xl border border-border bg-background px-4 py-4"><Text className="text-center font-semibold text-foreground">Open audit package verification</Text></View></Link>
        <Link href={"/integration-settings" as never} asChild><View className="rounded-2xl border border-border bg-background px-4 py-4"><Text className="text-center font-semibold text-foreground">Open integration settings</Text></View></Link>
      </ScrollView>
    </ScreenContainer>
  );
}
