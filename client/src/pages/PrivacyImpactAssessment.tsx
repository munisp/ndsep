/**
 * PrivacyImpactAssessment — RETIRED as a separate surface (Round-12 W3).
 * This page was wired to the orphaned phase12.pia.* procedures, which
 * duplicated the canonical `dpia` / `dpiaWizard` routers. It now re-exports
 * the unified DPIA workspace so the `/pia` route keeps working. The
 * phase12.pia.* procedures remain server-side for backward compatibility but
 * have no client consumer.
 */
export { default } from "./DpiaWorkspace";
