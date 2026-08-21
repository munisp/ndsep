-- Mart: Organisation compliance scores with trend
{{ config(materialized='incremental', unique_key='org_id') }}

WITH latest_scores AS (
    SELECT
        org_id,
        score,
        recorded_at,
        ROW_NUMBER() OVER (PARTITION BY org_id ORDER BY recorded_at DESC) AS rn
    FROM {{ source('ndsep', 'compliance_score_history') }}
),
violation_counts AS (
    SELECT
        org_id,
        COUNT(*) FILTER (WHERE status = 'open') AS open_violations,
        COUNT(*) FILTER (WHERE severity = 'critical' AND status = 'open') AS critical_violations
    FROM {{ source('ndsep', 'violations') }}
    GROUP BY org_id
)
SELECT
    o.id AS org_id,
    o.name AS org_name,
    o.sector,
    COALESCE(ls.score, o.compliance_score, 0) AS compliance_score,
    COALESCE(vc.open_violations, 0) AS open_violations,
    COALESCE(vc.critical_violations, 0) AS critical_violations,
    CASE
        WHEN COALESCE(ls.score, 0) >= 80 THEN 'compliant'
        WHEN COALESCE(ls.score, 0) >= 60 THEN 'at_risk'
        ELSE 'non_compliant'
    END AS compliance_status,
    NOW() AS calculated_at
FROM {{ ref('stg_organizations') }} o
LEFT JOIN latest_scores ls ON o.id = ls.org_id AND ls.rn = 1
LEFT JOIN violation_counts vc ON o.id = vc.org_id
