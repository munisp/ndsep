/**
 * TranslatedWhistleblowerIntake (gap 9)
 *
 * Drop-in translated shell for the whistleblower intake surface. Renders the
 * translated intake header (title, protection notice, access-token guidance
 * for the follow-up channel) plus a language selector, then embeds the
 * existing WhistleblowerPortal page UNMODIFIED. Registration note: swap the
 * route component for `/whistleblower` (see g2_registration.md).
 */
import { lazy, Suspense } from "react";
import { useT } from "@/hooks/useT";
import { LanguageSelector } from "@/components/LanguageSelector";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Lock, AlertTriangle } from "lucide-react";

const WhistleblowerPortal = lazy(() => import("@/pages/WhistleblowerPortal"));

export default function TranslatedWhistleblowerIntake() {
  const { t } = useT();

  return (
    <div>
      <section aria-labelledby="wb-intake-title" className="bg-gradient-to-b from-primary/10 to-background border-b">
        <div className="container py-8">
          <div className="flex justify-end mb-4">
            <LanguageSelector />
          </div>
          <div className="max-w-3xl mx-auto text-center space-y-4">
            <div className="flex justify-center">
              <Shield className="h-12 w-12 text-primary" aria-hidden="true" />
            </div>
            <h1 id="wb-intake-title" className="text-3xl font-bold">{t("whistleblower.title")}</h1>
            <p className="text-lg text-muted-foreground">{t("whistleblower.subtitle")}</p>
            <Alert className="text-left">
              <Lock className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{t("whistleblower.protectionNotice")}</AlertDescription>
            </Alert>
            <Alert className="text-left">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{t("whistleblower.accessTokenNotice")}</AlertDescription>
            </Alert>
          </div>
        </div>
      </section>

      <Suspense fallback={<div className="container py-8">{t("common.loading")}</div>}>
        <WhistleblowerPortal />
      </Suspense>
    </div>
  );
}
