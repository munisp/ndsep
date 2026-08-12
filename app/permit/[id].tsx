import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { loadAuditCacheManifest, readEncryptedAuditPackage, saveEncryptedAuditPackage, type CachedAuditManifest } from "@/lib/offline-audit-cache";
import { trpc } from "@/lib/trpc";

type ExportPreview = {
  fileName: string;
  mimeType: string;
  content: string;
  packageMetadata?: {
    generatedAt: string;
    format: "csv" | "pdf" | "markdown";
    fileName: string;
    sha256: string;
    signature: string;
    signedBy: string;
    algorithm?: string;
    publicKeyId?: string;
    verifierHint: string;
  } | null;
};

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
  tone?: "dark" | "primary" | "success" | "warning";
  disabled?: boolean;
}) {
  const backgroundClass =
    tone === "primary"
      ? "bg-primary"
      : tone === "success"
        ? "bg-success"
        : tone === "warning"
          ? "bg-warning"
          : "bg-foreground";
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }]}>
      <View className={`rounded-2xl px-4 py-3 ${backgroundClass}`}>
        <Text className="text-center text-sm font-semibold text-background">{label}</Text>
      </View>
    </Pressable>
  );
}

function toAuditHtml(title: string, content: string, signature?: string) {
  const escaped = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");
  return `<!doctype html><html><head><meta charset="utf-8" /><style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:24px;color:#111827}h1{font-size:24px;margin-bottom:16px}p,div{font-size:12px;line-height:1.5;white-space:normal}.sig{margin-top:20px;padding-top:12px;border-top:1px solid #D1D5DB;color:#4B5563}</style></head><body><h1>${title}</h1><div>${escaped}</div><div class="sig"><strong>Signature:</strong> ${signature ?? "Pending"}</div></body></html>`;
}

function hoursUntil(dateString: string) {
  return Math.max(0, Math.round((new Date(dateString).getTime() - Date.now()) / (1000 * 60 * 60)));
}

export default function PermitDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const caseId = params.id ?? "permit-mining-001";
  const utils = trpc.useUtils();
  const activeAgencyUserQuery = trpc.permitting.getActiveAgencyUser.useQuery();
  const viewerRole = activeAgencyUserQuery.data?.role ?? "applicant";
  const recordQuery = trpc.permitting.getCaseForRole.useQuery({ caseId, role: viewerRole });
  const platformQuery = trpc.permitting.getPlatform.useQuery();
  const custodyTimelineQuery = trpc.permitting.getCustodyTimeline.useQuery({ caseId });
  const signingKeysQuery = trpc.permitting.listSigningKeys.useQuery();
  const supervisorDigestsQuery = trpc.permitting.listSupervisorDigests.useQuery();

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
  const [selectedAssigneeId, setSelectedAssigneeId] = useState("");
  const [overrideReason, setOverrideReason] = useState("Manual supervisor override");
  const [handoffNote, setHandoffNote] = useState("Accepted for current review stage.");
  const [exportPreview, setExportPreview] = useState<ExportPreview | null>(null);
  const [cacheManifest, setCacheManifest] = useState<CachedAuditManifest | null>(null);

  useEffect(() => {
    if (!record) return;
    setSummary(record.summary);
    setSelectedAssigneeId(record.activeAssignment?.assignedUserId ?? "");
    const nextDrafts: Record<string, string> = {};
    record.formSections.forEach((section) => {
      section.fields.forEach((field) => {
        nextDrafts[field.key] = field.value;
      });
    });
    setDraftSections(nextDrafts);
  }, [record]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let mounted = true;
    const bootstrapCacheManifest = async () => {
      try {
        const manifest = await loadAuditCacheManifest(caseId);
        if (mounted) setCacheManifest(manifest);
      } catch {
        if (mounted) setCacheManifest(null);
      }
    };
    void bootstrapCacheManifest();
    return () => {
      mounted = false;
    };
  }, [caseId]);

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

  const revokeSigningKeyMutation = trpc.permitting.revokeSigningKey.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.permitting.getPlatform.invalidate(),
        utils.permitting.listSigningKeys.invalidate(),
        utils.permitting.getCustodyTimeline.invalidate({ caseId }),
        utils.permitting.getCaseForRole.invalidate({ caseId, role: viewerRole }),
      ]);
    },
  });

  const overrideAssignmentMutation = trpc.permitting.overrideAssignment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.permitting.getPlatform.invalidate(),
        utils.permitting.getCaseForRole.invalidate({ caseId, role: viewerRole }),
      ]);
    },
  });

  const advanceHandoffMutation = trpc.permitting.advanceHandoff.useMutation({
    onSuccess: async () => {
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
  const canOverride = viewerRole === "planning_supervisor";
  const assignableUsers = useMemo(() => agencyUsers.filter((item) => item.role !== "applicant"), [agencyUsers]);
  const currentPackageMetadata = exportPreview?.packageMetadata ?? record?.latestAuditPackage ?? null;
  const custodyTimeline = custodyTimelineQuery.data ?? record?.custodyTimeline ?? [];
  const signingKeys = signingKeysQuery.data ?? [];
  const supervisorDigests = (supervisorDigestsQuery.data ?? []).filter((item) => !activeAgencyUser?.agencyId || item.agencyId === activeAgencyUser.agencyId);

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

  const handlePrepareExport = async (format: "markdown" | "csv") => {
    const exported = await utils.permitting.exportAuditHistory.fetch({ caseId, format });
    setExportPreview(exported as ExportPreview);
  };

  const handleDownloadAudit = async (format: "csv" | "pdf") => {
    const markdownExport = (await utils.permitting.exportAuditHistory.fetch({ caseId, format: "markdown" })) as ExportPreview;
    setExportPreview(markdownExport);

    if (format === "pdf") {
      const html = toAuditHtml(record.title, markdownExport.content, markdownExport.packageMetadata?.signature);
      const printed = await Print.printToFileAsync({ html });
      if (Platform.OS === "web") {
        window.open(printed.uri, "_blank");
        return;
      }
      const base64Pdf = await FileSystem.readAsStringAsync(printed.uri, { encoding: FileSystem.EncodingType.Base64 });
      const manifest = await saveEncryptedAuditPackage(caseId, {
        format: "pdf",
        fileName: `${record.id}-audit-history.pdf`,
        mimeType: "application/pdf",
        payload: base64Pdf,
        updatedAt: new Date().toISOString(),
      });
      setCacheManifest(manifest);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(printed.uri, { mimeType: "application/pdf" });
      }
      return;
    }

    const csvExport = (await utils.permitting.exportAuditHistory.fetch({ caseId, format: "csv" })) as ExportPreview;
    setExportPreview(csvExport);
    if (Platform.OS === "web") {
      const blob = new Blob([csvExport.content], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = csvExport.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      return;
    }

    const manifest = await saveEncryptedAuditPackage(caseId, {
      format: "csv",
      fileName: csvExport.fileName,
      mimeType: "text/csv",
      payload: csvExport.content,
      updatedAt: new Date().toISOString(),
    });
    setCacheManifest(manifest);
    const targetPath = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${csvExport.fileName}`;
    await FileSystem.writeAsStringAsync(targetPath, csvExport.content, { encoding: FileSystem.EncodingType.UTF8 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(targetPath, { mimeType: "text/csv" });
    }
  };

  const handleOpenCachedAudit = async (format: "csv" | "pdf") => {
    if (Platform.OS === "web") return;
    const cached = await readEncryptedAuditPackage(caseId, format);
    if (!cached) return;
    const targetPath = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${cached.fileName}`;
    if (format === "pdf") {
      await FileSystem.writeAsStringAsync(targetPath, cached.payload, { encoding: FileSystem.EncodingType.Base64 });
    } else {
      await FileSystem.writeAsStringAsync(targetPath, cached.payload, { encoding: FileSystem.EncodingType.UTF8 });
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(targetPath, { mimeType: cached.mimeType });
    }
  };

  const handleRevokeCurrentKey = () => {
    if (!activeAgencyUser || !currentPackageMetadata?.publicKeyId) return;
    revokeSigningKeyMutation.mutate({
      keyId: currentPackageMetadata.publicKeyId,
      reason: `Supervisor initiated revocation for ${currentPackageMetadata.fileName}`,
      actorName: activeAgencyUser.displayName,
    });
  };

  const handleOverrideAssignment = () => {
    if (!activeAgencyUser || !selectedAssigneeId || overrideReason.trim().length < 3) return;
    overrideAssignmentMutation.mutate({
      caseId: record.id,
      assignedUserId: selectedAssigneeId,
      actorName: activeAgencyUser.displayName,
      actorRole: activeAgencyUser.role,
      reason: overrideReason.trim(),
    });
  };

  const handleAdvanceHandoff = (handoffId: string, action: "accept" | "complete" | "escalate") => {
    if (!activeAgencyUser || handoffNote.trim().length < 3) return;
    advanceHandoffMutation.mutate({
      caseId: record.id,
      handoffId,
      actorName: activeAgencyUser.displayName,
      actorRole: activeAgencyUser.role,
      action,
      note: handoffNote.trim(),
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
          {canOverride ? (
            <View className="rounded-2xl border border-border bg-background p-4">
              <Text className="text-sm font-semibold text-foreground">Supervisor override</Text>
              <View className="mt-3 flex-row flex-wrap gap-2">
                {assignableUsers.map((user) => (
                  <Pressable key={user.id} onPress={() => setSelectedAssigneeId(user.id)} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}> 
                    <View className={`rounded-full border px-3 py-2 ${selectedAssigneeId === user.id ? "border-primary bg-primary/10" : "border-border bg-surface"}`}>
                      <Text className={`text-xs font-semibold ${selectedAssigneeId === user.id ? "text-primary" : "text-foreground"}`}>{user.displayName}</Text>
                      <Text className="text-[11px] text-muted">{user.role.replace(/_/g, " ")}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
              <TextInput value={overrideReason} onChangeText={setOverrideReason} className="mt-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foreground" placeholder="Reason for reassignment" placeholderTextColor="#6B7280" />
              <View className="mt-3">
                <ActionButton label={overrideAssignmentMutation.isPending ? "Reassigning…" : "Apply supervisor reassignment"} onPress={handleOverrideAssignment} tone="primary" disabled={!selectedAssigneeId} />
              </View>
            </View>
          ) : null}
        </SectionCard>

        <SectionCard title="Approval handoffs and escalation timers">
          <TextInput value={handoffNote} onChangeText={setHandoffNote} className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground" placeholder="Handoff acceptance or escalation note" placeholderTextColor="#6B7280" />
          {(record.approvalHandoffs ?? []).map((handoff) => {
            const warning = hoursUntil(handoff.dueAt) <= 6;
            return (
              <View key={handoff.id} className={`rounded-2xl border p-4 ${warning ? "border-warning bg-warning/5" : "border-border bg-background"}`}>
                <View className="flex-row items-center justify-between gap-4">
                  <Text className="flex-1 text-base font-semibold text-foreground">{handoff.toRole.replace(/_/g, " ")}</Text>
                  <Text className={`text-sm font-semibold ${warning ? "text-warning" : "text-primary"}`}>{handoff.status}</Text>
                </View>
                <Text className="mt-2 text-sm text-muted">From {handoff.fromRole.replace(/_/g, " ")} · Due in {hoursUntil(handoff.dueAt)}h</Text>
                <Text className="mt-1 text-xs text-muted">Reason: {handoff.reason}</Text>
                {canReview ? (
                  <View className="mt-3 gap-2 md:flex-row">
                    <View className="flex-1"><ActionButton label="Accept handoff" onPress={() => handleAdvanceHandoff(handoff.id, "accept")} tone="dark" /></View>
                    <View className="flex-1"><ActionButton label="Complete handoff" onPress={() => handleAdvanceHandoff(handoff.id, "complete")} tone="success" /></View>
                    <View className="flex-1"><ActionButton label="Escalate handoff" onPress={() => handleAdvanceHandoff(handoff.id, "escalate")} tone="warning" /></View>
                  </View>
                ) : null}
              </View>
            );
          })}
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
                        <TextInput editable={editable} value={draftSections[field.key] ?? ""} onChangeText={(value) => setDraftSections((current) => ({ ...current, [field.key]: value }))} multiline={field.fieldType === "textarea"} keyboardType={field.fieldType === "number" ? "numeric" : "default"} className="mt-2 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foreground" style={{ minHeight: field.fieldType === "textarea" ? 92 : 52, textAlignVertical: "top" }} />
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
                <Text className="text-sm font-semibold text-foreground">Last document extraction</Text>
                <Text className="mt-2 text-sm text-muted">{record.lastAiExtraction.documentName} · {record.lastAiExtraction.model ?? "model unavailable"}</Text>
                <Text className="mt-1 text-xs text-muted">Source: {record.lastAiExtraction.sourceType ?? "text"} · Provenance: {record.lastAiExtraction.provenance ?? "unavailable"} · Status: {record.lastAiExtraction.status ?? "requires_review"} · Confidence: {record.lastAiExtraction.confidence ?? "not available"}</Text>
                <Text className="mt-1 text-xs text-muted">Populated: {record.lastAiExtraction.populatedKeys.join(", ") || "No matching fields yet"}</Text>
                <Text className="mt-1 text-xs text-warning">{record.lastAiExtraction.reason ?? "Extracted values require reviewer confirmation before any permit decision."}</Text>
              </View>
            ) : null}
          </SectionCard>
        ) : null}

        <SectionCard title="Supervisor digests and signing keys">
          {supervisorDigests.length ? supervisorDigests.map((digest) => (
            <View key={digest.id} className="rounded-2xl border border-border bg-background p-4">
              <Text className="text-sm font-semibold text-foreground">{digest.subject}</Text>
              <Text className="mt-2 text-xs text-muted">{digest.summary}</Text>
              <Text className="mt-1 text-xs text-muted">Channel: {digest.channel.replace("_", " ")} · Backlog: {digest.backlogCount} · Overdue handoffs: {digest.overdueHandoffs}</Text>
            </View>
          )) : <Text className="text-sm text-muted">No supervisor digests available for the active agency.</Text>}
          <View className="gap-3">
            {signingKeys.map((key) => (
              <View key={key.keyId} className={`rounded-2xl border p-4 ${key.active ? "border-success bg-success/5" : "border-warning bg-warning/5"}`}>
                <Text className="text-sm font-semibold text-foreground">{key.keyId}</Text>
                <Text className="mt-2 text-xs text-muted">{key.algorithm} · Created {new Date(key.createdAt).toLocaleString()}</Text>
                <Text className="mt-1 text-xs text-muted">Status: {key.active ? "Active" : `Revoked ${key.revokedAt ? new Date(key.revokedAt).toLocaleString() : ""}`}</Text>
                {key.revocationReason ? <Text className="mt-1 text-xs text-muted">Reason: {key.revocationReason}</Text> : null}
              </View>
            ))}
          </View>
          {canOverride && currentPackageMetadata?.publicKeyId ? (
            <ActionButton label={revokeSigningKeyMutation.isPending ? "Revoking key…" : `Revoke ${currentPackageMetadata.publicKeyId}`} onPress={handleRevokeCurrentKey} tone="warning" />
          ) : null}
        </SectionCard>

        <SectionCard title="Signed audit package and offline cache">
          <View className="gap-3 md:flex-row">
            <View className="flex-1"><ActionButton label="Preview signed Markdown" onPress={() => void handlePrepareExport("markdown")} tone="dark" /></View>
            <View className="flex-1"><ActionButton label="Preview signed CSV" onPress={() => void handlePrepareExport("csv")} tone="primary" /></View>
          </View>
          <Link href={{ pathname: "/audit-verify", params: { caseId: record.id } } as never} asChild>
            <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
              <View className="rounded-2xl border border-border bg-background px-4 py-3">
                <Text className="text-center text-sm font-semibold text-foreground">Open verification page</Text>
              </View>
            </Pressable>
          </Link>
          <View className="gap-3 md:flex-row">
            <View className="flex-1"><ActionButton label="Download signed CSV" onPress={() => void handleDownloadAudit("csv")} tone="primary" /></View>
            <View className="flex-1"><ActionButton label="Download signed PDF" onPress={() => void handleDownloadAudit("pdf")} tone="success" /></View>
          </View>
          {currentPackageMetadata ? (
            <View className="rounded-2xl border border-border bg-background p-4">
              <Text className="text-sm font-semibold text-foreground">{currentPackageMetadata.fileName}</Text>
              <Text className="mt-2 text-xs text-muted">Signed by {currentPackageMetadata.signedBy} · Generated {new Date(currentPackageMetadata.generatedAt).toLocaleString()}</Text>
              <Text className="mt-2 text-xs text-muted">SHA-256: {currentPackageMetadata.sha256}</Text>
              <Text className="mt-1 text-xs text-muted">Signature: {currentPackageMetadata.signature}</Text>
              <Text className="mt-1 text-xs text-muted">Algorithm: {currentPackageMetadata.algorithm ?? "RSA-SHA256"} · Key: {currentPackageMetadata.publicKeyId ?? "n/a"}</Text>
              <Text className="mt-1 text-xs text-muted">{currentPackageMetadata.verifierHint}</Text>
            </View>
          ) : null}
          {exportPreview ? (
            <View className="rounded-2xl border border-border bg-background p-4">
              <Text className="text-sm font-semibold text-foreground">{exportPreview.fileName}</Text>
              <Text className="mt-2 text-xs text-muted">{exportPreview.mimeType}</Text>
              <Text className="mt-3 text-xs leading-5 text-muted">{exportPreview.content.slice(0, 900)}</Text>
            </View>
          ) : null}
          {Platform.OS !== "web" ? (
            <View className="rounded-2xl border border-border bg-background p-4">
              <Text className="text-sm font-semibold text-foreground">Offline cache</Text>
              <Text className="mt-2 text-xs text-muted">Updated: {cacheManifest?.updatedAt ? new Date(cacheManifest.updatedAt).toLocaleString() : "No cached package yet"}</Text>
              <Text className="mt-1 text-xs text-muted">CSV: {cacheManifest?.csvPath ? "Encrypted package available" : "Unavailable"}</Text>
              <Text className="mt-1 text-xs text-muted">PDF: {cacheManifest?.pdfPath ? "Encrypted package available" : "Unavailable"}</Text>
              <View className="mt-3 gap-2 md:flex-row">
                <View className="flex-1"><ActionButton label="Unlock cached CSV" onPress={() => void handleOpenCachedAudit("csv")} tone="dark" disabled={!cacheManifest?.csvPath} /></View>
                <View className="flex-1"><ActionButton label="Unlock cached PDF" onPress={() => void handleOpenCachedAudit("pdf")} tone="success" disabled={!cacheManifest?.pdfPath} /></View>
              </View>
            </View>
          ) : null}
        </SectionCard>

        <SectionCard title="Chain of custody">
          {(custodyTimeline.length ? custodyTimeline : []).map((event) => (
            <View key={event.id} className="rounded-2xl border border-border bg-background p-4">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-sm font-semibold text-foreground">{event.summary}</Text>
                <Text className="text-xs font-semibold text-primary">{event.action}</Text>
              </View>
              <Text className="mt-2 text-xs text-muted">{event.packageType} · {event.packageRef}</Text>
              <Text className="mt-1 text-xs text-muted">{event.actor} · {event.role.replace(/_/g, " ")} · {new Date(event.occurredAt).toLocaleString()}</Text>
            </View>
          ))}
          {custodyTimeline.length === 0 ? <Text className="text-sm text-muted">No custody transfers or validations have been recorded yet.</Text> : null}
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
