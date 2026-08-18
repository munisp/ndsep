import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { readStakeholderSyncIndex } from "./stakeholder-sync-index";
import { buildStakeholderSyncDiagnostics } from "./stakeholder-sync-diagnostics-format";

export async function exportStakeholderSyncDiagnostics() {
  const items = await readStakeholderSyncIndex();
  const document = buildStakeholderSyncDiagnostics(items);
  if (Platform.OS === "web") { const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = globalThis.document.createElement("a"); anchor.href = url; anchor.download = `idlr-pts-stakeholder-sync-diagnostics-${Date.now()}.json`; anchor.click(); URL.revokeObjectURL(url); return; }
  const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}idlr-pts-stakeholder-sync-diagnostics-${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(document, null, 2), { encoding: FileSystem.EncodingType.UTF8 });
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device.");
  await Sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: "Share queue diagnostics" });
}
