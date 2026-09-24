-- Migration 0076: Breach supplement sequence uniqueness (re-asserted).
--
-- 0033 declared UNIQUE (breach_id, supplement_sequence) on breach_supplements,
-- but deployments where 0033 only partially applied may lack it. The
-- submitSupplement router relies on this constraint to serialize concurrent
-- MAX+1 allocations (it retries on SQLSTATE 23505).
-- Idempotent: safe to run repeatedly.

DO $$
BEGIN
  IF to_regclass('breach_supplements') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'breach_supplements_unique_seq'
      AND conrelid = 'breach_supplements'::regclass
  ) THEN
    -- Deduplicate any historical collisions before adding the constraint.
    DELETE FROM breach_supplements a
    USING breach_supplements b
    WHERE a.breach_id = b.breach_id
      AND a.supplement_sequence = b.supplement_sequence
      AND a.id > b.id;

    ALTER TABLE breach_supplements
      ADD CONSTRAINT breach_supplements_unique_seq
      UNIQUE (breach_id, supplement_sequence);
  END IF;
END $$;
