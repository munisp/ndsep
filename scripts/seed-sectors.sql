--
-- PostgreSQL database dump
--

\restrict BMoi762VgoLWudQWFJiWhbw4yBSCEafbD4p4isVhjmcBSZP2unCpgmv0ea2DMIg

-- Dumped from database version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: clinical_trials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clinical_trials (
    id integer NOT NULL,
    facility_id integer,
    trial_name character varying(200),
    sponsor character varying(200),
    foreign_sponsor boolean DEFAULT false,
    participant_count integer DEFAULT 0,
    data_localisation_compliant boolean DEFAULT false,
    status character varying(30) DEFAULT 'active'::character varying,
    start_date date,
    end_date date,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: clinical_trials_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clinical_trials_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clinical_trials_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clinical_trials_id_seq OWNED BY public.clinical_trials.id;


--
-- Name: energy_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.energy_companies (
    id integer NOT NULL,
    company_name character varying(200) NOT NULL,
    company_code character varying(30),
    sector character varying(50) DEFAULT 'electricity'::character varying,
    company_type character varying(50),
    customer_base bigint DEFAULT 0,
    installed_capacity_mw numeric(10,2) DEFAULT 0,
    state character varying(50),
    data_localisation_compliant boolean DEFAULT false,
    is_active boolean DEFAULT true,
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: energy_companies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.energy_companies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: energy_companies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.energy_companies_id_seq OWNED BY public.energy_companies.id;


--
-- Name: energy_licences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.energy_licences (
    id integer NOT NULL,
    company_id integer,
    licence_number character varying(50),
    licence_type character varying(50),
    status character varying(30) DEFAULT 'active'::character varying,
    expiry_date date,
    created_at timestamp without time zone DEFAULT now(),
    issued_at timestamp without time zone DEFAULT now()
);


--
-- Name: energy_licences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.energy_licences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: energy_licences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.energy_licences_id_seq OWNED BY public.energy_licences.id;


--
-- Name: fintech_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fintech_companies (
    id integer NOT NULL,
    company_name character varying(200) NOT NULL,
    company_code character varying(30),
    licence_type character varying(50) DEFAULT 'PSP'::character varying,
    transaction_volume_monthly bigint DEFAULT 0,
    customer_base bigint DEFAULT 0,
    state character varying(50),
    data_localisation_compliant boolean DEFAULT false,
    ndpc_registered boolean DEFAULT false,
    is_active boolean DEFAULT true,
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    compliance_score numeric(5,2) DEFAULT 0,
    api_volume bigint DEFAULT 0,
    monthly_transaction_volume_ngn bigint DEFAULT 0,
    wallet_balance_ngn numeric(15,2) DEFAULT 0
);


--
-- Name: fintech_companies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fintech_companies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fintech_companies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fintech_companies_id_seq OWNED BY public.fintech_companies.id;


--
-- Name: fintech_data_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fintech_data_events (
    id integer NOT NULL,
    company_id integer,
    event_type character varying(100),
    violation_detected boolean DEFAULT false,
    description text,
    detected_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    occurred_at timestamp without time zone DEFAULT now()
);


--
-- Name: fintech_data_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fintech_data_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fintech_data_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fintech_data_events_id_seq OWNED BY public.fintech_data_events.id;


--
-- Name: grid_monitoring_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grid_monitoring_events (
    id integer NOT NULL,
    company_id integer,
    event_type character varying(50),
    data_localisation_violation boolean DEFAULT false,
    description text,
    severity character varying(20) DEFAULT 'low'::character varying,
    detected_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    occurred_at timestamp without time zone DEFAULT now()
);


--
-- Name: grid_monitoring_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.grid_monitoring_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: grid_monitoring_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.grid_monitoring_events_id_seq OWNED BY public.grid_monitoring_events.id;


--
-- Name: health_facilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_facilities (
    id integer NOT NULL,
    facility_name character varying(200) NOT NULL,
    facility_code character varying(30),
    facility_type character varying(50) DEFAULT 'Hospital'::character varying,
    state character varying(50),
    lga character varying(100),
    patient_records_count bigint DEFAULT 0,
    ehr_system character varying(100),
    data_localisation_compliant boolean DEFAULT false,
    ndpc_registered boolean DEFAULT false,
    dpia_completed boolean DEFAULT false,
    is_active boolean DEFAULT true,
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    compliance_score numeric(5,2) DEFAULT 0,
    nhia_accredited boolean DEFAULT false,
    bed_count integer DEFAULT 0
);


--
-- Name: health_facilities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.health_facilities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: health_facilities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.health_facilities_id_seq OWNED BY public.health_facilities.id;


--
-- Name: insurance_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insurance_claims (
    id integer NOT NULL,
    company_id integer,
    claim_ref character varying(50),
    claim_type character varying(100),
    amount_ngn numeric(15,2) DEFAULT 0,
    fraud_flag boolean DEFAULT false,
    status character varying(30) DEFAULT 'pending'::character varying,
    filed_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    submitted_at timestamp without time zone DEFAULT now()
);


--
-- Name: insurance_claims_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.insurance_claims_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: insurance_claims_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.insurance_claims_id_seq OWNED BY public.insurance_claims.id;


--
-- Name: insurance_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insurance_companies (
    id integer NOT NULL,
    company_name character varying(200) NOT NULL,
    company_code character varying(30),
    company_type character varying(50) DEFAULT 'Life'::character varying,
    gross_premium_ngn numeric(15,2) DEFAULT 0,
    policy_count integer DEFAULT 0,
    state character varying(50),
    data_localisation_compliant boolean DEFAULT false,
    ndpc_registered boolean DEFAULT false,
    is_active boolean DEFAULT true,
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    compliance_score numeric(5,2) DEFAULT 0
);


--
-- Name: insurance_companies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.insurance_companies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: insurance_companies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.insurance_companies_id_seq OWNED BY public.insurance_companies.id;


--
-- Name: insurance_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insurance_policies (
    id integer NOT NULL,
    company_id integer,
    policy_type character varying(100),
    cross_border_reinsurance boolean DEFAULT false,
    premium_ngn numeric(15,2) DEFAULT 0,
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: insurance_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.insurance_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: insurance_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.insurance_policies_id_seq OWNED BY public.insurance_policies.id;


--
-- Name: interconnect_disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interconnect_disputes (
    id integer NOT NULL,
    complainant_id integer,
    respondent_id integer,
    dispute_type character varying(100),
    amount_ngn numeric(15,2) DEFAULT 0,
    status character varying(30) DEFAULT 'pending'::character varying,
    filed_at timestamp without time zone DEFAULT now(),
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: interconnect_disputes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.interconnect_disputes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: interconnect_disputes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.interconnect_disputes_id_seq OWNED BY public.interconnect_disputes.id;


--
-- Name: lawful_intercept_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lawful_intercept_requests (
    id integer NOT NULL,
    operator_id integer,
    request_ref character varying(50),
    target_type character varying(50),
    requesting_agency character varying(100),
    status character varying(30) DEFAULT 'pending'::character varying,
    approved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: lawful_intercept_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lawful_intercept_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lawful_intercept_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lawful_intercept_requests_id_seq OWNED BY public.lawful_intercept_requests.id;


--
-- Name: oil_gas_data_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oil_gas_data_reports (
    id integer NOT NULL,
    company_id integer,
    report_type character varying(100),
    is_locally_stored boolean DEFAULT true,
    submitted_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: oil_gas_data_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oil_gas_data_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oil_gas_data_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oil_gas_data_reports_id_seq OWNED BY public.oil_gas_data_reports.id;


--
-- Name: open_banking_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_banking_consents (
    id integer NOT NULL,
    company_id integer,
    consent_type character varying(100),
    customer_count integer DEFAULT 0,
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    consent_status character varying(30) DEFAULT 'active'::character varying,
    granted_at timestamp without time zone DEFAULT now()
);


--
-- Name: open_banking_consents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.open_banking_consents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: open_banking_consents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.open_banking_consents_id_seq OWNED BY public.open_banking_consents.id;


--
-- Name: patient_data_localisation_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_data_localisation_checks (
    id integer NOT NULL,
    facility_id integer,
    check_type character varying(100),
    status character varying(30) DEFAULT 'compliant'::character varying,
    findings text,
    checked_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: patient_data_localisation_checks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patient_data_localisation_checks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: patient_data_localisation_checks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patient_data_localisation_checks_id_seq OWNED BY public.patient_data_localisation_checks.id;


--
-- Name: platform_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_stats (
    id integer NOT NULL,
    metric_name character varying(100),
    metric_value numeric(15,2),
    category character varying(50),
    period character varying(30),
    recorded_at timestamp without time zone DEFAULT now()
);


--
-- Name: platform_stats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.platform_stats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: platform_stats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.platform_stats_id_seq OWNED BY public.platform_stats.id;


--
-- Name: qos_violations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qos_violations (
    id integer NOT NULL,
    operator_id integer,
    violation_type character varying(100),
    severity character varying(20) DEFAULT 'medium'::character varying,
    description text,
    penalty_ngn numeric(15,2) DEFAULT 0,
    status character varying(30) DEFAULT 'open'::character varying,
    detected_at timestamp without time zone DEFAULT now(),
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: qos_violations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qos_violations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qos_violations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qos_violations_id_seq OWNED BY public.qos_violations.id;


--
-- Name: spectrum_licences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spectrum_licences (
    id integer NOT NULL,
    operator_id integer,
    licence_number character varying(50),
    band character varying(30),
    bandwidth_mhz numeric(10,2),
    region character varying(100),
    status character varying(30) DEFAULT 'active'::character varying,
    expiry_date date,
    data_localisation_compliant boolean DEFAULT false,
    lawful_intercept_enabled boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: spectrum_licences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.spectrum_licences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: spectrum_licences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.spectrum_licences_id_seq OWNED BY public.spectrum_licences.id;


--
-- Name: telecom_operators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telecom_operators (
    id integer NOT NULL,
    operator_name character varying(200) NOT NULL,
    operator_code character varying(20),
    operator_type character varying(50) DEFAULT 'MNO'::character varying,
    subscriber_base bigint DEFAULT 0,
    market_share numeric(5,2) DEFAULT 0,
    coverage_pct numeric(5,2) DEFAULT 0,
    hq_state character varying(50),
    data_localisation_compliant boolean DEFAULT false,
    lawful_intercept_enabled boolean DEFAULT false,
    is_active boolean DEFAULT true,
    ndpc_registered boolean DEFAULT false,
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: telecom_operators_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.telecom_operators_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telecom_operators_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.telecom_operators_id_seq OWNED BY public.telecom_operators.id;


--
-- Name: clinical_trials id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_trials ALTER COLUMN id SET DEFAULT nextval('public.clinical_trials_id_seq'::regclass);


--
-- Name: energy_companies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.energy_companies ALTER COLUMN id SET DEFAULT nextval('public.energy_companies_id_seq'::regclass);


--
-- Name: energy_licences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.energy_licences ALTER COLUMN id SET DEFAULT nextval('public.energy_licences_id_seq'::regclass);


--
-- Name: fintech_companies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fintech_companies ALTER COLUMN id SET DEFAULT nextval('public.fintech_companies_id_seq'::regclass);


--
-- Name: fintech_data_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fintech_data_events ALTER COLUMN id SET DEFAULT nextval('public.fintech_data_events_id_seq'::regclass);


--
-- Name: grid_monitoring_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grid_monitoring_events ALTER COLUMN id SET DEFAULT nextval('public.grid_monitoring_events_id_seq'::regclass);


--
-- Name: health_facilities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_facilities ALTER COLUMN id SET DEFAULT nextval('public.health_facilities_id_seq'::regclass);


--
-- Name: insurance_claims id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_claims ALTER COLUMN id SET DEFAULT nextval('public.insurance_claims_id_seq'::regclass);


--
-- Name: insurance_companies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_companies ALTER COLUMN id SET DEFAULT nextval('public.insurance_companies_id_seq'::regclass);


--
-- Name: insurance_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_policies ALTER COLUMN id SET DEFAULT nextval('public.insurance_policies_id_seq'::regclass);


--
-- Name: interconnect_disputes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interconnect_disputes ALTER COLUMN id SET DEFAULT nextval('public.interconnect_disputes_id_seq'::regclass);


--
-- Name: lawful_intercept_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lawful_intercept_requests ALTER COLUMN id SET DEFAULT nextval('public.lawful_intercept_requests_id_seq'::regclass);


--
-- Name: oil_gas_data_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oil_gas_data_reports ALTER COLUMN id SET DEFAULT nextval('public.oil_gas_data_reports_id_seq'::regclass);


--
-- Name: open_banking_consents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_banking_consents ALTER COLUMN id SET DEFAULT nextval('public.open_banking_consents_id_seq'::regclass);


--
-- Name: patient_data_localisation_checks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_data_localisation_checks ALTER COLUMN id SET DEFAULT nextval('public.patient_data_localisation_checks_id_seq'::regclass);


--
-- Name: platform_stats id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_stats ALTER COLUMN id SET DEFAULT nextval('public.platform_stats_id_seq'::regclass);


--
-- Name: qos_violations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qos_violations ALTER COLUMN id SET DEFAULT nextval('public.qos_violations_id_seq'::regclass);


--
-- Name: spectrum_licences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spectrum_licences ALTER COLUMN id SET DEFAULT nextval('public.spectrum_licences_id_seq'::regclass);


--
-- Name: telecom_operators id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telecom_operators ALTER COLUMN id SET DEFAULT nextval('public.telecom_operators_id_seq'::regclass);


--
-- Data for Name: clinical_trials; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.clinical_trials VALUES (1, 1, 'COVID-19 Variant Surveillance', 'WHO Nigeria', true, 5000, true, 'active', '2024-01-15', '2025-12-31', '2026-05-06 13:41:49.598414');
INSERT INTO public.clinical_trials VALUES (2, 2, 'Malaria Vaccine Phase III', 'GSK / Abuja', true, 3200, true, 'active', '2024-03-01', '2026-06-30', '2026-05-06 13:41:49.598414');
INSERT INTO public.clinical_trials VALUES (3, 3, 'Sickle Cell Gene Therapy', 'NIMR / UCH', false, 150, true, 'active', '2024-06-01', '2027-01-01', '2026-05-06 13:41:49.598414');
INSERT INTO public.clinical_trials VALUES (4, 4, 'Tuberculosis Drug Resistance', 'Johns Hopkins', true, 800, false, 'active', '2023-09-15', '2025-09-15', '2026-05-06 13:41:49.598414');
INSERT INTO public.clinical_trials VALUES (5, 5, 'Diabetes Management Study', 'Novo Nordisk', true, 1200, false, 'completed', '2022-01-01', '2024-06-30', '2026-05-06 13:41:49.598414');


--
-- Data for Name: energy_companies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.energy_companies VALUES (1, 'Ikeja Electric', 'IE-001', 'electricity', 'DisCo', 3500000, 0.00, 'Lagos', true, true, 'active', '2026-05-06 13:42:07.314753');
INSERT INTO public.energy_companies VALUES (2, 'Eko Electricity', 'EE-001', 'electricity', 'DisCo', 2800000, 0.00, 'Lagos', true, true, 'active', '2026-05-06 13:42:07.314753');
INSERT INTO public.energy_companies VALUES (3, 'Enugu Electricity', 'EEDC-001', 'electricity', 'DisCo', 1900000, 0.00, 'Enugu', false, true, 'active', '2026-05-06 13:42:07.314753');
INSERT INTO public.energy_companies VALUES (4, 'Egbin Power Plc', 'EGP-001', 'electricity', 'GenCo', 0, 1320.00, 'Lagos', true, true, 'active', '2026-05-06 13:42:07.314753');
INSERT INTO public.energy_companies VALUES (5, 'Dangote Refinery', 'DAN-001', 'oil_gas', 'Refinery', 0, 0.00, 'Lagos', true, true, 'active', '2026-05-06 13:42:07.314753');
INSERT INTO public.energy_companies VALUES (6, 'Shell Nigeria', 'SHL-001', 'oil_gas', 'E&P', 0, 0.00, 'Rivers', false, true, 'active', '2026-05-06 13:42:07.314753');
INSERT INTO public.energy_companies VALUES (7, 'Total Energies Nigeria', 'TOT-001', 'oil_gas', 'E&P', 0, 0.00, 'Rivers', true, true, 'active', '2026-05-06 13:42:07.314753');
INSERT INTO public.energy_companies VALUES (8, 'Transcorp Power', 'TCP-001', 'electricity', 'GenCo', 0, 972.00, 'Edo', false, true, 'active', '2026-05-06 13:42:07.314753');


--
-- Data for Name: energy_licences; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.energy_licences VALUES (1, 1, 'NERC-DL-2024-001', 'Distribution', 'active', '2034-12-31', '2026-05-06 13:42:07.317574', '2026-05-06 13:48:19.171205');
INSERT INTO public.energy_licences VALUES (2, 2, 'NERC-DL-2024-002', 'Distribution', 'active', '2034-12-31', '2026-05-06 13:42:07.317574', '2026-05-06 13:48:19.171205');
INSERT INTO public.energy_licences VALUES (3, 3, 'NERC-DL-2024-003', 'Distribution', 'active', '2032-06-30', '2026-05-06 13:42:07.317574', '2026-05-06 13:48:19.171205');
INSERT INTO public.energy_licences VALUES (4, 4, 'NERC-GL-2024-001', 'Generation', 'active', '2035-03-15', '2026-05-06 13:42:07.317574', '2026-05-06 13:48:19.171205');
INSERT INTO public.energy_licences VALUES (5, 5, 'NUPRC-RL-2024-001', 'Refining', 'active', '2044-01-01', '2026-05-06 13:42:07.317574', '2026-05-06 13:48:19.171205');
INSERT INTO public.energy_licences VALUES (6, 6, 'NUPRC-EP-2024-001', 'Exploration', 'active', '2029-09-30', '2026-05-06 13:42:07.317574', '2026-05-06 13:48:19.171205');
INSERT INTO public.energy_licences VALUES (7, 7, 'NUPRC-EP-2024-002', 'Exploration', 'active', '2030-12-31', '2026-05-06 13:42:07.317574', '2026-05-06 13:48:19.171205');
INSERT INTO public.energy_licences VALUES (8, 8, 'NERC-GL-2024-002', 'Generation', 'active', '2033-07-15', '2026-05-06 13:42:07.317574', '2026-05-06 13:48:19.171205');


--
-- Data for Name: fintech_companies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.fintech_companies VALUES (1, 'Flutterwave', 'FLW-001', 'PSP', 12000000, 3500000, 'Lagos', true, true, true, 'active', '2026-05-06 13:42:41.189804', 95.00, 450000000, 12000000, 0.00);
INSERT INTO public.fintech_companies VALUES (2, 'Paystack (Stripe)', 'PSK-001', 'PSP', 9500000, 2800000, 'Lagos', true, true, true, 'active', '2026-05-06 13:42:41.189804', 92.00, 380000000, 9500000, 0.00);
INSERT INTO public.fintech_companies VALUES (3, 'OPay', 'OPY-001', 'MMO', 45000000, 35000000, 'Lagos', true, true, true, 'active', '2026-05-06 13:42:41.189804', 78.00, 280000000, 45000000, 0.00);
INSERT INTO public.fintech_companies VALUES (4, 'PalmPay', 'PLP-001', 'MMO', 30000000, 28000000, 'Lagos', false, true, true, 'active', '2026-05-06 13:42:41.189804', 62.00, 180000000, 30000000, 0.00);
INSERT INTO public.fintech_companies VALUES (5, 'Moniepoint', 'MNP-001', 'MFB', 25000000, 12000000, 'Lagos', true, true, true, 'active', '2026-05-06 13:42:41.189804', 88.00, 320000000, 25000000, 0.00);
INSERT INTO public.fintech_companies VALUES (6, 'Kuda Bank', 'KDA-001', 'MFB', 8000000, 6500000, 'Lagos', true, true, true, 'active', '2026-05-06 13:42:41.189804', 85.00, 150000000, 8000000, 0.00);
INSERT INTO public.fintech_companies VALUES (7, 'Carbon (One Finance)', 'CRB-001', 'MFB', 3500000, 2200000, 'Lagos', false, false, true, 'active', '2026-05-06 13:42:41.189804', 55.00, 50000000, 3500000, 0.00);
INSERT INTO public.fintech_companies VALUES (8, 'Chipper Cash', 'CHP-001', 'PSP', 2000000, 1500000, 'Lagos', false, false, true, 'active', '2026-05-06 13:42:41.189804', 48.00, 35000000, 2000000, 0.00);


--
-- Data for Name: fintech_data_events; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.fintech_data_events VALUES (1, 1, 'API Key Exposure', false, 'Test API keys found in public GitHub repo — revoked within 2 hours', '2026-05-06 13:42:41.19282', '2026-05-06 13:42:41.19282', '2026-05-06 13:42:41.19282');
INSERT INTO public.fintech_data_events VALUES (2, 4, 'Cross-Border Transfer', true, 'Customer KYC data transferred to China-based servers', '2026-05-06 13:42:41.19282', '2026-05-06 13:42:41.19282', '2026-05-06 13:42:41.19282');
INSERT INTO public.fintech_data_events VALUES (3, 3, 'Consent Violation', true, 'Marketing push notifications sent without opt-in consent', '2026-05-06 13:42:41.19282', '2026-05-06 13:42:41.19282', '2026-05-06 13:42:41.19282');
INSERT INTO public.fintech_data_events VALUES (4, 7, 'Data Retention Breach', true, 'Deleted customer records found in backup exceeding 90-day policy', '2026-05-06 13:42:41.19282', '2026-05-06 13:42:41.19282', '2026-05-06 13:42:41.19282');
INSERT INTO public.fintech_data_events VALUES (5, 8, 'Third-Party Sharing', true, 'Customer transaction data shared with analytics vendor without consent', '2026-05-06 13:42:41.19282', '2026-05-06 13:42:41.19282', '2026-05-06 13:42:41.19282');


--
-- Data for Name: grid_monitoring_events; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.grid_monitoring_events VALUES (1, 1, 'load_shedding', false, 'Planned maintenance in Ikeja GRA district', 'low', '2026-05-06 13:42:07.318908', '2026-05-06 13:42:07.318908', '2026-05-06 13:42:07.318908');
INSERT INTO public.grid_monitoring_events VALUES (2, 3, 'data_breach', true, 'Customer billing data found on offshore server', 'critical', '2026-05-06 13:42:07.318908', '2026-05-06 13:42:07.318908', '2026-05-06 13:42:07.318908');
INSERT INTO public.grid_monitoring_events VALUES (3, 6, 'cyber_incident', false, 'Port scan detected on SCADA system', 'high', '2026-05-06 13:42:07.318908', '2026-05-06 13:42:07.318908', '2026-05-06 13:42:07.318908');
INSERT INTO public.grid_monitoring_events VALUES (4, 4, 'outage', false, 'Unit 3 turbine trip — 330MW offline', 'high', '2026-05-06 13:42:07.318908', '2026-05-06 13:42:07.318908', '2026-05-06 13:42:07.318908');
INSERT INTO public.grid_monitoring_events VALUES (5, 2, 'meter_tampering', false, 'Smart meter firmware vulnerability detected', 'medium', '2026-05-06 13:42:07.318908', '2026-05-06 13:42:07.318908', '2026-05-06 13:42:07.318908');


--
-- Data for Name: health_facilities; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.health_facilities VALUES (1, 'Lagos University Teaching Hospital', 'LUTH-001', 'Teaching Hospital', 'Lagos', 'Mushin', 2500000, 'OpenMRS', true, true, true, true, 'active', '2026-05-06 13:41:49.594736', 92.50, true, 850);
INSERT INTO public.health_facilities VALUES (2, 'National Hospital Abuja', 'NHA-001', 'Federal Hospital', 'FCT', 'Central Area', 1800000, 'DHIS2', true, true, true, true, 'active', '2026-05-06 13:41:49.594736', 88.00, true, 620);
INSERT INTO public.health_facilities VALUES (3, 'University College Hospital Ibadan', 'UCH-001', 'Teaching Hospital', 'Oyo', 'Ibadan North', 1200000, 'OpenMRS', true, true, false, true, 'active', '2026-05-06 13:41:49.594736', 78.50, true, 540);
INSERT INTO public.health_facilities VALUES (4, 'Ahmadu Bello University Teaching Hospital', 'ABUTH-001', 'Teaching Hospital', 'Kaduna', 'Zaria', 950000, 'DHIS2', false, true, false, true, 'active', '2026-05-06 13:41:49.594736', 65.00, true, 450);
INSERT INTO public.health_facilities VALUES (5, 'University of Benin Teaching Hospital', 'UBTH-001', 'Teaching Hospital', 'Edo', 'Benin City', 800000, 'Custom EHR', false, false, false, true, 'active', '2026-05-06 13:41:49.594736', 55.00, false, 380);
INSERT INTO public.health_facilities VALUES (6, 'Federal Medical Centre Owerri', 'FMC-OW-001', 'Federal Hospital', 'Imo', 'Owerri Municipal', 450000, 'DHIS2', true, true, true, true, 'active', '2026-05-06 13:41:49.594736', 82.00, true, 200);
INSERT INTO public.health_facilities VALUES (7, 'Reddington Hospital', 'RED-001', 'Private Hospital', 'Lagos', 'Victoria Island', 180000, 'Epic MyChart', true, true, true, true, 'active', '2026-05-06 13:41:49.594736', 95.00, true, 120);
INSERT INTO public.health_facilities VALUES (8, 'EHA Clinics', 'EHA-001', 'Private Clinic', 'FCT', 'Jabi', 95000, 'Custom Cloud', false, true, false, true, 'active', '2026-05-06 13:41:49.594736', 70.00, false, 35);


--
-- Data for Name: insurance_claims; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.insurance_claims VALUES (1, 1, 'CLM-2024-001', 'Motor Accident', 2500000.00, false, 'under_investigation', '2026-05-06 13:42:21.735', '2026-05-06 13:42:21.735', '2026-05-06 13:48:19.170381');
INSERT INTO public.insurance_claims VALUES (2, 2, 'CLM-2024-002', 'Life Claim', 15000000.00, false, 'settled', '2026-05-06 13:42:21.735', '2026-05-06 13:42:21.735', '2026-05-06 13:48:19.170381');
INSERT INTO public.insurance_claims VALUES (3, 3, 'CLM-2024-003', 'Fire Damage', 45000000.00, false, 'pending', '2026-05-06 13:42:21.735', '2026-05-06 13:42:21.735', '2026-05-06 13:48:19.170381');
INSERT INTO public.insurance_claims VALUES (4, 1, 'CLM-2024-004', 'Motor Theft', 8000000.00, true, 'under_investigation', '2026-05-06 13:42:21.735', '2026-05-06 13:42:21.735', '2026-05-06 13:48:19.170381');
INSERT INTO public.insurance_claims VALUES (5, 4, 'CLM-2024-005', 'Oil Spill', 250000000.00, false, 'pending', '2026-05-06 13:42:21.735', '2026-05-06 13:42:21.735', '2026-05-06 13:48:19.170381');
INSERT INTO public.insurance_claims VALUES (6, 5, 'CLM-2024-006', 'Professional Negligence', 5000000.00, true, 'under_investigation', '2026-05-06 13:42:21.735', '2026-05-06 13:42:21.735', '2026-05-06 13:48:19.170381');


--
-- Data for Name: insurance_companies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.insurance_companies VALUES (1, 'Leadway Assurance', 'LWA-001', 'Life & General', 85000000000.00, 450000, 'Lagos', true, true, true, 'active', '2026-05-06 13:42:21.730758', 92.00);
INSERT INTO public.insurance_companies VALUES (2, 'AXA Mansard', 'AXA-001', 'Life & General', 62000000000.00, 320000, 'Lagos', true, true, true, 'active', '2026-05-06 13:42:21.730758', 88.00);
INSERT INTO public.insurance_companies VALUES (3, 'AIICO Insurance', 'AII-001', 'Life & General', 45000000000.00, 280000, 'Lagos', false, true, true, 'active', '2026-05-06 13:42:21.730758', 65.00);
INSERT INTO public.insurance_companies VALUES (4, 'Custodian Investment', 'CUS-001', 'General', 38000000000.00, 195000, 'Lagos', true, true, true, 'active', '2026-05-06 13:42:21.730758', 85.00);
INSERT INTO public.insurance_companies VALUES (5, 'Zenith General Insurance', 'ZGI-001', 'General', 28000000000.00, 150000, 'Lagos', true, true, true, 'active', '2026-05-06 13:42:21.730758', 82.00);
INSERT INTO public.insurance_companies VALUES (6, 'Coronation Insurance', 'COR-001', 'General', 22000000000.00, 120000, 'Lagos', false, false, true, 'active', '2026-05-06 13:42:21.730758', 55.00);
INSERT INTO public.insurance_companies VALUES (7, 'Mutual Benefits Assurance', 'MBA-001', 'Life', 15000000000.00, 85000, 'Lagos', false, false, true, 'active', '2026-05-06 13:42:21.730758', 45.00);
INSERT INTO public.insurance_companies VALUES (8, 'Sovereign Trust Insurance', 'STI-001', 'General', 8000000000.00, 45000, 'Lagos', false, false, false, 'active', '2026-05-06 13:42:21.730758', 30.00);


--
-- Data for Name: insurance_policies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.insurance_policies VALUES (1, 1, 'Motor Vehicle', false, 150000.00, 'active', '2026-05-06 13:42:21.733211');
INSERT INTO public.insurance_policies VALUES (2, 1, 'Life Assurance', false, 500000.00, 'active', '2026-05-06 13:42:21.733211');
INSERT INTO public.insurance_policies VALUES (3, 2, 'Marine Cargo', true, 2500000.00, 'active', '2026-05-06 13:42:21.733211');
INSERT INTO public.insurance_policies VALUES (4, 3, 'Fire & Burglary', false, 350000.00, 'active', '2026-05-06 13:42:21.733211');
INSERT INTO public.insurance_policies VALUES (5, 4, 'Oil & Gas', true, 15000000.00, 'active', '2026-05-06 13:42:21.733211');
INSERT INTO public.insurance_policies VALUES (6, 5, 'Professional Indemnity', false, 800000.00, 'active', '2026-05-06 13:42:21.733211');
INSERT INTO public.insurance_policies VALUES (7, 2, 'Health Insurance', true, 450000.00, 'active', '2026-05-06 13:42:21.733211');
INSERT INTO public.insurance_policies VALUES (8, 6, 'Aviation', true, 25000000.00, 'lapsed', '2026-05-06 13:42:21.733211');


--
-- Data for Name: interconnect_disputes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.interconnect_disputes VALUES (1, 3, 1, 'Interconnect Rate Dispute', 2500000000.00, 'pending', '2026-05-06 13:41:30.829307', NULL, '2026-05-06 13:41:30.829307');
INSERT INTO public.interconnect_disputes VALUES (2, 4, 2, 'Number Portability Failure', 150000000.00, 'under_review', '2026-05-06 13:41:30.829307', NULL, '2026-05-06 13:41:30.829307');
INSERT INTO public.interconnect_disputes VALUES (3, 1, 3, 'Traffic Termination', 800000000.00, 'resolved', '2026-05-06 13:41:30.829307', NULL, '2026-05-06 13:41:30.829307');


--
-- Data for Name: lawful_intercept_requests; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.lawful_intercept_requests VALUES (1, 1, 'LI-2024-0001', 'phone_number', 'EFCC', 'approved', NULL, '2026-05-06 13:41:30.830369');
INSERT INTO public.lawful_intercept_requests VALUES (2, 2, 'LI-2024-0002', 'imei', 'DSS', 'pending', NULL, '2026-05-06 13:41:30.830369');
INSERT INTO public.lawful_intercept_requests VALUES (3, 1, 'LI-2024-0003', 'phone_number', 'NPF', 'approved', NULL, '2026-05-06 13:41:30.830369');
INSERT INTO public.lawful_intercept_requests VALUES (4, 3, 'LI-2024-0004', 'subscriber_data', 'NFIU', 'pending', NULL, '2026-05-06 13:41:30.830369');


--
-- Data for Name: oil_gas_data_reports; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.oil_gas_data_reports VALUES (1, 5, 'Production Report Q4 2024', true, '2026-05-06 13:42:07.320061', '2026-05-06 13:42:07.320061');
INSERT INTO public.oil_gas_data_reports VALUES (2, 6, 'Environmental Impact Assessment', false, '2026-05-06 13:42:07.320061', '2026-05-06 13:42:07.320061');
INSERT INTO public.oil_gas_data_reports VALUES (3, 7, 'Reserves Estimate', true, '2026-05-06 13:42:07.320061', '2026-05-06 13:42:07.320061');
INSERT INTO public.oil_gas_data_reports VALUES (4, 6, 'Flare Gas Data', false, '2026-05-06 13:42:07.320061', '2026-05-06 13:42:07.320061');


--
-- Data for Name: open_banking_consents; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.open_banking_consents VALUES (1, 1, 'Account Information', 850000, 'active', '2026-05-06 13:42:41.194621', 'active', '2026-05-06 13:48:19.169594');
INSERT INTO public.open_banking_consents VALUES (2, 2, 'Payment Initiation', 620000, 'active', '2026-05-06 13:42:41.194621', 'active', '2026-05-06 13:48:19.169594');
INSERT INTO public.open_banking_consents VALUES (3, 3, 'Account Information', 1200000, 'active', '2026-05-06 13:42:41.194621', 'active', '2026-05-06 13:48:19.169594');
INSERT INTO public.open_banking_consents VALUES (4, 5, 'Account Information', 450000, 'active', '2026-05-06 13:42:41.194621', 'active', '2026-05-06 13:48:19.169594');
INSERT INTO public.open_banking_consents VALUES (5, 6, 'Payment Initiation', 380000, 'active', '2026-05-06 13:42:41.194621', 'active', '2026-05-06 13:48:19.169594');
INSERT INTO public.open_banking_consents VALUES (6, 4, 'Account Information', 900000, 'active', '2026-05-06 13:42:41.194621', 'active', '2026-05-06 13:48:19.169594');


--
-- Data for Name: patient_data_localisation_checks; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.patient_data_localisation_checks VALUES (1, 1, 'Data Residency Audit', 'compliant', 'All patient data stored in Lagos data centre', '2026-05-06 13:41:49.596925', '2026-05-06 13:41:49.596925');
INSERT INTO public.patient_data_localisation_checks VALUES (2, 2, 'Cloud Storage Review', 'compliant', 'Azure Africa East region confirmed', '2026-05-06 13:41:49.596925', '2026-05-06 13:41:49.596925');
INSERT INTO public.patient_data_localisation_checks VALUES (3, 3, 'EHR Access Audit', 'compliant', 'Access logs show no offshore transfers', '2026-05-06 13:41:49.596925', '2026-05-06 13:41:49.596925');
INSERT INTO public.patient_data_localisation_checks VALUES (4, 4, 'Data Residency Audit', 'violation', 'Radiology images synced to UK server', '2026-05-06 13:41:49.596925', '2026-05-06 13:41:49.596925');
INSERT INTO public.patient_data_localisation_checks VALUES (5, 5, 'Cloud Storage Review', 'violation', 'AWS US-East-1 bucket found with patient PII', '2026-05-06 13:41:49.596925', '2026-05-06 13:41:49.596925');
INSERT INTO public.patient_data_localisation_checks VALUES (6, 6, 'Data Residency Audit', 'compliant', 'All data in Nigeria-based Rack Centre', '2026-05-06 13:41:49.596925', '2026-05-06 13:41:49.596925');
INSERT INTO public.patient_data_localisation_checks VALUES (7, 7, 'EHR Access Audit', 'compliant', 'Epic instance hosted in South Africa — no violation', '2026-05-06 13:41:49.596925', '2026-05-06 13:41:49.596925');
INSERT INTO public.patient_data_localisation_checks VALUES (8, 8, 'Cloud Storage Review', 'violation', 'Google Cloud US region storing patient records', '2026-05-06 13:41:49.596925', '2026-05-06 13:41:49.596925');


--
-- Data for Name: platform_stats; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.platform_stats VALUES (1, 'Total API Calls', 2450000.00, 'api', '2024-Q4', '2026-05-06 13:42:41.199938');
INSERT INTO public.platform_stats VALUES (2, 'Avg Response Time (ms)', 45.20, 'api', '2024-Q4', '2026-05-06 13:42:41.199938');
INSERT INTO public.platform_stats VALUES (3, 'Active Users', 1847.00, 'users', '2024-Q4', '2026-05-06 13:42:41.199938');
INSERT INTO public.platform_stats VALUES (4, 'Organizations Registered', 312.00, 'orgs', '2024-Q4', '2026-05-06 13:42:41.199938');
INSERT INTO public.platform_stats VALUES (5, 'Compliance Checks Run', 18500.00, 'compliance', '2024-Q4', '2026-05-06 13:42:41.199938');
INSERT INTO public.platform_stats VALUES (6, 'Data Breaches Reported', 47.00, 'security', '2024-Q4', '2026-05-06 13:42:41.199938');
INSERT INTO public.platform_stats VALUES (7, 'DPIA Completed', 234.00, 'compliance', '2024-Q4', '2026-05-06 13:42:41.199938');
INSERT INTO public.platform_stats VALUES (8, 'DPO Registered', 189.00, 'compliance', '2024-Q4', '2026-05-06 13:42:41.199938');
INSERT INTO public.platform_stats VALUES (9, 'Enforcement Cases', 156.00, 'enforcement', '2024-Q4', '2026-05-06 13:42:41.199938');
INSERT INTO public.platform_stats VALUES (10, 'Total Penalties (NGN)', 4850000000.00, 'enforcement', '2024-Q4', '2026-05-06 13:42:41.199938');


--
-- Data for Name: qos_violations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.qos_violations VALUES (1, 4, 'Call Drop Rate Exceeded', 'high', 'Call drop rate of 4.2% exceeds NCC threshold of 2%', 50000000.00, 'open', '2026-05-06 13:41:30.828136', NULL, '2026-05-06 13:41:30.828136');
INSERT INTO public.qos_violations VALUES (2, 3, 'Data Throughput Below Standard', 'medium', '4G throughput averaging 3.1 Mbps vs required 5 Mbps', 25000000.00, 'open', '2026-05-06 13:41:30.828136', NULL, '2026-05-06 13:41:30.828136');
INSERT INTO public.qos_violations VALUES (3, 2, 'SMS Delivery Delay', 'low', 'Inter-network SMS delivery exceeding 30 second threshold', 10000000.00, 'resolved', '2026-05-06 13:41:30.828136', NULL, '2026-05-06 13:41:30.828136');
INSERT INTO public.qos_violations VALUES (4, 1, 'Network Coverage Gap', 'medium', 'Coverage below 95% target in Borno State', 35000000.00, 'open', '2026-05-06 13:41:30.828136', NULL, '2026-05-06 13:41:30.828136');
INSERT INTO public.qos_violations VALUES (5, 4, 'Billing Irregularity', 'high', 'Unauthorized data deductions reported by 500+ subscribers', 75000000.00, 'open', '2026-05-06 13:41:30.828136', NULL, '2026-05-06 13:41:30.828136');


--
-- Data for Name: spectrum_licences; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.spectrum_licences VALUES (1, 1, 'NCC-SPE-2024-001', '700MHz', 20.00, 'Nationwide', 'active', '2034-12-31', true, true, '2026-05-06 13:41:30.826469');
INSERT INTO public.spectrum_licences VALUES (2, 1, 'NCC-SPE-2024-002', '2600MHz', 40.00, 'South-West', 'active', '2029-06-30', true, true, '2026-05-06 13:41:30.826469');
INSERT INTO public.spectrum_licences VALUES (3, 2, 'NCC-SPE-2024-003', '800MHz', 15.00, 'Nationwide', 'active', '2033-03-15', true, true, '2026-05-06 13:41:30.826469');
INSERT INTO public.spectrum_licences VALUES (4, 2, 'NCC-SPE-2024-004', '2300MHz', 30.00, 'North-Central', 'active', '2028-09-30', true, true, '2026-05-06 13:41:30.826469');
INSERT INTO public.spectrum_licences VALUES (5, 3, 'NCC-SPE-2024-005', '900MHz', 10.00, 'Nationwide', 'active', '2032-01-01', true, false, '2026-05-06 13:41:30.826469');
INSERT INTO public.spectrum_licences VALUES (6, 3, 'NCC-SPE-2024-006', '1800MHz', 25.00, 'South-South', 'active', '2030-07-15', false, false, '2026-05-06 13:41:30.826469');
INSERT INTO public.spectrum_licences VALUES (7, 4, 'NCC-SPE-2024-007', '900MHz', 10.00, 'Nationwide', 'active', '2031-12-31', false, false, '2026-05-06 13:41:30.826469');
INSERT INTO public.spectrum_licences VALUES (8, 5, 'NCC-SPE-2024-008', '5800MHz', 50.00, 'Lagos', 'active', '2027-06-30', true, false, '2026-05-06 13:41:30.826469');


--
-- Data for Name: telecom_operators; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.telecom_operators VALUES (1, 'MTN Nigeria', 'MTN', 'MNO', 78000000, 38.50, 92.30, 'Lagos', true, true, true, true, 'active', '2026-05-06 13:41:30.824481');
INSERT INTO public.telecom_operators VALUES (2, 'Airtel Nigeria', 'AIR', 'MNO', 55000000, 27.10, 85.70, 'Lagos', true, true, true, true, 'active', '2026-05-06 13:41:30.824481');
INSERT INTO public.telecom_operators VALUES (3, 'Globacom', 'GLO', 'MNO', 52000000, 25.60, 80.20, 'Lagos', true, false, true, true, 'active', '2026-05-06 13:41:30.824481');
INSERT INTO public.telecom_operators VALUES (4, '9mobile', '9MB', 'MNO', 14000000, 6.90, 65.40, 'Abuja', false, false, true, true, 'active', '2026-05-06 13:41:30.824481');
INSERT INTO public.telecom_operators VALUES (5, 'Spectranet', 'SPE', 'ISP', 1200000, 0.59, 22.10, 'Lagos', true, false, true, false, 'active', '2026-05-06 13:41:30.824481');
INSERT INTO public.telecom_operators VALUES (6, 'Smile Communications', 'SML', 'ISP', 800000, 0.39, 18.50, 'Lagos', false, false, true, false, 'active', '2026-05-06 13:41:30.824481');
INSERT INTO public.telecom_operators VALUES (7, 'ntel', 'NTL', 'MNO', 500000, 0.25, 12.00, 'Abuja', false, false, true, false, 'active', '2026-05-06 13:41:30.824481');
INSERT INTO public.telecom_operators VALUES (8, 'Tizeti Network', 'TIZ', 'ISP', 350000, 0.17, 8.30, 'Lagos', false, false, true, false, 'active', '2026-05-06 13:41:30.824481');


--
-- Name: clinical_trials_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.clinical_trials_id_seq', 5, true);


--
-- Name: energy_companies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.energy_companies_id_seq', 8, true);


--
-- Name: energy_licences_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.energy_licences_id_seq', 8, true);


--
-- Name: fintech_companies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.fintech_companies_id_seq', 8, true);


--
-- Name: fintech_data_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.fintech_data_events_id_seq', 5, true);


--
-- Name: grid_monitoring_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.grid_monitoring_events_id_seq', 5, true);


--
-- Name: health_facilities_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.health_facilities_id_seq', 8, true);


--
-- Name: insurance_claims_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.insurance_claims_id_seq', 6, true);


--
-- Name: insurance_companies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.insurance_companies_id_seq', 8, true);


--
-- Name: insurance_policies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.insurance_policies_id_seq', 8, true);


--
-- Name: interconnect_disputes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.interconnect_disputes_id_seq', 3, true);


--
-- Name: lawful_intercept_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.lawful_intercept_requests_id_seq', 4, true);


--
-- Name: oil_gas_data_reports_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.oil_gas_data_reports_id_seq', 4, true);


--
-- Name: open_banking_consents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.open_banking_consents_id_seq', 6, true);


--
-- Name: patient_data_localisation_checks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.patient_data_localisation_checks_id_seq', 8, true);


--
-- Name: platform_stats_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.platform_stats_id_seq', 10, true);


--
-- Name: qos_violations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.qos_violations_id_seq', 5, true);


--
-- Name: spectrum_licences_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.spectrum_licences_id_seq', 8, true);


--
-- Name: telecom_operators_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.telecom_operators_id_seq', 8, true);


--
-- Name: clinical_trials clinical_trials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_trials
    ADD CONSTRAINT clinical_trials_pkey PRIMARY KEY (id);


--
-- Name: energy_companies energy_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.energy_companies
    ADD CONSTRAINT energy_companies_pkey PRIMARY KEY (id);


--
-- Name: energy_licences energy_licences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.energy_licences
    ADD CONSTRAINT energy_licences_pkey PRIMARY KEY (id);


--
-- Name: fintech_companies fintech_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fintech_companies
    ADD CONSTRAINT fintech_companies_pkey PRIMARY KEY (id);


--
-- Name: fintech_data_events fintech_data_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fintech_data_events
    ADD CONSTRAINT fintech_data_events_pkey PRIMARY KEY (id);


--
-- Name: grid_monitoring_events grid_monitoring_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grid_monitoring_events
    ADD CONSTRAINT grid_monitoring_events_pkey PRIMARY KEY (id);


--
-- Name: health_facilities health_facilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_facilities
    ADD CONSTRAINT health_facilities_pkey PRIMARY KEY (id);


--
-- Name: insurance_claims insurance_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_claims
    ADD CONSTRAINT insurance_claims_pkey PRIMARY KEY (id);


--
-- Name: insurance_companies insurance_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_companies
    ADD CONSTRAINT insurance_companies_pkey PRIMARY KEY (id);


--
-- Name: insurance_policies insurance_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_policies
    ADD CONSTRAINT insurance_policies_pkey PRIMARY KEY (id);


--
-- Name: interconnect_disputes interconnect_disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interconnect_disputes
    ADD CONSTRAINT interconnect_disputes_pkey PRIMARY KEY (id);


--
-- Name: lawful_intercept_requests lawful_intercept_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lawful_intercept_requests
    ADD CONSTRAINT lawful_intercept_requests_pkey PRIMARY KEY (id);


--
-- Name: oil_gas_data_reports oil_gas_data_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oil_gas_data_reports
    ADD CONSTRAINT oil_gas_data_reports_pkey PRIMARY KEY (id);


--
-- Name: open_banking_consents open_banking_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_banking_consents
    ADD CONSTRAINT open_banking_consents_pkey PRIMARY KEY (id);


--
-- Name: patient_data_localisation_checks patient_data_localisation_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_data_localisation_checks
    ADD CONSTRAINT patient_data_localisation_checks_pkey PRIMARY KEY (id);


--
-- Name: platform_stats platform_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_stats
    ADD CONSTRAINT platform_stats_pkey PRIMARY KEY (id);


--
-- Name: qos_violations qos_violations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qos_violations
    ADD CONSTRAINT qos_violations_pkey PRIMARY KEY (id);


--
-- Name: spectrum_licences spectrum_licences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spectrum_licences
    ADD CONSTRAINT spectrum_licences_pkey PRIMARY KEY (id);


--
-- Name: telecom_operators telecom_operators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telecom_operators
    ADD CONSTRAINT telecom_operators_pkey PRIMARY KEY (id);


--
-- Name: clinical_trials clinical_trials_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_trials
    ADD CONSTRAINT clinical_trials_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.health_facilities(id);


--
-- Name: energy_licences energy_licences_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.energy_licences
    ADD CONSTRAINT energy_licences_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.energy_companies(id);


--
-- Name: fintech_data_events fintech_data_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fintech_data_events
    ADD CONSTRAINT fintech_data_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.fintech_companies(id);


--
-- Name: grid_monitoring_events grid_monitoring_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grid_monitoring_events
    ADD CONSTRAINT grid_monitoring_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.energy_companies(id);


--
-- Name: insurance_claims insurance_claims_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_claims
    ADD CONSTRAINT insurance_claims_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.insurance_companies(id);


--
-- Name: insurance_policies insurance_policies_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_policies
    ADD CONSTRAINT insurance_policies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.insurance_companies(id);


--
-- Name: interconnect_disputes interconnect_disputes_complainant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interconnect_disputes
    ADD CONSTRAINT interconnect_disputes_complainant_id_fkey FOREIGN KEY (complainant_id) REFERENCES public.telecom_operators(id);


--
-- Name: interconnect_disputes interconnect_disputes_respondent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interconnect_disputes
    ADD CONSTRAINT interconnect_disputes_respondent_id_fkey FOREIGN KEY (respondent_id) REFERENCES public.telecom_operators(id);


--
-- Name: lawful_intercept_requests lawful_intercept_requests_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lawful_intercept_requests
    ADD CONSTRAINT lawful_intercept_requests_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.telecom_operators(id);


--
-- Name: oil_gas_data_reports oil_gas_data_reports_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oil_gas_data_reports
    ADD CONSTRAINT oil_gas_data_reports_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.energy_companies(id);


--
-- Name: open_banking_consents open_banking_consents_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_banking_consents
    ADD CONSTRAINT open_banking_consents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.fintech_companies(id);


--
-- Name: patient_data_localisation_checks patient_data_localisation_checks_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_data_localisation_checks
    ADD CONSTRAINT patient_data_localisation_checks_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.health_facilities(id);


--
-- Name: qos_violations qos_violations_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qos_violations
    ADD CONSTRAINT qos_violations_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.telecom_operators(id);


--
-- Name: spectrum_licences spectrum_licences_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spectrum_licences
    ADD CONSTRAINT spectrum_licences_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.telecom_operators(id);


--
-- PostgreSQL database dump complete
--

\unrestrict BMoi762VgoLWudQWFJiWhbw4yBSCEafbD4p4isVhjmcBSZP2unCpgmv0ea2DMIg

