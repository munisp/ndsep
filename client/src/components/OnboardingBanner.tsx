import { useState } from "react";
import { X, CheckCircle2, Circle, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";

export function OnboardingBanner() {
  const [, navigate] = useLocation();
  const [dismissed, setDismissed] = useState(false);

  const { data: bannerData } = trpc.onboardingChecklist.shouldShowBanner.useQuery(undefined, {
    staleTime: 30_000,
  });

  const dismissBanner = trpc.onboardingChecklist.dismissBanner.useMutation({
    onSuccess: () => setDismissed(true),
  });

  if (dismissed || !bannerData?.show) return null;

  const { completedCount = 0, totalSteps = 5, percentComplete = 0 } = bannerData;

  return (
    <div className="mx-4 mt-3 mb-1 rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-900/40 via-[#0d1f3c] to-cyan-900/30 px-4 py-3 flex items-center gap-4 shadow-lg">
      <div className="flex-shrink-0">
        <Sparkles className="h-5 w-5 text-indigo-400" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-indigo-200">
            Welcome to NDSEP — Complete your onboarding
          </span>
          <span className="text-xs text-muted-foreground">
            {completedCount}/{totalSteps} steps done
          </span>
        </div>
        {/* Progress bar */}
        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className="bg-gradient-to-r from-indigo-500 to-cyan-400 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${percentComplete}%` }}
          />
        </div>
      </div>

      <Button
        size="sm"
        variant="ghost"
        className="text-indigo-300 hover:text-indigo-100 hover:bg-indigo-500/20 text-xs gap-1 flex-shrink-0"
        onClick={() => navigate("/onboarding-checklist")}
      >
        View checklist <ArrowRight className="h-3 w-3" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-foreground flex-shrink-0"
        onClick={() => dismissBanner.mutate()}
        aria-label="Dismiss banner"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
