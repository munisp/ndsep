-- Migration: Extend user_role enum with government_staff and regulator
-- Reconciles the DB role model with the Keycloak realm roles
-- (orchestration/keycloak/ndsep-realm.json): government_staff and regulator
-- previously collapsed to "user" at login and were rejected on role updates.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'government_staff';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'regulator';
