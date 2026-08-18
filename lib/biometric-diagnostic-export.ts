import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import { authorizeEncryptedDiagnosticsExport } from "./biometric-export-authorization";

export async function confirmEncryptedDiagnosticsExport() { if (Platform.OS === "web") return { approved: false as const, message: "Encrypted support packages require biometric confirmation in the native application." }; return authorizeEncryptedDiagnosticsExport(LocalAuthentication); }
