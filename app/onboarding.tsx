import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";

export default function OnboardingScreen() {
  const { bundle, submitBusinessProfile, analyzeIdentityDocument, analyzeBusinessDocument, startLiveness, completeLiveness } = useMobilePlatformBundle();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [livenessSessionId, setLivenessSessionId] = useState<string | null>(bundle.onboarding.latestLivenessSession?.sessionId ?? null);
  const [form, setForm] = useState({
    stakeholderType: bundle.onboarding.businessProfile.stakeholderType,
    companyName: bundle.onboarding.businessProfile.companyName ?? "",
    cacNumber: bundle.onboarding.businessProfile.cacNumber ?? "",
    tinNumber: bundle.onboarding.businessProfile.tinNumber ?? "",
    businessEmail: bundle.onboarding.businessProfile.businessEmail ?? "",
    businessPhone: bundle.onboarding.businessProfile.businessPhone ?? "",
    businessAddress: bundle.onboarding.businessProfile.businessAddress ?? "",
    contactPerson: bundle.onboarding.businessProfile.contactPerson ?? "",
  });

  async function readAssetAsBase64(uri: string) {
    return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  }

  async function pickDocument(kind: "identity" | "business", type: string) {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "image/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;
      const asset = result.assets[0];
      const base64Data = await readAssetAsBase64(asset.uri);

      if (kind === "identity") {
        await analyzeIdentityDocument.mutateAsync({
          type,
          fileName: asset.name,
          mimeType: asset.mimeType ?? "image/jpeg",
          base64Data,
        });
      } else {
        await analyzeBusinessDocument.mutateAsync({
          type,
          fileName: asset.name,
          mimeType: asset.mimeType ?? "image/jpeg",
          base64Data,
        });
      }
    } catch (error) {
      Alert.alert("Document processing failed", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function openLivenessCapture() {
    if (!permission?.granted) {
      const status = await requestPermission();
      if (!status.granted) {
        Alert.alert("Camera permission required", "Allow camera access to run the available single-image screening step.");
        return;
      }
    }

    const session = await startLiveness.mutateAsync();
    setLivenessSessionId(session.sessionId);
    setCaptureOpen(true);
  }

  async function captureLiveness() {
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.7,
        base64: false,
        exif: false,
      });

      if (!photo || !livenessSessionId) return;
      const base64Data = await readAssetAsBase64(photo.uri);
      await completeLiveness.mutateAsync({
        sessionId: livenessSessionId,
        mimeType: "image/jpeg",
        base64Data,
        framesAnalyzed: 1,
      });
      setCaptureOpen(false);
    } catch (error) {
      Alert.alert("Liveness screening failed", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function submitBusiness() {
    try {
      await submitBusinessProfile({
        stakeholderType: form.stakeholderType,
        companyName: form.companyName || null,
        cacNumber: form.cacNumber || null,
        tinNumber: form.tinNumber || null,
        businessEmail: form.businessEmail || null,
        businessPhone: form.businessPhone || null,
        businessAddress: form.businessAddress || null,
        contactPerson: form.contactPerson || null,
        onboardingStatus: bundle.onboarding.businessProfile.onboardingStatus,
        cacStatus: bundle.onboarding.businessProfile.cacStatus,
        tinStatus: bundle.onboarding.businessProfile.tinStatus,
        submittedAt: bundle.onboarding.businessProfile.submittedAt,
        verifiedAt: bundle.onboarding.businessProfile.verifiedAt,
        documents: bundle.onboarding.businessProfile.documents,
      });
      Alert.alert("Business profile saved", "The KYB profile has been synchronized to the live mobile API.");
    } catch (error) {
      Alert.alert("Profile save failed", error instanceof Error ? error.message : "Please try again.");
    }
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
        <View>
          <Text className="text-3xl font-bold text-foreground">Stakeholder onboarding</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            Complete KYC, KYB, model-assisted document screening, and explicitly scoped liveness review in one native workflow.
          </Text>
        </View>

        <View className="rounded-3xl bg-primary p-5">
          <Text className="text-sm text-white/80">Readiness</Text>
          <Text className="mt-2 text-3xl font-bold text-white">{bundle.onboarding.readiness}%</Text>
          <Text className="mt-2 text-sm text-white/85">{bundle.onboarding.nextAction}</Text>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Verification checklist</Text>
          <View className="mt-4 gap-3">
            {bundle.onboarding.checklist.map((item) => (
              <View key={item.key} className="rounded-2xl border border-border bg-background p-4">
                <Text className="font-semibold text-foreground">{item.label}</Text>
                <Text className="mt-1 text-sm text-muted">{item.completed ? "Completed" : "Pending"}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Business profile</Text>
          <View className="mt-4 gap-3">
            <TextInput value={form.companyName} onChangeText={(value) => setForm((current) => ({ ...current, companyName: value }))} placeholder="Company name" placeholderTextColor="#94A3B8" className="rounded-2xl border border-border bg-background px-4 py-3 text-foreground" />
            <TextInput value={form.cacNumber} onChangeText={(value) => setForm((current) => ({ ...current, cacNumber: value }))} placeholder="CAC / RC number" placeholderTextColor="#94A3B8" className="rounded-2xl border border-border bg-background px-4 py-3 text-foreground" />
            <TextInput value={form.tinNumber} onChangeText={(value) => setForm((current) => ({ ...current, tinNumber: value }))} placeholder="TIN" placeholderTextColor="#94A3B8" className="rounded-2xl border border-border bg-background px-4 py-3 text-foreground" />
            <TextInput value={form.businessEmail} onChangeText={(value) => setForm((current) => ({ ...current, businessEmail: value }))} placeholder="Business email" placeholderTextColor="#94A3B8" keyboardType="email-address" className="rounded-2xl border border-border bg-background px-4 py-3 text-foreground" />
            <TextInput value={form.businessPhone} onChangeText={(value) => setForm((current) => ({ ...current, businessPhone: value }))} placeholder="Business phone" placeholderTextColor="#94A3B8" className="rounded-2xl border border-border bg-background px-4 py-3 text-foreground" />
            <TextInput value={form.businessAddress} onChangeText={(value) => setForm((current) => ({ ...current, businessAddress: value }))} placeholder="Business address" placeholderTextColor="#94A3B8" multiline className="rounded-2xl border border-border bg-background px-4 py-3 text-foreground" />
            <TextInput value={form.contactPerson} onChangeText={(value) => setForm((current) => ({ ...current, contactPerson: value }))} placeholder="Contact person" placeholderTextColor="#94A3B8" className="rounded-2xl border border-border bg-background px-4 py-3 text-foreground" />
            <Pressable onPress={submitBusiness} style={{ opacity: 1 }}>
              <View className="rounded-2xl bg-foreground px-4 py-4">
                <Text className="text-center font-semibold text-background">Sync business profile</Text>
              </View>
            </Pressable>
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Document intelligence</Text>
          <Text className="mt-2 text-sm text-muted">Capture or select clear images for model-assisted screening and evidence extraction. Automated screening never verifies identity, registry authority, or document authenticity by itself.</Text>
          <View className="mt-4 gap-3">
            <Pressable onPress={() => pickDocument("identity", "National Identification Slip")}>
              <View className="rounded-2xl border border-border bg-background px-4 py-4">
                <Text className="text-center font-semibold text-foreground">Add identity document</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => pickDocument("business", "Certificate of Incorporation")}>
              <View className="rounded-2xl border border-border bg-background px-4 py-4">
                <Text className="text-center font-semibold text-foreground">Add KYB document</Text>
              </View>
            </Pressable>
          </View>

          <View className="mt-4 gap-3">
            {bundle.onboarding.identityDocuments.map((document) => (
              <View key={document.id} className="rounded-2xl border border-border bg-background p-4">
                <Text className="font-semibold text-foreground">{document.type}</Text>
                <Text className="mt-1 text-sm text-muted">Status: {document.status} · Engine: {document.engine ?? "manual"} · {document.analysisProvenance ?? "manual_review"}</Text>
                <Text className="mt-1 text-sm text-muted">Confidence: {document.confidence ?? 0}%</Text>
                {document.analysisReason ? <Text className="mt-1 text-xs text-warning">{document.analysisReason}</Text> : null}
              </View>
            ))}
            {bundle.onboarding.businessProfile.documents.map((document) => (
              <View key={document.id} className="rounded-2xl border border-border bg-background p-4">
                <Text className="font-semibold text-foreground">{document.type}</Text>
                <Text className="mt-1 text-sm text-muted">Status: {document.status} · Engine: {document.engine ?? "manual"} · {document.analysisProvenance ?? "manual_review"}</Text>
                <Text className="mt-1 text-sm text-muted">Confidence: {document.confidence ?? 0}%</Text>
                {document.analysisReason ? <Text className="mt-1 text-xs text-warning">{document.analysisReason}</Text> : null}
              </View>
            ))}
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Liveness screening</Text>
          <Text className="mt-2 text-sm text-muted">This build captures one still image only. It cannot complete or verify a blink-turn-smile liveness challenge; use it only to route the case to an authorized review process.</Text>
          <Text className="mt-2 text-sm text-muted">Current status: {bundle.onboarding.livenessStatus}</Text>

          {captureOpen ? (
            <View className="mt-4 overflow-hidden rounded-3xl border border-border bg-background">
              <CameraView ref={cameraRef} facing="front" style={{ height: 320 }} />
              <View className="flex-row gap-3 p-4">
                <Pressable onPress={() => setCaptureOpen(false)} style={{ flex: 1 }}>
                  <View className="rounded-2xl border border-border bg-surface px-4 py-4">
                    <Text className="text-center font-semibold text-foreground">Cancel</Text>
                  </View>
                </Pressable>
                <Pressable onPress={captureLiveness} style={{ flex: 1, opacity: completeLiveness.isPending ? 0.7 : 1 }}>
                  <View className="rounded-2xl bg-foreground px-4 py-4">
                    <Text className="text-center font-semibold text-background">Capture single-image screening</Text>
                  </View>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable onPress={openLivenessCapture} style={{ opacity: startLiveness.isPending ? 0.7 : 1 }}>
              <View className="mt-4 rounded-2xl bg-foreground px-4 py-4">
                <Text className="text-center font-semibold text-background">Start liveness screening</Text>
              </View>
            </Pressable>
          )}

          {bundle.onboarding.latestLivenessSession ? (
            <View className="mt-4 rounded-2xl border border-border bg-background p-4">
              <Text className="font-semibold text-foreground">Latest liveness session</Text>
              <Text className="mt-1 text-sm text-muted">Status: {bundle.onboarding.latestLivenessSession.status} · Method: {bundle.onboarding.latestLivenessSession.verificationMethod ?? "unavailable"}</Text>
              <Text className="mt-1 text-sm text-muted">Confidence: {bundle.onboarding.latestLivenessSession.confidence}%</Text>
              <Text className="mt-1 text-sm text-muted">Motion: {bundle.onboarding.latestLivenessSession.motionScore}% · Face quality: {bundle.onboarding.latestLivenessSession.faceQualityScore}%</Text>
              {bundle.onboarding.latestLivenessSession.availabilityReason ? <Text className="mt-1 text-xs text-warning">{bundle.onboarding.latestLivenessSession.availabilityReason}</Text> : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
