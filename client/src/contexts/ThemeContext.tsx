/**
 * ThemeContext — light / dark / auto (system) with backend persistence.
 *
 * Priority order for initial theme:
 *   1. Backend preference (themePrefs.get) — cross-device
 *   2. localStorage — offline fallback
 *   3. "auto" (follows OS preference)
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
    if (typeof window === "undefined") return "auto";
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (stored && CYCLE_ORDER.includes(stored)) return stored;
    return "auto";
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

  // Apply theme class to <html> with transition
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("theme-transitioning");
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
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
    if (CYCLE_ORDER.includes(bt) && bt !== mode) {
      setModeState(bt);
      localStorage.setItem(STORAGE_KEY, bt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
