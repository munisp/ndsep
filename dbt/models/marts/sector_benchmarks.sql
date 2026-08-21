-- Mart: Sector-level compliance benchmarks
{{ config(materialized='table') }}

SELECT
    sector,
    COUNT(*) AS org_count,
    AVG(compliance_score) AS avg_score,
    MIN(compliance_score) AS min_score,
    MAX(compliance_score) AS max_score,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY compliance_score) AS median_score,
    SUM(open_violations) AS total_open_violations,
    NOW() AS calculated_at
FROM {{ ref('compliance_scorecard') }}
GROUP BY sector
