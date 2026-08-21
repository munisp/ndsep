/**
 * NDSEP Form Auto-Save — Draft Preservation
 * ============================================
 * Saves form progress to prevent data loss on long compliance forms.
 * Uses both localStorage (client) and database (server) for reliability.
 *
 * Recommendation M9: Form auto-save for long compliance forms
 */

import { Pool } from "pg";
import { logger } from "./logger";
import { handleError } from "./errorClassifier";

const FORM_DRAFTS_TABLE = `
CREATE TABLE IF NOT EXISTS form_drafts (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  form_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, form_type)
);
`;

export async function initFormAutoSave(pool: Pool): Promise<void> {
  try {
    await pool.query(FORM_DRAFTS_TABLE);
    logger.info("[FormAutoSave] Initialized");
  } catch (err) {
    handleError(err, { module: "formAutoSave", action: "init" });
  }
}

/** Save a form draft (upsert) */
export async function saveDraft(
  pool: Pool,
  userId: string,
  formType: string,
  formData: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO form_drafts (user_id, form_type, form_data, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, form_type) DO UPDATE SET form_data = $3, updated_at = NOW()`,
    [userId, formType, JSON.stringify(formData)]
  );
}

/** Load a form draft */
export async function loadDraft(
  pool: Pool,
  userId: string,
  formType: string
): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `SELECT form_data FROM form_drafts WHERE user_id = $1 AND form_type = $2`,
    [userId, formType]
  );
  return result.rows.length > 0 ? result.rows[0].form_data : null;
}

/** Delete a draft (on successful form submission) */
export async function deleteDraft(
  pool: Pool,
  userId: string,
  formType: string
): Promise<void> {
  await pool.query(
    `DELETE FROM form_drafts WHERE user_id = $1 AND form_type = $2`,
    [userId, formType]
  );
}

/** List all drafts for a user */
export async function listDrafts(
  pool: Pool,
  userId: string
): Promise<Array<{ formType: string; updatedAt: Date }>> {
  const result = await pool.query(
    `SELECT form_type, updated_at FROM form_drafts WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return result.rows.map(r => ({ formType: r.form_type, updatedAt: r.updated_at }));
}
