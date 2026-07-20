import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

function ActionButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}>
      <View className="rounded-2xl bg-foreground px-4 py-3">
        <Text className="text-center text-sm font-semibold text-background">{label}</Text>
      </View>
    </Pressable>
  );
}

export default function AuditVerifyScreen() {
  const verifyMutation = trpc.permitting.verifyAuditPackage.useMutation();
  const verificationKeyQuery = trpc.permitting.getAuditVerificationKey.useQuery();
  const [caseId, setCaseId] = useState("");
  const [fileName, setFileName] = useState("audit-history-export.csv");
  const [fileContent, setFileContent] = useState("");
  const [sha256, setSha256] = useState("");
  const [signature, setSignature] = useState("");

  const handlePickAuditFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      type: ["text/csv", "text/plain", "text/markdown", "application/pdf"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setFileName(asset.name ?? "audit-package");
    if ((asset.mimeType ?? "").includes("pdf")) {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      setFileContent(base64);
      return;
    }
    const text = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
    setFileContent(text);
  };

  const handleVerify = () => {
    verifyMutation.mutate({
      caseId: caseId.trim() || undefined,
      fileName,
      content: fileContent,
      sha256,
      signature,
    });
  };

  const verification = verifyMutation.data;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View className="rounded-[28px] bg-primary p-6">
          <Text className="text-sm font-medium text-white/80">Audit trust center</Text>
          <Text className="mt-3 text-3xl font-bold text-white">Verify signed audit packages</Text>
          <Text className="mt-3 text-base leading-6 text-white/85">Upload an exported audit file, enter its recorded SHA-256 hash and signature, and confirm whether the package remains intact and matches the latest server-side record.</Text>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Verification input</Text>
          <TextInput value={caseId} onChangeText={setCaseId} placeholder="Optional permit case ID" placeholderTextColor="#6B7280" className="mt-4 rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground" />
          <TextInput value={fileName} onChangeText={setFileName} placeholder="Audit file name" placeholderTextColor="#6B7280" className="mt-3 rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground" />
          <TextInput value={sha256} onChangeText={setSha256} placeholder="Recorded SHA-256 hash" placeholderTextColor="#6B7280" className="mt-3 rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground" />
          <TextInput value={signature} onChangeText={setSignature} placeholder="Recorded signature" placeholderTextColor="#6B7280" className="mt-3 rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground" />
          <TextInput value={fileContent} onChangeText={setFileContent} multiline placeholder="Paste audit file content here if you are not picking a file" placeholderTextColor="#6B7280" className="mt-3 rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground" style={{ minHeight: 180, textAlignVertical: "top" }} />
          <View className="mt-3 gap-3">
            <ActionButton label="Pick exported audit file" onPress={() => void handlePickAuditFile()} />
            <ActionButton label={verifyMutation.isPending ? "Verifying…" : "Verify package"} onPress={handleVerify} disabled={fileContent.trim().length < 10 || sha256.trim().length < 32 || signature.trim().length < 32} />
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Published verification key</Text>
          <Text className="mt-3 text-sm text-muted">Key ID: {verificationKeyQuery.data?.keyId ?? "loading"}</Text>
          <Text className="mt-1 text-sm text-muted">Algorithm: {verificationKeyQuery.data?.algorithm ?? "loading"}</Text>
          <Text className="mt-3 text-xs text-foreground">{verificationKeyQuery.data?.publicKeyPem ?? "Public key unavailable."}</Text>
        </View>

        {verification ? (
          <View className="rounded-3xl border border-border bg-surface p-5">
            <Text className="text-lg font-semibold text-foreground">Verification result</Text>
            <Text className={`mt-3 text-base font-semibold ${verification.valid ? "text-success" : "text-error"}`}>{verification.valid ? "Valid package" : "Package validation failed"}</Text>
            <Text className="mt-3 text-sm text-muted">Hash matches: {verification.hashMatches ? "Yes" : "No"}</Text>
            <Text className="mt-1 text-sm text-muted">Signature matches: {verification.signatureMatches ? "Yes" : "No"}</Text>
            <Text className="mt-1 text-sm text-muted">Matches latest server package: {verification.matchesLatestPackage ? "Yes" : "No"}</Text>
            <Text className="mt-1 text-sm text-muted">Linked permit case: {verification.linkedCaseId ?? "Not provided"}</Text>
            <Text className="mt-4 text-xs text-muted">Recalculated SHA-256</Text>
            <Text className="mt-1 text-xs text-foreground">{verification.recalculatedHash}</Text>
            <Text className="mt-4 text-xs text-muted">Verification key</Text>
            <Text className="mt-1 text-xs text-foreground">{verification.verificationKey.keyId} · {verification.verificationKey.algorithm}</Text>
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
