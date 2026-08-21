-- Report: Monthly NITDA national compliance report
{{ config(materialized='table') }}

SELECT
    DATE_TRUNC('month', NOW()) AS report_month,
    COUNT(DISTINCT org_id) AS total_regulated_entities,
    AVG(compliance_score) AS national_avg_score,
    COUNT(*) FILTER (WHERE compliance_status = 'compliant') AS compliant_count,
    COUNT(*) FILTER (WHERE compliance_status = 'at_risk') AS at_risk_count,
    COUNT(*) FILTER (WHERE compliance_status = 'non_compliant') AS non_compliant_count,
    SUM(open_violations) AS total_open_violations,
    SUM(critical_violations) AS total_critical_violations
FROM {{ ref('compliance_scorecard') }}
