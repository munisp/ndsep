import { Link } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

export default function RecoveryApprovalScreen() {
  const identity = trpc.system.identitySecurity.useQuery(undefined, { retry: false });
  const recovery = trpc.recovery.status.useQuery(undefined, { retry: false });
  const hasPasskeyProof = identity.data?.activeSessions.some((session) => session.passkeyStatus === "verified_in_this_session") ?? false;
  const checking = identity.isLoading || recovery.isLoading;
  const controller = recovery.data;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Link href="/security-identity" asChild><Pressable><Text className="text-sm font-semibold text-primary">‹ Session security</Text></Pressable></Link>
        <View className="rounded-[28px] bg-surface p-5">
          <Text className="text-sm font-semibold text-primary">High-assurance control</Text>
          <Text className="mt-2 text-3xl font-bold text-foreground">Dual-approval recovery</Text>
          <Text className="mt-3 text-sm leading-6 text-muted">Recovery can never be completed from this client alone. It requires a server-side recovery controller, a KMS rewrap, device binding, two distinct authorized roles, and fresh WebAuthn proof for each approver.</Text>
        </View>

        <View className={`rounded-3xl border p-5 ${controller?.configurationComplete ? "border-primary bg-primary/5" : "border-warning bg-warning/10"}`}>
          <View className="flex-row items-center gap-3"><View className={`h-9 w-9 items-center justify-center rounded-full ${checking ? "bg-primary/10" : controller?.configurationComplete ? "bg-primary/10" : "bg-warning/15"}`}>{checking ? <ActivityIndicator size="small" color="#0A7EA4" /> : <Text className={`text-base font-bold ${controller?.configurationComplete ? "text-primary" : "text-warning"}`}>{controller?.configurationComplete ? "i" : "!"}</Text>}</View><View className="flex-1"><Text className={`text-lg font-semibold ${controller?.configurationComplete ? "text-primary" : "text-warning"}`}>{checking ? "Checking recovery safeguards" : controller?.configurationComplete ? "Configuration complete; live verification pending" : "Recovery execution is unavailable"}</Text><Text className="mt-1 text-sm leading-5 text-muted">{checking ? "Verifying the session, WebAuthn, KMS, and replay-worker boundaries…" : controller?.configurationComplete ? "Configuration is present, but KMS identity and the replay worker have not been live-verified. No recovery action is offered from this page." : controller?.reason ?? "No recovery controller state is available."}</Text></View></View>
          {!checking && !controller?.configurationComplete ? <Pressable disabled={recovery.isFetching} onPress={() => recovery.refetch()} style={({ pressed }) => [{ opacity: recovery.isFetching ? 0.5 : pressed ? 0.75 : 1 }]}><Text className="mt-4 text-sm font-semibold text-primary">{recovery.isFetching ? "Refreshing safeguards…" : "Check configuration again"}</Text></Pressable> : null}
          {recovery.isError ? <Text className="mt-3 text-xs leading-5 text-error">Recovery status could not be loaded: {recovery.error.message}. No request, approval, KMS rewrap, or replay action is available until the server can confirm its safeguards.</Text> : null}
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Required authorization chain</Text>
          <View className="mt-4 gap-3">
            <Requirement number="1" title="Device-bound request" detail="The controller binds the queue item, payload hash, idempotency key, and device fingerprint before a rewrap can begin." status={controller?.configurationComplete ? "Configuration complete; execution unverified" : controller?.kms.available ? "Blocked by another safeguard" : "KMS rewrap unavailable"} tone={controller?.configurationComplete || controller?.kms.available ? "muted" : "warning"} />
            <Requirement number="2" title="Security engineer approval" detail="A distinct security engineer must produce a fresh, user-verified WebAuthn assertion tied to the exact request digest." status={controller?.webauthn.available ? "Awaiting a signed request" : "WebAuthn verifier unavailable"} tone={controller?.webauthn.available ? "muted" : "warning"} />
            <Requirement number="3" title="Planning supervisor approval" detail="A different planning supervisor must add a second fresh WebAuthn assertion; duplicate subjects and roles are rejected server-side." status={controller?.webauthn.available ? "Awaiting first approval" : "WebAuthn verifier unavailable"} tone={controller?.webauthn.available ? "muted" : "warning"} />
            <Requirement number="4" title="Single controlled replay" detail="Only the allowlisted server replay worker may receive a re-encrypted envelope after the verified quorum is durable." status={controller?.replay.available ? "Worker boundary ready" : "Replay worker unavailable"} tone={controller?.replay.available ? "muted" : "warning"} />
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Current identity evidence</Text>
          <Text className="mt-2 text-sm leading-6 text-muted">{identity.isLoading ? "Checking signed session claims…" : hasPasskeyProof ? "A current session reports verified passkey authentication. This is necessary but does not authorize recovery; a fresh controller challenge is still required." : "No current session reports verified passkey authentication. Enrollment and a passkey claim may be required before a future recovery approval."}</Text>
        {identity.isError ? <Text className="mt-3 text-xs leading-5 text-error">Session evidence is unavailable: {identity.error.message}</Text> : null}
        </View>

        <Link href={"/passkey-enrollment" as never} asChild>
          <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.82 : 1 }]}>
            <View className="rounded-3xl border border-primary bg-primary/5 p-5">
              <Text className="text-lg font-semibold text-primary">Enroll a recovery passkey</Text>
              <Text className="mt-2 text-sm leading-5 text-muted">Register a platform-bound passkey that can sign recovery approval challenges. Each passkey requires user verification (biometric or PIN).</Text>
            </View>
          </Pressable>
        </Link>

        <Link href={"/passkey-approve" as never} asChild>
          <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.82 : 1 }]}>
            <View className="rounded-3xl border border-foreground/20 bg-surface p-5">
              <Text className="text-lg font-semibold text-foreground">Sign a recovery approval</Text>
              <Text className="mt-2 text-sm leading-5 text-muted">Enter a recovery authorization ID and use your enrolled passkey to sign an approval. Two distinct approvers are required.</Text>
            </View>
          </Pressable>
        </Link>
      </ScrollView>
    </ScreenContainer>
  );
}

function Requirement({ number, title, detail, status, tone }: { number: string; title: string; detail: string; status: string; tone: "warning" | "muted" }) {
  const badgeClass = tone === "warning" ? "bg-warning/15 text-warning" : "bg-background text-muted";
  return (
    <View className="flex-row gap-3 rounded-2xl border border-border bg-background p-4">
      <View className="h-7 w-7 items-center justify-center rounded-full bg-primary/10"><Text className="text-xs font-bold text-primary">{number}</Text></View>
      <View className="flex-1"><Text className="text-sm font-semibold text-foreground">{title}</Text><Text className="mt-1 text-xs leading-5 text-muted">{detail}</Text><View className={`mt-2 self-start rounded-full px-2 py-1 ${badgeClass}`}><Text className="text-[11px] font-semibold">{status}</Text></View></View>
    </View>
  );
}
