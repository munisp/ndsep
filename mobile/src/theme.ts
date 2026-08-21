/**
 * NDSEP Mobile Design Tokens
 * Single source of truth for all colors, spacing, typography.
 * Import this instead of hardcoding hex values.
 */

export const colors = {
  // Backgrounds
  background: "#0a0a0a",
  card: "#111827",
  cardBorder: "#1f2937",
  input: "#1f2937",
  surface: "#1a1a2e",

  // Text
  text: "#ffffff",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  textInverse: "#0a0a0a",

  // Brand
  primary: "#3b82f6",
  primaryLight: "#60a5fa",
  primaryDark: "#2563eb",

  // Semantic
  success: "#10b981",
  successLight: "#34d399",
  warning: "#f59e0b",
  warningLight: "#fbbf24",
  danger: "#ef4444",
  dangerLight: "#f87171",
  dangerDark: "#dc2626",
  info: "#06b6d4",

  // Status badge backgrounds (with transparency)
  criticalBg: "#7f1d1d",
  highBg: "#78350f",
  mediumBg: "#854d0e",
  lowBg: "#1e3a5f",
  successBg: "#064e3b",
  pendingBg: "#713f12",

  // Misc
  border: "#374151",
  separator: "#1f2937",
  overlay: "rgba(0, 0, 0, 0.6)",
  tabBarActive: "#3b82f6",
  tabBarInactive: "#6b7280",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 12,
  md: 13,
  base: 14,
  lg: 16,
  xl: 18,
  xxl: 24,
  heading: 24,
  display: 32,
} as const;

export const fontWeight = {
  normal: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};
