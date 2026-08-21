-- Migration 000007: 0006_lazy_abomination
-- Source: 0006_lazy_abomination.sql

ALTER TABLE "organizations" ADD COLUMN "contact_email" varchar(320);