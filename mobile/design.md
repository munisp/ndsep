# IDLR-PTS Mobile Design Plan

The native mobile application will be designed as a **portrait-first, one-handed operational workspace** for land-registry staff, surveyors, verification teams, and geospatial operators. The design should feel aligned with mainstream iOS interaction standards while remaining practical for Android devices through Expo. The mobile experience is intended to complement the existing PWA by prioritizing **task continuity, field capture, geospatial review, onboarding verification, and legal-workflow progression** in a smaller, more focused shell.

The brand direction for the mobile app should communicate **trust, field reliability, geospatial precision, and administrative clarity**. The primary color should be a deep registry blue (`#155EEF`) to anchor authority and navigation focus. Supporting colors should include a survey teal (`#0F9F8F`) for field and geospatial actions, a warm alert amber (`#F79009`) for sync and review risk, a success green (`#12B76A`) for verified and completed workflow states, and a soft neutral background palette built around `#F8FAFC`, `#FFFFFF`, and `#0F172A` for text and dark accents.

## Screen List

| Screen | Purpose |
|---|---|
| **Mobile Home / Mission Hub** | A task-first landing screen for daily priorities, active missions, pending reviews, and resume actions. |
| **Parcel Search & Quick Lookup** | Fast mobile lookup for parcel identifiers, owners, title references, and saved recent searches. |
| **Parcel Detail** | A concise parcel summary with ownership, status, geospatial actions, related workflows, and next-step shortcuts. |
| **Field Mission** | A mobile-first field survey workflow for parcel capture, notes, media evidence, sync state, and queue management. |
| **Geospatial Workbench** | A mobile geospatial page for parcel intelligence, location context, map exploration, and GeoLibre handoff. |
| **GeoLibre Launch Screen** | A bridge screen that prepares the parcel context and launches or links the GeoLibre workflow cleanly. |
| **Stakeholder Onboarding** | A guided KYC/KYB workflow for identity, document, and liveness tasks with readiness scoring. |
| **Legal Workflows** | A compact mobile workflow for C of O, related land-rights progression, approval state, and review queues. |
| **Notifications & Activity** | A timeline for sync events, verification updates, workflow progress, and system alerts. |
| **Profile & Settings** | User profile, role, session controls, install guidance, app preferences, and device-readiness status. |

## Primary Content and Functionality

| Screen | Primary content and functionality |
|---|---|
| **Mobile Home / Mission Hub** | Shows active tasks, resume cards, pending approvals, field queue counts, connectivity, and quick actions for field, geospatial, onboarding, and legal flows. |
| **Parcel Search & Quick Lookup** | Presents a search bar, recent searches, filtered result cards, and tap-through into parcel detail. |
| **Parcel Detail** | Displays parcel number, location, owner summary, title status, verification status, recent transactions, and actions to open field, geospatial, GeoLibre, or legal workflows. |
| **Field Mission** | Contains form inputs, location capture, evidence/media status, sync state, and queue flush controls designed for gloves-off, outdoor use. |
| **Geospatial Workbench** | Surfaces parcel intelligence, surrounding context, hotspot or terrain insight, and handoff actions into deeper GIS review. |
| **GeoLibre Launch Screen** | Shows prepared parcel context, export readiness, GeoJSON handoff, and the next-best geospatial actions. |
| **Stakeholder Onboarding** | Uses stepwise tabs or sections for NIN, BVN, KYC uploads, liveness, KYB details, and readiness checklist progress. |
| **Legal Workflows** | Displays workflow cards, current stage, required actions, parcel linkage, registration data, and progression controls. |
| **Notifications & Activity** | Lists event cards with status icons, timestamps, and route links back into the originating workflow. |
| **Profile & Settings** | Includes account identity, role, app mode, offline readiness, security preferences, and sign-out actions. |

## Key User Flows

| Flow | Step-by-step path |
|---|---|
| **Resume a field mission** | User opens Mobile Home → taps active mission card → lands in Field Mission → captures or reviews evidence → syncs or saves for later. |
| **Review a parcel geospatially** | User opens Parcel Search → selects parcel → enters Parcel Detail → taps Geospatial Workbench → reviews intelligence → launches GeoLibre if deeper GIS work is required. |
| **Complete stakeholder onboarding** | User opens Mobile Home → taps Onboarding → verifies NIN/BVN → uploads KYC documents → completes liveness → adds KYB details if applicable → returns to readiness summary. |
| **Advance a legal workflow** | User opens Legal Workflows → selects a C of O or related record → reviews parcel and status → performs the next progression action → confirms updated workflow state. |
| **Handle low-connectivity operations** | User opens Mobile Home → sees connectivity warning and queue count → enters Field Mission or Onboarding → completes capture tasks offline → returns to queue/sync state when connectivity improves. |

## Native-Mobile UX Principles for This App

The interface should emphasize **large touch targets, shallow hierarchy, strong scroll rhythm, and immediate state visibility**. The app should avoid desktop-style dense panels on small screens and instead prefer **stacked cards, segmented task areas, bottom-sheet style interactions, and persistent task continuity cues**. The Home / Mission Hub should act as the central operating surface, while Parcel Detail should become the connective layer between field, geospatial, onboarding, and legal actions.

The initial tab structure should remain compact and high-value. A practical starting point is **Home**, **Parcels**, **Field**, **Geo**, and **Profile**, with secondary workflows reached from those surfaces rather than crowding the bottom tab bar. This keeps the experience aligned with one-handed navigation expectations and reduces task-switching friction in the field.
