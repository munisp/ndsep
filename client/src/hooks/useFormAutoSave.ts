/**
 * React Hook: Form Auto-Save
 * ============================
 * Debounced auto-save to localStorage with visual indicator.
 *
 * Recommendation M9: Form auto-save for long compliance forms
 *
 * Usage:
 *   const { savedAt, isSaving, clearDraft } = useFormAutoSave("dpia-wizard", formData);
 */

import { useEffect, useCallback, useRef, useState } from "react";

const SAVE_DELAY_MS = 3000; // 3 seconds debounce

export function useFormAutoSave(
  formType: string,
  formData: Record<string, unknown>,
  options?: { enabled?: boolean; debounceMs?: number }
) {
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = options?.enabled ?? true;
  const debounceMs = options?.debounceMs ?? SAVE_DELAY_MS;

  const storageKey = `ndsep_draft_${formType}`;

  // Save draft to localStorage
  const saveDraft = useCallback(() => {
    if (!enabled) return;
    setIsSaving(true);
    try {
      const draft = {
        data: formData,
        savedAt: new Date().toISOString(),
        formType,
      };
      localStorage.setItem(storageKey, JSON.stringify(draft));
      setSavedAt(new Date());
    } catch {
      // localStorage might be full or unavailable
    }
    setIsSaving(false);
  }, [formData, formType, storageKey, enabled]);

  // Debounced save on data change
  useEffect(() => {
    if (!enabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(saveDraft, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [formData, saveDraft, debounceMs, enabled]);

  // Load draft from localStorage
  const loadDraft = useCallback((): Record<string, unknown> | null => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      return draft.data ?? null;
    } catch {
      return null;
    }
  }, [storageKey]);

  // Clear draft (call on successful form submission)
  const clearDraft = useCallback(() => {
    localStorage.removeItem(storageKey);
    setSavedAt(null);
  }, [storageKey]);

  return { savedAt, isSaving, loadDraft, clearDraft };
}
