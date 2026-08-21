/**
 * PwaLockScreen
 *
 * Full-screen lock overlay shown when the PWA inactivity timer fires.
 * Supports:
 *  - WebAuthn (fingerprint / Face ID) — attempted automatically on mount
 *  - 4-digit PIN fallback
 *  - First-time PIN setup if no PIN is configured
 */
import { useState, useEffect, useRef } from "react";
import { Shield, Fingerprint, Loader2, Delete, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type UsePwaLockResult } from "@/hooks/usePwaLock";

interface PwaLockScreenProps {
  lock: UsePwaLockResult;
}

const PIN_LENGTH = 4;

export function PwaLockScreen({ lock }: PwaLockScreenProps) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [setupStep, setSetupStep] = useState<"enter" | "confirm">("enter");
  const [error, setError] = useState("");
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isSetup = !lock.hasPinSet;

  // Auto-attempt biometric on mount if available
  useEffect(() => {
    if (!isSetup && lock.hasWebAuthn) {
      handleBiometric();
    }
    // Focus hidden input for keyboard PIN entry
    inputRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBiometric() {
    setBiometricLoading(true);
    setError("");
    try {
      const ok = await lock.unlockWithBiometric();
      if (!ok) setError("Biometric authentication failed. Please use your PIN.");
    } finally {
      setBiometricLoading(false);
    }
  }

  async function handlePinDigit(digit: string) {
    setError("");
    const next = (isSetup && setupStep === "confirm" ? confirmPin : pin) + digit;

    if (isSetup) {
      if (setupStep === "enter") {
        setPin(next);
        if (next.length === PIN_LENGTH) setSetupStep("confirm");
      } else {
        setConfirmPin(next);
        if (next.length === PIN_LENGTH) {
          if (next === pin) {
            await lock.setPin(pin);
          } else {
            setError("PINs do not match. Try again.");
            setPin("");
            setConfirmPin("");
            setSetupStep("enter");
          }
        }
      }
    } else {
      setPin(next);
      if (next.length === PIN_LENGTH) {
        const ok = await lock.unlockWithPin(next);
        if (!ok) {
          setError("Incorrect PIN. Try again.");
          setPin("");
        }
      }
    }
  }

  function handleDelete() {
    setError("");
    if (isSetup && setupStep === "confirm") {
      setConfirmPin((p) => p.slice(0, -1));
    } else {
      setPin((p) => p.slice(0, -1));
    }
  }

  const currentPin = isSetup && setupStep === "confirm" ? confirmPin : pin;
  const dots = Array.from({ length: PIN_LENGTH }, (_, i) => i < currentPin.length);

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center px-6">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-600 to-violet-700 flex items-center justify-center shadow-lg shadow-cyan-900/30">
          <Shield className="h-8 w-8 text-white" />
        </div>
        <div className="text-center">
          <p className="text-lg font-black text-white tracking-tight">NDSEP DPCO</p>
          <p className="text-xs text-muted-foreground">
            {isSetup
              ? setupStep === "enter"
                ? "Create a 4-digit PIN to secure your data"
                : "Confirm your PIN"
              : "Enter your PIN to continue"}
          </p>
        </div>
      </div>

      {/* PIN dots */}
      <div className="flex gap-4 mb-6">
        {dots.map((filled, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
              filled
                ? "bg-cyan-400 border-cyan-400 scale-110"
                : "bg-transparent border-border"
            }`}
          />
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-rose-400 mb-4 text-center animate-pulse">{error}</p>
      )}

      {/* Biometric button */}
      {!isSetup && lock.hasWebAuthn && (
        <button
          onClick={handleBiometric}
          disabled={biometricLoading}
          className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 mb-6 transition-colors"
        >
          {biometricLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Fingerprint className="h-5 w-5" />
          )}
          Use Biometrics
        </button>
      )}

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button
            key={n}
            onClick={() => handlePinDigit(String(n))}
            className="h-14 rounded-2xl bg-card border border-border/50 text-xl font-bold text-white hover:bg-muted/80 active:scale-95 transition-all"
          >
            {n}
          </button>
        ))}
        {/* Bottom row: show/hide | 0 | delete */}
        <button
          onClick={() => setShowPin((v) => !v)}
          className="h-14 rounded-2xl bg-muted/60 border border-border/30 flex items-center justify-center text-muted-foreground hover:text-white transition-colors"
        >
          {showPin ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
        <button
          onClick={() => handlePinDigit("0")}
          className="h-14 rounded-2xl bg-card border border-border/50 text-xl font-bold text-white hover:bg-muted/80 active:scale-95 transition-all"
        >
          0
        </button>
        <button
          onClick={handleDelete}
          className="h-14 rounded-2xl bg-muted/60 border border-border/30 flex items-center justify-center text-muted-foreground hover:text-white transition-colors"
        >
          <Delete className="h-5 w-5" />
        </button>
      </div>

      {/* Hidden input for hardware keyboard */}
      <input
        ref={inputRef}
        type={showPin ? "text" : "password"}
        inputMode="numeric"
        maxLength={PIN_LENGTH}
        value={currentPin}
        onChange={(e) => {
          const val = e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
          for (const ch of val.slice(currentPin.length)) handlePinDigit(ch);
        }}
        className="sr-only"
        aria-label="PIN entry"
      />

      <p className="text-[10px] text-muted-foreground mt-8 text-center">
        Session locked after 5 minutes of inactivity
      </p>
    </div>
  );
}
