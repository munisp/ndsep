import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface PageLoaderProps {
  /** Text shown below the spinner */
  message?: string;
  className?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: "h-5 w-5",
  md: "h-8 w-8",
  lg: "h-10 w-10",
};

/**
 * Standard full-page or section loading state.
 * Replaces 62+ inconsistent spinner implementations.
 */
export function PageLoader({ message, className, size = "md" }: PageLoaderProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center min-h-[16rem] gap-3", className)}>
      <Loader2 className={cn("animate-spin text-primary", sizeMap[size])} />
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}

interface InlineLoaderProps {
  className?: string;
  size?: "xs" | "sm" | "md";
}

const inlineSizeMap = {
  xs: "h-3 w-3",
  sm: "h-4 w-4",
  md: "h-5 w-5",
};

/** Inline spinner for buttons, cells, etc. */
export function InlineLoader({ className, size = "sm" }: InlineLoaderProps) {
  return <Loader2 className={cn("animate-spin", inlineSizeMap[size], className)} />;
}
