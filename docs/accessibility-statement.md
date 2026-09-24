# Accessibility Statement — NDSEP

**Effective date:** 2026-05-20
**Applies to:** The National Data Sovereignty Enforcement Platform (NDSEP) web
application, including all citizen-facing public surfaces.

## Commitment

The Nigeria Data Protection Commission (NDPC) is committed to ensuring that
the NDSEP platform is accessible to all users, including persons with
disabilities. We target **WCAG 2.1 Level AA** conformance for the
citizen-facing surfaces of the platform, in line with the NDPA 2023 principle
that data subject rights must be exercisable by all Nigerians without barrier.

## Measures in place

- **Automated conformance testing:** axe-core runs in CI
  (`e2e/a11y.spec.ts`, Playwright) against `/`, `/dsar`, and `/registry` with
  a zero-tolerance budget for critical and serious violations.
- **Keyboard navigation:** focus-trap utilities for modal dialogs
  (`client/src/lib/a11y.ts` → `trapFocus`) and a "skip to main content" link
  (`SkipLink`) on translated citizen shells.
- **Screen-reader support:** an aria-live announcer (`announce`) reports
  dynamic status changes (form submissions, payment updates) to assistive
  technology; the translated shells use semantic landmarks and labelled
  sections.
- **Language access:** citizen-facing surfaces are available in English,
  Hausa, Yorùbá, and Igbo (`client/src/lib/i18n.ts` +
  `client/src/lib/i18nCitizen.ts`), reducing language barriers to exercising
  data subject rights.
- **Contrast & theming:** the design system (Radix UI + Tailwind tokens)
  targets 4.5:1 text contrast in both light and dark themes.

## Known issues

The following moderate/minor issues are tracked for remediation within the
violation budgets enforced in CI (≤ 5 moderate / 5 minor per page):

1. Some legacy admin dashboards render dense data tables without explicit
   column-header associations on small viewports.
2. Third-party map embeds (network intelligence views) do not expose full
   keyboard-equivalent interaction; a tabular data alternative is available.
3. A subset of older pages mount before the i18n document `lang` attribute is
   updated on language switch; a full reload renders the correct language.
4. Focus order in multi-step DPCO onboarding wizards may jump when step
   content lazy-loads; use the wizard's Back/Next controls which manage focus.

## Enforcement budget

| Impact   | Budget (per scanned page) |
|----------|---------------------------|
| Critical | 0                         |
| Serious  | 0                         |
| Moderate | 5 (temporary, remediation tracked) |
| Minor    | 5 (temporary, remediation tracked) |

## Feedback

If you encounter an accessibility barrier on this platform, contact
**accessibility@ndsep.gov.ng** or the NDPC compliance desk
(**compliance@ndsep.gov.ng**). Include the page URL, assistive technology
used, and a description of the barrier. We aim to respond within 5 working
days.
