import { useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { Link } from "expo-router";
import { Platform } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

export default function PasskeyEnrollmentScreen() {
  const utils = trpc.useUtils();
  const credentials = trpc.recovery.credentials.useQuery(undefined, { retry: false });
  const enrollChallenge = trpc.recovery.enrollmentChallenge.useMutation();
  const completeEnrollment = trpc.recovery.completeEnrollment.useMutation({
    onSuccess: () => { utils.recovery.credentials.invalidate(); setFeedback("Passkey enrolled successfully. It can now be used for recovery approvals."); },
    onError: (error) => setFeedback(`Enrollment failed: ${error.message}`),
  });
  const revokeCredential = trpc.recovery.revokeCredential.useMutation({
    onSuccess: () => { utils.recovery.credentials.invalidate(); setFeedback("Passkey revoked."); },
    onError: (error) => setFeedback(`Revocation failed: ${error.message}`),
  });

  const [feedback, setFeedback] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  const startEnrollment = async () => {
    setFeedback(null);
    setEnrolling(true);
    try {
      const { options } = await enrollChallenge.mutateAsync();
      if (Platform.OS === "web") {
        const { startRegistration } = await import("@simplewebauthn/browser");
        const response = await startRegistration({ optionsJSON: options });
        await completeEnrollment.mutateAsync({ response: { ...response, clientExtensionResults: response.clientExtensionResults as Record<string, unknown>, response: { ...response.response, transports: response.response.transports as string[] | undefined } }, expectedChallenge: options.challenge });
      } else {
        setFeedback("Native passkey enrollment requires Expo Go or a development build with WebAuthn support. Use the PWA or a native build to complete enrollment.");
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Enrollment was cancelled or failed.");
    } finally {
      setEnrolling(false);
    }
  };

  const confirmRevoke = (credentialId: string) => {
    Alert.alert("Revoke passkey?", "This passkey will no longer be accepted for recovery approvals. This action cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: () => revokeCredential.mutate({ credentialId }) },
    ]);
  };

  const loading = credentials.isLoading || enrolling;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
        <Link href={"/recovery-approval" as never} asChild><Pressable><Text className="text-sm font-semibold text-primary">‹ Recovery status</Text></Pressable></Link>

        <View className="rounded-[28px] bg-surface p-5">
          <Text className="text-sm font-semibold text-primary">Recovery credential management</Text>
          <Text className="mt-2 text-3xl font-bold text-foreground">Passkey enrollment</Text>
          <Text className="mt-3 text-sm leading-6 text-muted">Enroll a platform-bound passkey that can sign recovery approval challenges. Each passkey is tied to your identity and requires user verification (biometric or PIN) for every approval.</Text>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Enrolled passkeys</Text>
          {credentials.isLoading ? (
            <View className="mt-4 items-center py-6"><ActivityIndicator size="small" color="#0A7EA4" /><Text className="mt-2 text-sm text-muted">Loading enrolled credentials…</Text></View>
          ) : credentials.isError ? (
            <View className="mt-4 rounded-2xl border border-error bg-error/10 p-4">
              <Text className="text-sm text-error">Could not load credentials: {credentials.error.message}</Text>
              <Pressable onPress={() => credentials.refetch()} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}><Text className="mt-2 text-sm font-semibold text-primary">Retry</Text></Pressable>
            </View>
          ) : credentials.data && credentials.data.length > 0 ? (
            <FlatList
              scrollEnabled={false}
              data={credentials.data}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ gap: 8, marginTop: 12 }}
              renderItem={({ item }) => (
                <View className="flex-row items-center justify-between rounded-2xl border border-border bg-background p-4">
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">Passkey …{item.credentialIdHash}</Text>
                    <Text className="mt-1 text-xs text-muted">Sign count: {item.signCount} · Enrolled: {new Date(item.createdAt).toLocaleDateString()}</Text>
                  </View>
                  <Pressable disabled={revokeCredential.isPending} onPress={() => confirmRevoke(item.id)} style={({ pressed }) => [{ opacity: revokeCredential.isPending ? 0.4 : pressed ? 0.7 : 1 }]}>
                    <View className="rounded-xl border border-error bg-error/10 px-3 py-2"><Text className="text-xs font-semibold text-error">Revoke</Text></View>
                  </Pressable>
                </View>
              )}
            />
          ) : (
            <View className="mt-4 items-center rounded-2xl border border-border bg-background py-8">
              <Text className="text-base font-semibold text-muted">No passkeys enrolled</Text>
              <Text className="mt-2 text-sm text-muted">Enroll a passkey below to enable recovery approvals.</Text>
            </View>
          )}
        </View>

        <Pressable disabled={loading} onPress={startEnrollment} style={({ pressed }) => [{ opacity: loading ? 0.5 : pressed ? 0.82 : 1 }]}>
          <View className="rounded-2xl bg-primary px-4 py-4">
            {loading ? (
              <View className="flex-row items-center justify-center gap-3"><ActivityIndicator size="small" color="#FFFFFF" /><Text className="font-semibold text-background">Enrolling passkey…</Text></View>
            ) : (
              <Text className="text-center font-semibold text-background">Enroll new passkey</Text>
            )}
          </View>
        </Pressable>

        {feedback ? (
          <View className={`rounded-2xl border p-4 ${feedback.startsWith("Passkey enrolled") || feedback.startsWith("Passkey revoked") ? "border-success bg-success/10" : "border-warning bg-warning/10"}`}>
            <Text className={`text-sm leading-5 ${feedback.startsWith("Passkey enrolled") || feedback.startsWith("Passkey revoked") ? "text-success" : "text-foreground"}`}>{feedback}</Text>
          </View>
        ) : null}

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-sm font-semibold text-foreground">Security notes</Text>
          <Text className="mt-2 text-xs leading-5 text-muted">Each passkey is bound to your authenticated subject and the configured relying party. The server stores only the public key and monotonic counter; the private key never leaves the authenticator. Revoking a passkey is immediate and permanent.</Text>
          <Text className="mt-2 text-xs leading-5 text-muted">Recovery approvals require a fresh user-verified assertion from an enrolled passkey. A revoked passkey cannot be used for any future approval.</Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
