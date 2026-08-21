/**
 * NDSEP Database — Organization Domain Queries
 * ===============================================
 * Extracted from db.ts for better code organization.
 * New organization queries should be added here.
 *
 * Recommendation H4: Domain module extraction
 */

import { getPool } from "../db";
import { logger } from "../logger";
import { handleError } from "../errorClassifier";
import { buildCursorQuery, buildCursorPage, type CursorParams, type CursorPage } from "../cursorPagination";

export interface OrganizationSummary {
  id: number;
  name: string;
  sector: string | null;
  registrationStatus: string;
  complianceScore: number;
  createdAt: Date;
}

/**
 * Get organizations with cursor-based pagination (M3).
 * Use this for large datasets instead of OFFSET/LIMIT.
 */
export async function getOrganizationsCursor(
  params: CursorParams
): Promise<CursorPage<OrganizationSummary>> {
  const pool = getPool();
  if (!pool) return { items: [], nextCursor: null, previousCursor: null, hasMore: false };

  try {
    const { whereClause, orderClause, limitClause, limit } = buildCursorQuery(params);
    const where = whereClause ? `WHERE ${whereClause}` : "";

    const result = await pool.query(
      `SELECT id, name, sector, registration_status, compliance_score, created_at
       FROM organizations ${where}
       ORDER BY ${orderClause}
       LIMIT ${limitClause}`
    );

    const items: OrganizationSummary[] = result.rows.map(r => ({
      id: r.id,
      name: r.name,
      sector: r.sector,
      registrationStatus: r.registration_status,
      complianceScore: parseFloat(r.compliance_score ?? "0"),
      createdAt: r.created_at,
    }));

    return buildCursorPage(items, limit);
  } catch (err) {
    handleError(err, { module: "db/organizations", action: "getOrganizationsCursor" });
    return { items: [], nextCursor: null, previousCursor: null, hasMore: false };
  }
}

/** Search organizations by name or sector */
export async function searchOrganizations(
  query: string,
  limit: number = 20
): Promise<OrganizationSummary[]> {
  const pool = getPool();
  if (!pool) return [];

  try {
    const result = await pool.query(
      `SELECT id, name, sector, registration_status, compliance_score, created_at
       FROM organizations
       WHERE name ILIKE $1 OR sector ILIKE $1 OR registration_number ILIKE $1
       ORDER BY compliance_score DESC NULLS LAST
       LIMIT $2`,
      [`%${query}%`, limit]
    );
    return result.rows.map(r => ({
      id: r.id,
      name: r.name,
      sector: r.sector,
      registrationStatus: r.registration_status,
      complianceScore: parseFloat(r.compliance_score ?? "0"),
      createdAt: r.created_at,
    }));
  } catch (err) {
    handleError(err, { module: "db/organizations", action: "searchOrganizations" });
    return [];
  }
}
