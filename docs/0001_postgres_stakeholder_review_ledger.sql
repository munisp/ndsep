begin;

create type stakeholder_type as enum ('individual', 'business');
create type stakeholder_trust_status as enum ('draft', 'in_review', 'verified', 'needs_attention', 'rejected');
create type stakeholder_document_status as enum ('pending', 'requires_review', 'verified', 'rejected', 'unavailable');
create type stakeholder_review_decision as enum ('request_review', 'approve', 'reject', 'return_for_information');

create table stakeholders (
  id uuid primary key default gen_random_uuid(),
  owner_subject varchar(255) not null unique,
  type stakeholder_type not null,
  company_name varchar(160), cac_number varchar(24), tin_number varchar(24),
  business_email varchar(320), business_phone varchar(24), business_address text, contact_person varchar(160),
  onboarding_status stakeholder_trust_status not null default 'draft',
  readiness integer not null default 0 check (readiness between 0 and 100),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index stakeholders_cac_idx on stakeholders(cac_number);

create table stakeholder_documents (
  id uuid primary key default gen_random_uuid(), stakeholder_id uuid not null references stakeholders(id) on delete cascade,
  kind varchar(80) not null, file_name varchar(255) not null, object_key text not null,
  status stakeholder_document_status not null default 'pending', screening jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index stakeholder_documents_stakeholder_idx on stakeholder_documents(stakeholder_id);

create table stakeholder_document_review_decisions (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references stakeholder_documents(id) on delete restrict,
  reviewer_subject varchar(255) not null, reviewer_role varchar(80) not null,
  decision stakeholder_review_decision not null, reason text not null, evidence_refs jsonb not null default '[]'::jsonb,
  prior_status stakeholder_document_status not null, new_status stakeholder_document_status not null,
  decided_at timestamptz not null default now()
);
create index stakeholder_document_review_decisions_document_idx on stakeholder_document_review_decisions(document_id);

create table stakeholder_audit_events (
  id uuid primary key default gen_random_uuid(), stakeholder_id uuid not null references stakeholders(id) on delete restrict,
  actor_subject varchar(255) not null, event_type varchar(100) not null, payload jsonb not null,
  occurred_at timestamptz not null default now()
);
create index stakeholder_audit_events_stakeholder_idx on stakeholder_audit_events(stakeholder_id, occurred_at);

commit;
