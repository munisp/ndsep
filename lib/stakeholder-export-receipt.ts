import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { createDiagnosticExportReceipt, type DiagnosticExportReceipt } from "./stakeholder-export-receipt-crypto";

const KEY = "idlr_pts_mobile.diagnostic_export_receipt_signing_key.v1";
async function signingKey() { const existing = await SecureStore.getItemAsync(KEY); if (existing) return existing; const key = Array.from(Crypto.getRandomBytes(32), (byte) => byte.toString(16).padStart(2, "0")).join(""); await SecureStore.setItemAsync(KEY, key); return key; }
async function downloadReceipt(receipt: DiagnosticExportReceipt) { const serialized = JSON.stringify(receipt, null, 2); const name = `idlr-pts-diagnostic-export-receipt-${receipt.receiptId}.json`; if (Platform.OS === "web") { const blob = new Blob([serialized], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = globalThis.document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); return; } const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${name}`; await FileSystem.writeAsStringAsync(uri, serialized, { encoding: FileSystem.EncodingType.UTF8 }); if (!(await Sharing.isAvailableAsync())) throw new Error("The package was exported, but a receipt could not be shared on this device."); await Sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: "Save diagnostic export receipt" }); }
export async function createAndDownloadDiagnosticExportReceipt(packageDocument: unknown, packageType: DiagnosticExportReceipt["packageType"]) { const receipt = await createDiagnosticExportReceipt(packageDocument, packageType, await signingKey(), Crypto.randomUUID(), new Date().toISOString()); await downloadReceipt(receipt); return receipt; }
