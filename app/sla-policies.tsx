import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

export default function SlaPoliciesScreen() {
  const policies = trpc.localPolicy.list.useQuery();
  const [selected, setSelected] = useState("lagos");
  const [hours, setHours] = useState("120");
  const [checklist, setChecklist] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const current = policies.data?.find((policy) => policy.jurisdiction === selected);
  const update = trpc.localPolicy.update.useMutation({ onSuccess: async (policy) => { await policies.refetch(); setMessage(`${policy.label} is now local policy version ${policy.version}.`); }, onError: (error) => setMessage(error.message || "A configured administrator session is required.") });
  const exportPdf = trpc.localPolicy.exportPdf.useMutation({ onSuccess: (exported) => { setMessage(`${exported.fileName} prepared. SHA-256: ${exported.sha256.slice(0, 16)}… ${exported.disclaimer}`); void Linking.openURL(`data:${exported.mimeType};base64,${exported.contentBase64}`); }, onError: (error) => setMessage(error.message || "Export requires a configured administrator session.") });

  useEffect(() => { if (current) { setHours(String(current.slaHours)); setChecklist(current.checklist.join("\n")); } }, [current?.jurisdiction, current?.version]);
  function save() {
    const items = checklist.split("\n").map((item) => item.trim()).filter(Boolean);
    const slaHours = Number(hours);
    if (!Number.isInteger(slaHours) || slaHours < 1 || reason.trim().length < 3 || items.length === 0) { setMessage("Enter a whole-number SLA, at least one checklist item, and a change reason."); return; }
    update.mutate({ jurisdiction: selected as "lagos" | "fct" | "kano" | "ogun" | "rivers", slaHours, checklist: items, reason: reason.trim() });
  }

  return <ScreenContainer className="bg-background"><ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
    <View className="rounded-[28px] bg-surface p-5"><Text className="text-sm text-muted">Administrator controls</Text><Text className="mt-2 text-3xl font-bold text-foreground">Local SLA policies</Text><Text className="mt-2 text-sm leading-5 text-muted">Versioned pilot policies for operating consistency. They are explicitly local configuration, not official state rules or approval authority.</Text></View>
    <View className="rounded-3xl border border-border bg-surface p-5"><Text className="text-lg font-semibold text-foreground">Select jurisdiction</Text><View className="mt-4 flex-row flex-wrap gap-2">{(policies.data ?? []).map((policy) => <Pressable key={policy.jurisdiction} onPress={() => setSelected(policy.jurisdiction)}><View className={`rounded-full border px-3 py-2 ${selected === policy.jurisdiction ? "border-primary bg-primary/10" : "border-border bg-background"}`}><Text className={`text-xs font-semibold ${selected === policy.jurisdiction ? "text-primary" : "text-muted"}`}>{policy.jurisdiction.toUpperCase()}</Text></View></Pressable>)}</View></View>
    {current ? <View className="rounded-3xl border border-border bg-surface p-5"><Text className="text-lg font-semibold text-foreground">{current.label}</Text><Text className="mt-2 text-xs leading-5 text-muted">Current version {current.version} · {current.updatedAt ? `updated ${new Date(current.updatedAt).toLocaleString()}` : "baseline local policy"}</Text><Text className="mt-4 text-sm font-semibold text-foreground">Review target (hours)</Text><TextInput value={hours} onChangeText={setHours} keyboardType="number-pad" className="mt-2 rounded-xl border border-border bg-background px-3 py-3 text-foreground" /><Text className="mt-4 text-sm font-semibold text-foreground">Checklist (one item per line)</Text><TextInput value={checklist} onChangeText={setChecklist} multiline className="mt-2 min-h-[150px] rounded-xl border border-border bg-background px-3 py-3 text-foreground" /><Text className="mt-4 text-sm font-semibold text-foreground">Required change reason</Text><TextInput value={reason} onChangeText={setReason} placeholder="Explain the local policy change" placeholderTextColor="#94A3B8" multiline className="mt-2 min-h-[80px] rounded-xl border border-border bg-background px-3 py-3 text-foreground" /><Pressable onPress={save} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}><View className="mt-4 rounded-2xl bg-foreground px-4 py-4"><Text className="text-center font-semibold text-background">Save local policy version</Text></View></Pressable><Pressable onPress={() => exportPdf.mutate()} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}><View className="mt-3 rounded-2xl border border-border bg-background px-4 py-4"><Text className="text-center font-semibold text-foreground">Export local policy history PDF</Text></View></Pressable>{message ? <Text className="mt-3 text-xs leading-5 text-muted">{message}</Text> : null}<Text className="mt-5 text-sm font-semibold text-foreground">Version history</Text><View className="mt-2 gap-2">{current.history.slice(0, 5).map((version) => <View key={`${version.version}-${version.updatedAt}`} className="rounded-xl border border-border bg-background p-3"><Text className="text-xs font-semibold text-foreground">Version {version.version} · {version.slaHours}h</Text><Text className="mt-1 text-xs text-muted">{version.changeReason || "Baseline policy"}</Text></View>)}{current.history.length === 0 ? <Text className="text-xs text-muted">No prior locally saved version.</Text> : null}</View></View> : null}
  </ScrollView></ScreenContainer>;
}
