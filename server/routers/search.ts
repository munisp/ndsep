/**
 * Extended Global Search Router (Round-12) — extends the legacy
 * enhancements.ts searchRouter (organizations / enforcement_cases /
 * citizen_requests / dpco, limit 20) with five additional entity types and a
 * raised limit (50):
 *
 *   complaints            public complaints (reference/subject/controller)
 *   settlements           settlement negotiations (refs, case ref, respondent)
 *   hosting_declarations  data-sovereignty hosting declarations (entity)
 *   transfer_declarations cross-border transfer declarations (country/basis)
 *   fines                 enforcement fines (fine_reference / ndpc_reference)
 *
 * Authorization mirrors the owning routers:
 *   - complaints, settlements, hosting_declarations are STAFF-ONLY (staff
 *     roles: admin / government_staff / auditor / regulator) — the owning
 *     routers gate them behind staffProcedure because they carry complainant
 *     PII and regulator-only workflow data. Non-staff callers get an empty
 *     result set for those types (never an error that would reveal the data
 *     exists but is hidden).
 *   - transfer_declarations and fines follow finePayments' org scoping:
 *     staff see everything; organisation users only rows belonging to their
 *     own organisation (organization_users membership or the org id on
 *     their account).
 *
 * Mount: in server/routers.ts add
 *   import { searchExtendedRouter } from "./routers/search";
 *   ...
 *   searchExtended: searchExtendedRouter,
 * (routers.ts is owned by another workstream — mount instruction only.)
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getPool } from "../db";

/** Staff roles that may see regulator-only entity types (mirrors
 *  staffProcedure in _core/trpc + finePayments' STAFF_ROLES). */
const STAFF_ROLES = new Set(["admin", "government_staff", "auditor", "regulator"]);

export const SEARCH_EXTENDED_TYPES = [
  "complaints",
  "settlements",
  "hosting_declarations",
  "transfer_declarations",
  "fines",
] as const;

export type SearchExtendedType = (typeof SEARCH_EXTENDED_TYPES)[number];

export const searchExtendedRouter = router({
  /**
   * Global search across the extended entity set. Per-type results are
   * ranked with Postgres full-text search and merged by rank; the response
   * is capped at `limit` (default 50, max 50).
   */
  global: protectedProcedure
    .input(
      z.object({
        query: z.string().min(2).max(200),
        types: z.array(z.enum(SEARCH_EXTENDED_TYPES)).optional(),
        limit: z.number().int().min(1).max(50).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      const pool = getPool();
      if (!pool) return [];
      const q = input.query;
      const isStaff = STAFF_ROLES.has(ctx.user.role);
      const results: any[] = [];
      const requested = input.types ?? [...SEARCH_EXTENDED_TYPES];
      // Staff-only types are silently dropped for non-staff callers (see
      // module docstring): they may never learn these rows exist.
      const types = requested.filter((t) =>
        isStaff || t === "transfer_declarations" || t === "fines"
      );
      if (types.length === 0) return [];
      const perTypeLimit = Math.max(1, Math.ceil(input.limit / types.length));

      if (types.includes("complaints")) {
        // Staff only. Complainant PII columns are deliberately NOT selected.
        const { rows } = await pool.query(
          `SELECT id, reference_code, category, subject, status, state, lga,
                  controller_name, received_at,
                  ts_rank(to_tsvector('english', COALESCE(reference_code,'') || ' ' || COALESCE(subject,'') || ' ' || COALESCE(controller_name,'')), plainto_tsquery('english', $1)) AS rank
           FROM public_complaints
           WHERE to_tsvector('english', COALESCE(reference_code,'') || ' ' || COALESCE(subject,'') || ' ' || COALESCE(controller_name,'')) @@ plainto_tsquery('english', $1)
           ORDER BY rank DESC LIMIT $2`,
          [q, perTypeLimit]
        );
        rows.forEach((r: Record<string, unknown>) => results.push({ type: "complaint", ...r }));
      }

      if (types.includes("settlements")) {
        // Staff only (regulator negotiation workflow).
        const { rows } = await pool.query(
          `SELECT s.id, s.settlement_ref, s.case_ref, s.fine_reference, s.status,
                  s.respondent_name, s.created_at,
                  ts_rank(to_tsvector('english', COALESCE(s.settlement_ref,'') || ' ' || COALESCE(s.case_ref,'') || ' ' || COALESCE(s.fine_reference,'') || ' ' || COALESCE(s.respondent_name,'')), plainto_tsquery('english', $1)) AS rank
           FROM settlements s
           WHERE to_tsvector('english', COALESCE(s.settlement_ref,'') || ' ' || COALESCE(s.case_ref,'') || ' ' || COALESCE(s.fine_reference,'') || ' ' || COALESCE(s.respondent_name,'')) @@ plainto_tsquery('english', $1)
           ORDER BY rank DESC LIMIT $2`,
          [q, perTypeLimit]
        );
        rows.forEach((r: Record<string, unknown>) => results.push({ type: "settlement", ...r }));
      }

      if (types.includes("hosting_declarations")) {
        // Staff only (regulator review surface).
        const { rows } = await pool.query(
          `SELECT id, entity_ref, entity_name, entity_type, declaration_status,
                  primary_dc_country, cloud_provider, submitted_at,
                  ts_rank(to_tsvector('english', COALESCE(entity_ref,'') || ' ' || COALESCE(entity_name,'') || ' ' || COALESCE(cloud_provider,'')), plainto_tsquery('english', $1)) AS rank
           FROM hosting_declarations
           WHERE to_tsvector('english', COALESCE(entity_ref,'') || ' ' || COALESCE(entity_name,'') || ' ' || COALESCE(cloud_provider,'')) @@ plainto_tsquery('english', $1)
           ORDER BY rank DESC LIMIT $2`,
          [q, perTypeLimit]
        );
        rows.forEach((r: Record<string, unknown>) => results.push({ type: "hosting_declaration", ...r }));
      }

      if (types.includes("transfer_declarations")) {
        // Staff see all; org users are scoped to their own organisation.
        const params: unknown[] = [q, perTypeLimit];
        let scopeClause = "";
        if (!isStaff) {
          params.push(ctx.user.id);
          scopeClause = `AND (td.organization_id = (SELECT organization_id FROM users WHERE id = $3)
             OR EXISTS (SELECT 1 FROM organization_users ou WHERE ou.user_id = $3 AND ou.organization_id = td.organization_id))`;
        }
        const { rows } = await pool.query(
          `SELECT td.id, td.organization_id, td.declaration_type, td.destination_country,
                  td.legal_basis, td.compliance_status, td.status, td.created_at,
                  ts_rank(to_tsvector('english', COALESCE(td.destination_country,'') || ' ' || COALESCE(td.legal_basis,'')), plainto_tsquery('english', $1)) AS rank
           FROM transfer_declarations td
           WHERE to_tsvector('english', COALESCE(td.destination_country,'') || ' ' || COALESCE(td.legal_basis,'')) @@ plainto_tsquery('english', $1)
           ${scopeClause}
           ORDER BY rank DESC LIMIT $2`,
          params
        );
        rows.forEach((r: Record<string, unknown>) => results.push({ type: "transfer_declaration", ...r }));
      }

      if (types.includes("fines")) {
        // Staff see all; org users are scoped to their own organisation
        // (finePayments listReceipts org-scope pattern).
        const params: unknown[] = [q, perTypeLimit];
        let scopeClause = "";
        if (!isStaff) {
          params.push(ctx.user.id);
          scopeClause = `AND (f.org_id = (SELECT organization_id FROM users WHERE id = $3)
             OR EXISTS (SELECT 1 FROM organization_users ou WHERE ou.user_id = $3 AND ou.organization_id = f.org_id))`;
        }
        const { rows } = await pool.query(
          `SELECT f.id, f.org_id, f.fine_reference, f.ndpc_reference, f.amount, f.currency,
                  f.status, f.issued_at,
                  ts_rank(to_tsvector('english', COALESCE(f.fine_reference,'') || ' ' || COALESCE(f.ndpc_reference,'') || ' ' || COALESCE(f.violation_description,'')), plainto_tsquery('english', $1)) AS rank
           FROM enforcement_fines f
           WHERE to_tsvector('english', COALESCE(f.fine_reference,'') || ' ' || COALESCE(f.ndpc_reference,'') || ' ' || COALESCE(f.violation_description,'')) @@ plainto_tsquery('english', $1)
           ${scopeClause}
           ORDER BY rank DESC LIMIT $2`,
          params
        );
        rows.forEach((r: Record<string, unknown>) => results.push({ type: "fine", ...r }));
      }

      results.sort((a, b) => Number(b.rank ?? 0) - Number(a.rank ?? 0));
      return results.slice(0, input.limit);
    }),
});

export type SearchExtendedRouter = typeof searchExtendedRouter;
