create extension if not exists pgcrypto;
create type recovery_status as enum ('pending','authorized','consumed','expired','denied');
create table recovery_authorizations (
 id uuid primary key default gen_random_uuid(), queue_id uuid not null, payload_hash char(64) not null,
 idempotency_key uuid not null, owner_subject text not null, target_device_fingerprint char(64) not null,
 challenge bytea not null unique, status recovery_status not null default 'pending', expires_at timestamptz not null,
 consumed_at timestamptz, created_at timestamptz not null default now(), unique(queue_id, payload_hash, target_device_fingerprint, status)
);
create table recovery_approvals (
 id uuid primary key default gen_random_uuid(), authorization_id uuid not null references recovery_authorizations(id) on delete restrict,
 approver_subject text not null, approver_role text not null check (approver_role in ('security_engineer','planning_supervisor')),
 credential_id bytea not null, assertion jsonb not null, signed_digest char(64) not null, sign_count bigint not null,
 signed_at timestamptz not null default now(), unique(authorization_id, approver_subject)
);
create table recovery_audit_events (
 id bigserial primary key, authorization_id uuid not null references recovery_authorizations(id) on delete restrict,
 event_type text not null, actor_subject text, event_hash char(64) not null, created_at timestamptz not null default now()
);
create index recovery_authorizations_ready_idx on recovery_authorizations(status, expires_at);
create index recovery_approvals_auth_idx on recovery_approvals(authorization_id);
