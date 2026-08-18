import { Platform } from "react-native";

import {
  clearLocalBiometricSession,
  getBiometricSessionMetadata,
  refreshBiometricSession,
  type OidcConfig,
} from "@/lib/oidc-session";

export type SessionNotice =
  | { kind: "refresh_confirmation"; message: string; expiresAt: number; promptedAt: number }
  | { kind: "session_cleared"; message: string };

type Listener = (notice: SessionNotice) => void;
const listeners = new Set<Listener>();
let refreshDecision: ((continueSession: boolean) => void) | null = null;

export function subscribeSessionNotice(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish(notice: SessionNotice) {
  listeners.forEach((listener) => listener(notice));
}

export function resolveSessionRefreshConfirmation(continueSession: boolean) {
  const resolve = refreshDecision;
  refreshDecision = null;
  resolve?.(continueSession);
}

export function notifySessionCleared(message: string) {
  publish({ kind: "session_cleared", message });
}

async function requestSessionRefreshConfirmation(expiresAt: number) {
  if (listeners.size === 0) return null;
  publish({
    kind: "refresh_confirmation",
    message: "Your biometric session is about to expire. Confirm with your device biometrics to continue securely before this request is sent.",
    expiresAt,
    promptedAt: Date.now(),
  });
  return new Promise<boolean>((resolve) => {
    refreshDecision = resolve;
  });
}

/** Called by the API boundary before a request when a native biometric OIDC session exists. */
export async function ensureFreshBiometricSession(config: OidcConfig) {
  if (Platform.OS === "web") return;
  const session = await getBiometricSessionMetadata();
  if (!session || session.expiresAt > Date.now() + 60_000) return;

  const proceed = await requestSessionRefreshConfirmation(session.expiresAt);
  if (proceed === false) {
    await clearLocalBiometricSession();
    notifySessionCleared("Your local biometric session was cleared. Sign in again before making protected changes.");
    throw new Error("Protected request cancelled because session renewal was not confirmed.");
  }

  try {
    await refreshBiometricSession(config);
  } catch (error) {
    notifySessionCleared("Your session refresh was rejected, so its local biometric copy was cleared. Please sign in again.");
    throw error;
  }
}
