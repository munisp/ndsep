import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";

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
  | "INTEGRATION_EXECUTION_MODE";

const groups: Array<{ title: string; note: string; fields: Array<{ key: FieldName; label: string; secret?: boolean }> }> = [
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
];

export default function IntegrationSettingsScreen() {
  const utils = trpc.useUtils();
  const statusQuery = trpc.integrationSettings.status.useQuery();
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
