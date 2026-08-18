import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import { authorizeTechnicalQueueView } from "./technical-view-authorization";
export async function confirmTechnicalQueueViewAuthorization() { if (Platform.OS === "web") return { approved: false as const, message: "Technical queue history is available only after native device authorization." }; return authorizeTechnicalQueueView(LocalAuthentication); }
