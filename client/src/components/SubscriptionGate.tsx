import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Lock, Zap, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Tier = "starter" | "professional" | "enterprise";

const TIER_RANK: Record<Tier, number> = {
  starter: 0,
  professional: 1,
  enterprise: 2,
};

const TIER_LABELS: Record<Tier, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

const TIER_COLORS: Record<Tier, string> = {
  starter: "text-muted-foreground",
  professional: "text-emerald-600 dark:text-emerald-400",
  enterprise: "text-amber-600 dark:text-amber-400",
};

interface SubscriptionGateProps {
  requiredTier: Tier;
  featureName: string;
  children: React.ReactNode;
}

export function SubscriptionGate({ requiredTier, featureName, children }: SubscriptionGateProps) {
  const { data, isLoading } = trpc.accreditation.getMyTier.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
      </div>
    );
  }

  const currentTier = (data?.tier ?? "starter") as Tier;
  const hasAccess = TIER_RANK[currentTier] >= TIER_RANK[requiredTier];

  if (hasAccess) return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-muted/50 px-6">
      <div className="max-w-md w-full bg-card rounded-2xl border border-border p-8 text-center shadow-sm">
        <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-5">
          <Lock className="w-6 h-6 text-amber-500" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          {featureName} requires {TIER_LABELS[requiredTier]}
        </h2>
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
          Your current plan is{" "}
          <span className={`font-semibold ${TIER_COLORS[currentTier]}`}>
            {TIER_LABELS[currentTier]}
          </span>
          . Upgrade to{" "}
          <span className={`font-semibold ${TIER_COLORS[requiredTier]}`}>
            {TIER_LABELS[requiredTier]}
          </span>{" "}
          or higher to unlock {featureName}.
        </p>

        <div className="bg-muted/50 rounded-xl border border-border p-4 mb-6 text-left">
          <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-emerald-500" />
            What you get with {TIER_LABELS[requiredTier]}:
          </p>
          {requiredTier === "professional" && (
            <ul className="space-y-1.5">
              {[
                "AI Gap Analysis — map NDPA gaps in under 60 seconds",
                "CAR Narrative Generator — professional narratives from ratings",
                "Risk Prediction Engine — DCPMI-based client risk scoring",
                "Up to 25 active audit engagements",
                "Performance Scorecard visibility",
              ].map(f => (
                <li key={f} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <span className="text-emerald-500 mt-0.5">✓</span> {f}
                </li>
              ))}
            </ul>
          )}
          {requiredTier === "enterprise" && (
            <ul className="space-y-1.5">
              {[
                "Unlimited audit engagements",
                "Full AI suite + Risk Prediction",
                "Unlimited Evidence Vault",
                "Dedicated account manager",
                "API access",
              ].map(f => (
                <li key={f} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <span className="text-emerald-500 mt-0.5">✓</span> {f}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Link href="/dpco/subscription">
            <Button className="w-full bg-emerald-700 hover:bg-emerald-800 text-white text-sm h-9">
              Upgrade to {TIER_LABELS[requiredTier]} <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
          <Link href="/dpco-brochure">
            <Button variant="outline" className="w-full text-sm h-9 text-muted-foreground">
              Compare Plans
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
