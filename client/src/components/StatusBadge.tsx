import { cn } from "@/lib/utils";
import { type ComponentType } from "react";

type StatusVariant =
  | "critical" | "high" | "medium" | "low" | "success"
  | "warning" | "info" | "neutral" | "active" | "inactive"
  | "pending" | "processing" | "error";

const variantStyles: Record<StatusVariant, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/25",
  medium: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/25",
  low: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25",
  success: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25",
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/25",
  neutral: "bg-muted text-muted-foreground border-border",
  active: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25",
  inactive: "bg-muted text-muted-foreground border-border",
  pending: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/25",
  processing: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25",
  error: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25",
};

interface StatusBadgeProps {
  variant: StatusVariant;
  children: React.ReactNode;
  icon?: ComponentType<{ className?: string }>;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Unified status badge — theme-safe (works in both light and dark modes).
 * Replaces 335+ ad-hoc badge color definitions across pages.
 */
export function StatusBadge({ variant, children, icon: Icon, size = "sm", className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        variantStyles[variant],
        className
      )}
    >
      {Icon && <Icon className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />}
      {children}
    </span>
  );
}

/** Helper to map common status strings to variants */
export function getStatusVariant(status: string): StatusVariant {
  const normalized = status.toLowerCase().replace(/[_-]/g, "");
  const mapping: Record<string, StatusVariant> = {
    critical: "critical",
    high: "high",
    medium: "medium",
    low: "low",
    success: "success",
    completed: "success",
    resolved: "success",
    closed: "neutral",
    active: "active",
    inactive: "inactive",
    pending: "pending",
    draft: "neutral",
    processing: "processing",
    inprogress: "processing",
    underinvestigation: "processing",
    warning: "warning",
    degraded: "warning",
    error: "error",
    failed: "error",
    unhealthy: "error",
    healthy: "success",
    open: "high",
    detected: "critical",
    contained: "warning",
    noticeissued: "warning",
    escalated: "high",
    escalatedtonitda: "high",
    settled: "success",
  };
  return mapping[normalized] ?? "neutral";
}
