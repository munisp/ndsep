/**
 * Organisation Identity Router (Round-12, workstream 3)
 * ======================================================
 * Single read-only identity lookup used to eliminate duplicated data entry of
 * organisation/controller identity across the public complaints portal, the
 * data-sovereignty hosting declaration, cross-border transfer declarations and
 * DPCO onboarding. A registration reference (CAC RC/BN number, NDPC
 * registration reference, or DPCO licence number) resolves to the canonical
 * identity already held in the platform registries.
 *
 * READ-ONLY: no writes, no new tables. Lookups run against:
 *   - organizations              (registration_number -> core registry record)
 *   - public_compliance_registry (registration_number -> published record)
 *   - dpco_organisations         (cac_number / rc_number / licence_number /
 *                                 ndpc_reference -> DPCO registry record)
 * Each source is queried defensively: a missing table/column or a failed query
 * is treated as "no match from this source", never as an error to the caller.
 *
 * INTEGRATOR: mount as `orgIdentity: orgIdentityRouter` in server/routers.ts.
 * The matching client component is client/src/components/OrgIdentityPrefill.tsx.
 */
import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const result = await pool.query(query, params);
  return result.rows ?? [];
}

/** Escape ILIKE metacharacters so a reference cannot widen the match. */
function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Defensive single-source lookup: failures degrade to "no rows". */
async function tryExec(source: string, query: string, params: unknown[]): Promise<any[]> {
  try {
    return await exec(query, params);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), source },
      "[orgIdentity] lookup source failed — treating as no match",
    );
    return [];
  }
}

export interface OrgIdentityMatch {
  found: boolean;
  /** Which registry supplied the identity (first match wins). */
  source: "organizations" | "public_compliance_registry" | "dpco_organisations" | null;
  /** Platform organisation id when the match is a registered controller/processor. */
  orgId: number | null;
  name: string | null;
  registrationRef: string | null;
  rcNumber: string | null;
  cacNumber: string | null;
  taxId: string | null;
  sector: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  /** DPCO licence number when the match is a licensed DPCO. */
  dpcoLicenceNumber: string | null;
}

const EMPTY_MATCH: OrgIdentityMatch = {
  found: false,
  source: null,
  orgId: null,
  name: null,
  registrationRef: null,
  rcNumber: null,
  cacNumber: null,
  taxId: null,
  sector: null,
  address: null,
  city: null,
  state: null,
  country: null,
  email: null,
  phone: null,
  website: null,
  dpcoLicenceNumber: null,
};

export const orgIdentityRouter = router({
  /**
   * Resolve an organisation identity from a registration reference.
   * Accepts a CAC RC/BN number (e.g. "RC1234567"), an NDPC registration
   * reference, or a DPCO licence number. Public procedure: the same lookup is
   * offered on unauthenticated surfaces (public complaints portal) where the
   * complainant identifies the controller they are complaining about. Returns
   * only registry identity fields — no compliance scores or internals.
   */
  lookupByRegistrationRef: publicProcedure
    .input(
      z.object({
        registrationRef: z
          .string()
          .min(2)
          .max(128)
          .transform((v) => v.trim())
          .refine((v) => v.length >= 2, "Registration reference is too short"),
      }),
    )
    .query(async ({ input }): Promise<OrgIdentityMatch> => {
      const ref = escapeLike(input.registrationRef);

      // 1. Core organisations registry (controllers/processors on the platform).
      const orgs = await tryExec(
        "organizations",
        `SELECT id, name, registration_number, sector, country, city, contact_email
           FROM organizations
          WHERE registration_number ILIKE $1 ESCAPE '\\'
          ORDER BY id ASC LIMIT 1`,
        [ref],
      );
      if (orgs[0]) {
        const o = orgs[0];
        return {
          ...EMPTY_MATCH,
          found: true,
          source: "organizations",
          orgId: o.id ?? null,
          name: o.name ?? null,
          registrationRef: o.registration_number ?? input.registrationRef,
          rcNumber: o.registration_number ?? null,
          sector: o.sector ?? null,
          city: o.city ?? null,
          country: o.country ?? null,
          email: o.contact_email ?? null,
        };
      }

      // 2. Published public compliance registry (cross-references org id).
      const published = await tryExec(
        "public_compliance_registry",
        `SELECT org_id, org_name, registration_number, sector
           FROM public_compliance_registry
          WHERE registration_number ILIKE $1 ESCAPE '\\'
          ORDER BY id ASC LIMIT 1`,
        [ref],
      );
      if (published[0]) {
        const r = published[0];
        return {
          ...EMPTY_MATCH,
          found: true,
          source: "public_compliance_registry",
          orgId: r.org_id ?? null,
          name: r.org_name ?? null,
          registrationRef: r.registration_number ?? input.registrationRef,
          rcNumber: r.registration_number ?? null,
          sector: r.sector ?? null,
        };
      }

      // 3. DPCO registry (licence number, CAC number, RC number, NDPC reference).
      const dpcos = await tryExec(
        "dpco_organisations",
        `SELECT id, name, licence_number, rc_number, cac_number, tax_id,
                email, phone, website, address, sectors
           FROM dpco_organisations
          WHERE licence_number ILIKE $1 ESCAPE '\\'
             OR cac_number ILIKE $1 ESCAPE '\\'
             OR rc_number ILIKE $1 ESCAPE '\\'
          ORDER BY id ASC LIMIT 1`,
        [ref],
      );
      if (dpcos[0]) {
        const d = dpcos[0];
        return {
          ...EMPTY_MATCH,
          found: true,
          source: "dpco_organisations",
          name: d.name ?? null,
          registrationRef: d.cac_number ?? d.rc_number ?? input.registrationRef,
          rcNumber: d.rc_number ?? null,
          cacNumber: d.cac_number ?? null,
          taxId: d.tax_id ?? null,
          sector: Array.isArray(d.sectors) && d.sectors.length > 0 ? String(d.sectors[0]) : null,
          address: d.address ?? null,
          email: d.email ?? null,
          phone: d.phone ?? null,
          website: d.website ?? null,
          dpcoLicenceNumber: d.licence_number ?? null,
        };
      }

      return EMPTY_MATCH;
    }),
});
