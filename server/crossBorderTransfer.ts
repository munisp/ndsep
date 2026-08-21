/**
 * NDSEP Cross-Border Transfer Adequacy Verification
 * ===================================================
 * Implements NDPA Section 43 — validates that cross-border data transfers
 * only proceed to countries/organizations with adequate protection.
 *
 * Adequacy criteria:
 *   1. Country on NDPC adequacy whitelist
 *   2. Valid transfer instrument in place (SCC, BCR, etc.)
 *   3. Transfer Impact Assessment completed
 *   4. Data subject consent obtained (where required)
 */

import { Pool } from "pg";
import { getDatabaseUrl } from "./config";
import { getPgSslConfig } from "./dbSslConfig";
import { logger } from "./logger";

// NDPC adequacy whitelist — countries with adequate data protection
// Based on NDPA Section 43(2) criteria
const ADEQUACY_WHITELIST = new Set([
  "EU", "UK", "CA", "JP", "KR", "NZ", "IL", "CH", "UY", "AR",
  "GH", "KE", "ZA", "RW", "MU", "SN", "CV", "TN", "MA",
]);

export interface TransferValidation {
  valid: boolean;
  checks: {
    adequacyCountry: boolean;
    transferInstrument: boolean;
    tiaCompleted: boolean;
    consentObtained: boolean;
  };
  blockers: string[];
  destinationCountry: string;
  transferType: string;
}

let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: getDatabaseUrl(), ssl: getPgSslConfig(), max: 3 });
  }
  return _pool;
}

export async function validateCrossBorderTransfer(
  orgId: number,
  destinationCountry: string,
  transferType: string = "standard"
): Promise<TransferValidation> {
  const pool = getPool();
  const blockers: string[] = [];

  // 1. Check adequacy whitelist
  const adequacyCountry = ADEQUACY_WHITELIST.has(destinationCountry.toUpperCase());

  // 2. Check for valid transfer instrument
  const { rows: instruments } = await pool.query(
    `SELECT id, instrument_type, status, expires_at
     FROM transfer_instruments
     WHERE organization_id = $1
       AND destination_country = $2
       AND status = 'active'
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [orgId, destinationCountry]
  );
  const transferInstrument = instruments.length > 0;

  // 3. Check for completed TIA
  const { rows: tias } = await pool.query(
    `SELECT id, status FROM tia_assessments
     WHERE organization_id = $1
       AND destination_country = $2
       AND status = 'completed'
     ORDER BY completed_at DESC
     LIMIT 1`,
    [orgId, destinationCountry]
  );
  const tiaCompleted = tias.length > 0;

  // 4. Check consent records for cross-border transfers
  const { rows: consents } = await pool.query(
    `SELECT id FROM consent_records
     WHERE organization_id = $1
       AND consent_type = 'cross_border_transfer'
       AND consent_status = 'active'
     LIMIT 1`,
    [orgId]
  );
  const consentObtained = consents.length > 0;

  // Determine blockers
  if (!adequacyCountry && !transferInstrument) {
    blockers.push(`${destinationCountry} is not on the NDPC adequacy whitelist and no transfer instrument exists`);
  }
  if (!tiaCompleted) {
    blockers.push("Transfer Impact Assessment not completed for this destination");
  }
  if (!consentObtained && !adequacyCountry) {
    blockers.push("Data subject consent for cross-border transfer not obtained");
  }

  const valid = blockers.length === 0;

  if (!valid) {
    logger.warn(
      { orgId, destinationCountry, blockers },
      "[CrossBorder] Transfer blocked — %d issues",
      blockers.length
    );
  }

  return {
    valid,
    checks: { adequacyCountry, transferInstrument, tiaCompleted, consentObtained },
    blockers,
    destinationCountry,
    transferType,
  };
}

export function getAdequacyWhitelist(): string[] {
  return Array.from(ADEQUACY_WHITELIST);
}
