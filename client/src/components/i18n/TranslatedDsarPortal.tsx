/**
 * TranslatedDsarPortal (gap 9)
 *
 * Drop-in translated shell for the DSAR public portal. Renders a fully
 * translated landing/hero section (en/ha/yo/ig via useT + i18nCitizen) with a
 * language selector, then embeds the existing DsarPublicPortal page
 * UNMODIFIED below it. Registration note: swap the route component for
 * `/dsar` from DsarPublicPortal to this wrapper (see g2_registration.md).
 */
import { lazy, Suspense } from "react";
import { useT } from "@/hooks/useT";
import { LanguageSelector } from "@/components/LanguageSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, FileText, Search, Clock } from "lucide-react";

const DsarPublicPortal = lazy(() => import("@/pages/DsarPublicPortal"));

export default function TranslatedDsarPortal() {
  const { t } = useT();

  return (
    <div>
      <section aria-labelledby="dsar-hero-title" className="bg-gradient-to-b from-primary/10 to-background border-b">
        <div className="container py-10">
          <div className="flex justify-end mb-4">
            <LanguageSelector />
          </div>
          <div className="max-w-3xl mx-auto text-center space-y-4">
            <div className="flex justify-center">
              <Shield className="h-12 w-12 text-primary" aria-hidden="true" />
            </div>
            {/* Base i18n keys from client/src/lib/i18n.ts (dsar.*) */}
            <h1 id="dsar-hero-title" className="text-3xl font-bold">{t("dsar.title")}</h1>
            <p className="text-lg text-muted-foreground">{t("dsar.subtitle")}</p>
            {/* Citizen extension keys (i18nCitizen.ts, dsarLanding.*) */}
            <p className="text-muted-foreground">{t("dsarLanding.heroSubtitle")}</p>
            <p className="text-sm text-muted-foreground">{t("dsar.deadlineInfo")}</p>
            <div className="flex gap-3 justify-center pt-2">
              <Button asChild>
                <a href="#dsar-portal">{t("dsarLanding.startRequest")}</a>
              </Button>
              <Button variant="outline" asChild>
                <a href="#dsar-portal">{t("dsar.trackRequest")}</a>
              </Button>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mt-8 max-w-4xl mx-auto">
            <Card>
              <CardContent className="pt-6 text-center space-y-2">
                <FileText className="h-6 w-6 mx-auto text-primary" aria-hidden="true" />
                <p className="text-sm">{t("dsarLanding.step1")}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center space-y-2">
                <Search className="h-6 w-6 mx-auto text-primary" aria-hidden="true" />
                <p className="text-sm">{t("dsarLanding.step2")}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center space-y-2">
                <Clock className="h-6 w-6 mx-auto text-primary" aria-hidden="true" />
                <p className="text-sm">{t("dsarLanding.step3")}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <div id="dsar-portal">
        <Suspense fallback={<div className="container py-8">{t("common.loading")}</div>}>
          <DsarPublicPortal />
        </Suspense>
      </div>
    </div>
  );
}
