-- ============================================================================
-- 0118: Round-9 FIN-1 — NDPC semantics for enforcement-case escalation
--       (idempotent; non-breaking)
--
-- The NDPA 2023 established the Nigeria Data Protection Commission (NDPC),
-- which succeeded NITDA for data-protection enforcement. The legacy enum
-- value 'escalated_to_nitda' and the column nitda_reference_number are
-- RETAINED so existing rows remain valid; new writes should use
-- 'escalated_to_ndpc'. No row is rewritten.
-- ============================================================================

-- New enum value alongside the legacy one (both remain valid).
ALTER TYPE enforcement_case_status ADD VALUE IF NOT EXISTS 'escalated_to_ndpc';

COMMENT ON COLUMN enforcement_cases.nitda_reference_number IS
  'Regulator reference number for the escalated case. Column name retained for backward compatibility; semantically the NDPC reference (NDPA 2023, NDPC succeeded NITDA for data-protection enforcement).';
