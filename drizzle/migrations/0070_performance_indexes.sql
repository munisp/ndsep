-- Migration: Performance indexes for hot query paths (Phase perf tuning)
-- ============================================================================
-- Idempotent: every statement uses IF NOT EXISTS and is safe to re-run.
--
-- CONCURRENCY NOTE: statements use CREATE INDEX CONCURRENTLY (same precedent
-- as drizzle/production-indexes.sql) so they do not take ACCESS EXCLUSIVE
-- locks on live tables. CONCURRENTLY cannot run inside a transaction block;
-- prior migrations in this folder are plain scripts with no BEGIN/COMMIT,
-- so apply this file the same way (e.g. `psql -f`, or a per-statement
-- runner) — never inside an explicit transaction.
--
-- Every index is annotated with the query path it serves. Query sources:
--   server/db.ts (getDashboardStats), server/routers/enhancements.ts (dsar,
--   globalSearch), phase11Features.ts, phase12Features.ts, phase13Features.ts,
--   accreditation.ts, dpco.ts, sanctionsRegister.ts, foia.ts, finePayments.ts,
--   electionOversight.ts, whistleblowerChannel.ts, fieldInspection.ts,
--   crossBorderAdequacy.ts, appealsDueProcess.ts
-- ============================================================================

-- ─── Public Sanctions Register (0050 tables; sanctionsRegister.ts) ──────────

-- sanctionsRegister.search / stats: public feed filters on published notices
-- and sorts by published_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_notices_public_feed
  ON enforcement_notices (published_at DESC)
  WHERE published_at IS NOT NULL AND status IN ('published', 'remediated', 'expired');

-- sanctionsRegister.listAll: admin list ORDER BY n.created_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_notices_created_at
  ON enforcement_notices (created_at DESC);

-- sanctionsRegister.search: gazette_number ILIKE filter (exact/prefix hits).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_notices_gazette
  ON enforcement_notices (gazette_number)
  WHERE gazette_number IS NOT NULL;

-- sanctionsRegister.requestDelisting: duplicate-open-request check
-- (WHERE notice_id = $1 AND status IN ('pending','under_review')) and the
-- listDelistingRequests review queue join.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_delisting_requests_open_notice
  ON delisting_requests (notice_id)
  WHERE status IN ('pending', 'under_review');

-- ─── FOIA module (0051 tables; foia.ts) ─────────────────────────────────────

-- foia.stats: COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '30 days').
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_foia_requests_received_at
  ON foia_requests (received_at DESC);

-- foia.listTasks: assignedToMe filter on open tasks (t.assigned_to = $N).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_foia_tasks_assigned
  ON foia_tasks (assigned_to)
  WHERE status IN ('open', 'in_progress');

-- ─── Fine payments & reconciliation (0043 tables; finePayments.ts) ──────────

-- finePayments.unmatchedQueue: WHERE match_status IN ('unmatched','partial')
-- ORDER BY created_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_recon_unmatched
  ON payment_reconciliations (created_at DESC)
  WHERE match_status IN ('unmatched', 'partial');

-- finePayments.autoReconcile: NOT EXISTS (SELECT 1 FROM payment_reconciliations
-- r WHERE r.rrr = p.rrr) anti-join over paid RRR codes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_recon_rrr
  ON payment_reconciliations (rrr);

-- FK support: payment_installments.penalty_id -> enforcement_fines(id)
-- (joins + ON DELETE CASCADE).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_installments_penalty
  ON payment_installments (penalty_id);

-- finePayments.verifyReceipt / receipt drill-down by fine.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_receipts_penalty
  ON receipts (penalty_id);

-- finePayments.listReceipts: ORDER BY issued_at DESC LIMIT 200.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_receipts_issued_at
  ON receipts (issued_at DESC);

-- FK support: refund_requests.penalty_id -> enforcement_fines(id).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refund_requests_penalty
  ON refund_requests (penalty_id);

-- finePayments.listRefunds: ORDER BY created_at DESC LIMIT 200.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refund_requests_created
  ON refund_requests (created_at DESC);

-- finePayments.getFineForRrr / phase11 getOutstanding: LEFT JOIN organizations
-- o ON o.id = f.org_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_fines_org
  ON enforcement_fines (org_id);

-- phase11Features.finePayment.getOutstanding: WHERE f.status IN
-- ('pending','partial','overdue') ORDER BY f.due_date ASC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_fines_outstanding
  ON enforcement_fines (due_date)
  WHERE status IN ('pending', 'partial', 'overdue');

-- ─── Election oversight (0052 tables; electionOversight.ts) ─────────────────

-- electionOversight.getActiveScrutinyPeriod: WHERE heightened_scrutiny = true
-- ORDER BY starts_at DESC LIMIT 1.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_election_periods_scrutiny
  ON election_periods (starts_at DESC)
  WHERE heightened_scrutiny = true;

-- electionOversight.listMicrotargetingReports: ORDER BY submitted_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pmr_submitted_at
  ON political_microtargeting_reports (submitted_at DESC);

-- electionOversight.listInecReferrals: ORDER BY r.referred_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inec_referrals_referred_at
  ON inec_referrals (referred_at DESC);

-- FK support: inec_referrals.microtargeting_report_id ->
-- political_microtargeting_reports(id).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inec_referrals_pmr
  ON inec_referrals (microtargeting_report_id);

-- FK support: inec_referrals.election_period_id -> election_periods(id).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inec_referrals_period
  ON inec_referrals (election_period_id);

-- ─── Whistleblower channel (0040 tables; whistleblowerChannel.ts) ───────────

-- whistleblower case queue lists filter by status.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whistleblower_reports_status
  ON whistleblower_reports (status);

-- whistleblower reports list ordering (submitted_at DESC).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whistleblower_reports_submitted
  ON whistleblower_reports (submitted_at DESC);

-- whistleblowerChannel.listProtectionFlags: JOIN whistleblower_reports wr
-- ON wr.id = pf.report_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_protection_flags_report
  ON protection_flags (report_id);

-- whistleblowerChannel.reviewReward: WHERE id = $3 AND status IN
-- ('nominated','approved'); decision queue filters on open reward states.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wb_rewards_open
  ON whistleblower_rewards (status)
  WHERE status IN ('nominated', 'approved');

-- whistleblowerChannel.markThreadRead: UPDATE ... WHERE report_id = $1 AND
-- sender = 'case_officer' AND read_at IS NULL.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wb_messages_unread_officer
  ON whistleblower_messages (report_id)
  WHERE sender = 'case_officer' AND read_at IS NULL;

-- ─── Field inspection (0034 tables; fieldInspection.ts) ─────────────────────

-- fieldInspection.listCases: ORDER BY c.opened_at DESC LIMIT 200.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inspection_cases_opened
  ON inspection_cases (opened_at DESC);

-- fieldInspection active-case queue + sync completion update
-- (status IN ('open','in_field')).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inspection_cases_active
  ON inspection_cases (status)
  WHERE status IN ('open', 'in_field');

-- fieldInspection.listEvidence (WHERE case_uuid = $1 AND deleted = false
-- ORDER BY captured_at ASC) and the evidence_count correlated subquery in
-- listCases (e.case_uuid = c.case_uuid AND e.deleted = false).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inspection_evidence_case_live
  ON inspection_evidence (case_uuid, captured_at)
  WHERE deleted = false;

-- fieldInspection.listConflicts: optional WHERE case_uuid = $1 ORDER BY
-- created_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inspection_conflicts_case
  ON inspection_sync_conflicts (case_uuid, created_at DESC);

-- ─── Cross-border adequacy (0030 tables; crossBorderAdequacy.ts) ────────────

-- crossBorderAdequacy.overdueReviews: WHERE decision_status = 'in_force'
-- ORDER BY review_due_date ASC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_adequacy_decisions_review_due
  ON adequacy_decisions (review_due_date)
  WHERE decision_status = 'in_force';

-- crossBorderAdequacy.listBcr: ORDER BY created_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bcr_created
  ON binding_corporate_rules (created_at DESC);

-- crossBorderAdequacy.listDerogations: ORDER BY d.transfer_date DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_derogations_transfer_date
  ON cross_border_derogations (transfer_date DESC);

-- FK support: cross_border_derogations.adequacy_decision_id ->
-- adequacy_decisions(id).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_derogations_decision
  ON cross_border_derogations (adequacy_decision_id);

-- FK support: cross_border_enforcement_links.derogation_id /
-- adequacy_decision_id (listEnforcementLinks joins).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cb_links_derogation
  ON cross_border_enforcement_links (derogation_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cb_links_decision
  ON cross_border_enforcement_links (adequacy_decision_id);

-- ─── Appeals & due process (0035 tables; appealsDueProcess.ts) ──────────────

-- appealsDueProcess.listAppeals: optional WHERE a.status = $N ORDER BY
-- a.created_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_penalty_appeals_status_created
  ON penalty_appeals (status, created_at DESC);

-- appealsDueProcess: penalty_appeals JOIN financial_penalties ON penalty_id;
-- FK support for appeal_hearings/penalty_stays/tribunal_escalations cascades.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_penalty_appeals_penalty
  ON penalty_appeals (penalty_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_penalty_appeals_org
  ON penalty_appeals (organization_id);

-- appealsDueProcess.listAppeals stay_status subquery (WHERE s.appeal_id = a.id
-- ORDER BY s.granted_at DESC LIMIT 1).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_penalty_stays_appeal
  ON penalty_stays (appeal_id, granted_at DESC);

-- appealsDueProcess.getStayForPenalty: WHERE penalty_id = $1 ORDER BY
-- granted_at DESC LIMIT 1 (covers non-active history; the unique partial
-- idx_penalty_stays_active covers the active stay).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_penalty_stays_penalty_history
  ON penalty_stays (penalty_id, granted_at DESC);

-- appealsDueProcess.listHearings: optional WHERE status = $N ORDER BY
-- h.hearing_date ASC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appeal_hearings_schedule
  ON appeal_hearings (status, hearing_date);

-- appealsDueProcess.listEscalations: optional WHERE status = $N ORDER BY
-- t.escalated_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tribunal_escalations_status
  ON tribunal_escalations (status, escalated_at DESC);

-- ─── DPCO module (dpco.ts, accreditation.ts) ────────────────────────────────

-- dpco.dashboardStats: COUNT(*) WHERE status = 'active' / 'expired' and
-- tier GROUP BY over active organisations.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpco_organisations_status
  ON dpco_organisations (status);

-- dpco.dashboardStats: licences expiring within 90 days
-- (status = 'active' AND licence_expires_at BETWEEN CURRENT_DATE AND +90d).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpco_organisations_licence_expiry
  ON dpco_organisations (licence_expires_at)
  WHERE status = 'active';

-- dpco.listClients (JOIN dpco_organisations, filter c.status) and
-- marketStats per-DPCO client GROUP BY dpco_org_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpco_clients_org_status
  ON dpco_clients (dpco_org_id, status);

-- FK/per-DPCO scoping of audit engagements.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpco_engagements_org
  ON dpco_audit_engagements (dpco_org_id);

-- dpco.dashboardStats: open engagements (current_stage NOT IN
-- ('car_filed','report_issued')); auditTrend scans created_at.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpco_engagements_open
  ON dpco_audit_engagements (created_at)
  WHERE current_stage NOT IN ('car_filed', 'report_issued');

-- dpco.listTrainingSessions: ORDER BY t.scheduled_date DESC (+ status filter).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpco_training_sessions_date
  ON dpco_training_sessions (scheduled_date DESC);

-- dpco.listParticipants: WHERE session_id = ? ORDER BY enrolled_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpco_training_participants_session
  ON dpco_training_participants (session_id);

-- dpco.listPolicyDrafts: status filter (+ updated_at ordering).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpco_policy_drafts_status
  ON dpco_policy_drafts (status);

-- dpco.listVerificationStatements: status filter, ORDER BY created_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpco_verification_status
  ON dpco_verification_statements (status, created_at DESC);

-- dpco.uploadEvidence: dedup lookup WHERE sha256_hash = $1.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpco_evidence_sha256
  ON dpco_evidence_items (sha256_hash);

-- accreditation.listApplications: status filter, ORDER BY created_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpco_accreditation_status
  ON dpco_accreditation_applications (status, created_at DESC);

-- accreditation.submitApplication: duplicate-application pre-check
-- (WHERE email = ? OR rc_number = ? OR cac_number = ?).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpco_accreditation_email
  ON dpco_accreditation_applications (email);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpco_accreditation_rc
  ON dpco_accreditation_applications (rc_number);

-- ─── DSAR / citizen requests (enhancements.ts, phase11Features.ts) ──────────

-- dsar.listWithDeadlines (overdue filter + ORDER BY response_deadline ASC),
-- dsar.pendingCount, electionOversight political-complaint queue: all exclude
-- resolved/closed. Complements the existing partial
-- idx_citizen_requests_deadline (predicate NOT IN ('completed','rejected')).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_requests_open_deadline
  ON citizen_requests (response_deadline)
  WHERE status NOT IN ('resolved', 'closed');

-- enhancements.globalSearch: to_tsvector('english', COALESCE(citizen_name,'')
-- || ' ' || COALESCE(description,'')) @@ plainto_tsquery(...) FTS.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_requests_fts
  ON citizen_requests USING gin (
    to_tsvector('english', coalesce(citizen_name, '') || ' ' || coalesce(description, ''))
  );

-- phase11Features.dsar.getByOrg / dashboard: WHERE org_id = $1.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dsar_requests_org
  ON dsar_requests (org_id);

-- phase11Features.dsar.dashboard: WHERE d.status NOT IN
-- ('completed','rejected','withdrawn') ORDER BY d.deadline_at ASC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dsar_requests_open_deadline
  ON dsar_requests (deadline_at)
  WHERE status NOT IN ('completed', 'rejected', 'withdrawn');

-- ─── NDPA gap-closure tables (server/db.ts getDashboardStats, phase11/13) ────

-- phase13 nationalOverview: breach_incidents WHERE detected_at > NOW() - 30d;
-- phase11 breach stats: detected_at < NOW() - 72h.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_breach_incidents_detected
  ON breach_incidents (detected_at DESC);

-- phase11 breach stats: 72-hour notification overdue check
-- (notified_at IS NULL AND detected_at < NOW() - INTERVAL '72 hours').
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_breach_incidents_unnotified
  ON breach_incidents (detected_at)
  WHERE notified_at IS NULL;

-- phase13 dpoRegistry.list: LEFT JOIN organizations o ON da.organization_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dpo_appointments_org
  ON dpo_appointments (organization_id);

-- getDashboardStats: consent_records FILTER (WHERE consent_status = ...).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_consent_records_status
  ON consent_records (consent_status);

-- enhancements.generateAnnualAuditReturn: upsert/lookup per org + year.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_compliance_audit_returns_org_year
  ON compliance_audit_returns (org_id, reporting_year);

-- phase11 compliance.leaderboard / getOrgScoreHistory:
-- WHERE org_id = $1 ORDER BY recorded_at DESC and recorded_at > NOW() - 30d
-- window scans.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_compliance_score_history_org_time
  ON compliance_score_history (org_id, recorded_at DESC);

-- phase11 webhooks.listByUser / subscribe dedup: WHERE user_id = $1.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_subscriptions_user
  ON webhook_subscriptions (user_id);

-- phase12 lineage traversal: WHERE target_node_id = $1 (upstream) and
-- WHERE source_node_id = $1 (downstream).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_data_lineage_edges_target
  ON data_lineage_edges (target_node_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_data_lineage_edges_source
  ON data_lineage_edges (source_node_id);

-- ─── Post-migration housekeeping ─────────────────────────────────────────────
-- Refresh planner statistics on the newly indexed tables so the planner can
-- use the indexes immediately (ANALYZE is cheap and non-blocking).
ANALYZE enforcement_notices;
ANALYZE delisting_requests;
ANALYZE foia_requests;
ANALYZE foia_tasks;
ANALYZE payment_reconciliations;
ANALYZE payment_installments;
ANALYZE receipts;
ANALYZE refund_requests;
ANALYZE enforcement_fines;
ANALYZE election_periods;
ANALYZE political_microtargeting_reports;
ANALYZE inec_referrals;
ANALYZE whistleblower_reports;
ANALYZE whistleblower_messages;
ANALYZE whistleblower_rewards;
ANALYZE protection_flags;
ANALYZE inspection_cases;
ANALYZE inspection_evidence;
ANALYZE inspection_sync_conflicts;
ANALYZE adequacy_decisions;
ANALYZE binding_corporate_rules;
ANALYZE cross_border_derogations;
ANALYZE cross_border_enforcement_links;
ANALYZE penalty_appeals;
ANALYZE penalty_stays;
ANALYZE appeal_hearings;
ANALYZE tribunal_escalations;
ANALYZE dpco_organisations;
ANALYZE dpco_clients;
ANALYZE dpco_audit_engagements;
ANALYZE dpco_training_sessions;
ANALYZE dpco_training_participants;
ANALYZE dpco_policy_drafts;
ANALYZE dpco_verification_statements;
ANALYZE dpco_evidence_items;
ANALYZE dpco_accreditation_applications;
ANALYZE citizen_requests;
ANALYZE dsar_requests;
ANALYZE breach_incidents;
ANALYZE dpo_appointments;
ANALYZE consent_records;
ANALYZE compliance_audit_returns;
ANALYZE compliance_score_history;
ANALYZE webhook_subscriptions;
ANALYZE data_lineage_edges;
