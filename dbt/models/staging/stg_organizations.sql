-- Staging: Standardise organisation data
{{ config(materialized='view') }}

SELECT
    id,
    name,
    sector,
    registration_number,
    compliance_score,
    status,
    created_at,
    updated_at
FROM {{ source('ndsep', 'organizations') }}
WHERE status != 'deleted'
