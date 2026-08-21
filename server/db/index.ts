/**
 * NDSEP Database Module Index — Domain Re-exports
 * ==================================================
 * Recommendation H4: Split db.ts god file into domain modules.
 *
 * This file provides organized, domain-specific re-exports from the
 * monolithic db.ts. Existing imports from "../db" continue to work.
 *
 * Phase 1: Re-export everything from the existing db.ts
 * Phase 2: Gradually move functions into domain-specific files
 * Phase 3: Remove re-exports once all consumers use domain imports
 */

// Re-export everything from the monolithic db.ts for backward compatibility
export * from "../db";

// Domain-specific modules (new code should import from these)
export * from "./organizations";
export * from "./compliance";
export * from "./enforcement";
export * from "./monitoring";
