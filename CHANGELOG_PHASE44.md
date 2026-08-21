# NDSEP Phase 44 Changelog

**Date:** 2026-04-26
**Test count:** 1017 / 1017 passing (29 test files)
**Phase 44 tests:** 46 new tests in `server/phase44.test.ts`

---

## Summary

Phase 44 delivers five production-ready features across the ROPA, Automated Decisions, Privacy Notices, Accreditation, and Public Registry modules, together with a new `ropaPdf.ts` module and a live stats panel on the Home page.

---

## New Files

| File | Description |
|------|-------------|
| `server/ropaPdf.ts` | New module exporting `generateRopaPdf(records, orgName)` using PDFDocument from pdfkit. Generates a formatted PDF with a cover page, summary table, and per-record detail sections. |
| `server/phase44.test.ts` | 46 vitest tests covering all Phase 44 features. |
| `CHANGELOG_PHASE44.md` | This file. |

---

## Backend Changes

### `server/routers.ts` — ropa router

A new `export` procedure was added to the `ropaRouter` using the PBAC `exportProcedure` middleware. It accepts `{ format: "json" | "csv" | "pdf" }` and rejects unauthenticated requests with `UNAUTHORIZED`. For PDF format it delegates to `generateRopaPdf` from `ropaPdf.ts`; for JSON/CSV it returns the raw records.

A new `update` procedure was added using the PBAC `updateProcedure` middleware to allow editing existing ROPA records.

### `server/routers.ts` — automatedDecisions router

Two new protected procedures were added:

- **`requestReview`** — accepts `{ id: z.number().positive() }`, sets `review_requested = true` and `human_review_requested_at = NOW()` on the matching `automated_decision_records` row. Rejects unauthenticated requests with `UNAUTHORIZED` and missing/negative IDs with `BAD_REQUEST`.
- **`completeReview`** — accepts `{ id: z.number().positive(), outcome: z.string().min(1) }`, records the review outcome and `review_completed_at` timestamp. Rejects unauthenticated requests with `UNAUTHORIZED`, missing outcome with `BAD_REQUEST`, and empty outcome strings with `BAD_REQUEST`.

### `server/routers.ts` — privacyNotices router

- **`update`** procedure added using the PBAC `updateProcedure` middleware. Accepts `{ id, title?, content?, status? }` where `status` is `z.enum(["draft", "published", "archived"])`. Rejects invalid status values with `BAD_REQUEST` and unauthenticated requests with `UNAUTHORIZED`.
- **`delete`** procedure confirmed to use `deleteProcedure` PBAC middleware.

### `server/routers/accreditation.ts` — submitRenewal

A new `submitRenewal` protected procedure was added. It creates a renewal application record in the `accreditation_applications` table with `application_type = 'renewal'` and `status = 'pending'`. Rejects unauthenticated requests with `UNAUTHORIZED`.

### `server/routers/newFeatures.ts` — publicRegistry.sectorStats

The `sectorStats` query was fixed to use `getSharedPool` with a raw `pg.Pool.query()` call instead of the drizzle `sql.raw()` template. This resolves a runtime error caused by a reference to `ndpc_registration_status`, a column that does not exist in the `organizations` table. The procedure remains a `publicProcedure` and returns an array of `{ sector, count }` objects.

### `server/workers/ropa_generator.py`

Column name fixes applied:
- `purpose_of_processing` → `purpose`
- `lawful_basis` → `ropa_lawful_basis`
- `cross_border_transfer_countries` → `cross_border_countries`
- `data_subject_categories` → `data_subjects`

These align the Python worker with the actual `ropa_records` table schema.

---

## Frontend Changes

### `client/src/pages/RopaRecords.tsx`

An export mutation was wired to the `ropa.export` procedure. A dropdown allows the user to select JSON, CSV, or PDF format. On success the response is downloaded as a file. On error a toast is shown.

### `client/src/pages/AutomatedDecisions.tsx`

Two mutations were wired:
- `requestReview` — triggered by a "Request Human Review" button on each record row. Shows a success toast on completion.
- `completeReview` — triggered by a "Complete Review" button with an outcome input field. Shows a success toast on completion.

### `client/src/pages/PrivacyNotices.tsx`

An `update` mutation was wired for the publish workflow. A "Publish" button on each draft notice row calls `privacyNotices.update` with `{ id, status: "published" }`. Shows a success toast on completion.

### `client/src/pages/AccreditationStatus.tsx`

A `submitRenewal` mutation was wired with a confirmation dialog. The user is prompted to confirm before the renewal application is submitted. Shows a success toast on completion.

### `client/src/pages/DpoDashboard.tsx`

A `requestReview` mutation was wired inline on the Automated Decisions panel. The DPO can trigger a human review request directly from the workbench without navigating to the full Automated Decisions page.

### `client/src/pages/Home.tsx`

A `publicRegistry.sectorStats` live query was wired to the hero stats panel. The panel now shows real-time sector breakdown data (sector name and count) fetched from the database without requiring authentication.

---

## Test Coverage

The 46 tests in `server/phase44.test.ts` cover:

| Test Group | Tests |
|------------|-------|
| Server Health | 1 |
| ropa.export PBAC | 3 |
| automatedDecisions.requestReview | 3 |
| automatedDecisions.completeReview | 3 |
| privacyNotices.update PBAC | 3 |
| accreditation.submitRenewal PBAC | 2 |
| publicRegistry.sectorStats | 2 |
| ropaPdf.ts Module | 3 |
| ropa_generator.py column names | 4 |
| RopaRecords.tsx export mutation | 2 |
| AutomatedDecisions.tsx mutations | 3 |
| PrivacyNotices.tsx update mutation | 2 |
| AccreditationStatus.tsx submitRenewal | 2 |
| DpoDashboard.tsx requestReview | 2 |
| Home.tsx sectorStats query | 2 |
| ropa router procedures | 3 |
| privacyNotices router procedures | 2 |
| ropa.list Public Access | 2 |
| automatedDecisions.list Public Access | 1 |
| privacyNotices.list Public Access | 1 |

**Note on superjson:** The two array-return tests (`sectorStats returns an array`, `ropa.list returns an array`) unwrap the superjson envelope `{json: [...]}` before asserting `Array.isArray()`, since the tRPC server uses superjson as its transformer.

---

## Cumulative Test Count

| Phase | Tests Added | Total |
|-------|-------------|-------|
| Phase 1–41 | 895 | 895 |
| Phase 42 | 39 | 934 |
| Phase 43 | 37 | 971 |
| **Phase 44** | **46** | **1017** |
