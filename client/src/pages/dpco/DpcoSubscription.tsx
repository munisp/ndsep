import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  XCircle,
  Zap,
  Shield,
  Building2,
  CreditCard,
  TrendingUp,
  Users,
  ClipboardCheck,
  Percent,
  Calendar,
  AlertTriangle,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

// ─── Constants ────────────────────────────────────────────────────────────────
const DEMO_DPCO_ORG_ID = 1;

const TIER_META: Record<
  string,
  {
    color: string;
    border: string;
    bg: string;
    icon: React.ElementType;
    badge: string;
    highlight: boolean;
  }
> = {
  starter: {
    color: "text-muted-foreground",
    border: "border-border",
    bg: "bg-muted",
    icon: Shield,
    badge: "bg-muted text-muted-foreground",
    highlight: false,
  },
  professional: {
    color: "text-blue-700",
    border: "border-blue-500/30",
    bg: "bg-blue-50",
    icon: Zap,
    badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    highlight: true,
  },
  enterprise: {
    color: "text-purple-700",
    border: "border-purple-500/30",
    bg: "bg-purple-50",
    icon: Building2,
    badge: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    highlight: false,
  },
};

const FEATURE_LABELS: Record<string, string> = {
  basic_audit: "Basic Compliance Audits",
  advanced_audit: "Advanced / Multi-Layer Audits",
  policy_drafts: "Policy & Contract Drafting",
  training: "Staff Training Sessions",
  evidence_vault: "Evidence Vault Access",
  analytics: "Earnings & Revenue Analytics",
  api_access: "API Access (Webhook + REST)",
  white_label: "White-Label Client Reports",
  dedicated_support: "Dedicated NDPC Liaison Support",
};

const ALL_FEATURES = Object.keys(FEATURE_LABELS);

function formatNGN(n: number | string) {
  return "₦" + Number(n).toLocaleString("en-NG", { minimumFractionDigits: 0 });
}

// ─── Upgrade Confirmation Dialog ──────────────────────────────────────────────
function UpgradeDialog({
  tierKey,
  tierName,
  monthlyFee,
  platformFeeRate,
  currentTier,
  onUpgraded,
}: {
  tierKey: string;
  tierName: string;
  monthlyFee: number;
  platformFeeRate: number;
  currentTier: string;
  onUpgraded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  const isDowngrade =
    ["starter", "professional", "enterprise"].indexOf(tierKey) <
    ["starter", "professional", "enterprise"].indexOf(currentTier);

  // For downgrades: direct DB mutation (no payment needed)
  const downgradeMutation = trpc.billing.upsertSubscription.useMutation({
    onSuccess: () => {
      toast.success(`Plan changed to ${tierName}.`);
      setOpen(false);
      utils.billing.getSubscription.invalidate();
      onUpgraded();
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  // For upgrades: Stripe Checkout session
  const checkoutMutation = trpc.billing.createSubscriptionCheckout.useMutation({
    onSuccess: ({ url }) => {
      toast.info(`Redirecting to secure payment for ${tierName} plan…`);
      setOpen(false);
      window.open(url, "_blank");
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const isPending = downgradeMutation.isPending || checkoutMutation.isPending;

  function handleConfirm() {
    if (isDowngrade) {
      downgradeMutation.mutate({
        dpcoOrgId: DEMO_DPCO_ORG_ID,
        tier: tierKey as "starter" | "professional" | "enterprise",
      });
    } else {
      checkoutMutation.mutate({
        dpcoOrgId: DEMO_DPCO_ORG_ID,
        tier: tierKey as "starter" | "professional" | "enterprise",
        origin: window.location.origin,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="w-full mt-4"
          variant={tierKey === currentTier ? "outline" : "default"}
          disabled={tierKey === currentTier}
        >
          {tierKey === currentTier
            ? "Current Plan"
            : isDowngrade
              ? `Downgrade to ${tierName}`
              : `Upgrade to ${tierName}`}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isDowngrade ? "Downgrade" : "Upgrade"} to {tierName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg border p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">New monthly fee</span>
              <span className="font-semibold">{formatNGN(monthlyFee)}/mo</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Platform fee rate</span>
              <span className="font-semibold">
                {(platformFeeRate * 100).toFixed(0)}% of each invoice
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Effective from</span>
              <span className="font-semibold">
                {isDowngrade ? "Immediately" : "After payment confirmation"}
              </span>
            </div>
          </div>
          {!isDowngrade && (
            <div className="flex gap-2 rounded-lg border border-blue-500/20 bg-blue-50 p-3 text-sm text-blue-800">
              <CreditCard className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                You will be redirected to a secure Stripe checkout page to complete the upgrade.
                Use test card <strong>4242 4242 4242 4242</strong> with any future date and CVC.
              </span>
            </div>
          )}
          {isDowngrade && (
            <div className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Downgrading will increase your platform fee rate to{" "}
                {(platformFeeRate * 100).toFixed(0)}%. Existing paid invoices
                are not affected.
              </span>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isPending}>
              {isPending
                ? "Processing…"
                : isDowngrade
                  ? "Confirm Downgrade"
                  : "Proceed to Payment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DpcoSubscription() {
  const tiersQuery = trpc.billing.getSubscriptionTiers.useQuery();
  const subQuery = trpc.billing.getSubscription.useQuery(
    { dpcoOrgId: DEMO_DPCO_ORG_ID },
    { refetchOnWindowFocus: true }
  );

  const tiers = tiersQuery.data ?? [];
  const sub = subQuery.data;
  const currentTier = sub?.tier ?? "starter";

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <Breadcrumbs items={[{ label: "DPCO Portal", href: "/dpco" }, { label: "Subscription" }]} />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">DPCO Subscription</h1>
        <p className="text-muted-foreground mt-1">
          Choose the plan that fits your DPCO practice. Platform fee rates
          automatically apply to all new invoices upon upgrade.
        </p>
      </div>

      {/* Current plan banner */}
      {sub && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-50 p-4 flex flex-wrap gap-6 items-center">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-blue-600" />
            <span className="font-semibold text-blue-800">
              Current Plan:{" "}
              <span className="capitalize">{sub.tier}</span>
            </span>
            <Badge className="capitalize bg-blue-500/15 text-blue-600 dark:text-blue-400 border-0">
              {sub.status}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-6 text-sm text-blue-700">
            <span className="flex items-center gap-1">
              <TrendingUp className="h-4 w-4" />
              Platform fee: {(Number(sub.platformFeeRate) * 100).toFixed(0)}%
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              Max clients: {sub.maxClients}
            </span>
            <span className="flex items-center gap-1">
              <ClipboardCheck className="h-4 w-4" />
              Max audits/mo: {sub.maxAuditsPerMonth}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              Renews:{" "}
              {sub.currentPeriodEnd
                ? new Date(sub.currentPeriodEnd).toLocaleDateString()
                : "—"}
            </span>
          </div>
        </div>
      )}

      {/* Tier cards */}
      {tiersQuery.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-96 rounded-xl border bg-muted animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tiers.map((tier) => {
            const meta = TIER_META[tier.key] ?? TIER_META.starter;
            const Icon = meta.icon;
            const isCurrent = tier.key === currentTier;

            return (
              <Card
                key={tier.key}
                className={`relative border-2 ${meta.border} ${meta.bg} ${meta.highlight ? "ring-2 ring-blue-400 ring-offset-2" : ""}`}
              >
                {meta.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-blue-600 text-white border-0 px-3 py-1 text-xs">
                      Most Popular
                    </Badge>
                  </div>
                )}
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-5 w-5 ${meta.color}`} />
                    <CardTitle className={`text-lg ${meta.color}`}>
                      {tier.name}
                    </CardTitle>
                    {isCurrent && (
                      <Badge className={`${meta.badge} border-0 text-xs`}>
                        Current
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2">
                    <span className="text-3xl font-bold">
                      {formatNGN(tier.monthlyFee)}
                    </span>
                    <span className="text-muted-foreground text-sm">/month</span>
                  </div>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Percent className="h-3.5 w-3.5" />
                    {(tier.platformFeeRate * 100).toFixed(0)}% platform fee on
                    invoices
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{tier.maxClients} clients</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{tier.maxAuditsPerMonth} audits/mo</span>
                    </div>
                  </div>

                  <div className="border-t pt-3 space-y-1.5">
                    {ALL_FEATURES.map((f) => {
                      const included = tier.features.includes(f);
                      return (
                        <div key={f} className="flex items-center gap-2 text-sm">
                          {included ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          ) : (
                            <XCircle className="h-4 w-4 text-foreground shrink-0" />
                          )}
                          <span
                            className={
                              included
                                ? "text-foreground"
                                : "text-muted-foreground line-through"
                            }
                          >
                            {FEATURE_LABELS[f]}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <UpgradeDialog
                    tierKey={tier.key}
                    tierName={tier.name}
                    monthlyFee={tier.monthlyFee}
                    platformFeeRate={tier.platformFeeRate}
                    currentTier={currentTier}
                    onUpgraded={() => subQuery.refetch()}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Fee rate explainer */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Percent className="h-4 w-4 text-muted-foreground" />
            How Platform Fees Work
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            When a client pays an invoice, the platform automatically splits the
            payment: your net earnings are credited immediately, and the platform
            fee is recorded as a revenue split entry.
          </p>
          <p>
            <strong>Example (Professional plan, 10% fee):</strong> A ₦2,500,000
            invoice → ₦250,000 platform fee → ₦2,250,000 net to your DPCO.
          </p>
          <p>
            Upgrading to a higher tier reduces your platform fee rate, increasing
            your net earnings on every invoice. The new rate applies to all
            invoices created <em>after</em> the upgrade.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
