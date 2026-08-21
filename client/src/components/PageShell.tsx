import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageShellProps {
  children: ReactNode;
  className?: string;
  /** Max width constraint — defaults to full width */
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
}

const maxWidthMap = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-5xl",
  xl: "max-w-6xl",
  "2xl": "max-w-7xl",
  full: "",
};

/**
 * Standard page wrapper — provides consistent vertical spacing
 * and optional max-width constraint. Use inside DashboardLayout.
 */
export function PageShell({ children, className, maxWidth = "full" }: PageShellProps) {
  return (
    <div className={cn("space-y-6", maxWidthMap[maxWidth], maxWidth !== "full" && "mx-auto", className)}>
      {children}
    </div>
  );
}
