/**
 * DpcoApply — THIN WRAPPER (Round-12 W3 consolidation).
 * The standalone accreditation application form was consolidated into the
 * unified DPCO onboarding wizard (which submits both dpco.registerOrganisation
 * and accreditation.submitApplication in sequence). This file remains so the
 * `/dpco/apply` route keeps working.
 */
export { default } from "./DpcoOnboarding";
