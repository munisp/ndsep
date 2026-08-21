/**
 * usePwaLock
 *
 * Provides a 5-minute inactivity lock for the DPCO PWA in standalone mode.
 *
 * Behaviour:
 *  - Only activates when running as an installed PWA (display-mode: standalone)
 *  - Resets the inactivity timer on any pointer/keyboard/touch/scroll event
 *  - After LOCK_TIMEOUT_MS of inactivity the app is "locked"
 *  - Unlock attempts WebAuthn (fingerprint/Face ID) first; falls back to PIN
 *  - PIN is stored as a SHA-256 hash in localStorage (never plaintext)
 *  - Session unlock state is kept in sessionStorage so it survives hot-reloads
 *    but not browser restarts
 */
import { useState, useEffect, useCallback, useRef } from "react";

const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const PIN_HASH_KEY = "ndsep_pwa_pin_hash";
const SESSION_UNLOCKED_KEY = "ndsep_pwa_unlocked";
const WEBAUTHN_CRED_KEY = "ndsep_pwa_webauthn_cred";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function webAuthnAuthenticate(credentialId: string): Promise<boolean> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          { type: "public-key", id: Uint8Array.from(atob(credentialId), (c) => c.charCodeAt(0)) },
        ],
        userVerification: "required",
        timeout: 30000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export interface UsePwaLockResult {
  isLocked: boolean;
  hasPinSet: boolean;
  hasWebAuthn: boolean;
  unlockWithPin: (pin: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
  setPin: (pin: string) => Promise<void>;
  clearPin: () => void;
  lockNow: () => void;
}

export function usePwaLock(): UsePwaLockResult {
  const [isLocked, setIsLocked] = useState(false);
  const [hasPinSet, setHasPinSet] = useState(false);
  const [hasWebAuthn, setHasWebAuthn] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);

  // Initialise state
  useEffect(() => {
    setHasPinSet(!!localStorage.getItem(PIN_HASH_KEY));
    setHasWebAuthn(!!localStorage.getItem(WEBAUTHN_CRED_KEY));

    // If not standalone, never lock
    if (!isStandalone()) return;

    // Restore session unlock state
    const sessionUnlocked = sessionStorage.getItem(SESSION_UNLOCKED_KEY);
    if (sessionUnlocked === "1") {
      setIsLocked(false);
    }
  }, []);

  // Inactivity timer — only in standalone mode
  useEffect(() => {
    if (!isStandalone()) return;

    const resetTimer = () => {
      if (!activeRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setIsLocked(true);
        sessionStorage.removeItem(SESSION_UNLOCKED_KEY);
      }, LOCK_TIMEOUT_MS);
    };

    const events = ["pointerdown", "pointermove", "keydown", "touchstart", "scroll", "wheel"];
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer(); // start the initial timer

    return () => {
      activeRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, []);

  const unlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    const stored = localStorage.getItem(PIN_HASH_KEY);
    if (!stored) return false;
    const hash = await sha256(pin);
    if (hash === stored) {
      setIsLocked(false);
      sessionStorage.setItem(SESSION_UNLOCKED_KEY, "1");
      return true;
    }
    return false;
  }, []);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    const credId = localStorage.getItem(WEBAUTHN_CRED_KEY);
    if (!credId) return false;
    const ok = await webAuthnAuthenticate(credId);
    if (ok) {
      setIsLocked(false);
      sessionStorage.setItem(SESSION_UNLOCKED_KEY, "1");
    }
    return ok;
  }, []);

  const setPin = useCallback(async (pin: string): Promise<void> => {
    const hash = await sha256(pin);
    localStorage.setItem(PIN_HASH_KEY, hash);
    setHasPinSet(true);
  }, []);

  const clearPin = useCallback(() => {
    localStorage.removeItem(PIN_HASH_KEY);
    localStorage.removeItem(WEBAUTHN_CRED_KEY);
    setHasPinSet(false);
    setHasWebAuthn(false);
  }, []);

  const lockNow = useCallback(() => {
    setIsLocked(true);
    sessionStorage.removeItem(SESSION_UNLOCKED_KEY);
  }, []);

  return { isLocked, hasPinSet, hasWebAuthn, unlockWithPin, unlockWithBiometric, setPin, clearPin, lockNow };
}
