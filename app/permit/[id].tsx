import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-3xl border border-border bg-surface p-5">
      <Text className="text-lg font-semibold text-foreground">{title}</Text>
      <View className="mt-4 gap-3">{children}</View>
    </View>
  );
}

function ActionButton({ label, onPress, tone = "dark" }: { label: string; onPress: () => void; tone?: "dark" | "primary" | "success" }) {
  const backgroundClass = tone === "primary" ? "bg-primary" : tone === "success" ? "bg-success" : "bg-foreground";
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}> 
      <View className={`rounded-2xl px-4 py-3 ${backgroundClass}`}>
        <Text className="text-center text-sm font-semibold text-background">{label}</Text>
      </View>
    </Pressable>
  );
}

export default function PermitDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const caseId = params.id ?? "permit-mining-001";
  const utils = trpc.useUtils();
  const platformQuery = trpc.permitting.getPlatform.useQuery();
  const activeAgencyUserQuery = trpc.permitting.getActiveAgencyUser.useQuery();
  const record = platformQuery.data?.permitCases.find((item) => item.id === caseId) ?? null;
  const agencies = platformQuery.data?.agencies ?? [];
  const services = platformQuery.data?.services ?? [];
  const activeAgencyUser = activeAgencyUserQuery.data;

  const [summary, setSummary] = useState("");
  const [draftSections, setDraftSections] = useState<Record<string, string>>({});
  const [reviewNote, setReviewNote] = useState("");
  const [documentName, setDocumentName] = useState("permit-supporting-document.txt");
  const [documentText, setDocumentText] = useState("");

  useEffect(() => {
    if (!record) return;
    setSummary(record.summary);
    const nextDrafts: Record<string, string> = {};
    record.formSections.forEach((section) => {
      section.fields.forEach((field) => {
        nextDrafts[field.key] = field.value;
      });
    });
    setDraftSections(nextDrafts);
  }, [record]);

  const updateFormMutation = trpc.permitting.updateFormSections.useMutation({
    onSuccess: async () => {
      await utils.permitting.getPlatform.invalidate();
    },
  });
  const addReviewNoteMutation = trpc.permitting.addReviewNote.useMutation({
    onSuccess: async () => {
      setReviewNote("");
      await utils.permitting.getPlatform.invalidate();
    },
  });
  const extractDocumentMutation = trpc.permitting.extractDocumentToForm.useMutation({
    onSuccess: async () => {
      await utils.permitting.getPlatform.invalidate();
    },
  });

  const leadAgency = agencies.find((item) => item.id === record?.leadAgencyId) ?? null;
  const participatingAgencies = agencies.filter((item) => record?.participatingAgencyIds.includes(item.id));

  const canUseEditableForms = useMemo(() => record?.sector === "mining" || record?.sector === "oil_gas", [record?.sector]);

  if (!record) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <Text className="text-lg font-semibold text-foreground">Permit case not found</Text>
        <Text className="mt-2 text-center text-sm text-muted">The selected permit detail could not be loaded from the expanded platform snapshot.</Text>
      </ScreenContainer>
    );
  }

  const handleSaveForm = () => {
    const formSections = record.formSections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => ({
        ...field,
        value: draftSections[field.key] ?? field.value,
        source:
          field.source === "ai" && (draftSections[field.key] ?? field.value) === field.value
            ? ("ai" as const)
            : ("manual" as const),
      })),
    }));
    updateFormMutation.mutate({ caseId: record.id, summary, formSections });
  };

  const handleAddReviewNote = (decision: "comment" | "needs_changes" | "approved") => {
    if (!activeAgencyUser || reviewNote.trim().length < 3) return;
    addReviewNoteMutation.mutate({
      caseId: record.id,
      author: activeAgencyUser.displayName,
      role: activeAgencyUser.role,
      agencyId: activeAgencyUser.agencyId,
      decision,
      note: reviewNote.trim(),
    });
  };

  const handleExtractDocument = () => {
    extractDocumentMutation.mutate({
      caseId: record.id,
      documentName: documentName.trim() || "uploaded-document.txt",
      documentText,
    });
  };

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View className="rounded-[28px] bg-primary p-6">
          <Text className="text-sm font-medium text-white/80">{record.permitType}</Text>
          <Text className="mt-3 text-3xl font-bold text-white">{record.title}</Text>
          <Text className="mt-3 text-base leading-6 text-white/85">{record.summary}</Text>
          <Text className="mt-4 text-sm text-white/80">{record.applicantName} · {record.locationLabel} · {record.assetReference}</Text>
        </View>

        <SectionCard title="Active reviewer context">
          <View className="rounded-2xl border border-border bg-background p-4">
            <Text className="text-base font-semibold text-foreground">{activeAgencyUser?.displayName ?? "No active agency user"}</Text>
            <Text className="mt-2 text-sm text-muted">Role: {activeAgencyUser?.role.replace(/_/g, " ") ?? "Unavailable"}</Text>
            <Text className="mt-1 text-xs text-muted">Agency: {activeAgencyUser?.agencyId ?? "Applicant context"}</Text>
          </View>
        </SectionCard>

        {canUseEditableForms ? (
          <SectionCard title="Editable intake and review form">
            <View className="rounded-2xl border border-border bg-background p-4">
              <Text className="text-sm font-semibold text-foreground">Permit summary</Text>
              <TextInput
                value={summary}
                onChangeText={setSummary}
                multiline
                className="mt-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foreground"
                style={{ minHeight: 88, textAlignVertical: "top" }}
              />
            </View>
            {record.formSections.map((section) => (
              <View key={section.id} className="rounded-2xl border border-border bg-background p-4">
                <Text className="text-base font-semibold text-foreground">{section.title}</Text>
                <Text className="mt-2 text-sm leading-5 text-muted">{section.description}</Text>
                <View className="mt-4 gap-3">
                  {section.fields.map((field) => (
                    <View key={field.key}>
                      <Text className="text-sm font-semibold text-foreground">{field.label}</Text>
                      <TextInput
                        value={draftSections[field.key] ?? ""}
                        onChangeText={(value) => setDraftSections((current) => ({ ...current, [field.key]: value }))}
                        multiline={field.fieldType === "textarea"}
                        keyboardType={field.fieldType === "number" ? "numeric" : "default"}
                        className="mt-2 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foreground"
                        style={{ minHeight: field.fieldType === "textarea" ? 92 : 52, textAlignVertical: "top" }}
                      />
                      <Text className="mt-1 text-xs text-muted">{field.required ? "Required" : "Optional"} · Source: {field.source}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            <ActionButton label={updateFormMutation.isPending ? "Saving…" : "Save permit form"} onPress={handleSaveForm} tone="primary" />
          </SectionCard>
        ) : null}

        {canUseEditableForms ? (
          <SectionCard title="AI document extraction and prefill">
            <Text className="text-sm leading-5 text-muted">Paste uploaded document text below to extract structured permit values and populate the editable intake form automatically.</Text>
            <TextInput
              value={documentName}
              onChangeText={setDocumentName}
              className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
            />
            <TextInput
              value={documentText}
              onChangeText={setDocumentText}
              multiline
              className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
              style={{ minHeight: 150, textAlignVertical: "top" }}
              placeholder="Paste OCR text or uploaded document text here"
              placeholderTextColor="#6B7280"
            />
            <ActionButton label={extractDocumentMutation.isPending ? "Extracting…" : "Extract and prefill form"} onPress={handleExtractDocument} tone="success" />
            {record.lastAiExtraction ? (
              <View className="rounded-2xl border border-border bg-background p-4">
                <Text className="text-sm font-semibold text-foreground">Last AI extraction</Text>
                <Text className="mt-2 text-sm text-muted">{record.lastAiExtraction.documentName} · {record.lastAiExtraction.model}</Text>
                <Text className="mt-1 text-xs text-muted">Populated: {record.lastAiExtraction.populatedKeys.join(", ") || "No matching fields yet"}</Text>
              </View>
            ) : null}
          </SectionCard>
        ) : null}

        <SectionCard title="Lifecycle timeline">
          {record.timeline.map((entry) => (
            <View key={entry.key} className="rounded-2xl border border-border bg-background p-4">
              <Text className="text-base font-semibold text-foreground">{entry.label}</Text>
              <Text className="mt-1 text-sm text-muted">{entry.completed ? "Completed" : "Pending"}</Text>
              <Text className="mt-1 text-xs text-muted">{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "Awaiting progression"}</Text>
            </View>
          ))}
        </SectionCard>

        <SectionCard title="Review notes and approval actions">
          <TextInput
            value={reviewNote}
            onChangeText={setReviewNote}
            multiline
            className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
            style={{ minHeight: 110, textAlignVertical: "top" }}
            placeholder="Write a reviewer note or approval decision context"
            placeholderTextColor="#6B7280"
          />
          <View className="gap-3">
            <ActionButton label="Save comment" onPress={() => handleAddReviewNote("comment")} tone="dark" />
            <ActionButton label="Request changes" onPress={() => handleAddReviewNote("needs_changes")} tone="primary" />
            <ActionButton label="Approve review note" onPress={() => handleAddReviewNote("approved")} tone="success" />
          </View>
          {record.reviewNotes.map((note) => (
            <View key={note.id} className="rounded-2xl border border-border bg-background p-4">
              <View className="flex-row items-center justify-between gap-4">
                <Text className="flex-1 text-base font-semibold text-foreground">{note.author}</Text>
                <Text className="text-sm font-semibold text-primary">{note.decision.replace(/_/g, " ")}</Text>
              </View>
              <Text className="mt-2 text-sm leading-5 text-muted">{note.note}</Text>
              <Text className="mt-2 text-xs text-muted">{note.role.replace(/_/g, " ")} · {new Date(note.createdAt).toLocaleString()}</Text>
            </View>
          ))}
        </SectionCard>

        <SectionCard title="Obligations and risk">
          {record.obligations.map((item) => (
            <View key={item.id} className="rounded-2xl border border-border bg-background p-4">
              <View className="flex-row items-center justify-between gap-4">
                <Text className="flex-1 text-base font-semibold text-foreground">{item.title}</Text>
                <Text className="text-sm font-semibold text-primary">{item.status}</Text>
              </View>
              <Text className="mt-2 text-sm text-muted">Owner: {item.owner}</Text>
              <Text className="mt-1 text-xs text-muted">Due {new Date(item.dueAt).toLocaleString()}</Text>
            </View>
          ))}
        </SectionCard>

        <SectionCard title="Agency coordination">
          <View className="rounded-2xl border border-border bg-background p-4">
            <Text className="text-base font-semibold text-foreground">Lead agency</Text>
            <Text className="mt-2 text-sm text-muted">{leadAgency?.name ?? "Unknown lead agency"}</Text>
            <Text className="mt-1 text-xs text-muted">{leadAgency?.role ?? "Lead role unavailable"}</Text>
          </View>
          {participatingAgencies.map((agency) => (
            <View key={agency.id} className="rounded-2xl border border-border bg-background p-4">
              <Text className="text-base font-semibold text-foreground">{agency.name}</Text>
              <Text className="mt-2 text-sm text-muted">{agency.role}</Text>
              <Text className="mt-1 text-xs text-muted">{agency.jurisdiction} · SLA {agency.reviewSlaHours}h</Text>
            </View>
          ))}
        </SectionCard>

        <SectionCard title="Polyglot service topology">
          {services.map((service) => (
            <View key={service.id} className="rounded-2xl border border-border bg-background p-4">
              <View className="flex-row items-center justify-between gap-4">
                <Text className="flex-1 text-base font-semibold text-foreground">{service.name}</Text>
                <Text className="text-sm font-semibold text-primary">{service.language}</Text>
              </View>
              <Text className="mt-2 text-sm leading-5 text-muted">{service.responsibility}</Text>
              <Text className="mt-2 text-xs text-muted">Runtime: {service.runtimeMode.replace(/_/g, " ")} · Endpoint: {service.endpointPath}</Text>
            </View>
          ))}
        </SectionCard>
      </ScrollView>
    </ScreenContainer>
  );
}
