/**
 * ThemeContext — light / dark / auto (system) with backend persistence.
 *
 * Priority order for initial theme:
 *   1. Backend preference (themePrefs.get) — cross-device
 *   2. localStorage — offline fallback
 *   3. "dark" — the default console theme for new users
 *
 * Applied via classes on <html>: "dark" or "light" (mutually exclusive).
 * The bare :root token set in index.css is already dark, so "dark" mainly
 * drives Tailwind `dark:` variants while "light" activates the light override
 * block and `.light`-scoped styles.
 */
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";

export type ThemeMode = "light" | "dark" | "auto";
type ResolvedTheme = "light" | "dark";

interface ThemeContextType {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  cycleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = "ndsep_theme";
const CYCLE_ORDER: ThemeMode[] = ["light", "dark", "auto"];

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolve(mode: ThemeMode): ResolvedTheme {
  return mode === "auto" ? getSystemTheme() : mode;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "dark";
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (stored && CYCLE_ORDER.includes(stored)) return stored;
    // Default new users to the dark console theme (light stays one toggle away)
    return "dark";
  });

  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolved: ResolvedTheme = mode === "auto" ? systemTheme : mode;
  const isDark = resolved === "dark";

  // Listen for OS theme changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Apply theme classes to <html> with transition.
  // "dark" and "light" are mutually exclusive; index.css keys the light
  // override block off :root.light and `.light` selectors, while Tailwind
  // `dark:` utilities key off `.dark`.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("theme-transitioning");
    root.classList.toggle("dark", isDark);
    root.classList.toggle("light", !isDark);
    // Remove transition class after animation completes
    const timer = setTimeout(() => root.classList.remove("theme-transitioning"), 300);
    return () => clearTimeout(timer);
  }, [isDark]);

  // Backend sync
  const setThemeMutation = trpc.themePrefs.set.useMutation();

  const { data: backendPrefs } = trpc.themePrefs.get.useQuery(undefined, {
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (!backendPrefs?.theme) return;
    const bt = backendPrefs.theme as ThemeMode;
    if (!CYCLE_ORDER.includes(bt)) return;
    // The server coalesces "no preference row" to "light". When the user has
    // never made a local choice, don't let that unset default override the
    // dark console default for new users.
    const hasLocalChoice =
      typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) !== null;
    if (bt === "light" && !hasLocalChoice) return;
    if (bt !== mode) {
      setModeState(bt);
      localStorage.setItem(STORAGE_KEY, bt);
    }

  }, [backendPrefs]);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
    // Backend only accepts "light" | "dark" — resolve "auto" before syncing
    const backendTheme: "light" | "dark" = newMode === "auto" ? resolve(newMode) : newMode;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      setThemeMutation.mutate({ theme: backendTheme });
    }, 500);
  }, [setThemeMutation]);

  const cycleTheme = useCallback(() => {
    setMode(CYCLE_ORDER[(CYCLE_ORDER.indexOf(mode) + 1) % CYCLE_ORDER.length]);
  }, [mode, setMode]);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode, cycleTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
