import { Link } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

export default function RecoveryApprovalScreen() {
  const identity = trpc.system.identitySecurity.useQuery(undefined, { retry: false });
  const hasPasskeyProof = identity.data?.activeSessions.some((session) => session.passkeyStatus === "verified_in_this_session") ?? false;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Link href="/security-identity" asChild><Pressable><Text className="text-sm font-semibold text-primary">‹ Session security</Text></Pressable></Link>
        <View className="rounded-[28px] bg-surface p-5">
          <Text className="text-sm font-semibold text-primary">High-assurance control</Text>
          <Text className="mt-2 text-3xl font-bold text-foreground">Dual-approval recovery</Text>
          <Text className="mt-3 text-sm leading-6 text-muted">Recovery can never be completed from this client alone. It requires a server-side recovery controller, a KMS rewrap, device binding, two distinct authorized roles, and fresh WebAuthn proof for each approver.</Text>
        </View>

        <View className="rounded-3xl border border-warning bg-warning/10 p-5">
          <Text className="text-lg font-semibold text-warning">Recovery execution is not configured</Text>
          <Text className="mt-2 text-sm leading-6 text-muted">No server recovery controller is connected in this environment, so no request can be created, approved, rewrapped, or replayed here. This page intentionally exposes no bypass, local simulation, or offline approval action.</Text>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Required authorization chain</Text>
          <View className="mt-4 gap-3">
            <Requirement number="1" title="Device-bound request" detail="The controller must bind a request to its original device and idempotency key before KMS rewrap." status="Unavailable without recovery controller" tone="warning" />
            <Requirement number="2" title="Security engineer approval" detail="A distinct security engineer must produce fresh WebAuthn proof." status="Not requested" tone="muted" />
            <Requirement number="3" title="Planning supervisor approval" detail="A different planning supervisor must provide a second fresh WebAuthn proof." status="Not requested" tone="muted" />
            <Requirement number="4" title="Single controlled replay" detail="Only an authorized server worker may perform an idempotent replay after the quorum is verified." status="Blocked by design" tone="warning" />
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Current identity evidence</Text>
          <Text className="mt-2 text-sm leading-6 text-muted">{identity.isLoading ? "Checking signed session claims…" : hasPasskeyProof ? "A current session reports verified passkey authentication. This is necessary but does not authorize recovery." : "No current session reports verified passkey authentication. Enrollment or an identity-provider claim may be required before a future recovery approval."}</Text>
          {identity.isError ? <Text className="mt-3 text-xs leading-5 text-error">Session evidence is unavailable: {identity.error.message}</Text> : null}
        </View>
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
