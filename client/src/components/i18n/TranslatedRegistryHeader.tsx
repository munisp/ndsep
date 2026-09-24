/**
 * TranslatedRegistryHeader + TranslatedPublicComplianceRegistry (gap 9)
 *
 * Translated header for the public compliance registry: title, subtitle,
 * status legend and live aggregate stats (via the existing
 * phase13.publicRegistry.getStats endpoint), with a language selector.
 *
 * TranslatedPublicComplianceRegistry is the drop-in wrapper: header on top,
 * the existing PublicComplianceRegistry page UNMODIFIED below. Registration
 * note: swap the route component for `/registry` (see g2_registration.md).
 */
import { lazy, Suspense } from "react";
import { useT } from "@/hooks/useT";
import { trpc } from "@/lib/trpc";
import { LanguageSelector } from "@/components/LanguageSelector";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";

const PublicComplianceRegistry = lazy(() => import("@/pages/PublicComplianceRegistry"));

export function TranslatedRegistryHeader() {
  const { t } = useT();
  const stats = trpc.phase13.publicRegistry.getStats.useQuery();

  return (
    <section aria-labelledby="registry-title" className="bg-gradient-to-b from-primary/10 to-background border-b">
      <div className="container py-8">
        <div className="flex justify-end mb-4">
          <LanguageSelector />
        </div>
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <div className="flex justify-center">
            <Building2 className="h-12 w-12 text-primary" aria-hidden="true" />
          </div>
          <h1 id="registry-title" className="text-3xl font-bold">{t("registry.title")}</h1>
          <p className="text-lg text-muted-foreground">{t("registry.subtitle")}</p>

          <div className="flex flex-wrap gap-2 justify-center pt-2" aria-label={t("registry.status")}>
            <Badge variant="default">{t("registry.statuses.compliant")}</Badge>
            <Badge variant="secondary">{t("registry.statuses.partially_compliant")}</Badge>
            <Badge variant="destructive">{t("registry.statuses.non_compliant")}</Badge>
            <Badge variant="outline">{t("registry.statuses.pending")}</Badge>
          </div>

          {stats.data && (
            <dl className="grid grid-cols-3 gap-4 pt-4 text-center">
              <div>
                <dt className="text-sm text-muted-foreground">{t("registry.totalRegistered")}</dt>
                <dd className="text-2xl font-bold">{Number(stats.data.total_registered ?? 0).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{t("registry.compliantCount")}</dt>
                <dd className="text-2xl font-bold text-green-600">{Number(stats.data.compliant ?? 0).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{t("registry.avgScore")}</dt>
                <dd className="text-2xl font-bold">{Number(stats.data.avg_score ?? 0).toLocaleString()}</dd>
              </div>
            </dl>
          )}
        </div>
      </div>
    </section>
  );
}

export default function TranslatedPublicComplianceRegistry() {
  const { t } = useT();
  return (
    <div>
      <TranslatedRegistryHeader />
      <Suspense fallback={<div className="container py-8">{t("common.loading")}</div>}>
        <PublicComplianceRegistry />
      </Suspense>
    </div>
  );
}
