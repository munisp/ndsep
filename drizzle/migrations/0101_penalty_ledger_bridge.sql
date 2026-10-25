-- ============================================================================
-- 0101: Penalty ledger unification bridge (round 9, FIX-A)
--
-- appeals/stays/escalations key financial_penalties.id while RRR collection
-- (finePayments) operates on enforcement_fines. Without a bridge a stay on a
-- financial penalty never suspends RRR collection on the matching fine.
-- This migration adds financial_penalties.enforcement_fine_id, backfills it
-- from the strongest available link, and adds the FK. Idempotent.
-- ============================================================================

ALTER TABLE financial_penalties
  ADD COLUMN IF NOT EXISTS enforcement_fine_id INTEGER;

-- Backfill 1: strongest link — enforcement_fines.case_id → enforcement_cases
-- → enforcement_cases.penalty_id = financial_penalties.id.
UPDATE financial_penalties fp
SET enforcement_fine_id = f.id
FROM enforcement_fines f
JOIN enforcement_cases ec ON ec.id = f.case_id
WHERE fp.enforcement_fine_id IS NULL
  AND ec.penalty_id = fp.id;

-- Backfill 2: unambiguous organisation + amount match (exactly one candidate
-- fine for that org and amount; skip ambiguous pairs).
UPDATE financial_penalties fp
SET enforcement_fine_id = f.id
FROM enforcement_fines f
WHERE fp.enforcement_fine_id IS NULL
  AND f.org_id = fp.organization_id
  AND f.amount = fp.amount
  AND (
    SELECT COUNT(*) FROM enforcement_fines f2
    WHERE f2.org_id = fp.organization_id AND f2.amount = fp.amount
  ) = 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'financial_penalties_enforcement_fine_id_fk'
      AND connamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE financial_penalties
      ADD CONSTRAINT financial_penalties_enforcement_fine_id_fk
      FOREIGN KEY (enforcement_fine_id) REFERENCES enforcement_fines(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_financial_penalties_enforcement_fine
  ON financial_penalties (enforcement_fine_id);

-- Reverse lookup index: "is this fine under a stayed penalty?"
CREATE INDEX IF NOT EXISTS idx_penalty_stays_penalty_active
  ON penalty_stays (penalty_id) WHERE status = 'active';
