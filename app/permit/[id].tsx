import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
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

function ActionButton({
  label,
  onPress,
  tone = "dark",
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  tone?: "dark" | "primary" | "success";
  disabled?: boolean;
}) {
  const backgroundClass = tone === "primary" ? "bg-primary" : tone === "success" ? "bg-success" : "bg-foreground";
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }]}>
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
  const activeAgencyUserQuery = trpc.permitting.getActiveAgencyUser.useQuery();
  const viewerRole = activeAgencyUserQuery.data?.role ?? "applicant";
  const recordQuery = trpc.permitting.getCaseForRole.useQuery({ caseId, role: viewerRole });
  const platformQuery = trpc.permitting.getPlatform.useQuery();
  const [exportFormat, setExportFormat] = useState<"markdown" | "csv" | null>(null);
  const exportQuery = trpc.permitting.exportAuditHistory.useQuery(
    { caseId, format: exportFormat ?? "markdown" },
    { enabled: exportFormat !== null },
  );

  const record = recordQuery.data;
  const agencies = platformQuery.data?.agencies ?? [];
  const services = platformQuery.data?.services ?? [];
  const agencyUsers = platformQuery.data?.agencyUsers ?? [];
  const activeAgencyUser = activeAgencyUserQuery.data;

  const [summary, setSummary] = useState("");
  const [draftSections, setDraftSections] = useState<Record<string, string>>({});
  const [reviewNote, setReviewNote] = useState("");
  const [documentName, setDocumentName] = useState("permit-supporting-document.txt");
  const [documentText, setDocumentText] = useState("");
  const [pickedFile, setPickedFile] = useState<{ name: string; mimeType: string; base64Data: string } | null>(null);

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
      await Promise.all([
        utils.permitting.getPlatform.invalidate(),
        utils.permitting.getCaseForRole.invalidate({ caseId, role: viewerRole }),
      ]);
    },
  });

  const addReviewNoteMutation = trpc.permitting.addReviewNote.useMutation({
    onSuccess: async () => {
      setReviewNote("");
      await Promise.all([
        utils.permitting.getPlatform.invalidate(),
        utils.permitting.getCaseForRole.invalidate({ caseId, role: viewerRole }),
      ]);
    },
  });

  const extractDocumentMutation = trpc.permitting.extractDocumentToForm.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.permitting.getPlatform.invalidate(),
        utils.permitting.getCaseForRole.invalidate({ caseId, role: viewerRole }),
      ]);
    },
  });

  const uploadDocumentMutation = trpc.permitting.uploadDocumentAndExtract.useMutation({
    onSuccess: async () => {
      setPickedFile(null);
      await Promise.all([
        utils.permitting.getPlatform.invalidate(),
        utils.permitting.getCaseForRole.invalidate({ caseId, role: viewerRole }),
      ]);
    },
  });

  const leadAgency = agencies.find((item) => item.id === record?.leadAgencyId) ?? null;
  const participatingAgencies = agencies.filter((item) => record?.participatingAgencyIds.includes(item.id));
  const assignedReviewer = agencyUsers.find((item) => item.id === record?.activeAssignment?.assignedUserId) ?? null;
  const latestUploadedDocument = record?.uploadedDocuments?.[0] ?? null;
  const canUseEditableForms = useMemo(() => record?.sector === "mining" || record?.sector === "oil_gas", [record?.sector]);
  const isApplicant = viewerRole === "applicant";
  const canReview = viewerRole !== "applicant";

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
        source: field.source === "ai" && (draftSections[field.key] ?? field.value) === field.value ? ("ai" as const) : ("manual" as const),
      })),
    }));
    updateFormMutation.mutate({ caseId: record.id, actorRole: viewerRole, summary, formSections });
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

  const handlePickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      type: ["application/pdf", "image/*", "text/plain"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const base64Data = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
    setPickedFile({
      name: asset.name ?? "permit-upload",
      mimeType: asset.mimeType ?? "application/octet-stream",
      base64Data,
    });
    setDocumentName(asset.name ?? "permit-upload");
  };

  const handleUploadPickedDocument = () => {
    if (!pickedFile) return;
    uploadDocumentMutation.mutate({
      caseId: record.id,
      fileName: pickedFile.name,
      mimeType: pickedFile.mimeType,
      base64Data: pickedFile.base64Data,
      uploadedByRole: viewerRole,
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

        <SectionCard title="Escalation and reviewer assignment">
          <View className="rounded-2xl border border-border bg-background p-4">
            <Text className="text-base font-semibold text-foreground">{assignedReviewer?.displayName ?? "No active assignee"}</Text>
            <Text className="mt-2 text-sm text-muted">Role: {assignedReviewer?.role.replace(/_/g, " ") ?? "Not assigned"}</Text>
            <Text className="mt-1 text-xs text-muted">Reason: {record.activeAssignment?.reason ?? "No escalation rule applied yet"}</Text>
            <Text className="mt-1 text-xs text-muted">Status: {record.activeAssignment?.status ?? "n/a"}</Text>
          </View>
        </SectionCard>

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
              <TextInput editable={isApplicant || canReview} value={summary} onChangeText={setSummary} multiline className="mt-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foreground" style={{ minHeight: 88, textAlignVertical: "top" }} />
            </View>
            {record.formSections.map((section) => (
              <View key={section.id} className="rounded-2xl border border-border bg-background p-4">
                <Text className="text-base font-semibold text-foreground">{section.title}</Text>
                <Text className="mt-2 text-sm leading-5 text-muted">{section.description}</Text>
                <View className="mt-4 gap-3">
                  {section.fields.map((field) => {
                    const editable = !field.editableBy || field.editableBy.includes(viewerRole);
                    return (
                      <View key={field.key}>
                        <Text className="text-sm font-semibold text-foreground">{field.label}</Text>
                        <TextInput
                          editable={editable}
                          value={draftSections[field.key] ?? ""}
                          onChangeText={(value) => setDraftSections((current) => ({ ...current, [field.key]: value }))}
                          multiline={field.fieldType === "textarea"}
                          keyboardType={field.fieldType === "number" ? "numeric" : "default"}
                          className="mt-2 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foreground"
                          style={{ minHeight: field.fieldType === "textarea" ? 92 : 52, textAlignVertical: "top" }}
                        />
                        <Text className="mt-1 text-xs text-muted">{field.required ? "Required" : "Optional"} · Source: {field.source} · Editable by: {(field.editableBy ?? [viewerRole]).join(", ").replace(/_/g, " ")}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
            <ActionButton label={updateFormMutation.isPending ? "Saving…" : "Save permit form"} onPress={handleSaveForm} tone="primary" />
          </SectionCard>
        ) : null}

        {canUseEditableForms ? (
          <SectionCard title="Document ingestion and AI prefill">
            <Text className="text-sm leading-5 text-muted">Use direct document upload for real PDF and image parsing, or paste raw extracted text when needed for fallback extraction.</Text>
            <View className="gap-3">
              <ActionButton label="Pick PDF or image document" onPress={handlePickDocument} tone="dark" />
              {pickedFile ? (
                <View className="rounded-2xl border border-border bg-background p-4">
                  <Text className="text-sm font-semibold text-foreground">Ready to upload</Text>
                  <Text className="mt-2 text-sm text-muted">{pickedFile.name} · {pickedFile.mimeType}</Text>
                </View>
              ) : null}
              <ActionButton label={uploadDocumentMutation.isPending ? "Uploading and extracting…" : "Upload and extract"} onPress={handleUploadPickedDocument} tone="success" disabled={!pickedFile} />
            </View>

            <TextInput value={documentName} onChangeText={setDocumentName} className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground" />
            <TextInput value={documentText} onChangeText={setDocumentText} multiline className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground" style={{ minHeight: 150, textAlignVertical: "top" }} placeholder="Paste OCR text or extracted permit text here" placeholderTextColor="#6B7280" />
            <ActionButton label={extractDocumentMutation.isPending ? "Extracting…" : "Extract from pasted text"} onPress={handleExtractDocument} tone="primary" disabled={documentText.trim().length < 20} />

            <View className="gap-4 md:flex-row">
              <View className="flex-1 rounded-2xl border border-border bg-background p-4">
                <Text className="text-sm font-semibold text-foreground">Uploaded document preview</Text>
                <Text className="mt-2 text-sm text-muted">{latestUploadedDocument?.fileName ?? "No uploaded document yet"}</Text>
                <Text className="mt-2 text-xs text-muted">{latestUploadedDocument?.extractedTextPreview ?? "Upload a PDF or image to inspect the extracted source text preview here."}</Text>
              </View>
              <View className="flex-1 rounded-2xl border border-border bg-background p-4">
                <Text className="text-sm font-semibold text-foreground">Extracted field verification</Text>
                <View className="mt-3 gap-2">
                  {record.formSections.flatMap((section) => section.fields).map((field) => (
                    <View key={field.key} className="rounded-xl border border-border bg-surface px-3 py-2">
                      <Text className="text-xs font-semibold text-foreground">{field.label}</Text>
                      <Text className="mt-1 text-xs text-muted">{field.value || "No value extracted"}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            {record.lastAiExtraction ? (
              <View className="rounded-2xl border border-border bg-background p-4">
                <Text className="text-sm font-semibold text-foreground">Last AI extraction</Text>
                <Text className="mt-2 text-sm text-muted">{record.lastAiExtraction.documentName} · {record.lastAiExtraction.model}</Text>
                <Text className="mt-1 text-xs text-muted">Source: {record.lastAiExtraction.sourceType ?? "text"} · Confidence: {record.lastAiExtraction.confidence ?? 0}</Text>
                <Text className="mt-1 text-xs text-muted">Populated: {record.lastAiExtraction.populatedKeys.join(", ") || "No matching fields yet"}</Text>
              </View>
            ) : null}
          </SectionCard>
        ) : null}

        <SectionCard title="Audit history export">
          <View className="gap-3 md:flex-row">
            <View className="flex-1"><ActionButton label="Prepare Markdown export" onPress={() => setExportFormat("markdown")} tone="dark" /></View>
            <View className="flex-1"><ActionButton label="Prepare CSV export" onPress={() => setExportFormat("csv")} tone="primary" /></View>
          </View>
          {exportQuery.data ? (
            <View className="rounded-2xl border border-border bg-background p-4">
              <Text className="text-sm font-semibold text-foreground">{exportQuery.data.fileName}</Text>
              <Text className="mt-2 text-xs text-muted">{exportQuery.data.mimeType}</Text>
              <Text className="mt-3 text-xs leading-5 text-muted">{exportQuery.data.content.slice(0, 900)}</Text>
            </View>
          ) : null}
        </SectionCard>

        <SectionCard title="Lifecycle timeline">
          {record.timeline.map((entry) => (
            <View key={entry.key} className="rounded-2xl border border-border bg-background p-4">
              <Text className="text-base font-semibold text-foreground">{entry.label}</Text>
              <Text className="mt-1 text-sm text-muted">{entry.completed ? "Completed" : "Pending"}</Text>
              <Text className="mt-1 text-xs text-muted">{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "Awaiting progression"}</Text>
            </View>
          ))}
        </SectionCard>

        {canReview ? (
          <SectionCard title="Review notes and approval actions">
            <TextInput value={reviewNote} onChangeText={setReviewNote} multiline className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground" style={{ minHeight: 110, textAlignVertical: "top" }} placeholder="Write a reviewer note or approval decision context" placeholderTextColor="#6B7280" />
            <View className="gap-3">
              <ActionButton label="Save comment" onPress={() => handleAddReviewNote("comment")} tone="dark" />
              <ActionButton label="Request changes" onPress={() => handleAddReviewNote("needs_changes")} tone="primary" />
              <ActionButton label="Approve review note" onPress={() => handleAddReviewNote("approved")} tone="success" />
            </View>
          </SectionCard>
        ) : null}

        <SectionCard title="Review and audit events">
          {(record.auditHistory ?? []).map((event) => (
            <View key={event.id} className="rounded-2xl border border-border bg-background p-4">
              <View className="flex-row items-center justify-between gap-4">
                <Text className="flex-1 text-base font-semibold text-foreground">{event.actor}</Text>
                <Text className="text-sm font-semibold text-primary">{event.type.replace(/_/g, " ")}</Text>
              </View>
              <Text className="mt-2 text-sm leading-5 text-muted">{event.summary}</Text>
              <Text className="mt-2 text-xs text-muted">{event.role.replace(/_/g, " ")} · {new Date(event.createdAt).toLocaleString()}</Text>
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
