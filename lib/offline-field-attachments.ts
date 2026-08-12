import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
export { MAX_OFFLINE_ATTACHMENTS_PER_MANIFEST, MAX_OFFLINE_ATTACHMENT_BYTES } from "./offline-field-attachment-policy";
import { MAX_OFFLINE_ATTACHMENT_BYTES } from "./offline-field-attachment-policy";

export type OfflineFieldAttachment = {
  id: string;
  kind: "photo" | "file";
  name: string;
  mimeType: string | null;
  size: number | null;
  localUri: string;
  persistence: "app_document_directory" | "browser_session";
  capturedAt: string;
};

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-96) || "field-evidence";
}

export async function persistOfflineFieldAttachment(input: Omit<OfflineFieldAttachment, "id" | "localUri" | "persistence" | "capturedAt"> & { uri: string }) {
  const id = `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const capturedAt = new Date().toISOString();
  const info = await FileSystem.getInfoAsync(input.uri);
  const detectedSize = info.exists && "size" in info && typeof info.size === "number" ? info.size : null;
  const resolvedSize = typeof input.size === "number" ? input.size : detectedSize;
  if (resolvedSize !== null && resolvedSize > MAX_OFFLINE_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds the ${Math.round(MAX_OFFLINE_ATTACHMENT_BYTES / (1024 * 1024))} MB offline storage limit.`);
  }
  if (Platform.OS === "web" || !FileSystem.documentDirectory) {
    return { ...input, size: resolvedSize, id, localUri: input.uri, persistence: "browser_session" as const, capturedAt };
  }
  const directory = `${FileSystem.documentDirectory}field-evidence/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const localUri = `${directory}${id}-${safeName(input.name)}`;
  await FileSystem.copyAsync({ from: input.uri, to: localUri });
  return { ...input, size: resolvedSize, id, localUri, persistence: "app_document_directory" as const, capturedAt };
}

export async function deleteOfflineFieldAttachment(attachment: OfflineFieldAttachment) {
  if (attachment.persistence === "app_document_directory") {
    const info = await FileSystem.getInfoAsync(attachment.localUri);
    if (info.exists) await FileSystem.deleteAsync(attachment.localUri, { idempotent: true });
  }
}

export function getOfflineAttachmentUsage(attachments: OfflineFieldAttachment[]) {
  const usedBytes = attachments.reduce((total, attachment) => total + (attachment.size ?? 0), 0);
  return { usedBytes, limitBytes: 50 * 1024 * 1024, percent: Math.min(100, Math.round((usedBytes / (50 * 1024 * 1024)) * 100)) };
}
