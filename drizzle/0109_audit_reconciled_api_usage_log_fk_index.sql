-- The marketplace tables are initialized by the marketplace module in older
-- deployments. Create the index immediately when the table already exists;
-- the marketplace bootstrap carries the same index for a newly created table.
DO $$
BEGIN
  IF to_regclass('public.api_usage_log') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "idx_api_usage_log_api_key_id_fk"
      ON public."api_usage_log" ("api_key_id");
  END IF;
END $$;
