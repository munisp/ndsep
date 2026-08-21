import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  message?: string;
  retry?: () => void;
  action?: ReactNode;
  className?: string;
}

/**
 * Standard error state for failed data queries.
 * Provides consistent error display with optional retry.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  retry,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4 text-center", className)}>
      <div className="rounded-full bg-destructive/10 p-4 mb-4">
        <AlertTriangle className="h-8 w-8 text-destructive" />
      </div>
      <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
      {message && <p className="text-sm text-muted-foreground max-w-sm">{message}</p>}
      <div className="mt-4 flex gap-2">
        {retry && (
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        )}
        {action}
      </div>
    </div>
  );
}
