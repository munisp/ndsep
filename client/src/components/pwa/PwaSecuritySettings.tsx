/**
 * PwaSecuritySettings
 *
 * Settings panel for managing the PWA lock screen PIN.
 * Shown in the DPCO PWA settings tab.
 */
import { useState } from "react";
import { Lock, Unlock, Trash2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { type UsePwaLockResult } from "@/hooks/usePwaLock";

interface PwaSecuritySettingsProps {
  lock: UsePwaLockResult;
}

export function PwaSecuritySettings({ lock }: PwaSecuritySettingsProps) {
  const [showSetup, setShowSetup] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");

  async function handleSavePin() {
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      setError("PIN must be exactly 4 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      setError("PINs do not match.");
      return;
    }
    await lock.setPin(newPin);
    setShowSetup(false);
    setNewPin("");
    setConfirmPin("");
    setError("");
    toast.success("PIN set successfully. Your PWA will lock after 5 minutes of inactivity.");
  }

  function handleClearPin() {
    lock.clearPin();
    toast.success("PIN removed. The PWA will no longer auto-lock.");
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-violet-400" />
        <div>
          <p className="text-sm font-semibold text-white">App Lock</p>
          <p className="text-[11px] text-muted-foreground">
            {lock.hasPinSet
              ? "PIN active — app locks after 5 min inactivity"
              : "No PIN set — app will not auto-lock"}
          </p>
        </div>
      </div>

      {showSetup ? (
        <div className="space-y-2">
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="New 4-digit PIN"
            value={newPin}
            onChange={(e) => { setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }}
            className="w-full bg-muted border border-border/50 rounded-xl px-3 py-2 text-sm text-white placeholder-muted-foreground focus-visible:outline-none focus-visible:border-violet-500/60 tracking-widest text-center"
          />
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="Confirm PIN"
            value={confirmPin}
            onChange={(e) => { setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }}
            className="w-full bg-muted border border-border/50 rounded-xl px-3 py-2 text-sm text-white placeholder-muted-foreground focus-visible:outline-none focus-visible:border-violet-500/60 tracking-widest text-center"
          />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="outline"
              className="flex-1 text-xs border-border text-foreground"
              onClick={() => { setShowSetup(false); setNewPin(""); setConfirmPin(""); setError(""); }}>
              Cancel
            </Button>
            <Button size="sm"
              className="flex-1 text-xs bg-violet-600 hover:bg-violet-500 text-white"
              onClick={handleSavePin}>
              Save PIN
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="outline"
            className="flex-1 text-xs border-border text-foreground hover:text-white gap-1.5"
            onClick={() => setShowSetup(true)}>
            <Lock className="h-3 w-3" />
            {lock.hasPinSet ? "Change PIN" : "Set PIN"}
          </Button>
          {lock.hasPinSet && (
            <>
              <Button size="sm" variant="outline"
                className="flex-1 text-xs border-border text-foreground hover:text-white gap-1.5"
                onClick={lock.lockNow}>
                <Unlock className="h-3 w-3" />
                Lock Now
              </Button>
              <Button size="sm" variant="outline"
                className="text-xs border-rose-800/60 text-rose-400 hover:text-rose-300 gap-1.5 px-3"
                onClick={handleClearPin}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
