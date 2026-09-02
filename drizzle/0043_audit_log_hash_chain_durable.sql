-- Durable, transactionally serialized hash-chain fields for newly written audit logs.
-- Historical records are deliberately not backfilled here: an unverifiable rewrite of
-- existing evidence would not establish non-repudiation. The verifier reports legacy
-- rows without a chain value as an integrity failure for any requested verification window.

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS previous_hash TEXT,
  ADD COLUMN IF NOT EXISTS hash_chain TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'audit_logs_previous_hash_sha256_shape'
      AND conrelid = 'public.audit_logs'::regclass
  ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_previous_hash_sha256_shape
      CHECK (previous_hash IS NULL OR previous_hash ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'audit_logs_hash_chain_sha256_shape'
      AND conrelid = 'public.audit_logs'::regclass
  ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_hash_chain_sha256_shape
      CHECK (hash_chain IS NULL OR hash_chain ~ '^[0-9a-f]{64}$');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.assign_audit_log_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior_hash TEXT;
  canonical_payload TEXT;
BEGIN
  -- Serialize concurrent inserts so the ordered chain cannot fork under load.
  PERFORM pg_advisory_xact_lock(8043, 1);

  IF NEW.previous_hash IS NOT NULL OR NEW.hash_chain IS NOT NULL THEN
    RAISE EXCEPTION 'audit log chain values are database managed';
  END IF;

  SELECT hash_chain
    INTO prior_hash
    FROM public.audit_logs
   WHERE hash_chain IS NOT NULL
   ORDER BY id DESC
   LIMIT 1;

  NEW.previous_hash := prior_hash;
  canonical_payload := concat(
    COALESCE(prior_hash, 'GENESIS'), '|',
    NEW.action, '|',
    COALESCE(NEW.resource_type, ''), '|',
    COALESCE(NEW.resource_id::text, ''), '|',
    COALESCE(NEW.user_id::text, ''), '|',
    COALESCE(NEW.details, '{}'), '|',
    NEW.created_at::text
  );
  NEW.hash_chain := encode(digest(canonical_payload, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_assign_hash_chain ON public.audit_logs;
CREATE TRIGGER audit_logs_assign_hash_chain
BEFORE INSERT ON public.audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.assign_audit_log_hash_chain();

CREATE INDEX IF NOT EXISTS idx_audit_logs_hash_chain
  ON public.audit_logs (hash_chain)
  WHERE hash_chain IS NOT NULL;
