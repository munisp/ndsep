-- Generated from a verified PostgreSQL catalog comparison.
-- Reconciles the executable historical migration chain with drizzle/schema.ts.
-- Additive only: existing data is preserved; newly introduced constraints validate data.

DO $$ BEGIN CREATE TYPE public."adequacy_status" AS ENUM ('adequate', 'partially_adequate', 'not_adequate', 'under_review', 'pending'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."aml_case_status" AS ENUM ('open', 'under_investigation', 'escalated', 'filed_str', 'closed_no_action', 'closed_action_taken'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."aml_case_type" AS ENUM ('suspicious_transaction', 'pep_match', 'sanctions_match', 'structuring', 'unusual_pattern', 'high_risk_country', 'adverse_media', 'threshold_breach'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."bank_license_type" AS ENUM ('commercial', 'merchant', 'microfinance', 'development', 'mortgage', 'payment_service_bank', 'non_interest'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."bank_status" AS ENUM ('licensed', 'provisional', 'suspended', 'revoked', 'under_examination'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."breach_severity" AS ENUM ('low', 'medium', 'high', 'critical'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."breach_status" AS ENUM ('detected', 'assessing', 'ndpc_notified', 'individuals_notified', 'contained', 'resolved', 'closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."car_status" AS ENUM ('draft', 'submitted', 'under_review', 'accepted', 'rejected', 'revision_requested'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."cbn_report_status" AS ENUM ('draft', 'pending_review', 'approved', 'submitted', 'acknowledged', 'rejected', 'overdue'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."cbn_report_type" AS ENUM ('str', 'ctr', 'scuml_report', 'aml_annual', 'prudential_return', 'liquidity_return', 'capital_adequacy', 'credit_risk', 'operational_risk'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."clinical_trial_status" AS ENUM ('protocol_review', 'ethics_approved', 'recruiting', 'active', 'completed', 'suspended', 'terminated', 'results_pending'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."consent_status" AS ENUM ('active', 'withdrawn', 'expired', 'pending'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."control_rating" AS ENUM ('compliant', 'partial', 'non_compliant', 'not_applicable'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."correspondent_relationship" AS ENUM ('nostro', 'vostro', 'loro', 'bilateral'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."correspondent_status" AS ENUM ('active', 'suspended', 'terminated', 'under_review'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."dpa_status" AS ENUM ('draft', 'active', 'expired', 'terminated', 'under_review'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."dpco_audit_stage" AS ENUM ('initiated', 'data_mapping', 'gap_assessment', 'fieldwork', 'findings_review', 'management_response', 'report_issued', 'car_filed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."dpco_client_policy_status" AS ENUM ('draft', 'reviewed', 'signed', 'expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."dpco_client_risk" AS ENUM ('low', 'medium', 'high', 'critical'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."dpco_client_status" AS ENUM ('active', 'inactive', 'suspended'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."dpco_evidence_status" AS ENUM ('active', 'expired', 'superseded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."dpco_org_status" AS ENUM ('pending', 'active', 'suspended', 'revoked'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."dpco_org_tier" AS ENUM ('starter', 'professional', 'enterprise'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."dpco_training_status" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."dpia_risk_level" AS ENUM ('low', 'medium', 'high', 'critical'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."dpia_status" AS ENUM ('draft', 'in_progress', 'review', 'approved', 'rejected', 'archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."dpo_credential_status" AS ENUM ('pending', 'verified', 'expired', 'suspended', 'revoked'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."dpo_report_status" AS ENUM ('draft', 'submitted', 'verified', 'rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."energy_licence_status" AS ENUM ('active', 'suspended', 'revoked', 'expired', 'pending_renewal', 'under_review'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."energy_licence_type" AS ENUM ('generation', 'transmission', 'distribution', 'trading', 'system_operator', 'oil_exploration', 'oil_production', 'gas_processing', 'pipeline', 'refinery'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."export_job_status" AS ENUM ('queued', 'processing', 'completed', 'failed', 'expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."fintech_data_event_type" AS ENUM ('transaction_data_export', 'customer_data_transfer', 'kyc_data_sharing', 'credit_data_export', 'fraud_data_sharing', 'regulatory_reporting', 'cross_border_payment', 'data_breach'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."fintech_licence_status" AS ENUM ('active', 'suspended', 'revoked', 'expired', 'provisional', 'sandbox', 'under_review'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."fintech_licence_type" AS ENUM ('payment_service_bank', 'mobile_money', 'switching_company', 'payment_solution_service', 'super_agent', 'microfinance_bank', 'digital_bank', 'crowdfunding', 'robo_advisor', 'crypto_exchange', 'emoney_issuer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."fraud_alert_status" AS ENUM ('open', 'investigating', 'confirmed_fraud', 'false_positive', 'escalated', 'resolved'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."fraud_alert_type" AS ENUM ('velocity_breach', 'unusual_amount', 'geo_anomaly', 'device_fingerprint', 'account_takeover', 'synthetic_identity', 'card_not_present', 'social_engineering', 'insider_threat', 'ml_anomaly'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."grid_event_type" AS ENUM ('outage', 'voltage_deviation', 'frequency_deviation', 'load_shedding', 'equipment_failure', 'cyber_incident', 'natural_disaster', 'planned_maintenance'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."health_data_category" AS ENUM ('patient_records', 'clinical_trials', 'genomic_data', 'mental_health', 'hiv_aids', 'reproductive_health', 'insurance_claims', 'prescription_data'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."health_facility_type" AS ENUM ('federal_hospital', 'state_hospital', 'private_hospital', 'clinic', 'pharmacy', 'laboratory', 'hmo', 'telemedicine', 'research_institute'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."insurance_claim_status" AS ENUM ('submitted', 'under_investigation', 'approved', 'partially_approved', 'rejected', 'appealed', 'settled', 'closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."insurance_licence_status" AS ENUM ('active', 'suspended', 'revoked', 'expired', 'provisional', 'under_review'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."insurance_licence_type" AS ENUM ('life', 'non_life', 'composite', 'reinsurance', 'broker', 'loss_adjuster', 'microinsurance', 'takaful', 'health_insurance'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."interconnect_dispute_status" AS ENUM ('filed', 'under_investigation', 'mediation', 'arbitration', 'resolved', 'escalated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."kyc_status" AS ENUM ('pending', 'in_review', 'verified', 'rejected', 'expired', 'suspended'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."kyc_tier" AS ENUM ('tier1', 'tier2', 'tier3'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."lawful_basis" AS ENUM ('consent', 'contract', 'legal_obligation', 'vital_interest', 'public_interest', 'legitimate_interest'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."nip_status" AS ENUM ('initiated', 'processing', 'completed', 'failed', 'reversed', 'pending_confirmation'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."parental_consent_status" AS ENUM ('pending', 'granted', 'denied', 'withdrawn', 'expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."privacy_notice_status" AS ENUM ('draft', 'active', 'archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."qos_violation_type" AS ENUM ('call_drop_rate', 'voice_quality', 'data_throughput', 'latency', 'availability', 'coverage_gap', 'interconnect_failure', 'billing_dispute'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."rtgs_status" AS ENUM ('queued', 'processing', 'settled', 'rejected', 'cancelled', 'pending_funds'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."spectrum_band" AS ENUM ('700mhz', '800mhz', '900mhz', '1800mhz', '2100mhz', '2300mhz', '2600mhz', '3500mhz', '26ghz', '28ghz'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."swift_status" AS ENUM ('draft', 'sent', 'acknowledged', 'processed', 'rejected', 'recalled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."telecom_licence_status" AS ENUM ('active', 'suspended', 'revoked', 'expired', 'pending_renewal', 'under_review'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."telecom_licence_type" AS ENUM ('unified_access', 'spectrum', 'isp', 'vsat', 'type_approval', 'infrastructure', 'numbering', 'mvno', 'submarine_cable'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."training_status" AS ENUM ('scheduled', 'in_progress', 'completed', 'overdue', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."transfer_instrument_status" AS ENUM ('draft', 'active', 'expired', 'revoked'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."transfer_instrument_type" AS ENUM ('bcr', 'scc', 'adequacy', 'derogation', 'authorization'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE public."user_role" ADD VALUE IF NOT EXISTS 'dpco';
DO $$ BEGIN CREATE TYPE public."watchlist_category" AS ENUM ('sanctions', 'pep', 'adverse_media', 'terrorism', 'fraud', 'corruption', 'money_laundering'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public."watchlist_source" AS ENUM ('ofac_sdn', 'un_consolidated', 'eu_consolidated', 'uk_hmt', 'cbn_internal', 'interpol', 'efcc', 'nfiu', 'local_court'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE "adequacy_determinations" (
	"id" serial PRIMARY KEY NOT NULL,
	"country_code" varchar(8) NOT NULL,
	"country_name" varchar(128) NOT NULL,
	"adequacy_status" "adequacy_status" DEFAULT 'pending' NOT NULL,
	"data_protection_law" varchar(256),
	"supervisory_authority" varchar(256),
	"assessment_date" timestamp,
	"expires_at" timestamp,
	"notes" text,
	"requires_additional_safeguards" boolean DEFAULT false,
	"approved_transfer_instruments" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "adequacy_determinations_country_code_unique" UNIQUE("country_code")
);

CREATE TABLE "ai_ethics_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_ref" varchar(50) NOT NULL,
	"org_id" integer,
	"ai_system_name" varchar(255) NOT NULL,
	"ai_system_type" varchar(100) NOT NULL,
	"risk_category" varchar(30) DEFAULT 'high',
	"bias_assessment_score" integer,
	"explainability_score" integer,
	"fairness_score" integer,
	"overall_ethics_score" integer,
	"ndpa_article_24_compliant" boolean DEFAULT false,
	"human_oversight_enabled" boolean DEFAULT false,
	"data_subjects_informed" boolean DEFAULT false,
	"findings" jsonb DEFAULT '[]',
	"recommendations" jsonb DEFAULT '[]',
	"review_status" varchar(30) DEFAULT 'pending',
	"reviewed_at" timestamp,
	"next_review_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_ethics_reviews_review_ref_unique" UNIQUE("review_ref")
);

CREATE TABLE "airflow_dags" (
	"id" serial PRIMARY KEY NOT NULL,
	"dag_id" varchar(255) NOT NULL,
	"dag_name" varchar(255) NOT NULL,
	"description" text,
	"schedule" varchar(100) DEFAULT '0 2 * * *',
	"is_active" boolean DEFAULT true,
	"is_paused" boolean DEFAULT false,
	"last_run_status" varchar(30) DEFAULT 'success',
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"task_count" integer DEFAULT 0,
	"success_count" integer DEFAULT 0,
	"failure_count" integer DEFAULT 0,
	"tags" jsonb DEFAULT '[]',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "airflow_dags_dag_id_unique" UNIQUE("dag_id")
);

CREATE TABLE "aml_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_ref" varchar(50) NOT NULL,
	"organization_id" integer,
	"bank_id" integer,
	"subject_name" varchar(255) NOT NULL,
	"subject_type" varchar(30) DEFAULT 'individual',
	"subject_bvn" varchar(11),
	"case_type" "aml_case_type" NOT NULL,
	"status" "aml_case_status" DEFAULT 'open' NOT NULL,
	"risk_score" integer DEFAULT 0,
	"pep_match" boolean DEFAULT false,
	"sanctions_match" boolean DEFAULT false,
	"adverse_media_match" boolean DEFAULT false,
	"transaction_amount" bigint,
	"transaction_currency" varchar(3) DEFAULT 'NGN',
	"transaction_ref" varchar(100),
	"source_of_funds" text,
	"narrative" text,
	"str_reference" varchar(50),
	"str_filed_at" timestamp,
	"assigned_to" varchar(255),
	"escalated_to" varchar(255),
	"closed_at" timestamp,
	"closure_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "aml_cases_case_ref_unique" UNIQUE("case_ref")
);

CREATE TABLE "automated_decision_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"ai_system_id" integer,
	"data_subject_email" varchar(320),
	"decision_type" varchar(128) NOT NULL,
	"decision_outcome" text NOT NULL,
	"significant_effect" boolean DEFAULT false,
	"human_review_requested" boolean DEFAULT false,
	"human_review_completed_at" timestamp,
	"human_review_outcome" text,
	"logic_explanation" text,
	"input_data_summary" text,
	"opt_out_requested" boolean DEFAULT false,
	"opt_out_granted_at" timestamp,
	"metadata" jsonb,
	"decided_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "banking_institutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"cbn_code" varchar(10) NOT NULL,
	"sort_code" varchar(10) NOT NULL,
	"bic_code" varchar(11),
	"name" varchar(255) NOT NULL,
	"short_name" varchar(50) NOT NULL,
	"license_type" "bank_license_type" NOT NULL,
	"license_number" varchar(50) NOT NULL,
	"status" "bank_status" DEFAULT 'licensed' NOT NULL,
	"head_office_address" text,
	"ceo_name" varchar(255),
	"total_assets" bigint,
	"capital_adequacy_ratio" numeric(5, 2),
	"non_performing_loan_ratio" numeric(5, 2),
	"data_protection_officer" varchar(255),
	"dpco_org_id" integer,
	"last_examination_date" timestamp,
	"next_examination_date" timestamp,
	"compliance_score" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "banking_institutions_cbn_code_unique" UNIQUE("cbn_code"),
	CONSTRAINT "banking_institutions_sort_code_unique" UNIQUE("sort_code")
);

CREATE TABLE "breach_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"breach_incident_severity" "breach_severity" DEFAULT 'medium' NOT NULL,
	"breach_incident_status" "breach_status" DEFAULT 'detected' NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"ndpc_notification_deadline" timestamp NOT NULL,
	"ndpc_notified_at" timestamp,
	"individuals_notified_at" timestamp,
	"contained_at" timestamp,
	"resolved_at" timestamp,
	"affected_individuals_count" integer DEFAULT 0,
	"data_types_affected" jsonb DEFAULT '[]'::jsonb,
	"breach_cause" text,
	"remediation_actions" text,
	"reported_by" integer,
	"assigned_to" integer,
	"ndpc_reference_number" varchar(128),
	"security_alert_id" integer,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "cbn_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_ref" varchar(50) NOT NULL,
	"bank_id" integer,
	"organization_id" integer,
	"report_type" "cbn_report_type" NOT NULL,
	"reporting_period" varchar(20) NOT NULL,
	"status" "cbn_report_status" DEFAULT 'draft' NOT NULL,
	"filing_deadline" timestamp,
	"submitted_at" timestamp,
	"acknowledged_at" timestamp,
	"cbn_ack_ref" varchar(50),
	"xml_payload" text,
	"pdf_url" varchar(500),
	"total_transactions" integer,
	"total_amount" bigint,
	"rejection_reason" text,
	"prepared_by" varchar(255),
	"approved_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cbn_reports_report_ref_unique" UNIQUE("report_ref")
);

CREATE TABLE "clinical_trials" (
	"id" serial PRIMARY KEY NOT NULL,
	"trial_ref" varchar(50) NOT NULL,
	"facility_id" integer,
	"organization_id" integer,
	"trial_title" varchar(500) NOT NULL,
	"sponsor_name" varchar(255) NOT NULL,
	"principal_investigator" varchar(255),
	"phase" varchar(20),
	"therapeutic_area" varchar(100),
	"status" "clinical_trial_status" DEFAULT 'protocol_review' NOT NULL,
	"participant_count" integer,
	"data_storage_country" varchar(100),
	"foreign_sponsor" boolean DEFAULT false,
	"ndpc_approval_ref" varchar(50),
	"ethics_approval_ref" varchar(50),
	"start_date" timestamp,
	"end_date" timestamp,
	"data_localisation_compliant" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_trials_trial_ref_unique" UNIQUE("trial_ref")
);

CREATE TABLE "compliance_audit_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"audit_period_start" timestamp NOT NULL,
	"audit_period_end" timestamp NOT NULL,
	"car_status" "car_status" DEFAULT 'draft' NOT NULL,
	"dpco_id" varchar(128),
	"dpco_name" varchar(256),
	"compliance_score" real,
	"findings_summary" text,
	"non_conformities" jsonb DEFAULT '[]'::jsonb,
	"corrective_actions" jsonb DEFAULT '[]'::jsonb,
	"data_protection_policies_review" text,
	"security_measures_assessment" text,
	"staff_training_assessment" text,
	"incident_response_assessment" text,
	"cross_border_assessment" text,
	"submitted_at" timestamp,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "compliance_gap_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"assessment_ref" varchar(50) NOT NULL,
	"org_id" integer,
	"assessment_type" varchar(50) DEFAULT 'ndpa_full',
	"overall_score" integer DEFAULT 0,
	"gap_count" integer DEFAULT 0,
	"critical_gaps" integer DEFAULT 0,
	"high_gaps" integer DEFAULT 0,
	"medium_gaps" integer DEFAULT 0,
	"low_gaps" integer DEFAULT 0,
	"gaps" jsonb DEFAULT '[]',
	"recommendations" jsonb DEFAULT '[]',
	"remediation_plan" jsonb DEFAULT '{}',
	"assessed_at" timestamp DEFAULT now() NOT NULL,
	"next_assessment_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_gap_assessments_assessment_ref_unique" UNIQUE("assessment_ref")
);

CREATE TABLE "consent_lifecycle_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"consent_id" varchar(100) NOT NULL,
	"org_id" integer,
	"data_subject_id" varchar(100) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"purpose_category" varchar(100),
	"legal_basis" varchar(100) DEFAULT 'consent',
	"data_categories" jsonb DEFAULT '[]',
	"retention_period_days" integer,
	"ip_address" varchar(45),
	"evidence_hash" varchar(64),
	"ndpa_article" varchar(50),
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "consent_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"data_subject_name" varchar(256) NOT NULL,
	"data_subject_email" varchar(320) NOT NULL,
	"data_subject_nin" varchar(64),
	"purpose" text NOT NULL,
	"lawful_basis" "lawful_basis" NOT NULL,
	"consent_status" "consent_status" DEFAULT 'active' NOT NULL,
	"consent_given_at" timestamp DEFAULT now() NOT NULL,
	"consent_withdrawn_at" timestamp,
	"expires_at" timestamp,
	"evidence_ref" text,
	"data_categories" jsonb DEFAULT '[]'::jsonb,
	"processing_activities" jsonb DEFAULT '[]'::jsonb,
	"third_party_sharing" boolean DEFAULT false,
	"cross_border_transfer" boolean DEFAULT false,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "cookie_consent_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"domain" varchar(256) NOT NULL,
	"visitor_id" varchar(256),
	"consent_given" boolean DEFAULT false NOT NULL,
	"necessary_cookies" boolean DEFAULT true,
	"analytical_cookies" boolean DEFAULT false,
	"marketing_cookies" boolean DEFAULT false,
	"functional_cookies" boolean DEFAULT false,
	"consent_timestamp" timestamp DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp,
	"ip_address" varchar(64),
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "correspondent_banks" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_id" integer,
	"correspondent_name" varchar(255) NOT NULL,
	"correspondent_bic" varchar(11) NOT NULL,
	"country" varchar(100) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"relationship_type" "correspondent_relationship" NOT NULL,
	"nostro_account" varchar(50),
	"vostro_account" varchar(50),
	"status" "correspondent_status" DEFAULT 'active' NOT NULL,
	"daily_limit" bigint,
	"monthly_limit" bigint,
	"kyc_completed" boolean DEFAULT false,
	"aml_risk_rating" varchar(20) DEFAULT 'low',
	"last_review_date" timestamp,
	"next_review_date" timestamp,
	"agreement_url" varchar(500),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "correspondent_banks_correspondent_bic_unique" UNIQUE("correspondent_bic")
);

CREATE TABLE "cross_agency_data_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"share_ref" varchar(50) NOT NULL,
	"requesting_agency" varchar(255) NOT NULL,
	"providing_agency" varchar(255) NOT NULL,
	"data_categories" jsonb DEFAULT '[]',
	"legal_basis" varchar(100) NOT NULL,
	"ndpa_article" varchar(50),
	"purpose" text NOT NULL,
	"status" varchar(30) DEFAULT 'pending',
	"approved_by" varchar(255),
	"ndpc_approval_ref" varchar(100),
	"records_shared" bigint DEFAULT 0,
	"encryption_standard" varchar(50) DEFAULT 'AES-256',
	"data_minimisation_applied" boolean DEFAULT true,
	"audit_trail_enabled" boolean DEFAULT true,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cross_agency_data_shares_share_ref_unique" UNIQUE("share_ref")
);

CREATE TABLE "data_export_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"citizen_request_id" integer,
	"organization_id" integer NOT NULL,
	"data_subject_email" varchar(320) NOT NULL,
	"export_format" varchar(32) DEFAULT 'json' NOT NULL,
	"export_job_status" "export_job_status" DEFAULT 'queued' NOT NULL,
	"data_categories" jsonb DEFAULT '[]'::jsonb,
	"file_size_bytes" integer,
	"download_url" text,
	"download_expires_at" timestamp,
	"processed_at" timestamp,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "data_lineage_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_node_id" varchar(100) NOT NULL,
	"target_node_id" varchar(100) NOT NULL,
	"transformation_type" varchar(100),
	"transformation_logic" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "data_lineage_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" varchar(100) NOT NULL,
	"node_type" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"system_name" varchar(100),
	"org_id" integer,
	"pii_contained" boolean DEFAULT false,
	"classification_level" varchar(50) DEFAULT 'internal',
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "data_lineage_nodes_node_id_unique" UNIQUE("node_id")
);

CREATE TABLE "data_pipeline_flows" (
	"id" serial PRIMARY KEY NOT NULL,
	"flow_id" varchar(100) NOT NULL,
	"flow_name" varchar(255) NOT NULL,
	"engine" varchar(50) DEFAULT 'nifi' NOT NULL,
	"status" varchar(30) DEFAULT 'running' NOT NULL,
	"org_id" integer,
	"source_system" varchar(255),
	"target_system" varchar(255),
	"records_processed" bigint DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"schedule_expression" varchar(100),
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "data_pipeline_flows_flow_id_unique" UNIQUE("flow_id")
);

CREATE TABLE "data_processing_agreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"processor_name" varchar(256) NOT NULL,
	"processor_country" varchar(128),
	"dpa_status" "dpa_status" DEFAULT 'draft' NOT NULL,
	"agreement_date" timestamp,
	"expiry_date" timestamp,
	"processing_purpose" text,
	"data_categories" jsonb DEFAULT '[]'::jsonb,
	"sub_processors" jsonb DEFAULT '[]'::jsonb,
	"security_measures" text,
	"breach_notification_clause" boolean DEFAULT true,
	"cross_border_transfer" boolean DEFAULT false,
	"audit_rights" boolean DEFAULT true,
	"termination_provisions" text,
	"document_url" text,
	"reviewed_by" integer,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "dbt_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_name" varchar(255) NOT NULL,
	"schema" varchar(100) DEFAULT 'compliance' NOT NULL,
	"materialisation" varchar(30) DEFAULT 'table',
	"status" varchar(30) DEFAULT 'success',
	"rows_affected" bigint DEFAULT 0,
	"execution_time_ms" integer DEFAULT 0,
	"last_run_at" timestamp DEFAULT now(),
	"sql_definition" text,
	"description" text,
	"tags" jsonb DEFAULT '[]',
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "dcpmi_thresholds" (
	"id" serial PRIMARY KEY NOT NULL,
	"sector_code" varchar(64),
	"criterion_name" varchar(256) NOT NULL,
	"criterion_description" text,
	"threshold_value" real NOT NULL,
	"threshold_unit" varchar(64) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_date" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "dpco_audit_control_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"engagement_id" integer NOT NULL,
	"control_id" varchar(20) NOT NULL,
	"rating" "control_rating" NOT NULL,
	"notes" text,
	"rated_by" varchar(255),
	"rated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "dpco_audit_engagements" (
	"id" serial PRIMARY KEY NOT NULL,
	"dpco_org_id" integer NOT NULL,
	"client_id" integer,
	"title" varchar(255) NOT NULL,
	"current_stage" "dpco_audit_stage" DEFAULT 'initiated' NOT NULL,
	"compliance_score" integer,
	"lead_auditor" varchar(255),
	"planned_start" timestamp,
	"planned_end" timestamp,
	"actual_start" timestamp,
	"actual_end" timestamp,
	"critical_findings" integer DEFAULT 0,
	"high_findings" integer DEFAULT 0,
	"medium_findings" integer DEFAULT 0,
	"low_findings" integer DEFAULT 0,
	"management_response" text,
	"notes" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "dpco_client_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"dpco_org_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"template_id" varchar(100) NOT NULL,
	"template_name" varchar(255) NOT NULL,
	"status" "dpco_client_policy_status" DEFAULT 'draft' NOT NULL,
	"customised_content" text,
	"file_url" varchar(500),
	"assigned_by" varchar(255),
	"signed_at" timestamp,
	"expires_at" timestamp,
	"notes" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "dpco_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"dpco_org_id" integer NOT NULL,
	"org_name" varchar(255) NOT NULL,
	"org_sector" varchar(100),
	"org_location" varchar(255),
	"contact_name" varchar(255),
	"contact_email" varchar(255),
	"contact_phone" varchar(50),
	"status" "dpco_client_status" DEFAULT 'active' NOT NULL,
	"risk_level" "dpco_client_risk" DEFAULT 'medium' NOT NULL,
	"compliance_score" integer DEFAULT 0,
	"onboarded_at" timestamp DEFAULT now(),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "dpco_evidence_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"dpco_org_id" integer NOT NULL,
	"engagement_id" integer,
	"client_id" integer,
	"title" varchar(255) NOT NULL,
	"description" text,
	"file_url" varchar(500),
	"file_key" varchar(500),
	"file_name" varchar(255),
	"mime_type" varchar(100),
	"file_size" integer,
	"sha256_hash" varchar(64),
	"control_ids" text[],
	"status" "dpco_evidence_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp,
	"uploaded_by" varchar(255),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "dpco_organisations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"licence_number" varchar(100),
	"status" "dpco_org_status" DEFAULT 'pending' NOT NULL,
	"tier" "dpco_org_tier" DEFAULT 'starter' NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"address" text,
	"cac_number" varchar(100),
	"tax_id" varchar(100),
	"rc_number" varchar(100),
	"dpo_name" varchar(255),
	"dpo_email" varchar(255),
	"services" text[],
	"sectors" text[],
	"website" varchar(255),
	"logo_url" varchar(500),
	"licence_expires_at" timestamp,
	"approved_at" timestamp,
	"approved_by" varchar(255),
	"rejection_reason" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dpco_organisations_licence_number_unique" UNIQUE("licence_number")
);

CREATE TABLE "dpco_policy_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"dpco_org_id" integer NOT NULL,
	"client_org_id" integer,
	"client_name" varchar(255),
	"title" varchar(500) NOT NULL,
	"document_type" varchar(100) NOT NULL,
	"content" text,
	"version" varchar(20) DEFAULT '1.0' NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"approved_by" varchar(255),
	"approved_at" timestamp,
	"signed_at" timestamp,
	"pdf_url" varchar(500),
	"tags" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "dpco_training_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"dpco_org_id" integer NOT NULL,
	"client_id" integer,
	"title" varchar(255) NOT NULL,
	"description" text,
	"training_type" varchar(100),
	"status" "dpco_training_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_date" timestamp,
	"completed_date" timestamp,
	"participant_count" integer DEFAULT 0,
	"certificates_issued" integer DEFAULT 0,
	"ndpa_section" varchar(50),
	"facilitator" varchar(255),
	"venue" varchar(255),
	"materials" text[],
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "dpco_verification_statements" (
	"id" serial PRIMARY KEY NOT NULL,
	"dpco_org_id" integer NOT NULL,
	"client_org_id" integer,
	"client_name" varchar(255) NOT NULL,
	"filing_period" varchar(50) NOT NULL,
	"statement_type" varchar(100) NOT NULL,
	"statement_text" text,
	"signed_by" varchar(255),
	"signed_at" timestamp,
	"pdf_url" varchar(500),
	"pkcs7_signature" text,
	"verification_code" varchar(64),
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp,
	"reviewed_by" varchar(255),
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dpco_verification_statements_verification_code_unique" UNIQUE("verification_code")
);

CREATE TABLE "dpia_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"title" text NOT NULL,
	"processing_description" text NOT NULL,
	"trigger_category" varchar(128) NOT NULL,
	"dpia_status" "dpia_status" DEFAULT 'draft' NOT NULL,
	"dpia_risk_level" "dpia_risk_level" DEFAULT 'medium' NOT NULL,
	"data_categories" jsonb DEFAULT '[]'::jsonb,
	"purpose_of_processing" text,
	"necessity_assessment" text,
	"risk_assessment" text,
	"mitigation_measures" text,
	"residual_risk" text,
	"ndpc_consultation_required" boolean DEFAULT false,
	"ndpc_consulted_at" timestamp,
	"reviewed_by" integer,
	"approved_at" timestamp,
	"next_review_date" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "dpo_appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"dpo_name" varchar(256) NOT NULL,
	"dpo_email" varchar(320) NOT NULL,
	"dpo_phone" varchar(32),
	"appointed_at" timestamp DEFAULT now() NOT NULL,
	"credential_status" "dpo_credential_status" DEFAULT 'pending' NOT NULL,
	"dpco_id" varchar(128),
	"dpco_name" varchar(256),
	"certification_expires_at" timestamp,
	"last_report_submitted_at" timestamp,
	"independence_verified" boolean DEFAULT false,
	"training_hours_completed" integer DEFAULT 0,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "dpo_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"dpo_appointment_id" integer,
	"report_period_start" timestamp NOT NULL,
	"report_period_end" timestamp NOT NULL,
	"dpo_report_status" "dpo_report_status" DEFAULT 'draft' NOT NULL,
	"privacy_notices_review" text,
	"data_processing_categories" text,
	"lawful_bases_review" text,
	"dpia_review" text,
	"rights_exercise_review" text,
	"complaint_handling" text,
	"security_measures_review" text,
	"cross_border_review" text,
	"breach_notifications" text,
	"training_activities" text,
	"recommendations" text,
	"dpco_verified_at" timestamp,
	"dpco_verifier_id" varchar(128),
	"submitted_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "energy_companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"company_name" varchar(255) NOT NULL,
	"company_code" varchar(20) NOT NULL,
	"sector" varchar(50) DEFAULT 'electricity' NOT NULL,
	"nerc_licence_number" varchar(50),
	"nuprc_licence_number" varchar(50),
	"installed_capacity_mw" numeric(10, 2),
	"distribution_zone" varchar(100),
	"customer_base" bigint DEFAULT 0,
	"data_localisation_compliant" boolean DEFAULT false,
	"scada_system" varchar(100),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "energy_companies_company_code_unique" UNIQUE("company_code")
);

CREATE TABLE "energy_licences" (
	"id" serial PRIMARY KEY NOT NULL,
	"licence_ref" varchar(50) NOT NULL,
	"company_id" integer,
	"organization_id" integer,
	"licence_type" "energy_licence_type" NOT NULL,
	"status" "energy_licence_status" DEFAULT 'active' NOT NULL,
	"authorized_capacity_mw" numeric(10, 2),
	"geographic_scope" varchar(255),
	"annual_fee_ngn" bigint,
	"issued_at" timestamp,
	"expires_at" timestamp,
	"data_localisation_condition" boolean DEFAULT true,
	"cyber_security_compliant" boolean DEFAULT false,
	"nerc_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "energy_licences_licence_ref_unique" UNIQUE("licence_ref")
);

CREATE TABLE "fintech_companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"company_name" varchar(255) NOT NULL,
	"cbn_licence_number" varchar(50),
	"sec_licence_number" varchar(50),
	"licence_type" "fintech_licence_type" NOT NULL,
	"status" "fintech_licence_status" DEFAULT 'active' NOT NULL,
	"active_users" bigint DEFAULT 0,
	"monthly_transaction_volume_ngn" bigint,
	"data_localisation_compliant" boolean DEFAULT false,
	"sandbox_mode" boolean DEFAULT false,
	"api_gateway_url" varchar(500),
	"data_storage_country" varchar(100) DEFAULT 'Nigeria',
	"licence_expires_at" timestamp,
	"last_cbn_audit" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fintech_companies_cbn_licence_number_unique" UNIQUE("cbn_licence_number")
);

CREATE TABLE "fintech_data_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_ref" varchar(50) NOT NULL,
	"company_id" integer,
	"event_type" "fintech_data_event_type" NOT NULL,
	"data_category" "data_classification" DEFAULT 'tier2_financial' NOT NULL,
	"records_affected" bigint,
	"source_country" varchar(100) DEFAULT 'Nigeria',
	"destination_country" varchar(100),
	"is_localised" boolean DEFAULT true,
	"violation_detected" boolean DEFAULT false,
	"violation_details" text,
	"regulatory_notified" boolean DEFAULT false,
	"penalty_ngn" bigint,
	"status" varchar(30) DEFAULT 'detected',
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fintech_data_events_event_ref_unique" UNIQUE("event_ref")
);

CREATE TABLE "fraud_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_ref" varchar(50) NOT NULL,
	"bank_id" integer,
	"organization_id" integer,
	"transaction_ref" varchar(100),
	"transaction_amount" bigint,
	"account_number" varchar(20),
	"alert_type" "fraud_alert_type" NOT NULL,
	"risk_score" integer DEFAULT 0,
	"ml_model" varchar(100),
	"ml_confidence" numeric(5, 2),
	"rule_triggered" varchar(255),
	"status" "fraud_alert_status" DEFAULT 'open' NOT NULL,
	"disposition" varchar(50),
	"investigator_notes" text,
	"assigned_to" varchar(255),
	"blocked_at" timestamp,
	"resolved_at" timestamp,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fraud_alerts_alert_ref_unique" UNIQUE("alert_ref")
);

CREATE TABLE "grid_monitoring_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_ref" varchar(50) NOT NULL,
	"company_id" integer,
	"event_type" "grid_event_type" NOT NULL,
	"severity" "severity" DEFAULT 'medium' NOT NULL,
	"affected_region" varchar(255),
	"affected_customers" integer,
	"duration_minutes" integer,
	"power_loss_mw" numeric(10, 2),
	"scada_data_exported" boolean DEFAULT false,
	"export_destination" varchar(255),
	"data_localisation_violation" boolean DEFAULT false,
	"reported_to_nerc" boolean DEFAULT false,
	"nerc_report_ref" varchar(50),
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"root_cause" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "grid_monitoring_events_event_ref_unique" UNIQUE("event_ref")
);

CREATE TABLE "health_facilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"facility_name" varchar(255) NOT NULL,
	"facility_code" varchar(20) NOT NULL,
	"facility_type" "health_facility_type" NOT NULL,
	"nhia_accreditation_number" varchar(50),
	"fmoh_licence_number" varchar(50),
	"state" varchar(100) NOT NULL,
	"lga" varchar(100),
	"address" text,
	"bed_capacity" integer,
	"patient_records_count" bigint DEFAULT 0,
	"emr_system" varchar(100),
	"data_localisation_compliant" boolean DEFAULT false,
	"ndpc_registered" boolean DEFAULT false,
	"dpia_completed" boolean DEFAULT false,
	"last_audit_date" timestamp,
	"compliance_score" numeric(5, 2),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "health_facilities_facility_code_unique" UNIQUE("facility_code")
);

CREATE TABLE "incident_playbooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"playbook_code" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"incident_type" varchar(100) NOT NULL,
	"severity" varchar(20) DEFAULT 'high',
	"ndpa_obligation" varchar(100),
	"steps" jsonb DEFAULT '[]' NOT NULL,
	"escalation_matrix" jsonb DEFAULT '{}',
	"sla_hours" integer DEFAULT 72,
	"is_active" boolean DEFAULT true,
	"last_reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "incident_playbooks_playbook_code_unique" UNIQUE("playbook_code")
);

CREATE TABLE "incident_response_activations" (
	"id" serial PRIMARY KEY NOT NULL,
	"activation_ref" varchar(50) NOT NULL,
	"playbook_id" integer,
	"org_id" integer,
	"incident_title" varchar(255) NOT NULL,
	"status" varchar(30) DEFAULT 'active',
	"current_step" integer DEFAULT 1,
	"completed_steps" jsonb DEFAULT '[]',
	"assigned_to" varchar(255),
	"ndpc_notified" boolean DEFAULT false,
	"ndpc_notified_at" timestamp,
	"affected_records" integer DEFAULT 0,
	"activated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "incident_response_activations_activation_ref_unique" UNIQUE("activation_ref")
);

CREATE TABLE "insurance_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_ref" varchar(50) NOT NULL,
	"policy_id" integer,
	"company_id" integer,
	"claim_type" varchar(100) NOT NULL,
	"claim_amount_ngn" bigint NOT NULL,
	"approved_amount_ngn" bigint,
	"status" "insurance_claim_status" DEFAULT 'submitted' NOT NULL,
	"fraud_flag" boolean DEFAULT false,
	"fraud_score" numeric(5, 2),
	"data_breach_risk" boolean DEFAULT false,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_claims_claim_ref_unique" UNIQUE("claim_ref")
);

CREATE TABLE "insurance_companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"company_name" varchar(255) NOT NULL,
	"naicom_licence_number" varchar(50),
	"licence_type" "insurance_licence_type" NOT NULL,
	"status" "insurance_licence_status" DEFAULT 'active' NOT NULL,
	"policy_count" bigint DEFAULT 0,
	"gross_premium_ngn" bigint,
	"claims_ratio" numeric(5, 2),
	"solvency_ratio" numeric(5, 2),
	"data_localisation_compliant" boolean DEFAULT false,
	"ndpc_registered" boolean DEFAULT false,
	"policyholder_data_country" varchar(100) DEFAULT 'Nigeria',
	"licence_expires_at" timestamp,
	"last_naicom_audit" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_companies_naicom_licence_number_unique" UNIQUE("naicom_licence_number")
);

CREATE TABLE "insurance_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_ref" varchar(50) NOT NULL,
	"company_id" integer,
	"policy_type" varchar(100) NOT NULL,
	"policyholder_name" varchar(255) NOT NULL,
	"policyholder_nin" varchar(20),
	"sum_insured_ngn" bigint NOT NULL,
	"annual_premium_ngn" bigint NOT NULL,
	"status" varchar(30) DEFAULT 'active',
	"data_storage_country" varchar(100) DEFAULT 'Nigeria',
	"cross_border_reinsurance" boolean DEFAULT false,
	"reinsurance_country" varchar(100),
	"start_date" timestamp,
	"end_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_policies_policy_ref_unique" UNIQUE("policy_ref")
);

CREATE TABLE "interconnect_disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"dispute_ref" varchar(50) NOT NULL,
	"complainant_operator_id" integer,
	"respondent_operator_id" integer,
	"dispute_type" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"amount_in_dispute_ngn" bigint,
	"status" "interconnect_dispute_status" DEFAULT 'filed' NOT NULL,
	"filed_at" timestamp DEFAULT now() NOT NULL,
	"mediation_date" timestamp,
	"resolved_at" timestamp,
	"resolution" text,
	"ncc_decision" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "interconnect_disputes_dispute_ref_unique" UNIQUE("dispute_ref")
);

CREATE TABLE "kyc_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_id" varchar(50) NOT NULL,
	"organization_id" integer,
	"bank_id" integer,
	"subject_type" varchar(30) DEFAULT 'individual' NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"date_of_birth" varchar(20),
	"nationality" varchar(100) DEFAULT 'Nigerian',
	"bvn" varchar(11),
	"nin" varchar(11),
	"phone_number" varchar(20),
	"email" varchar(255),
	"address" text,
	"selfie_url" varchar(500),
	"id_document_type" varchar(50),
	"id_document_url" varchar(500),
	"liveness_score" numeric(5, 2),
	"face_match_score" numeric(5, 2),
	"bvn_verified" boolean DEFAULT false,
	"nin_verified" boolean DEFAULT false,
	"address_verified" boolean DEFAULT false,
	"tier" "kyc_tier" DEFAULT 'tier1' NOT NULL,
	"status" "kyc_status" DEFAULT 'pending' NOT NULL,
	"risk_rating" varchar(20) DEFAULT 'low',
	"pep_flag" boolean DEFAULT false,
	"sanctions_flag" boolean DEFAULT false,
	"reviewed_by" varchar(255),
	"reviewed_at" timestamp,
	"rejection_reason" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kyc_records_reference_id_unique" UNIQUE("reference_id")
);

CREATE TABLE "lawful_intercept_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_ref" varchar(50) NOT NULL,
	"operator_id" integer,
	"requesting_agency" varchar(100) NOT NULL,
	"court_order_ref" varchar(100),
	"target_identifier" varchar(255),
	"request_type" varchar(50) DEFAULT 'call_data_records',
	"status" varchar(30) DEFAULT 'pending',
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"fulfilled_at" timestamp,
	"expires_at" timestamp,
	"data_retention_days" integer DEFAULT 90,
	"is_urgent" boolean DEFAULT false,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lawful_intercept_requests_request_ref_unique" UNIQUE("request_ref")
);

CREATE TABLE "national_id_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"verification_ref" varchar(50) NOT NULL,
	"org_id" integer,
	"id_type" varchar(50) NOT NULL,
	"verification_purpose" varchar(100),
	"request_count" integer DEFAULT 0,
	"success_count" integer DEFAULT 0,
	"failure_count" integer DEFAULT 0,
	"nimc_api_status" varchar(30) DEFAULT 'active',
	"consent_obtained" boolean DEFAULT true,
	"data_retention_days" integer DEFAULT 30,
	"ndpa_compliant" boolean DEFAULT true,
	"last_verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "national_id_verifications_verification_ref_unique" UNIQUE("verification_ref")
);

CREATE TABLE "ndpa_compliance_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" timestamp NOT NULL,
	"ndpa_index" real NOT NULL,
	"breach_resolution_rate" real NOT NULL,
	"breach_notification_rate" real NOT NULL,
	"dpo_appointment_rate" real NOT NULL,
	"dpia_completion_rate" real NOT NULL,
	"consent_compliance_rate" real NOT NULL,
	"training_completion_rate" real NOT NULL,
	"audit_return_rate" real NOT NULL,
	"privacy_notice_rate" real NOT NULL,
	"breaches_total" integer DEFAULT 0,
	"dpo_verified" integer DEFAULT 0,
	"dpia_approved" integer DEFAULT 0,
	"consent_active" integer DEFAULT 0,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "nip_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(40) NOT NULL,
	"name_enquiry_ref" varchar(40),
	"sender_bank_code" varchar(10) NOT NULL,
	"sender_bank_name" varchar(100),
	"sender_account_number" varchar(20) NOT NULL,
	"sender_account_name" varchar(255),
	"receiver_bank_code" varchar(10) NOT NULL,
	"receiver_bank_name" varchar(100),
	"receiver_account_number" varchar(20) NOT NULL,
	"receiver_account_name" varchar(255),
	"amount" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN',
	"narration" varchar(255),
	"status" "nip_status" DEFAULT 'initiated' NOT NULL,
	"response_code" varchar(10),
	"response_message" varchar(255),
	"nibss_ref" varchar(50),
	"channel_code" varchar(10),
	"aml_flagged" boolean DEFAULT false,
	"fraud_flagged" boolean DEFAULT false,
	"settlement_date" timestamp,
	"initiated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nip_transactions_session_id_unique" UNIQUE("session_id")
);

CREATE TABLE "oil_gas_data_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_ref" varchar(50) NOT NULL,
	"company_id" integer,
	"organization_id" integer,
	"report_type" varchar(50) NOT NULL,
	"reporting_period" varchar(20) NOT NULL,
	"production_barrels" bigint,
	"reserves_barrels" bigint,
	"data_storage_location" varchar(255),
	"data_storage_country" varchar(100),
	"is_locally_stored" boolean DEFAULT true,
	"nuprc_submitted" boolean DEFAULT false,
	"nuprc_ack_ref" varchar(50),
	"status" varchar(30) DEFAULT 'draft',
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oil_gas_data_reports_report_ref_unique" UNIQUE("report_ref")
);

CREATE TABLE "open_banking_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"consent_ref" varchar(50) NOT NULL,
	"company_id" integer,
	"customer_id" varchar(100) NOT NULL,
	"data_scopes" jsonb DEFAULT '[]' NOT NULL,
	"third_party_name" varchar(255),
	"third_party_country" varchar(100),
	"consent_status" "consent_status" DEFAULT 'active' NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"data_minimisation_compliant" boolean DEFAULT true,
	"cross_border_transfer" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "open_banking_consents_consent_ref_unique" UNIQUE("consent_ref")
);

CREATE TABLE "organization_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"role" varchar(64) DEFAULT 'member' NOT NULL,
	"is_primary" boolean DEFAULT false,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "parental_consent_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"child_name" varchar(256),
	"child_age" integer,
	"parent_name" varchar(256) NOT NULL,
	"parent_email" varchar(320) NOT NULL,
	"parent_id_verified" boolean DEFAULT false,
	"purpose" text NOT NULL,
	"parental_consent_status" "parental_consent_status" DEFAULT 'pending' NOT NULL,
	"consent_given_at" timestamp,
	"consent_withdrawn_at" timestamp,
	"verification_method" varchar(128),
	"age_verification_method" varchar(128),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "patient_data_localisation_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"check_ref" varchar(50) NOT NULL,
	"facility_id" integer,
	"organization_id" integer,
	"data_category" "health_data_category" NOT NULL,
	"storage_location" varchar(255) NOT NULL,
	"storage_country" varchar(100) NOT NULL,
	"is_locally_stored" boolean NOT NULL,
	"cross_border_transfer" boolean DEFAULT false,
	"transfer_destination" varchar(255),
	"transfer_basis" varchar(100),
	"records_affected" bigint,
	"status" "residency_status" DEFAULT 'unknown' NOT NULL,
	"violation_details" text,
	"remediation_deadline" timestamp,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "patient_data_localisation_checks_check_ref_unique" UNIQUE("check_ref")
);

CREATE TABLE "pia_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"pia_ref" varchar(50) NOT NULL,
	"org_id" integer,
	"project_name" varchar(255) NOT NULL,
	"project_description" text,
	"data_controller" varchar(255),
	"processing_purpose" text,
	"data_categories" jsonb DEFAULT '[]',
	"data_subject_count" integer,
	"cross_border_transfer" boolean DEFAULT false,
	"automated_decision_making" boolean DEFAULT false,
	"risk_level" varchar(20) DEFAULT 'medium',
	"risk_score" integer DEFAULT 50,
	"mitigation_measures" jsonb DEFAULT '[]',
	"ndpc_consultation_required" boolean DEFAULT false,
	"ndpc_consultation_ref" varchar(100),
	"status" varchar(30) DEFAULT 'draft',
	"approved_by" varchar(255),
	"approved_at" timestamp,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pia_assessments_pia_ref_unique" UNIQUE("pia_ref")
);

CREATE TABLE "platform_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"org_id" integer,
	"notification_type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"severity" varchar(20) DEFAULT 'info',
	"is_read" boolean DEFAULT false,
	"action_url" varchar(500),
	"metadata" jsonb DEFAULT '{}',
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "privacy_notices" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"title" varchar(256) NOT NULL,
	"version" varchar(32) DEFAULT '1.0' NOT NULL,
	"privacy_notice_status" "privacy_notice_status" DEFAULT 'draft' NOT NULL,
	"notice_type" varchar(64) DEFAULT 'general' NOT NULL,
	"content" text NOT NULL,
	"data_controller_info" text,
	"dpo_contact_info" text,
	"purposes_of_processing" jsonb DEFAULT '[]'::jsonb,
	"lawful_bases" jsonb DEFAULT '[]'::jsonb,
	"data_retention_info" text,
	"rights_info" text,
	"cross_border_info" text,
	"cookie_info" text,
	"published_at" timestamp,
	"effective_date" timestamp,
	"previous_version_id" integer,
	"approved_by" integer,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "qos_violations" (
	"id" serial PRIMARY KEY NOT NULL,
	"violation_ref" varchar(50) NOT NULL,
	"operator_id" integer,
	"organization_id" integer,
	"violation_type" "qos_violation_type" NOT NULL,
	"severity" "severity" DEFAULT 'medium' NOT NULL,
	"measured_value" numeric(10, 4),
	"threshold_value" numeric(10, 4),
	"measurement_unit" varchar(30),
	"affected_region" varchar(100),
	"affected_subscribers" integer,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"reported_at" timestamp,
	"resolved_at" timestamp,
	"penalty_ngn" bigint,
	"status" varchar(30) DEFAULT 'open',
	"ncc_case_ref" varchar(50),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "qos_violations_violation_ref_unique" UNIQUE("violation_ref")
);

CREATE TABLE "regulatory_intelligence_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_type" varchar(50) NOT NULL,
	"title" varchar(500) NOT NULL,
	"summary" text,
	"source_url" varchar(1000),
	"source_org" varchar(255) DEFAULT 'NDPC',
	"jurisdiction" varchar(100) DEFAULT 'Nigeria',
	"affected_sectors" jsonb DEFAULT '[]',
	"ndpa_articles" jsonb DEFAULT '[]',
	"compliance_deadline" timestamp,
	"impact_level" varchar(20) DEFAULT 'medium',
	"action_required" boolean DEFAULT false,
	"published_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "regulatory_sandbox_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_ref" varchar(50) NOT NULL,
	"org_id" integer,
	"project_title" varchar(255) NOT NULL,
	"project_description" text,
	"innovation_type" varchar(100) NOT NULL,
	"data_types_involved" jsonb DEFAULT '[]',
	"proposed_duration" integer DEFAULT 12,
	"status" varchar(30) DEFAULT 'pending',
	"ndpc_approval_ref" varchar(100),
	"waived_requirements" jsonb DEFAULT '[]',
	"conditions" jsonb DEFAULT '[]',
	"progress_reports" jsonb DEFAULT '[]',
	"approved_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "regulatory_sandbox_applications_application_ref_unique" UNIQUE("application_ref")
);

CREATE TABLE "retention_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"name" varchar(256) NOT NULL,
	"data_category" varchar(128) NOT NULL,
	"retention_period_days" integer NOT NULL,
	"archival_action" varchar(64) DEFAULT 'delete' NOT NULL,
	"legal_basis" text,
	"is_global" boolean DEFAULT false,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_executed_at" timestamp,
	"next_execution_at" timestamp,
	"records_affected" integer DEFAULT 0,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "ropa_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"processing_activity_name" text NOT NULL,
	"purpose" text NOT NULL,
	"ropa_lawful_basis" "lawful_basis" NOT NULL,
	"data_categories" jsonb DEFAULT '[]'::jsonb,
	"data_subject_categories" jsonb DEFAULT '[]'::jsonb,
	"recipients" jsonb DEFAULT '[]'::jsonb,
	"cross_border_transfers" boolean DEFAULT false,
	"transfer_destinations" jsonb DEFAULT '[]'::jsonb,
	"retention_period_days" integer,
	"security_measures" text,
	"dpia_required" boolean DEFAULT false,
	"dpia_id" integer,
	"dpo_reviewed" boolean DEFAULT false,
	"last_reviewed_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "rtgs_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" varchar(50) NOT NULL,
	"sender_bank_code" varchar(10) NOT NULL,
	"sender_bank_name" varchar(100),
	"sender_account_number" varchar(20),
	"receiver_bank_code" varchar(10) NOT NULL,
	"receiver_bank_name" varchar(100),
	"receiver_account_number" varchar(20),
	"amount" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN',
	"narration" text,
	"status" "rtgs_status" DEFAULT 'queued' NOT NULL,
	"priority" varchar(10) DEFAULT 'normal',
	"settlement_cycle" varchar(10),
	"cbn_ref" varchar(50),
	"rejection_reason" text,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rtgs_transactions_reference_unique" UNIQUE("reference")
);

CREATE TABLE "sector_compliance_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer,
	"sector" varchar(64) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"details" jsonb DEFAULT '{}',
	"worker_name" varchar(128),
	"rule_id" varchar(128),
	"resolved" boolean DEFAULT false,
	"resolved_at" timestamp,
	"resolved_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "spectrum_licences" (
	"id" serial PRIMARY KEY NOT NULL,
	"licence_ref" varchar(50) NOT NULL,
	"operator_id" integer,
	"organization_id" integer,
	"band" "spectrum_band" NOT NULL,
	"frequency_range_mhz" varchar(50) NOT NULL,
	"bandwidth_mhz" numeric(6, 2) NOT NULL,
	"licence_type" "telecom_licence_type" DEFAULT 'spectrum' NOT NULL,
	"status" "telecom_licence_status" DEFAULT 'active' NOT NULL,
	"geographic_scope" varchar(100) DEFAULT 'national',
	"annual_fee_ngn" bigint,
	"issued_at" timestamp,
	"expires_at" timestamp,
	"last_renewal_at" timestamp,
	"data_localisation_compliant" boolean DEFAULT false,
	"lawful_intercept_enabled" boolean DEFAULT false,
	"ncc_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "spectrum_licences_licence_ref_unique" UNIQUE("licence_ref")
);

CREATE TABLE "staff_training_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"training_title" varchar(256) NOT NULL,
	"training_type" varchar(128) NOT NULL,
	"description" text,
	"training_status" "training_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_date" timestamp,
	"completed_date" timestamp,
	"participant_count" integer DEFAULT 0,
	"target_audience" varchar(256),
	"trainer_name" varchar(256),
	"duration_hours" real,
	"pass_rate" real,
	"next_scheduled_date" timestamp,
	"is_recurring" boolean DEFAULT false,
	"recurrence_months" integer,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "stripe_payment_intents" (
	"id" serial PRIMARY KEY NOT NULL,
	"stripe_intent_id" varchar(255) NOT NULL,
	"penalty_id" integer,
	"org_id" integer,
	"amount_ngn" bigint NOT NULL,
	"amount_usd" integer,
	"currency" varchar(10) DEFAULT 'usd',
	"status" varchar(30) DEFAULT 'pending',
	"stripe_status" varchar(50),
	"payment_method_type" varchar(50),
	"receipt_url" varchar(1000),
	"failure_reason" text,
	"metadata" jsonb DEFAULT '{}',
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_payment_intents_stripe_intent_id_unique" UNIQUE("stripe_intent_id")
);

CREATE TABLE "swift_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_ref" varchar(50) NOT NULL,
	"message_type" varchar(10) NOT NULL,
	"sender_bic" varchar(11) NOT NULL,
	"sender_bank_name" varchar(100),
	"receiver_bic" varchar(11) NOT NULL,
	"receiver_bank_name" varchar(100),
	"amount" bigint,
	"currency" varchar(3),
	"value_date" varchar(20),
	"ordering_customer" varchar(255),
	"beneficiary_customer" varchar(255),
	"remittance_info" text,
	"correspondent_bic" varchar(11),
	"status" "swift_status" DEFAULT 'draft' NOT NULL,
	"ack_nak_code" varchar(10),
	"sanctions_screened" boolean DEFAULT false,
	"sanctions_flagged" boolean DEFAULT false,
	"raw_message" text,
	"sent_at" timestamp,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "swift_messages_message_ref_unique" UNIQUE("message_ref")
);

CREATE TABLE "telecom_operators" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"operator_name" varchar(255) NOT NULL,
	"operator_code" varchar(10) NOT NULL,
	"operator_type" varchar(50) DEFAULT 'mno' NOT NULL,
	"ncc_licence_number" varchar(50),
	"subscriber_base" bigint DEFAULT 0,
	"market_share" numeric(5, 2),
	"coverage_percent" numeric(5, 2),
	"headquarters_state" varchar(100),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telecom_operators_operator_code_unique" UNIQUE("operator_code"),
	CONSTRAINT "telecom_operators_ncc_licence_number_unique" UNIQUE("ncc_licence_number")
);

CREATE TABLE "transfer_instruments" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument_type" "transfer_instrument_type" NOT NULL,
	"name" varchar(256) NOT NULL,
	"transfer_instrument_status" "transfer_instrument_status" DEFAULT 'draft' NOT NULL,
	"description" text,
	"template_content" text,
	"applicable_countries" jsonb DEFAULT '[]'::jsonb,
	"effective_date" timestamp,
	"expiry_date" timestamp,
	"approved_by" integer,
	"organization_id" integer,
	"ndpc_approval_ref" varchar(128),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "vendor_risk_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_ref" varchar(50) NOT NULL,
	"vendor_name" varchar(255) NOT NULL,
	"vendor_type" varchar(100) NOT NULL,
	"country" varchar(100) DEFAULT 'Nigeria',
	"org_id" integer,
	"risk_score" integer DEFAULT 50,
	"risk_level" varchar(20) DEFAULT 'medium',
	"data_categories" jsonb DEFAULT '[]',
	"dpia_required" boolean DEFAULT false,
	"dpa_executed" boolean DEFAULT false,
	"dpa_expires_at" timestamp,
	"last_audit_at" timestamp,
	"next_audit_at" timestamp,
	"certifications" jsonb DEFAULT '[]',
	"contract_status" varchar(30) DEFAULT 'active',
	"ndpc_registered" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_risk_profiles_vendor_ref_unique" UNIQUE("vendor_ref")
);

CREATE TABLE "watchlist_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" varchar(100) NOT NULL,
	"entity_type" varchar(30) DEFAULT 'individual',
	"primary_name" varchar(255) NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb,
	"date_of_birth" varchar(20),
	"nationality" varchar(100),
	"passport_number" varchar(50),
	"source" "watchlist_source" NOT NULL,
	"category" "watchlist_category" NOT NULL,
	"risk_level" varchar(20) DEFAULT 'high',
	"listing_date" timestamp,
	"delisting_date" timestamp,
	"is_active" boolean DEFAULT true,
	"reason" text,
	"additional_info" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_entries_entity_id_unique" UNIQUE("entity_id")
);

CREATE TABLE "whistleblower_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_ref" varchar(50) NOT NULL,
	"category" varchar(100) NOT NULL,
	"org_id" integer,
	"description" text NOT NULL,
	"evidence_urls" jsonb DEFAULT '[]',
	"is_anonymous" boolean DEFAULT true,
	"reporter_email" varchar(255),
	"status" varchar(30) DEFAULT 'received',
	"priority" varchar(20) DEFAULT 'medium',
	"assigned_to" varchar(255),
	"ndpc_escalated" boolean DEFAULT false,
	"resolution_notes" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whistleblower_reports_report_ref_unique" UNIQUE("report_ref")
);

ALTER TABLE public."dpco_invoices" ADD COLUMN IF NOT EXISTS "client_org_id" integer;
ALTER TABLE public."dpco_invoices" ADD COLUMN IF NOT EXISTS "client_email" character varying(256);
ALTER TABLE public."users" ADD COLUMN IF NOT EXISTS "dpco_org_id" integer;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_ethics_reviews_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."ai_ethics_reviews" ADD CONSTRAINT "ai_ethics_reviews_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aml_cases_bank_id_banking_institutions_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."aml_cases" ADD CONSTRAINT "aml_cases_bank_id_banking_institutions_id_fk" FOREIGN KEY (bank_id) REFERENCES banking_institutions(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aml_cases_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."aml_cases" ADD CONSTRAINT "aml_cases_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cbn_reports_bank_id_banking_institutions_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."cbn_reports" ADD CONSTRAINT "cbn_reports_bank_id_banking_institutions_id_fk" FOREIGN KEY (bank_id) REFERENCES banking_institutions(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cbn_reports_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."cbn_reports" ADD CONSTRAINT "cbn_reports_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'citizen_requests_reference_number_unique' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."citizen_requests" ADD CONSTRAINT "citizen_requests_reference_number_unique" UNIQUE (reference_number)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinical_trials_facility_id_health_facilities_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."clinical_trials" ADD CONSTRAINT "clinical_trials_facility_id_health_facilities_id_fk" FOREIGN KEY (facility_id) REFERENCES health_facilities(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinical_trials_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."clinical_trials" ADD CONSTRAINT "clinical_trials_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_gap_assessments_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."compliance_gap_assessments" ADD CONSTRAINT "compliance_gap_assessments_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_lifecycle_events_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."consent_lifecycle_events" ADD CONSTRAINT "consent_lifecycle_events_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'correspondent_banks_bank_id_banking_institutions_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."correspondent_banks" ADD CONSTRAINT "correspondent_banks_bank_id_banking_institutions_id_fk" FOREIGN KEY (bank_id) REFERENCES banking_institutions(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'data_lineage_nodes_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."data_lineage_nodes" ADD CONSTRAINT "data_lineage_nodes_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'data_pipeline_flows_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."data_pipeline_flows" ADD CONSTRAINT "data_pipeline_flows_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dpco_accreditation_applications_existing_dpco_org_id_dpco_organ' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."dpco_accreditation_applications" ADD CONSTRAINT "dpco_accreditation_applications_existing_dpco_org_id_dpco_organ" FOREIGN KEY (existing_dpco_org_id) REFERENCES dpco_organisations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dpco_accreditation_applications_reference_token_unique' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."dpco_accreditation_applications" ADD CONSTRAINT "dpco_accreditation_applications_reference_token_unique" UNIQUE (reference_token)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dpco_engagement_requests_reference_token_unique' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."dpco_engagement_requests" ADD CONSTRAINT "dpco_engagement_requests_reference_token_unique" UNIQUE (reference_token)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dpco_invoices_invoice_number_unique' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."dpco_invoices" ADD CONSTRAINT "dpco_invoices_invoice_number_unique" UNIQUE (invoice_number)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dpco_payments_payment_reference_unique' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."dpco_payments" ADD CONSTRAINT "dpco_payments_payment_reference_unique" UNIQUE (payment_reference)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dpco_policy_drafts_dpco_org_id_dpco_organisations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."dpco_policy_drafts" ADD CONSTRAINT "dpco_policy_drafts_dpco_org_id_dpco_organisations_id_fk" FOREIGN KEY (dpco_org_id) REFERENCES dpco_organisations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dpco_subscriptions_dpco_org_id_unique' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."dpco_subscriptions" ADD CONSTRAINT "dpco_subscriptions_dpco_org_id_unique" UNIQUE (dpco_org_id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dpco_verification_statements_dpco_org_id_dpco_organisations_id_' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."dpco_verification_statements" ADD CONSTRAINT "dpco_verification_statements_dpco_org_id_dpco_organisations_id_" FOREIGN KEY (dpco_org_id) REFERENCES dpco_organisations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'energy_companies_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."energy_companies" ADD CONSTRAINT "energy_companies_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'energy_licences_company_id_energy_companies_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."energy_licences" ADD CONSTRAINT "energy_licences_company_id_energy_companies_id_fk" FOREIGN KEY (company_id) REFERENCES energy_companies(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'energy_licences_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."energy_licences" ADD CONSTRAINT "energy_licences_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fintech_companies_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."fintech_companies" ADD CONSTRAINT "fintech_companies_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fintech_data_events_company_id_fintech_companies_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."fintech_data_events" ADD CONSTRAINT "fintech_data_events_company_id_fintech_companies_id_fk" FOREIGN KEY (company_id) REFERENCES fintech_companies(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fraud_alerts_bank_id_banking_institutions_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."fraud_alerts" ADD CONSTRAINT "fraud_alerts_bank_id_banking_institutions_id_fk" FOREIGN KEY (bank_id) REFERENCES banking_institutions(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fraud_alerts_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."fraud_alerts" ADD CONSTRAINT "fraud_alerts_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grid_monitoring_events_company_id_energy_companies_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."grid_monitoring_events" ADD CONSTRAINT "grid_monitoring_events_company_id_energy_companies_id_fk" FOREIGN KEY (company_id) REFERENCES energy_companies(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'health_facilities_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."health_facilities" ADD CONSTRAINT "health_facilities_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incident_response_activations_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."incident_response_activations" ADD CONSTRAINT "incident_response_activations_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incident_response_activations_playbook_id_incident_playbooks_id' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."incident_response_activations" ADD CONSTRAINT "incident_response_activations_playbook_id_incident_playbooks_id" FOREIGN KEY (playbook_id) REFERENCES incident_playbooks(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_claims_company_id_insurance_companies_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."insurance_claims" ADD CONSTRAINT "insurance_claims_company_id_insurance_companies_id_fk" FOREIGN KEY (company_id) REFERENCES insurance_companies(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_claims_policy_id_insurance_policies_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."insurance_claims" ADD CONSTRAINT "insurance_claims_policy_id_insurance_policies_id_fk" FOREIGN KEY (policy_id) REFERENCES insurance_policies(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_companies_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."insurance_companies" ADD CONSTRAINT "insurance_companies_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_policies_company_id_insurance_companies_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."insurance_policies" ADD CONSTRAINT "insurance_policies_company_id_insurance_companies_id_fk" FOREIGN KEY (company_id) REFERENCES insurance_companies(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interconnect_disputes_complainant_operator_id_telecom_operators' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."interconnect_disputes" ADD CONSTRAINT "interconnect_disputes_complainant_operator_id_telecom_operators" FOREIGN KEY (complainant_operator_id) REFERENCES telecom_operators(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interconnect_disputes_respondent_operator_id_telecom_operators_' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."interconnect_disputes" ADD CONSTRAINT "interconnect_disputes_respondent_operator_id_telecom_operators_" FOREIGN KEY (respondent_operator_id) REFERENCES telecom_operators(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kyc_records_bank_id_banking_institutions_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."kyc_records" ADD CONSTRAINT "kyc_records_bank_id_banking_institutions_id_fk" FOREIGN KEY (bank_id) REFERENCES banking_institutions(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kyc_records_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."kyc_records" ADD CONSTRAINT "kyc_records_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lawful_intercept_requests_operator_id_telecom_operators_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."lawful_intercept_requests" ADD CONSTRAINT "lawful_intercept_requests_operator_id_telecom_operators_id_fk" FOREIGN KEY (operator_id) REFERENCES telecom_operators(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'national_id_verifications_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."national_id_verifications" ADD CONSTRAINT "national_id_verifications_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oil_gas_data_reports_company_id_energy_companies_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."oil_gas_data_reports" ADD CONSTRAINT "oil_gas_data_reports_company_id_energy_companies_id_fk" FOREIGN KEY (company_id) REFERENCES energy_companies(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oil_gas_data_reports_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."oil_gas_data_reports" ADD CONSTRAINT "oil_gas_data_reports_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'open_banking_consents_company_id_fintech_companies_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."open_banking_consents" ADD CONSTRAINT "open_banking_consents_company_id_fintech_companies_id_fk" FOREIGN KEY (company_id) REFERENCES fintech_companies(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_users_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."organization_users" ADD CONSTRAINT "organization_users_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_users_user_id_users_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."organization_users" ADD CONSTRAINT "organization_users_user_id_users_id_fk" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_data_localisation_checks_facility_id_health_facilities_' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."patient_data_localisation_checks" ADD CONSTRAINT "patient_data_localisation_checks_facility_id_health_facilities_" FOREIGN KEY (facility_id) REFERENCES health_facilities(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_data_localisation_checks_organization_id_organizations_' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."patient_data_localisation_checks" ADD CONSTRAINT "patient_data_localisation_checks_organization_id_organizations_" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pia_assessments_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."pia_assessments" ADD CONSTRAINT "pia_assessments_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_notifications_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."platform_notifications" ADD CONSTRAINT "platform_notifications_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_notifications_user_id_users_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."platform_notifications" ADD CONSTRAINT "platform_notifications_user_id_users_id_fk" FOREIGN KEY (user_id) REFERENCES users(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qos_violations_operator_id_telecom_operators_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."qos_violations" ADD CONSTRAINT "qos_violations_operator_id_telecom_operators_id_fk" FOREIGN KEY (operator_id) REFERENCES telecom_operators(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qos_violations_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."qos_violations" ADD CONSTRAINT "qos_violations_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_sandbox_applications_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."regulatory_sandbox_applications" ADD CONSTRAINT "regulatory_sandbox_applications_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sector_compliance_events_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."sector_compliance_events" ADD CONSTRAINT "sector_compliance_events_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sector_compliance_events_resolved_by_users_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."sector_compliance_events" ADD CONSTRAINT "sector_compliance_events_resolved_by_users_id_fk" FOREIGN KEY (resolved_by) REFERENCES users(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spectrum_licences_operator_id_telecom_operators_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."spectrum_licences" ADD CONSTRAINT "spectrum_licences_operator_id_telecom_operators_id_fk" FOREIGN KEY (operator_id) REFERENCES telecom_operators(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spectrum_licences_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."spectrum_licences" ADD CONSTRAINT "spectrum_licences_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stripe_payment_intents_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."stripe_payment_intents" ADD CONSTRAINT "stripe_payment_intents_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stripe_payment_intents_penalty_id_financial_penalties_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."stripe_payment_intents" ADD CONSTRAINT "stripe_payment_intents_penalty_id_financial_penalties_id_fk" FOREIGN KEY (penalty_id) REFERENCES financial_penalties(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telecom_operators_organization_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."telecom_operators" ADD CONSTRAINT "telecom_operators_organization_id_organizations_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_risk_profiles_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."vendor_risk_profiles" ADD CONSTRAINT "vendor_risk_profiles_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id)'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whistleblower_reports_org_id_organizations_id_fk' AND connamespace = 'public'::regnamespace) THEN EXECUTE 'ALTER TABLE public."whistleblower_reports" ADD CONSTRAINT "whistleblower_reports_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id)'; END IF; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS adequacy_determinations_country_code_unique ON public.adequacy_determinations USING btree (country_code);
CREATE UNIQUE INDEX IF NOT EXISTS adequacy_determinations_pkey ON public.adequacy_determinations USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_ethics_reviews_pkey ON public.ai_ethics_reviews USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_ethics_reviews_review_ref_unique ON public.ai_ethics_reviews USING btree (review_ref);
CREATE UNIQUE INDEX IF NOT EXISTS airflow_dags_dag_id_unique ON public.airflow_dags USING btree (dag_id);
CREATE UNIQUE INDEX IF NOT EXISTS airflow_dags_pkey ON public.airflow_dags USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS aml_cases_case_ref_unique ON public.aml_cases USING btree (case_ref);
CREATE UNIQUE INDEX IF NOT EXISTS aml_cases_pkey ON public.aml_cases USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS automated_decision_records_pkey ON public.automated_decision_records USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS banking_institutions_cbn_code_unique ON public.banking_institutions USING btree (cbn_code);
CREATE UNIQUE INDEX IF NOT EXISTS banking_institutions_pkey ON public.banking_institutions USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS banking_institutions_sort_code_unique ON public.banking_institutions USING btree (sort_code);
CREATE UNIQUE INDEX IF NOT EXISTS breach_incidents_pkey ON public.breach_incidents USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS cbn_reports_pkey ON public.cbn_reports USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS cbn_reports_report_ref_unique ON public.cbn_reports USING btree (report_ref);
CREATE UNIQUE INDEX IF NOT EXISTS citizen_requests_reference_number_unique ON public.citizen_requests USING btree (reference_number);
CREATE UNIQUE INDEX IF NOT EXISTS clinical_trials_pkey ON public.clinical_trials USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS clinical_trials_trial_ref_unique ON public.clinical_trials USING btree (trial_ref);
CREATE UNIQUE INDEX IF NOT EXISTS compliance_audit_returns_pkey ON public.compliance_audit_returns USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS compliance_gap_assessments_assessment_ref_unique ON public.compliance_gap_assessments USING btree (assessment_ref);
CREATE UNIQUE INDEX IF NOT EXISTS compliance_gap_assessments_pkey ON public.compliance_gap_assessments USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS consent_lifecycle_events_pkey ON public.consent_lifecycle_events USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS consent_records_pkey ON public.consent_records USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS cookie_consent_records_pkey ON public.cookie_consent_records USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS correspondent_banks_correspondent_bic_unique ON public.correspondent_banks USING btree (correspondent_bic);
CREATE UNIQUE INDEX IF NOT EXISTS correspondent_banks_pkey ON public.correspondent_banks USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS cross_agency_data_shares_pkey ON public.cross_agency_data_shares USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS cross_agency_data_shares_share_ref_unique ON public.cross_agency_data_shares USING btree (share_ref);
CREATE UNIQUE INDEX IF NOT EXISTS data_export_jobs_pkey ON public.data_export_jobs USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS data_lineage_edges_pkey ON public.data_lineage_edges USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS data_lineage_nodes_node_id_unique ON public.data_lineage_nodes USING btree (node_id);
CREATE UNIQUE INDEX IF NOT EXISTS data_lineage_nodes_pkey ON public.data_lineage_nodes USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS data_pipeline_flows_flow_id_unique ON public.data_pipeline_flows USING btree (flow_id);
CREATE UNIQUE INDEX IF NOT EXISTS data_pipeline_flows_pkey ON public.data_pipeline_flows USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS data_processing_agreements_pkey ON public.data_processing_agreements USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dbt_models_pkey ON public.dbt_models USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dcpmi_thresholds_pkey ON public.dcpmi_thresholds USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_accreditation_applications_reference_token_unique ON public.dpco_accreditation_applications USING btree (reference_token);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_audit_control_ratings_pkey ON public.dpco_audit_control_ratings USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_audit_engagements_pkey ON public.dpco_audit_engagements USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_client_policies_pkey ON public.dpco_client_policies USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_clients_pkey ON public.dpco_clients USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_engagement_requests_reference_token_unique ON public.dpco_engagement_requests USING btree (reference_token);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_evidence_items_pkey ON public.dpco_evidence_items USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_invoices_invoice_number_unique ON public.dpco_invoices USING btree (invoice_number);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_organisations_licence_number_unique ON public.dpco_organisations USING btree (licence_number);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_organisations_pkey ON public.dpco_organisations USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_payments_payment_reference_unique ON public.dpco_payments USING btree (payment_reference);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_policy_drafts_pkey ON public.dpco_policy_drafts USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_subscriptions_dpco_org_id_unique ON public.dpco_subscriptions USING btree (dpco_org_id);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_training_sessions_pkey ON public.dpco_training_sessions USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_verification_statements_pkey ON public.dpco_verification_statements USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dpco_verification_statements_verification_code_unique ON public.dpco_verification_statements USING btree (verification_code);
CREATE UNIQUE INDEX IF NOT EXISTS dpia_assessments_pkey ON public.dpia_assessments USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dpo_appointments_pkey ON public.dpo_appointments USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS dpo_reports_pkey ON public.dpo_reports USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS energy_companies_company_code_unique ON public.energy_companies USING btree (company_code);
CREATE UNIQUE INDEX IF NOT EXISTS energy_companies_pkey ON public.energy_companies USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS energy_licences_licence_ref_unique ON public.energy_licences USING btree (licence_ref);
CREATE UNIQUE INDEX IF NOT EXISTS energy_licences_pkey ON public.energy_licences USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS fintech_companies_cbn_licence_number_unique ON public.fintech_companies USING btree (cbn_licence_number);
CREATE UNIQUE INDEX IF NOT EXISTS fintech_companies_pkey ON public.fintech_companies USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS fintech_data_events_event_ref_unique ON public.fintech_data_events USING btree (event_ref);
CREATE UNIQUE INDEX IF NOT EXISTS fintech_data_events_pkey ON public.fintech_data_events USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS fraud_alerts_alert_ref_unique ON public.fraud_alerts USING btree (alert_ref);
CREATE UNIQUE INDEX IF NOT EXISTS fraud_alerts_pkey ON public.fraud_alerts USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS grid_monitoring_events_event_ref_unique ON public.grid_monitoring_events USING btree (event_ref);
CREATE UNIQUE INDEX IF NOT EXISTS grid_monitoring_events_pkey ON public.grid_monitoring_events USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS health_facilities_facility_code_unique ON public.health_facilities USING btree (facility_code);
CREATE UNIQUE INDEX IF NOT EXISTS health_facilities_pkey ON public.health_facilities USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS incident_playbooks_pkey ON public.incident_playbooks USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS incident_playbooks_playbook_code_unique ON public.incident_playbooks USING btree (playbook_code);
CREATE UNIQUE INDEX IF NOT EXISTS incident_response_activations_activation_ref_unique ON public.incident_response_activations USING btree (activation_ref);
CREATE UNIQUE INDEX IF NOT EXISTS incident_response_activations_pkey ON public.incident_response_activations USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS insurance_claims_claim_ref_unique ON public.insurance_claims USING btree (claim_ref);
CREATE UNIQUE INDEX IF NOT EXISTS insurance_claims_pkey ON public.insurance_claims USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS insurance_companies_naicom_licence_number_unique ON public.insurance_companies USING btree (naicom_licence_number);
CREATE UNIQUE INDEX IF NOT EXISTS insurance_companies_pkey ON public.insurance_companies USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS insurance_policies_pkey ON public.insurance_policies USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS insurance_policies_policy_ref_unique ON public.insurance_policies USING btree (policy_ref);
CREATE UNIQUE INDEX IF NOT EXISTS interconnect_disputes_dispute_ref_unique ON public.interconnect_disputes USING btree (dispute_ref);
CREATE UNIQUE INDEX IF NOT EXISTS interconnect_disputes_pkey ON public.interconnect_disputes USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS kyc_records_pkey ON public.kyc_records USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS kyc_records_reference_id_unique ON public.kyc_records USING btree (reference_id);
CREATE UNIQUE INDEX IF NOT EXISTS lawful_intercept_requests_pkey ON public.lawful_intercept_requests USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS lawful_intercept_requests_request_ref_unique ON public.lawful_intercept_requests USING btree (request_ref);
CREATE UNIQUE INDEX IF NOT EXISTS national_id_verifications_pkey ON public.national_id_verifications USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS national_id_verifications_verification_ref_unique ON public.national_id_verifications USING btree (verification_ref);
CREATE UNIQUE INDEX IF NOT EXISTS ndpa_compliance_snapshots_pkey ON public.ndpa_compliance_snapshots USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS nip_transactions_pkey ON public.nip_transactions USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS nip_transactions_session_id_unique ON public.nip_transactions USING btree (session_id);
CREATE UNIQUE INDEX IF NOT EXISTS oil_gas_data_reports_pkey ON public.oil_gas_data_reports USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS oil_gas_data_reports_report_ref_unique ON public.oil_gas_data_reports USING btree (report_ref);
CREATE UNIQUE INDEX IF NOT EXISTS open_banking_consents_consent_ref_unique ON public.open_banking_consents USING btree (consent_ref);
CREATE UNIQUE INDEX IF NOT EXISTS open_banking_consents_pkey ON public.open_banking_consents USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS organization_users_pkey ON public.organization_users USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS parental_consent_records_pkey ON public.parental_consent_records USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS patient_data_localisation_checks_check_ref_unique ON public.patient_data_localisation_checks USING btree (check_ref);
CREATE UNIQUE INDEX IF NOT EXISTS patient_data_localisation_checks_pkey ON public.patient_data_localisation_checks USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS pia_assessments_pia_ref_unique ON public.pia_assessments USING btree (pia_ref);
CREATE UNIQUE INDEX IF NOT EXISTS pia_assessments_pkey ON public.pia_assessments USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS platform_notifications_pkey ON public.platform_notifications USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS privacy_notices_pkey ON public.privacy_notices USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS qos_violations_pkey ON public.qos_violations USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS qos_violations_violation_ref_unique ON public.qos_violations USING btree (violation_ref);
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_intelligence_items_pkey ON public.regulatory_intelligence_items USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_sandbox_applications_application_ref_unique ON public.regulatory_sandbox_applications USING btree (application_ref);
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_sandbox_applications_pkey ON public.regulatory_sandbox_applications USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS retention_policies_pkey ON public.retention_policies USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS ropa_records_pkey ON public.ropa_records USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS rtgs_transactions_pkey ON public.rtgs_transactions USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS rtgs_transactions_reference_unique ON public.rtgs_transactions USING btree (reference);
CREATE UNIQUE INDEX IF NOT EXISTS sector_compliance_events_pkey ON public.sector_compliance_events USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS spectrum_licences_licence_ref_unique ON public.spectrum_licences USING btree (licence_ref);
CREATE UNIQUE INDEX IF NOT EXISTS spectrum_licences_pkey ON public.spectrum_licences USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_training_records_pkey ON public.staff_training_records USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS stripe_payment_intents_pkey ON public.stripe_payment_intents USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS stripe_payment_intents_stripe_intent_id_unique ON public.stripe_payment_intents USING btree (stripe_intent_id);
CREATE UNIQUE INDEX IF NOT EXISTS swift_messages_message_ref_unique ON public.swift_messages USING btree (message_ref);
CREATE UNIQUE INDEX IF NOT EXISTS swift_messages_pkey ON public.swift_messages USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS telecom_operators_ncc_licence_number_unique ON public.telecom_operators USING btree (ncc_licence_number);
CREATE UNIQUE INDEX IF NOT EXISTS telecom_operators_operator_code_unique ON public.telecom_operators USING btree (operator_code);
CREATE UNIQUE INDEX IF NOT EXISTS telecom_operators_pkey ON public.telecom_operators USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS transfer_instruments_pkey ON public.transfer_instruments USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_risk_profiles_pkey ON public.vendor_risk_profiles USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_risk_profiles_vendor_ref_unique ON public.vendor_risk_profiles USING btree (vendor_ref);
CREATE UNIQUE INDEX IF NOT EXISTS watchlist_entries_entity_id_unique ON public.watchlist_entries USING btree (entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS watchlist_entries_pkey ON public.watchlist_entries USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS whistleblower_reports_pkey ON public.whistleblower_reports USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS whistleblower_reports_report_ref_unique ON public.whistleblower_reports USING btree (report_ref);
