import { Link } from "expo-router";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useEffect, useState } from "react";

import { ScreenContainer } from "@/components/screen-container";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";
import { trpc } from "@/lib/trpc";
import { getStakeholderSyncPreferences, setStakeholderSyncPreferences } from "@/lib/stakeholder-sync-settings";

function ActionTile({ label, onPress, active = false }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.82 : 1 }]}> 
      <View className={`rounded-2xl border px-4 py-4 ${active ? "border-primary bg-primary/10" : "border-border bg-background"}`}>
        <Text className={`text-sm font-semibold ${active ? "text-primary" : "text-foreground"}`}>{label}</Text>
      </View>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { bundle, hasLiveConnection } = useMobilePlatformBundle();
  const [pauseOnCellular, setPauseOnCellular] = useState(false); const [wifiOnlyMutations, setWifiOnlyMutations] = useState(false);
  useEffect(() => { void getStakeholderSyncPreferences().then((preferences) => { setPauseOnCellular(preferences.pauseOnCellular); setWifiOnlyMutations(preferences.wifiOnlyAllQueuedMutations); }); }, []);
  const updateCellularPreference = async (value: boolean) => { setPauseOnCellular(value); try { await setStakeholderSyncPreferences({ pauseOnCellular: value }); } catch { setPauseOnCellular(!value); } };
  const updateWifiMutationPreference = async (value: boolean) => { setWifiOnlyMutations(value); try { await setStakeholderSyncPreferences({ wifiOnlyAllQueuedMutations: value, wifiOnlyDocumentUpload: value }); } catch { setWifiOnlyMutations(!value); } };
  const utils = trpc.useUtils();
  const platformQuery = trpc.permitting.getPlatform.useQuery();
  const paymentAlerts = trpc.paymentOperations.myAlerts.useQuery(undefined, { retry: false });
  const activeAgencyUserQuery = trpc.permitting.getActiveAgencyUser.useQuery();
  const setActiveAgencyUserMutation = trpc.permitting.setActiveAgencyUser.useMutation({
    onSuccess: async () => {
      await utils.permitting.getPlatform.invalidate();
      await utils.permitting.getActiveAgencyUser.invalidate();
    },
  });

  const registeredCount = bundle.legalWorkflows.filter((workflow) => workflow.status === "registered").length;
  const platform = platformQuery.data;
  const activeAgencyUser = activeAgencyUserQuery.data;
  const queueIds = new Set(activeAgencyUser?.queueIds ?? []);
  const visibleQueues = (platform?.approvalQueues ?? []).filter((queue) => queueIds.has(queue.id));
  const unreadPaymentAlerts = paymentAlerts.data?.filter((alert) => !alert.readAt).length ?? 0;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View className="rounded-[28px] bg-surface p-5">
          <Text className="text-sm text-muted">Operator profile</Text>
          <Text className="mt-2 text-3xl font-bold text-foreground">{activeAgencyUser?.displayName ?? "Registry Operations"}</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            Manage role-based approval queues, intake review context, and cross-agency permitting workflows from the same mobile and web shell.
          </Text>
          <Text className="mt-3 text-xs text-muted">Active role: {activeAgencyUser?.role.replace(/_/g, " ") ?? "Unavailable"}</Text>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Agency login context</Text>
          <Text className="mt-2 text-sm text-muted">Switch among seeded agency reviewer roles to inspect approval queues and sector-specific review work.</Text>
          <View className="mt-4 gap-3">
            {platform?.agencyUsers.map((user) => (
              <ActionTile
                key={user.id}
                label={`${user.displayName} · ${user.role.replace(/_/g, " ")}`}
                active={user.id === activeAgencyUser?.id}
                onPress={() => setActiveAgencyUserMutation.mutate({ userId: user.id })}
              />
            ))}
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Approval queues</Text>
          <Text className="mt-2 text-sm text-muted">These queues are filtered by the currently active agency role and stay aligned with multi-agency routing.</Text>
          <View className="mt-4 gap-3">
            {visibleQueues.map((queue) => (
              <View key={queue.id} className="rounded-2xl border border-border bg-background p-4">
                <View className="flex-row items-center justify-between gap-4">
                  <Text className="flex-1 text-base font-semibold text-foreground">{queue.title}</Text>
                  <Text className="text-sm font-semibold text-primary">{queue.pendingCount} pending</Text>
                </View>
                <Text className="mt-2 text-sm leading-5 text-muted">{queue.description}</Text>
                <Text className="mt-2 text-xs text-muted">Overdue: {queue.overdueCount} · Cases: {queue.caseIds.join(", ")}</Text>
              </View>
            ))}
          </View>
          <Link href={"/(tabs)/permits" as never} asChild>
            <View className="mt-4 rounded-2xl bg-foreground px-4 py-4">
              <Text className="text-center font-semibold text-background">Open permits dashboard</Text>
            </View>
          </Link>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Stakeholder onboarding</Text>
          <Text className="mt-2 text-sm text-muted">Focus stakeholder: {bundle.onboarding.stakeholder}</Text>
          <Text className="mt-2 text-sm text-muted">Next action: {bundle.onboarding.nextAction}</Text>

          <View className="mt-4 flex-row gap-3">
            <View className="flex-1 rounded-2xl border border-border bg-background p-4">
              <Text className="text-xs uppercase tracking-wide text-muted">Readiness</Text>
              <Text className="mt-2 text-2xl font-semibold text-foreground">{bundle.onboarding.readiness}%</Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-background p-4">
              <Text className="text-xs uppercase tracking-wide text-muted">Liveness</Text>
              <Text className="mt-2 text-base font-semibold text-foreground">{bundle.onboarding.livenessStatus}</Text>
            </View>
          </View>

          <View className="mt-4 gap-2">
            <Text className="text-sm text-muted">NIN: {bundle.onboarding.ninStatus}</Text>
            <Text className="text-sm text-muted">BVN: {bundle.onboarding.bvnStatus}</Text>
            <Text className="text-sm text-muted">KYB: {bundle.onboarding.kybStatus}</Text>
            <Text className="text-sm text-muted">Sync: {hasLiveConnection ? "Live API connected" : "Offline cache in use"}</Text>
          </View>

          <Link href={"/onboarding" as never} asChild>
            <View className="mt-4 rounded-2xl border border-border bg-background px-4 py-4">
              <Text className="text-center font-semibold text-foreground">Open onboarding workflow</Text>
            </View>
          </Link>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <View className="flex-row items-center justify-between gap-4"><View className="flex-1"><Text className="text-lg font-semibold text-foreground">Offline synchronization</Text><Text className="mt-2 text-sm leading-5 text-muted">Pause automatic encrypted stakeholder replay while using cellular data. Manual retry remains available from the queue.</Text></View><Switch value={pauseOnCellular} onValueChange={updateCellularPreference} /></View>
          <Text className="mt-3 text-xs text-muted">{pauseOnCellular ? "Automatic replay waits for Wi-Fi or another non-cellular connection." : "Automatic replay may use cellular data when internet access is available."}</Text>
          <View className="mt-4 border-t border-border pt-4"><View className="flex-row items-center justify-between gap-4"><View className="flex-1"><Text className="text-sm font-semibold text-foreground">Wi-Fi-only queued mutations</Text><Text className="mt-1 text-xs leading-4 text-muted">Queue stakeholder profiles and documents until Wi-Fi is available instead of sending any queued mutation over cellular data.</Text></View><Switch value={wifiOnlyMutations} onValueChange={updateWifiMutationPreference} /></View></View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-lg font-semibold text-foreground">Payment Alerts</Text>
              <Text className="mt-2 text-sm leading-5 text-muted">Review approval or rejection alerts for your submitted offline-payment declarations. Payment decisions are not bank or gateway settlement confirmations.</Text>
            </View>
            {paymentAlerts.data ? <View className={`rounded-full px-3 py-2 ${unreadPaymentAlerts ? "bg-primary/10" : "bg-background"}`}><Text className={`text-xs font-bold ${unreadPaymentAlerts ? "text-primary" : "text-muted"}`}>{unreadPaymentAlerts} unread</Text></View> : null}
          </View>
          {paymentAlerts.isError ? <Text className="mt-3 text-xs leading-4 text-warning">Sign in to access account-specific payment alerts. No financial notification data is shown without an authenticated session.</Text> : null}
          <Link href={"/payment-notifications" as never} asChild>
            <View className="mt-4 rounded-2xl border border-primary bg-background px-4 py-4"><Text className="text-center font-semibold text-primary">Open payment alerts</Text></View>
          </Link>
          <Link href={"/offline-payment" as never} asChild>
            <View className="mt-3 rounded-2xl border border-border bg-background px-4 py-4"><Text className="text-center font-semibold text-foreground">Declare an offline payment</Text></View>
          </Link>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Land-rights workflow continuity</Text>
          <Text className="mt-2 text-sm text-muted">Registered workflows: {registeredCount} of {bundle.legalWorkflows.length}</Text>
          <View className="mt-4 gap-3">
            {bundle.legalWorkflows.map((workflow) => (
              <View key={workflow.id} className="rounded-2xl border border-border bg-background p-4">
                <Text className="font-semibold text-foreground">{workflow.type}</Text>
                <Text className="mt-1 text-sm text-muted">Status: {workflow.status}</Text>
                <Text className="mt-1 text-sm text-muted">Desk: {workflow.assignedDesk}</Text>
                <Text className="mt-1 text-sm text-muted">Updated: {new Date(workflow.updatedAt).toLocaleString()}</Text>
              </View>
            ))}
          </View>

          <Link href={"/legal-workflow" as never} asChild>
            <View className="mt-4 rounded-2xl border border-border bg-background px-4 py-4">
              <Text className="text-center font-semibold text-foreground">Open legal workflow</Text>
            </View>
          </Link>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Platform integrations</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">Review Keycloak, document intelligence, and authority-bridge availability. Unconfigured services stay unavailable rather than returning sample results.</Text>
          <Link href={"/integration-settings" as never} asChild>
            <View className="mt-4 rounded-2xl border border-border bg-background px-4 py-4"><Text className="text-center font-semibold text-foreground">Open integration settings</Text></View>
          </Link>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Administrator operations</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">Review field evidence awaiting authorisation, external-service posture, supervisor backlog digests, and audit controls without converting any local status into an official decision.</Text>
          <Link href={"/operations" as never} asChild>
            <View className="mt-4 rounded-2xl border border-border bg-background px-4 py-4"><Text className="text-center font-semibold text-foreground">Open operations control center</Text></View>
          </Link>
          <Link href={"/diagnostic-attestations" as never} asChild>
            <View className="mt-3 rounded-2xl border border-primary bg-background px-4 py-4"><Text className="text-center font-semibold text-primary">Manage organization diagnostic receipts</Text></View>
          </Link>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
