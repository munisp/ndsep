import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import * as WebBrowser from "expo-web-browser";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

type FieldName =
  | "OIDC_ISSUER"
  | "OIDC_AUDIENCE"
  | "OIDC_JWKS_URL"
  | "DOCLING_SERVICE_URL"
  | "DOCLING_SERVICE_API_KEY"
  | "NIMC_NVS_BRIDGE_URL"
  | "NIMC_NVS_BRIDGE_TOKEN"
  | "CAC_VAS_BRIDGE_URL"
  | "CAC_VAS_BRIDGE_TOKEN"
  | "PAYMENT_GATEWAY_ACTIVE_PROVIDER"
  | "PAYMENT_GATEWAY_PUBLIC_BASE_URL"
  | "PAYSTACK_SECRET_KEY"
  | "FLUTTERWAVE_WEBHOOK_SECRET_HASH"
  | "FLUTTERWAVE_SECRET_KEY"
  | "INTEGRATION_EXECUTION_MODE"
  | "WAF_TELEMETRY_URL"
  | "WAF_TELEMETRY_BEARER_TOKEN"
  | "SECURITY_TELEMETRY_ALLOWED_HOSTS"
  | "SIEM_CORRELATION_URL_TEMPLATE"
  | "RECOVERY_KMS_REGION"
  | "RECOVERY_KMS_KEY_ID"
  | "RECOVERY_WEBAUTHN_ORIGIN"
  | "RECOVERY_WEBAUTHN_RP_ID"
  | "RECOVERY_REPLAY_URL"
  | "RECOVERY_REPLAY_SHARED_SECRET"
  | "RECOVERY_REPLAY_ALLOWED_HOSTS";

const groups: { title: string; note: string; fields: { key: FieldName; label: string; secret?: boolean }[] }[] = [
  {
    title: "Keycloak access tokens",
    note: "Tokens must carry agency_id and agency_roles claims. The values are saved only by the server when secure persistence is configured.",
    fields: [
      { key: "OIDC_ISSUER", label: "Issuer URL" },
      { key: "OIDC_AUDIENCE", label: "Audience" },
      { key: "OIDC_JWKS_URL", label: "JWKS URL" },
    ],
  },
  {
    title: "Docling document intelligence",
    note: "Connect a secured Docling Serve endpoint. Document conversion remains unavailable until the endpoint is reachable.",
    fields: [
      { key: "DOCLING_SERVICE_URL", label: "Service URL" },
      { key: "DOCLING_SERVICE_API_KEY", label: "API key", secret: true },
    ],
  },
  {
    title: "Nigerian authority bridges",
    note: "Use only authorized internal bridges. NIMC and CAC are never contacted through guessed public endpoints.",
    fields: [
      { key: "NIMC_NVS_BRIDGE_URL", label: "NIMC bridge URL" },
      { key: "NIMC_NVS_BRIDGE_TOKEN", label: "NIMC bridge token", secret: true },
      { key: "CAC_VAS_BRIDGE_URL", label: "CAC bridge URL" },
      { key: "CAC_VAS_BRIDGE_TOKEN", label: "CAC bridge token", secret: true },
    ],
  },
  {
    title: "Payment gateway activation",
    note: "Choose one provider, set a public HTTPS origin, and enter only the selected provider’s server credentials. Webhook settlement evidence remains unavailable until all required values are present and the provider transaction can be re-verified.",
    fields: [
      { key: "PAYMENT_GATEWAY_ACTIVE_PROVIDER", label: "Active provider (paystack or flutterwave)" },
      { key: "PAYMENT_GATEWAY_PUBLIC_BASE_URL", label: "Public HTTPS origin" },
      { key: "PAYSTACK_SECRET_KEY", label: "Paystack secret key", secret: true },
      { key: "FLUTTERWAVE_WEBHOOK_SECRET_HASH", label: "Flutterwave webhook secret hash", secret: true },
      { key: "FLUTTERWAVE_SECRET_KEY", label: "Flutterwave secret key", secret: true },
    ],
  },
  {
    title: "APISIX and OpenAppSec telemetry",
    note: "Configure only an HTTPS, allowlisted endpoint that returns a WAF history array. The app shows unavailable rather than fabricated WAF statistics when this contract cannot be verified.",
    fields: [
      { key: "WAF_TELEMETRY_URL", label: "Telemetry URL" },
      { key: "WAF_TELEMETRY_BEARER_TOKEN", label: "Telemetry bearer token", secret: true },
      { key: "SECURITY_TELEMETRY_ALLOWED_HOSTS", label: "Allowed telemetry and SIEM hosts" },
      { key: "SIEM_CORRELATION_URL_TEMPLATE", label: "SIEM URL template using {eventId}" },
    ],
  },
  {
    title: "Dual-approval recovery controller",
    note: "Recovery remains unavailable until all WebAuthn, KMS, and worker-replay boundaries are configured. The server re-encrypts envelopes through KMS; it never accepts a locally decrypted payload or a client-side bypass.",
    fields: [
      { key: "RECOVERY_WEBAUTHN_ORIGIN", label: "WebAuthn HTTPS origin" },
      { key: "RECOVERY_WEBAUTHN_RP_ID", label: "WebAuthn RP ID" },
      { key: "RECOVERY_KMS_REGION", label: "KMS region" },
      { key: "RECOVERY_KMS_KEY_ID", label: "KMS destination key ID" },
      { key: "RECOVERY_REPLAY_URL", label: "Approved replay-worker URL" },
      { key: "RECOVERY_REPLAY_ALLOWED_HOSTS", label: "Allowed replay-worker hosts" },
      { key: "RECOVERY_REPLAY_SHARED_SECRET", label: "Replay-worker credential", secret: true },
    ],
  },
];

export default function IntegrationSettingsScreen() {
  const utils = trpc.useUtils();
  const statusQuery = trpc.integrationSettings.status.useQuery();
  const securityAudit = trpc.integrationSettings.audit.useQuery({ limit: 25 }, { retry: false });
  const auditIntegrity = trpc.system.verifySecurityAuditChain.useQuery(undefined, { retry: false });
  const gatewayActivation = trpc.paymentOperations.gatewayActivation.useQuery({}, { retry: false });
  const [values, setValues] = useState<Partial<Record<FieldName, string>>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const save = trpc.integrationSettings.save.useMutation({
    onSuccess: async () => {
      setValues({});
      setFeedback("Integration settings saved. Secrets remain redacted in this application.");
      await utils.integrationSettings.status.invalidate();
      await utils.trust.providerHealth.invalidate();
    },
    onError: (error) => setFeedback(error.message.includes("FORBIDDEN") || error.message.includes("admin") ? "Only an authenticated platform administrator can save integration settings." : error.message),
  });
  const openSiem = trpc.integrationSettings.openSiemCorrelation.useMutation({ onSuccess: ({ url }) => { void WebBrowser.openBrowserAsync(url); void securityAudit.refetch(); }, onError: (error) => setFeedback(error.message) });

  const status = statusQuery.data;
  const statusByField = new Map(status?.fields.map((field) => [field.field, field]));
  const secureStorageAvailable = Boolean(status?.secureStorageAvailable);
  const executionMode = values.INTEGRATION_EXECUTION_MODE ?? status?.executionMode ?? "staging";

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View className="rounded-[28px] bg-surface p-5">
          <Text className="text-sm text-muted">Administrator controls</Text>
          <Text className="mt-2 text-3xl font-bold text-foreground">Integration settings</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">This page shows configuration status only. It never displays saved secrets or converts an unavailable provider into a verified service.</Text>
        </View>

        {!secureStorageAvailable ? (
          <View className="rounded-3xl border border-warning bg-warning/10 p-5">
            <Text className="text-base font-semibold text-warning">Secure saving is unavailable</Text>
            <Text className="mt-2 text-sm leading-5 text-foreground">{status?.reason ?? "Loading secure storage status..."}</Text>
            <Text className="mt-2 text-sm text-muted">The fields below are disabled to prevent credentials from being stored insecurely. Add the server encryption key first, then authenticate as an administrator.</Text>
          </View>
        ) : null}

        <View className="rounded-3xl border border-border bg-surface p-5"><Text className="text-lg font-semibold text-foreground">Gateway callback status</Text><Text className={`mt-2 text-sm font-semibold ${gatewayActivation.data?.ready ? "text-success" : "text-warning"}`}>{gatewayActivation.data?.ready ? "Configuration complete; provider transaction re-verification is still required for settlement evidence." : "Gateway settlement is unavailable"}</Text><Text className="mt-2 text-sm leading-5 text-muted">{gatewayActivation.data?.callbackUrl ? `Register this callback with the selected provider: ${gatewayActivation.data.callbackUrl}` : gatewayActivation.data?.reason ?? "Authenticate as an administrator to inspect gateway activation status."}</Text></View>

        <View className="rounded-3xl border border-border bg-surface p-5"><Text className="text-lg font-semibold text-foreground">Integration execution mode</Text><Text className="mt-2 text-sm leading-5 text-muted">Staging uses the approved endpoints entered below. Simulation is a development-only emulator lab and cannot verify identity, registry, document, or payment outcomes.</Text><View className="mt-4 flex-row gap-3"><Pressable onPress={() => setValues((current) => ({ ...current, INTEGRATION_EXECUTION_MODE: "staging" }))} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.78 : 1 }]}><View className={`rounded-2xl border px-4 py-3 ${executionMode === "staging" ? "border-success bg-success/10" : "border-border bg-background"}`}><Text className="text-center font-semibold text-foreground">Staging</Text></View></Pressable><Pressable disabled={!status?.simulationAllowed} onPress={() => setValues((current) => ({ ...current, INTEGRATION_EXECUTION_MODE: "simulation" }))} style={({ pressed }) => [{ flex: 1, opacity: !status?.simulationAllowed ? 0.4 : pressed ? 0.78 : 1 }]}><View className={`rounded-2xl border px-4 py-3 ${executionMode === "simulation" ? "border-warning bg-warning/10" : "border-border bg-background"}`}><Text className="text-center font-semibold text-foreground">Simulation</Text></View></Pressable></View><Text className="mt-3 text-xs leading-5 text-muted">{status?.simulationAllowed ? "Simulation is permitted only because this server explicitly enabled development emulators. Saving requires administrator access." : "Simulation is disabled in this environment, including production."}</Text></View>
        <View className="rounded-3xl border border-border bg-surface p-5"><Text className="text-lg font-semibold text-foreground">Integration execution mode</Text><Text className="mt-2 text-sm leading-5 text-muted">Staging uses the approved endpoints entered below. Simulation is a development-only emulator lab and cannot verify identity, registry, document, or payment outcomes.</Text><View className="mt-4 flex-row gap-3"><Pressable onPress={() => setValues((current) => ({ ...current, INTEGRATION_EXECUTION_MODE: "staging" }))} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.78 : 1 }]}><View className={`rounded-2xl border px-4 py-3 ${executionMode === "staging" ? "border-success bg-success/10" : "border-border bg-background"}`}><Text className="text-center font-semibold text-foreground">Staging</Text></View></Pressable><Pressable disabled={!status?.simulationAllowed} onPress={() => setValues((current) => ({ ...current, INTEGRATION_EXECUTION_MODE: "simulation" }))} style={({ pressed }) => [{ flex: 1, opacity: !status?.simulationAllowed ? 0.4 : pressed ? 0.78 : 1 }]}><View className={`rounded-2xl border px-4 py-3 ${executionMode === "simulation" ? "border-warning bg-warning/10" : "border-border bg-background"}`}><Text className="text-center font-semibold text-foreground">Simulation</Text></View></Pressable></View><Text className="mt-3 text-xs leading-5 text-muted">{status?.simulationAllowed ? "Simulation is permitted only because this server explicitly enabled development emulators. Saving requires administrator access." : "Simulation is disabled in this environment, including production."}</Text></View>
        <View className="rounded-3xl border border-border bg-surface p-5"><Text className="text-lg font-semibold text-foreground">Security configuration audit</Text><Text className="mt-2 text-sm leading-5 text-muted">Secret values are never stored in the event payload. Opening an allowlisted SIEM pivot creates a signed click event in this local audit chain.</Text><View className={`mt-3 rounded-2xl border p-3 ${auditIntegrity.data?.valid ? "border-success bg-success/10" : "border-error bg-error/10"}`}><Text className={`text-sm font-semibold ${auditIntegrity.data?.valid ? "text-success" : "text-error"}`}>{auditIntegrity.data?.valid ? "Audit chain verified" : "Audit chain integrity issue"}</Text><Text className="mt-1 text-xs text-muted">{auditIntegrity.data?.totalEvents ?? 0} event(s) · HMAC {auditIntegrity.data?.hmacStatus ?? "not checked"}{auditIntegrity.data?.firstInvalidEventId ? ` · first invalid: ${auditIntegrity.data.firstInvalidEventId}` : ""}</Text><Text className="mt-1 text-xs text-muted">{auditIntegrity.data?.reason ?? "Verifying…"}</Text><Pressable onPress={() => auditIntegrity.refetch()}><Text className="mt-2 text-xs font-semibold text-primary">Verify again</Text></Pressable></View>{securityAudit.data?.length ? <View className="mt-4 gap-2">{securityAudit.data.map((event) => <View key={event.eventId} className="rounded-2xl border border-border bg-background p-3"><Text className="text-xs font-semibold text-foreground">{event.type.replace(/_/g, " ")}</Text><Text className="mt-1 text-xs text-muted">{event.actor} · {new Date(event.occurredAt).toLocaleString()}</Text>{event.type === "integration_settings_saved" ? <Pressable disabled={openSiem.isPending} onPress={() => openSiem.mutate({ auditEventId: event.eventId })}><Text className="mt-2 text-xs font-semibold text-primary">Open correlated SIEM event</Text></Pressable> : null}</View>)}</View> : <Text className="mt-3 text-sm text-muted">No signed configuration events are available yet.</Text>}</View>

        {groups.map((group) => (
          <View key={group.title} className="rounded-3xl border border-border bg-surface p-5">
            <Text className="text-lg font-semibold text-foreground">{group.title}</Text>
            <Text className="mt-2 text-sm leading-5 text-muted">{group.note}</Text>
            <View className="mt-4 gap-3">
              {group.fields.map((field) => {
                const fieldStatus = statusByField.get(field.key);
                return (
                  <View key={field.key} className="rounded-2xl border border-border bg-background p-4">
                    <View className="flex-row items-center justify-between gap-3">
                      <Text className="flex-1 text-sm font-semibold text-foreground">{field.label}</Text>
                      <Text className={`text-xs font-semibold ${fieldStatus?.configured ? "text-success" : "text-warning"}`}>{fieldStatus?.configured ? "Configured" : "Unavailable"}</Text>
                    </View>
                    <Text className="mt-1 text-xs text-muted">{fieldStatus?.configured ? `Stored through ${fieldStatus.source.replace(/_/g, " ")}.` : "No endpoint or credential is configured."}</Text>
                    <TextInput
                      value={values[field.key] ?? ""}
                      onChangeText={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
                      placeholder={field.secret ? "Enter replacement value" : "https://..."}
                      placeholderTextColor="#687076"
                      secureTextEntry={field.secret}
                      editable={secureStorageAvailable && !save.isPending}
                      autoCapitalize="none"
                      className="mt-3 rounded-xl border border-border px-3 py-3 text-sm text-foreground"
                    />
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        {feedback ? <View className="rounded-2xl border border-border bg-surface p-4"><Text className="text-sm leading-5 text-foreground">{feedback}</Text></View> : null}

        <Pressable
          disabled={!secureStorageAvailable || save.isPending}
          onPress={() => save.mutate({ ...values, INTEGRATION_EXECUTION_MODE: executionMode })}
          style={({ pressed }) => [{ opacity: !secureStorageAvailable || save.isPending ? 0.45 : pressed ? 0.82 : 1 }]}
        >
          <View className="rounded-2xl bg-foreground px-4 py-4">
            {save.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-center font-semibold text-background">Save secure settings</Text>}
          </View>
        </Pressable>

        <Link href={"/payment-gateway-settings" as never} asChild><View className="rounded-2xl border border-primary bg-primary/5 px-4 py-4"><Text className="text-center font-semibold text-primary">Open dedicated payment gateway settings</Text></View></Link>

        <Link href={"/(tabs)/profile" as never} asChild>
          <View className="rounded-2xl border border-border bg-background px-4 py-4"><Text className="text-center font-semibold text-foreground">Return to profile</Text></View>
        </Link>
      </ScrollView>
    </ScreenContainer>
  );
}
