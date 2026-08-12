import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

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
  if (Platform.OS === "web" || !FileSystem.documentDirectory) {
    return { ...input, id, localUri: input.uri, persistence: "browser_session" as const, capturedAt };
  }
  const directory = `${FileSystem.documentDirectory}field-evidence/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const localUri = `${directory}${id}-${safeName(input.name)}`;
  await FileSystem.copyAsync({ from: input.uri, to: localUri });
  return { ...input, id, localUri, persistence: "app_document_directory" as const, capturedAt };
}
