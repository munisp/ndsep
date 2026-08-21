import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { buildAuditCsv, buildAuditReportHtml, type ExportAuditEvent, type ExportIntegrity } from "./security-audit-export-format";
export { buildAuditCsv, buildAuditReportHtml, type ExportAuditEvent, type ExportIntegrity } from "./security-audit-export-format";

function triggerWebDownload(content: string, fileName: string, mimeType: string) { const blob = new Blob([content], { type: mimeType }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click(); URL.revokeObjectURL(url); }

export async function exportAuditCsv(events: ExportAuditEvent[], integrity: ExportIntegrity) {
  const content = buildAuditCsv(events, integrity); const name = `idlrpts-security-audit-${Date.now()}.csv`;
  if (Platform.OS === "web") { triggerWebDownload(content, name, "text/csv"); return; }
  const uri = `${FileSystem.cacheDirectory}${name}`; await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 }); await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Share security audit CSV" });
}

export async function exportAuditPdf(events: ExportAuditEvent[], integrity: ExportIntegrity) {
  const html = buildAuditReportHtml(events, integrity); if (Platform.OS === "web") { triggerWebDownload(html, `idlrpts-security-audit-${Date.now()}.html`, "text/html"); return; }
  const { uri } = await Print.printToFileAsync({ html }); await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Share security audit report" });
}
