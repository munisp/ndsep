import { useState } from "react";
import { CheckCircle2, Circle, ArrowRight, Trophy, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
const STEP_ICONS: Record<string, string> = {
  profile: "🏢",
  assets: "📦",
  dpo: "👤",
  ropa: "📋",
  tutorial: "🎓",
};

export default function OnboardingChecklist() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.onboardingChecklist.getChecklist.useQuery();

  const completeStep = trpc.onboardingChecklist.completeStep.useMutation({
    onSuccess: (res) => {
      utils.onboardingChecklist.getChecklist.invalidate();
      utils.onboardingChecklist.shouldShowBanner.invalidate();
      if (res.allComplete) {
        toast.success("🎉 Congratulations! You have completed all onboarding steps!", { duration: 6000 });
      } else {
        toast.success("Step marked as complete!");
      }
    },
  });

  if (isLoading) {
    return (
      <>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 text-cyan-600 animate-spin" />
        </div>
      </>
    );
  }

  const { steps = [], completedCount = 0, totalSteps = 5, percentComplete = 0, isComplete = false, totalPoints = 0 } = data ?? {};

  return (
    <>
      <div className="p-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="h-7 w-7 text-indigo-400" />
            <h1 className="text-2xl font-bold text-foreground">Getting Started with NDSEP</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Complete these steps to fully set up your organisation on the National Data Sovereignty Enforcement Platform.
          </p>
        </div>

        {/* Progress card */}
        <div className="bg-muted border border-indigo-500/20 rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-3xl font-bold text-indigo-300">{percentComplete}%</div>
              <div className="text-sm text-muted-foreground">{completedCount} of {totalSteps} steps complete</div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1 text-amber-400">
                <Trophy className="h-5 w-5" />
                <span className="text-xl font-bold">{totalPoints}</span>
              </div>
              <div className="text-xs text-muted-foreground">points earned</div>
            </div>
          </div>
          <div className="w-full bg-muted rounded-full h-3">
            <div
              className="bg-gradient-to-r from-indigo-500 to-cyan-400 h-3 rounded-full transition-all duration-700"
              style={{ width: `${percentComplete}%` }}
            />
          </div>
          {isComplete && (
            <div className="mt-4 flex items-center gap-2 text-emerald-400 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4" />
              All steps complete! Your organisation is fully onboarded.
            </div>
          )}
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {steps.map((step: any, idx: number) => (
            <div
              key={step.id}
              className={`rounded-xl border p-4 flex items-center gap-4 transition-all ${
                step.completed
                  ? "border-emerald-500/20 bg-emerald-900/10"
                  : "border-border/50 bg-muted hover:border-indigo-500/30"
              }`}
            >
              {/* Step number / check */}
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-lg ${
                step.completed ? "bg-emerald-500/20" : "bg-muted"
              }`}>
                {step.completed ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                ) : (
                  <span>{STEP_ICONS[step.id] ?? `${idx + 1}`}</span>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`font-medium text-sm ${step.completed ? "text-emerald-600 line-through opacity-70" : "text-foreground"}`}>
                    {step.label}
                  </span>
                  <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                    +{step.points} pts
                  </Badge>
                </div>
                {step.completed && step.completedAt && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Completed {new Date(step.completedAt).toLocaleDateString()}
                  </div>
                )}
              </div>

              {/* Action */}
              {!step.completed ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-indigo-300 hover:text-indigo-100 text-xs gap-1"
                    onClick={() => navigate(step.path)}
                  >
                    Go <ArrowRight className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs"
                    onClick={() => completeStep.mutate({ stepId: step.id })}
                    disabled={completeStep.isPending}
                  >
                    Mark done
                  </Button>
                </div>
              ) : (
                <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0" />
              )}
            </div>
          ))}
        </div>

        {/* Tips */}
        <div className="mt-8 p-4 rounded-xl bg-cyan-900/10 border border-border">
          <h3 className="text-sm font-semibold text-cyan-600 mb-2">💡 Tips for new organisations</h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Start by completing your organisation profile — it unlocks all sector-specific features.</li>
            <li>• Appoint a DPO early — it is a legal requirement under NDPA Section 30 for data controllers processing personal data at scale.</li>
            <li>• Your ROPA must be kept up to date and available for inspection by the NDPC at any time.</li>
            <li>• The Getting Started tutorial takes about 10 minutes and covers all key platform features.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
