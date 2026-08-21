import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import { Platform } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

type ApprovalRole = "security_engineer" | "planning_supervisor";

export default function PasskeyApproveScreen() {
  const utils = trpc.useUtils();
  const recovery = trpc.recovery.status.useQuery(undefined, { retry: false });
  const credentials = trpc.recovery.credentials.useQuery(undefined, { retry: false });
  const approve = trpc.recovery.approve.useMutation({
    onSuccess: (data) => {
      setFeedback(`Approval recorded. Authorization status: ${data?.status ?? "unknown"}.`);
      utils.recovery.authorization.invalidate();
    },
    onError: (error) => setFeedback(`Approval failed: ${error.message}`),
  });

  const [authorizationId, setAuthorizationId] = useState("");
  const [selectedRole, setSelectedRole] = useState<ApprovalRole>("security_engineer");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const authQuery = trpc.recovery.authorization.useQuery(
    { authorizationId: authorizationId.trim() },
    { enabled: /^[0-9a-f-]{36}$/i.test(authorizationId.trim()), retry: false },
  );

  const authorization = authQuery.data;
  const hasCredentials = (credentials.data?.length ?? 0) > 0;
  const canApprove = authorization?.status === "pending" && hasCredentials && recovery.data?.webauthn.available;

  const performApproval = async () => {
    if (!authorization || !canApprove) return;
    setFeedback(null);
    setSigning(true);
    try {
      if (Platform.OS === "web") {
        const { startAuthentication } = await import("@simplewebauthn/browser");
        const assertionOptions = {
          challenge: authorization.idempotencyKey,
          rpId: recovery.data?.webauthn.rpId ?? undefined,
          userVerification: "required" as const,
          timeout: 60_000,
        };
        const assertion = await startAuthentication({ optionsJSON: assertionOptions as never });
        await approve.mutateAsync({ authorizationId: authorization.id, approvalRole: selectedRole, assertion: { ...assertion, clientExtensionResults: assertion.clientExtensionResults as Record<string, unknown> } });
      } else {
        setFeedback("Native passkey assertion requires a development build with WebAuthn support. Use the PWA or a native build to complete approval.");
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Approval was cancelled or failed.");
    } finally {
      setSigning(false);
    }
  };

  const confirmApproval = () => {
    Alert.alert(
      "Sign recovery approval?",
      `You are about to sign a recovery approval as ${selectedRole.replace("_", " ")} for authorization ${authorizationId.slice(0, 8)}…. This requires biometric or PIN verification.`,
      [{ text: "Cancel", style: "cancel" }, { text: "Sign", onPress: performApproval }],
    );
  };

  const loading = signing || approve.isPending;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
        <Link href={"/recovery-approval" as never} asChild><Pressable><Text className="text-sm font-semibold text-primary">‹ Recovery status</Text></Pressable></Link>

        <View className="rounded-[28px] bg-surface p-5">
          <Text className="text-sm font-semibold text-primary">Recovery approval</Text>
          <Text className="mt-2 text-3xl font-bold text-foreground">Sign with passkey</Text>
          <Text className="mt-3 text-sm leading-6 text-muted">Enter a recovery authorization ID and sign an approval using your enrolled passkey. Two distinct approvers with different roles are required to authorize a recovery.</Text>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-sm font-semibold text-foreground">Authorization ID</Text>
          <TextInput
            value={authorizationId}
            onChangeText={setAuthorizationId}
            placeholder="Enter recovery authorization UUID"
            placeholderTextColor="#687076"
            autoCapitalize="none"
            autoCorrect={false}
            className="mt-3 rounded-xl border border-border px-3 py-3 text-sm text-foreground"
          />
          {authQuery.isLoading ? (
            <View className="mt-3 flex-row items-center gap-2"><ActivityIndicator size="small" color="#0A7EA4" /><Text className="text-sm text-muted">Loading authorization…</Text></View>
          ) : authQuery.isError ? (
            <Text className="mt-3 text-sm text-error">Could not load authorization: {authQuery.error.message}</Text>
          ) : authorization ? (
            <View className="mt-3 rounded-2xl border border-border bg-background p-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-foreground">Status</Text>
                <View className={`rounded-full px-3 py-1 ${authorization.status === "pending" ? "bg-warning/15" : authorization.status === "authorized" ? "bg-success/15" : authorization.status === "consumed" ? "bg-primary/10" : "bg-error/10"}`}>
                  <Text className={`text-xs font-bold ${authorization.status === "pending" ? "text-warning" : authorization.status === "authorized" ? "text-success" : authorization.status === "consumed" ? "text-primary" : "text-error"}`}>{authorization.status}</Text>
                </View>
              </View>
              <Text className="mt-2 text-xs text-muted">Queue: {authorization.queueId}</Text>
              <Text className="mt-1 text-xs text-muted">Payload: {authorization.payloadHash.slice(0, 16)}…</Text>
              <Text className="mt-1 text-xs text-muted">Expires: {new Date(authorization.expiresAt).toLocaleString()}</Text>
            </View>
          ) : null}
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-sm font-semibold text-foreground">Your approval role</Text>
          <Text className="mt-2 text-xs text-muted">Select the role you are approving as. Both roles must be filled by different subjects.</Text>
          <View className="mt-3 flex-row gap-3">
            {(["security_engineer", "planning_supervisor"] as const).map((role) => (
              <Pressable key={role} onPress={() => setSelectedRole(role)} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.8 : 1 }]}>
                <View className={`rounded-2xl border px-4 py-3 ${selectedRole === role ? "border-primary bg-primary/10" : "border-border bg-background"}`}>
                  <Text className={`text-center text-sm font-semibold ${selectedRole === role ? "text-primary" : "text-foreground"}`}>{role.replace("_", " ")}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-sm font-semibold text-foreground">Enrolled passkeys</Text>
          {credentials.isLoading ? (
            <View className="mt-3 flex-row items-center gap-2"><ActivityIndicator size="small" color="#0A7EA4" /><Text className="text-sm text-muted">Loading…</Text></View>
          ) : !hasCredentials ? (
            <View className="mt-3 rounded-2xl border border-warning bg-warning/10 p-4">
              <Text className="text-sm text-warning">No enrolled passkeys. You must enroll a passkey before approving.</Text>
              <Link href={"/passkey-enrollment" as never} asChild><Pressable><Text className="mt-2 text-sm font-semibold text-primary">Go to enrollment</Text></Pressable></Link>
            </View>
          ) : (
            <Text className="mt-3 text-sm text-muted">{credentials.data!.length} passkey(s) available for signing.</Text>
          )}
        </View>

        <Pressable disabled={!canApprove || loading} onPress={confirmApproval} style={({ pressed }) => [{ opacity: !canApprove || loading ? 0.45 : pressed ? 0.82 : 1 }]}>
          <View className="rounded-2xl bg-primary px-4 py-4">
            {loading ? (
              <View className="flex-row items-center justify-center gap-3"><ActivityIndicator size="small" color="#FFFFFF" /><Text className="font-semibold text-background">Signing approval…</Text></View>
            ) : (
              <Text className="text-center font-semibold text-background">Sign recovery approval</Text>
            )}
          </View>
        </Pressable>

        {!canApprove && !loading && authorization ? (
          <View className="rounded-2xl border border-warning bg-warning/10 p-4">
            <Text className="text-sm leading-5 text-warning">
              {authorization.status !== "pending" ? `This authorization is ${authorization.status} and cannot accept new approvals.` : !hasCredentials ? "Enroll a passkey first to sign approvals." : !recovery.data?.webauthn.available ? "WebAuthn verification is not configured on the server." : "Approval is not available."}
            </Text>
          </View>
        ) : null}

        {feedback ? (
          <View className={`rounded-2xl border p-4 ${feedback.startsWith("Approval recorded") ? "border-success bg-success/10" : "border-warning bg-warning/10"}`}>
            <Text className={`text-sm leading-5 ${feedback.startsWith("Approval recorded") ? "text-success" : "text-foreground"}`}>{feedback}</Text>
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
