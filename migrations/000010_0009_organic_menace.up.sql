-- Migration 000010: 0009_organic_menace
-- Source: 0009_organic_menace.sql

ALTER TYPE "public"."citizen_request_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."citizen_request_status" ADD VALUE 'overdue';