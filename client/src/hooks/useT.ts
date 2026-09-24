/**
 * useT — thin typed wrapper around the existing i18n setup (gap 9)
 *
 * Wraps react-i18next's useTranslation, guarantees the citizen-facing
 * extension bundles (client/src/lib/i18nCitizen.ts) are registered, and
 * exposes the active language + a switcher so citizen surfaces can render a
 * language picker without touching i18next directly.
 *
 * Usage:
 *   const { t, language, setLanguage, languages } = useT();
 *   <h1>{t("whistleblower.title")}</h1>
 */
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { registerCitizenBundles } from "@/lib/i18nCitizen";

registerCitizenBundles();

export interface UseTResult {
  /** i18next translate function; supports interpolation, e.g. t("dsar.successMessage", { ref }) */
  t: ReturnType<typeof useTranslation>["t"];
  /** Active language code (en | ha | yo | ig | fr) */
  language: string;
  /** Switch language; persisted to localStorage by the detector */
  setLanguage: (code: string) => void;
  /** Supported languages with native names, for pickers */
  languages: typeof SUPPORTED_LANGUAGES;
  isRTL: boolean;
}

export function useT(): UseTResult {
  const { t, i18n } = useTranslation();

  const setLanguage = useCallback(
    (code: string) => {
      void i18n.changeLanguage(code);
    },
    [i18n],
  );

  const language = useMemo(() => (i18n.language ?? "en").split("-")[0], [i18n.language]);

  return {
    t,
    language,
    setLanguage,
    languages: SUPPORTED_LANGUAGES,
    isRTL: false, // none of the supported languages are RTL; kept for future Arabic support
  };
}

export default useT;
