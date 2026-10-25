#!/usr/bin/env sh
set -eu

# Safe remediation for legacy records that predate migration 0034.
# Never generates legal licence or verification reference numbers. Instead, it
# moves invalid final-state records to identifier_remediation_required and
# records their former state, leaving an auditable operator workflow.

MODE=${1:---report}
DATABASE_URL=${DATABASE_URL:?DATABASE_URL is required}

psql_cmd() {
  psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" "$@"
}

report() {
  psql_cmd <<'SQL'
SELECT 'registry_active_missing_licence' AS category, count(*) AS records
FROM public.dpco_registry_service_records
WHERE COALESCE(payload ->> 'status', '') = 'active'
  AND COALESCE(length(btrim(payload ->> 'licence_number')), 0) = 0
UNION ALL
SELECT 'verification_issued_missing_ref', count(*)
FROM public.dpco_verification_service_records
WHERE COALESCE(payload ->> 'status', '') = 'issued'
  AND COALESCE(length(btrim(payload ->> 'ref_number')), 0) = 0;
SQL
}

apply() {
  psql_cmd <<'SQL'
BEGIN;
LOCK TABLE public.dpco_registry_service_records IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.dpco_verification_service_records IN SHARE ROW EXCLUSIVE MODE;

WITH changed AS (
  UPDATE public.dpco_registry_service_records
  SET payload = jsonb_set(
      jsonb_set(
        jsonb_set(payload, '{previous_final_status}', to_jsonb(payload ->> 'status'), true),
        '{status}', '"identifier_remediation_required"'::jsonb, true
      ),
      '{identifier_remediation}',
      jsonb_build_object(
        'reason', 'missing_licence_number',
        'remediated_at', now(),
        'action', 'final_status_removed_without_fabricating_identifier'
      ),
      true
    ),
    updated_at = now()
  WHERE COALESCE(payload ->> 'status', '') = 'active'
    AND COALESCE(length(btrim(payload ->> 'licence_number')), 0) = 0
  RETURNING registry_id
)
SELECT 'registry_records_quarantined' AS action, count(*) AS records FROM changed;

WITH changed AS (
  UPDATE public.dpco_verification_service_records
  SET payload = jsonb_set(
      jsonb_set(
        jsonb_set(payload, '{previous_final_status}', to_jsonb(payload ->> 'status'), true),
        '{status}', '"identifier_remediation_required"'::jsonb, true
      ),
      '{identifier_remediation}',
      jsonb_build_object(
        'reason', 'missing_ref_number',
        'remediated_at', now(),
        'action', 'final_status_removed_without_fabricating_identifier'
      ),
      true
    ),
    updated_at = now()
  WHERE COALESCE(payload ->> 'status', '') = 'issued'
    AND COALESCE(length(btrim(payload ->> 'ref_number')), 0) = 0
  RETURNING statement_id
)
SELECT 'verification_records_quarantined' AS action, count(*) AS records FROM changed;
COMMIT;
SQL
}

validate() {
  remaining=$(psql_cmd -Atc "
    SELECT (
      (SELECT count(*) FROM public.dpco_registry_service_records
        WHERE COALESCE(payload ->> 'status', '') = 'active'
          AND COALESCE(length(btrim(payload ->> 'licence_number')), 0) = 0)
      +
      (SELECT count(*) FROM public.dpco_verification_service_records
        WHERE COALESCE(payload ->> 'status', '') = 'issued'
          AND COALESCE(length(btrim(payload ->> 'ref_number')), 0) = 0)
    );")
  if [ "$remaining" != "0" ]; then
    echo "Refusing to validate constraints: $remaining invalid final-state record(s) remain." >&2
    exit 1
  fi
  psql_cmd <<'SQL'
ALTER TABLE public.dpco_registry_service_records
  VALIDATE CONSTRAINT dpco_registry_active_requires_licence_number;
ALTER TABLE public.dpco_verification_service_records
  VALIDATE CONSTRAINT dpco_verification_issued_requires_ref_number;
SQL
}

case "$MODE" in
  --report)
    report
    ;;
  --apply)
    echo "Applying non-destructive identifier remediation; no identifiers will be invented."
    apply
    report
    ;;
  --validate-constraints)
    validate
    ;;
  *)
    echo "Usage: $0 [--report|--apply|--validate-constraints]" >&2
    exit 2
    ;;
esac
