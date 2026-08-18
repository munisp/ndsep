import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { readStakeholderSyncIndex } from "./stakeholder-sync-index";
import { buildStakeholderSyncDiagnostics } from "./stakeholder-sync-diagnostics-format";
import { encryptAuthorizedSupportDiagnostics } from "./stakeholder-support-crypto";
async function shareJson(document: unknown, fileName: string, title: string) {
  const serialized = JSON.stringify(document, null, 2);
  if (Platform.OS === "web") { const blob = new Blob([serialized], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = globalThis.document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click(); URL.revokeObjectURL(url); return; }
  const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${fileName}`; await FileSystem.writeAsStringAsync(uri, serialized, { encoding: FileSystem.EncodingType.UTF8 }); if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device."); await Sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: title });
}

export async function exportStakeholderSyncDiagnostics() {
  const items = await readStakeholderSyncIndex();
  const document = buildStakeholderSyncDiagnostics(items);
  await shareJson(document, `idlr-pts-stakeholder-sync-diagnostics-${Date.now()}.json`, "Share queue diagnostics");
}
export async function exportEncryptedStakeholderSyncDiagnostics(passphrase: string) { const document = buildStakeholderSyncDiagnostics(await readStakeholderSyncIndex(), true); const encrypted = await encryptAuthorizedSupportDiagnostics(JSON.stringify(document), passphrase, Crypto.getRandomBytes); await shareJson(encrypted, `idlr-pts-encrypted-sync-diagnostics-${Date.now()}.json`, "Share encrypted queue diagnostics"); }
