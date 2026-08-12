import { ScrollView, Text, View, Pressable } from "react-native";

import { useEffect, useRef, useState } from "react";
import { Alert, Image, TextInput } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";

import { ScreenContainer } from "@/components/screen-container";
import { findParcel } from "@/lib/mobile-data";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";
import { getOfflineFieldEvidenceQueue, queueOfflineFieldEvidence, replayOfflineFieldEvidence } from "@/lib/offline-field-evidence";
import { MAX_OFFLINE_ATTACHMENTS_PER_MANIFEST, MAX_OFFLINE_ATTACHMENT_BYTES, deleteOfflineFieldAttachment, getOfflineAttachmentUsage, persistOfflineFieldAttachment, type OfflineFieldAttachment } from "@/lib/offline-field-attachments";
import { MAX_OFFLINE_MANIFEST_BYTES } from "@/lib/offline-field-attachment-policy";

function RiskTone({ label, value }: { label: string; value: string }) {
  const accent = value === "high" ? "#DC2626" : value === "moderate" ? "#D97706" : "#059669";
  return (
    <View className="rounded-2xl border border-border bg-background px-4 py-3" style={{ borderColor: accent }}>
      <Text className="text-xs uppercase tracking-wide text-muted">{label}</Text>
      <Text className="mt-2 text-sm font-semibold" style={{ color: accent }}>
        {value}
      </Text>
    </View>
  );
}

export default function FieldScreen() {
  const { bundle, updateMissionStatus, hasLiveConnection } = useMobilePlatformBundle();
  const [selectedMissionId, setSelectedMissionId] = useState(bundle.missions[0]?.id ?? "");
  const [observationType, setObservationType] = useState<"boundary_marker" | "occupancy" | "encroachment" | "infrastructure" | "community_engagement" | "other">("boundary_marker");
  const [notes, setNotes] = useState("");
  const [queuedEvidence, setQueuedEvidence] = useState<Awaited<ReturnType<typeof getOfflineFieldEvidenceQueue>>>([]);
  const [replaySummary, setReplaySummary] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<OfflineFieldAttachment[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const attachmentUsage = getOfflineAttachmentUsage(attachments);

  useEffect(() => {
    void getOfflineFieldEvidenceQueue().then(setQueuedEvidence);
  }, []);

  async function advanceMission(missionId: string, currentStatus: "queued" | "active" | "synced") {
    const nextStatus = currentStatus === "queued" ? "active" : "synced";
    await updateMissionStatus({ missionId, status: nextStatus });
  }

  const selectedMission = bundle.missions.find((mission) => mission.id === selectedMissionId);
  const selectedParcel = selectedMission ? findParcel(selectedMission.parcelId, bundle.parcels) : null;

  async function captureOfflineObservation() {
    if (!selectedMission || !selectedParcel) return;
    if (notes.trim().length < 3) {
      Alert.alert("Observation note required", "Add a concise field note before saving the offline evidence draft.");
      return;
    }
    const draft = await queueOfflineFieldEvidence({
      missionId: selectedMission.id,
      parcelId: selectedParcel.id,
      observationType,
      notes: notes.trim(),
      capturedAt: new Date().toISOString(),
      coordinateSource: "parcel_reference",
      latitude: selectedParcel.latitude,
      longitude: selectedParcel.longitude,
      attachmentCount: attachments.length,
      attachments,
      verificationState: "unverified",
    });
    setQueuedEvidence((current) => [draft, ...current]);
    setNotes("");
    setAttachments([]);
    setReplaySummary("Draft saved on this device. It is unverified and will not change the registry until reconciliation succeeds.");
  }

  async function reconcileEvidence() {
    const result = await replayOfflineFieldEvidence();
    setQueuedEvidence(await getOfflineFieldEvidenceQueue());
    setReplaySummary(`${result.recorded} evidence record${result.recorded === 1 ? "" : "s"} recorded, ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} reconciled, and ${result.pending} still pending.`);
  }

  async function openCamera() {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        Alert.alert("Camera unavailable", "Camera permission is required to attach a photo. You can attach a file instead.");
        return;
      }
    }
    setCameraOpen(true);
  }

  async function takePhotoAttachment() {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.65, exif: false, base64: false });
    if (!photo?.uri) return;
    try {
      const attachment = await persistOfflineFieldAttachment({ uri: photo.uri, kind: "photo", name: `field-photo-${Date.now()}.jpg`, mimeType: "image/jpeg", size: null });
      setAttachments((current) => current.length >= MAX_OFFLINE_ATTACHMENTS_PER_MANIFEST || attachmentUsage.usedBytes + (attachment.size ?? 0) > MAX_OFFLINE_MANIFEST_BYTES ? current : [...current, attachment]);
    } catch (error) {
      Alert.alert("Photo not attached", error instanceof Error ? error.message : "The device could not store this photo offline.");
    }
    setCameraOpen(false);
  }

  async function pickFileAttachment() {
    const result = await DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf"], multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    try {
      const additions = await Promise.all(result.assets.slice(0, Math.max(0, MAX_OFFLINE_ATTACHMENTS_PER_MANIFEST - attachments.length)).map((asset) => persistOfflineFieldAttachment({ uri: asset.uri, kind: asset.mimeType?.startsWith("image/") ? "photo" : "file", name: asset.name, mimeType: asset.mimeType ?? null, size: asset.size ?? null })));
      setAttachments((current) => [...current, ...additions].filter((attachment, index, all) => index < MAX_OFFLINE_ATTACHMENTS_PER_MANIFEST && all.slice(0, index + 1).reduce((sum, item) => sum + (item.size ?? 0), 0) <= MAX_OFFLINE_MANIFEST_BYTES));
    } catch (error) {
      Alert.alert("File not attached", error instanceof Error ? error.message : "One or more files could not be stored offline.");
    }
  }

  async function removeAttachment(attachment: OfflineFieldAttachment) {
    await deleteOfflineFieldAttachment(attachment);
    setAttachments((current) => current.filter((item) => item.id !== attachment.id));
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View>
          <Text className="text-3xl font-bold text-foreground">Field Mission</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">A mobile-first field workspace for evidence capture, queue awareness, and sync-safe parcel operations.</Text>
        </View>

        <View className="rounded-3xl bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Mission control</Text>
          <Text className="mt-2 text-sm text-muted">{bundle.missions.filter((mission) => mission.status !== "synced").length} missions need attention. Prioritize high-risk sync packages first.</Text>
          <View className="mt-4 flex-row flex-wrap gap-3">
            <RiskTone label="Queued" value={String(bundle.missions.filter((mission) => mission.status === "queued").length)} />
            <RiskTone label="Active" value={String(bundle.missions.filter((mission) => mission.status === "active").length)} />
            <RiskTone label="High-risk sync" value={String(bundle.missions.filter((mission) => mission.syncRisk === "high").length)} />
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Offline evidence capture</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">Save a field observation without connectivity. The device stores an unverified evidence manifest; authorized reconciliation is required before it becomes a platform record.</Text>
          <Text className={`mt-2 text-sm font-semibold ${hasLiveConnection ? "text-success" : "text-warning"}`}>{hasLiveConnection ? "Live API reachable — queued drafts can be reconciled." : "Offline or API unavailable — drafts are retained on this device."}</Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            {bundle.missions.map((mission) => (
              <Pressable key={mission.id} onPress={() => setSelectedMissionId(mission.id)} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
                <View className={`rounded-full border px-3 py-2 ${selectedMissionId === mission.id ? "border-primary bg-primary/10" : "border-border bg-background"}`}><Text className={`text-xs font-semibold ${selectedMissionId === mission.id ? "text-primary" : "text-muted"}`}>{mission.title}</Text></View>
              </Pressable>
            ))}
          </View>
          <Text className="mt-3 text-xs text-muted">Reference parcel: {selectedParcel?.parcelNumber ?? "Unavailable"} · Coordinates use the local parcel reference and are not a live position claim.</Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            {(["boundary_marker", "occupancy", "encroachment", "infrastructure", "community_engagement", "other"] as const).map((type) => (
              <Pressable key={type} onPress={() => setObservationType(type)} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}><View className={`rounded-full border px-3 py-2 ${observationType === type ? "border-primary bg-primary/10" : "border-border bg-background"}`}><Text className={`text-xs font-semibold ${observationType === type ? "text-primary" : "text-muted"}`}>{type.replace(/_/g, " ")}</Text></View></Pressable>
            ))}
          </View>
          <TextInput value={notes} onChangeText={setNotes} placeholder="Describe the observation, field context, and any safety or dispute concern" placeholderTextColor="#94A3B8" multiline className="mt-4 min-h-[100px] rounded-2xl border border-border bg-background px-4 py-3 text-foreground" />
          {cameraOpen ? <View className="mt-4 overflow-hidden rounded-2xl border border-border bg-background"><CameraView ref={cameraRef} style={{ height: 280 }} facing="back" /><View className="flex-row gap-3 p-3"><Pressable onPress={() => void takePhotoAttachment()} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.8 : 1 }]}><View className="rounded-xl bg-foreground px-3 py-3"><Text className="text-center font-semibold text-background">Capture photo</Text></View></Pressable><Pressable onPress={() => setCameraOpen(false)} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}><View className="rounded-xl border border-border px-3 py-3"><Text className="font-semibold text-foreground">Cancel</Text></View></Pressable></View></View> : null}
          <View className="mt-4 flex-row gap-3"><Pressable onPress={() => void openCamera()} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.8 : 1 }]}><View className="rounded-2xl border border-border bg-background px-4 py-3"><Text className="text-center font-semibold text-foreground">Attach camera photo</Text></View></Pressable><Pressable onPress={() => void pickFileAttachment()} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.8 : 1 }]}><View className="rounded-2xl border border-border bg-background px-4 py-3"><Text className="text-center font-semibold text-foreground">Attach file</Text></View></Pressable></View>
          <Text className="mt-2 text-xs leading-4 text-muted">Attachments are kept in the app document directory on native devices. Maximum {MAX_OFFLINE_ATTACHMENTS_PER_MANIFEST} attachments and {Math.round(MAX_OFFLINE_ATTACHMENT_BYTES / (1024 * 1024))} MB per file. They remain local and unverified until a supervisor reviews the reconciled manifest.</Text>
          <View className="mt-3"><View className="h-2 overflow-hidden rounded-full bg-border"><View className={`h-2 rounded-full ${attachmentUsage.percent >= 90 ? "bg-error" : attachmentUsage.percent >= 70 ? "bg-warning" : "bg-primary"}`} style={{ width: `${attachmentUsage.percent}%` }} /></View><Text className={`mt-1 text-xs font-semibold ${attachmentUsage.percent >= 90 ? "text-error" : attachmentUsage.percent >= 70 ? "text-warning" : "text-muted"}`}>Offline draft storage: {Math.round(attachmentUsage.usedBytes / 1024)} KB of {Math.round(MAX_OFFLINE_MANIFEST_BYTES / (1024 * 1024))} MB ({attachmentUsage.percent}%) {attachmentUsage.percent >= 90 ? "· Storage nearly full" : attachmentUsage.percent >= 70 ? "· Approaching storage limit" : ""}</Text></View>
          {attachments.length > 0 ? <View className="mt-3 gap-2">{attachments.map((attachment) => <View key={attachment.id} className="flex-row items-center gap-3 rounded-xl border border-border bg-background p-3">{attachment.kind === "photo" ? <Image source={{ uri: attachment.localUri }} style={{ width: 56, height: 56, borderRadius: 10 }} /> : <View className="h-14 w-14 items-center justify-center rounded-xl bg-surface"><Text className="text-xs font-semibold text-muted">FILE</Text></View>}<View className="flex-1"><Text className="text-sm font-semibold text-foreground">{attachment.kind} · {attachment.name}</Text><Text className="mt-1 text-xs text-muted">{attachment.persistence.replace(/_/g, " ")} · {attachment.size ? `${Math.round(attachment.size / 1024)} KB` : "size unavailable"}</Text></View><Pressable onPress={() => void removeAttachment(attachment)}><View className="rounded-lg border border-error px-2 py-2"><Text className="text-xs font-semibold text-error">Delete</Text></View></Pressable></View>)}</View> : null}
          <Pressable onPress={() => void captureOfflineObservation()} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}><View className="mt-3 rounded-2xl bg-foreground px-4 py-4"><Text className="text-center font-semibold text-background">Save offline observation</Text></View></Pressable>
          <Pressable onPress={() => void reconcileEvidence()} disabled={!hasLiveConnection || queuedEvidence.length === 0} style={({ pressed }) => [{ opacity: !hasLiveConnection || queuedEvidence.length === 0 ? 0.45 : pressed ? 0.8 : 1 }]}><View className="mt-3 rounded-2xl border border-border bg-background px-4 py-4"><Text className="text-center font-semibold text-foreground">Reconcile {queuedEvidence.length} queued observation{queuedEvidence.length === 1 ? "" : "s"}</Text></View></Pressable>
          {replaySummary ? <Text className="mt-3 text-xs leading-5 text-muted">{replaySummary}</Text> : null}
          {queuedEvidence.length > 0 ? <View className="mt-4 gap-2">{queuedEvidence.slice(0, 3).map((draft) => <View key={draft.id} className="rounded-2xl border border-warning bg-warning/5 p-3"><Text className="text-sm font-semibold text-foreground">{draft.observationType.replace(/_/g, " ")} · unverified</Text><Text className="mt-1 text-xs text-muted">Queued {new Date(draft.queuedAt).toLocaleString()} · Attempts: {draft.attempts}</Text></View>)}</View> : null}
        </View>

        <View className="gap-4">
          {bundle.missions.map((mission) => {
            const parcel = findParcel(mission.parcelId, bundle.parcels);
            return (
              <View key={mission.id} className="rounded-3xl border border-border bg-surface p-5">
                <View className="flex-row items-start justify-between gap-4">
                  <View className="flex-1">
                    <Text className="text-lg font-semibold text-foreground">{mission.title}</Text>
                    <Text className="mt-1 text-sm text-muted">Parcel {parcel?.parcelNumber ?? "Unknown"} · {parcel?.lga ?? "Unknown LGA"}, {parcel?.state ?? "Unknown state"}</Text>
                  </View>
                  <View className="rounded-full bg-background px-3 py-1">
                    <Text className="text-xs font-semibold text-foreground">{mission.status}</Text>
                  </View>
                </View>

                <Text className="mt-4 text-sm text-muted">Evidence items: {mission.evidenceCount} · Last updated: {new Date(mission.lastUpdated).toLocaleString()}</Text>

                <View className="mt-4 flex-row gap-3">
                  <View className="flex-1 rounded-2xl border border-border bg-background p-4">
                    <Text className="text-xs uppercase tracking-wide text-muted">Sync risk</Text>
                    <Text className="mt-2 text-base font-semibold text-foreground">{mission.syncRisk}</Text>
                  </View>
                  <View className="flex-1 rounded-2xl border border-border bg-background p-4">
                    <Text className="text-xs uppercase tracking-wide text-muted">Workflow stage</Text>
                    <Text className="mt-2 text-base font-semibold text-foreground">{parcel?.workflowStage ?? "Workflow stage unavailable"}</Text>
                  </View>
                </View>

                <Pressable onPress={() => void advanceMission(mission.id, mission.status)}>
                  <View className="mt-4 rounded-2xl bg-foreground px-4 py-3">
                    <Text className="text-center font-semibold text-background">{mission.status === "queued" ? "Start mission" : mission.status === "active" ? "Mark as synced" : "Synced"}</Text>
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
