import { describe, it, expect } from "vitest";
import { evaluatePolicy, enforcePolicy } from "./pbac";

describe("PBAC — Policy-Based Access Control", () => {
  // ── Admin: full access ──────────────────────────────────────────────────
  it("admin can read any resource", () => {
    expect(evaluatePolicy({ userId: 1, role: "admin", resource: "banking.kyc", action: "read", env: "test" })).toBe(true);
  });

  it("admin can write any resource", () => {
    expect(evaluatePolicy({ userId: 1, role: "admin", resource: "phase12.vendorRisk", action: "write", env: "test" })).toBe(true);
  });

  it("admin can delete any resource", () => {
    expect(evaluatePolicy({ userId: 1, role: "admin", resource: "banking.aml", action: "delete", env: "test" })).toBe(true);
  });

  it("admin can export any resource", () => {
    expect(evaluatePolicy({ userId: 1, role: "admin", resource: "banking.kyc.exportCsv", action: "export", env: "test" })).toBe(true);
  });

  it("admin can approve any resource", () => {
    expect(evaluatePolicy({ userId: 1, role: "admin", resource: "phase13.penaltyCalculator", action: "approve", env: "test" })).toBe(true);
  });

  // ── Regular user: read-only on banking ─────────────────────────────────
  it("user can read banking resources", () => {
    expect(evaluatePolicy({ userId: 2, role: "user", resource: "banking.kyc", action: "read", env: "test" })).toBe(true);
  });

  it("user cannot write banking resources", () => {
    expect(evaluatePolicy({ userId: 2, role: "user", resource: "banking.kyc", action: "write", env: "test" })).toBe(false);
  });

  it("user cannot delete banking resources", () => {
    expect(evaluatePolicy({ userId: 2, role: "user", resource: "banking.aml", action: "delete", env: "test" })).toBe(false);
  });

  it("user cannot export banking resources", () => {
    expect(evaluatePolicy({ userId: 2, role: "user", resource: "banking.kyc.exportCsv", action: "export", env: "test" })).toBe(false);
  });

  // ── DSAR: users can submit ─────────────────────────────────────────────
  it("user can write dsar resources", () => {
    expect(evaluatePolicy({ userId: 2, role: "user", resource: "dsar.create", action: "write", env: "test" })).toBe(true);
  });

  // ── Whistleblower: users can submit ────────────────────────────────────
  it("user can write whistleblower resources", () => {
    expect(evaluatePolicy({ userId: 2, role: "user", resource: "phase12.whistleblower.create", action: "write", env: "test" })).toBe(true);
  });

  // ── Penalty calculator: read-only for users ────────────────────────────
  it("user can read penalty calculator", () => {
    expect(evaluatePolicy({ userId: 2, role: "user", resource: "phase13.penaltyCalculator.list", action: "read", env: "test" })).toBe(true);
  });

  it("user cannot approve penalty calculator", () => {
    expect(evaluatePolicy({ userId: 2, role: "user", resource: "phase13.penaltyCalculator", action: "approve", env: "test" })).toBe(false);
  });

  // ── Stripe payments: admin-only ────────────────────────────────────────
  it("user cannot access stripe payments", () => {
    expect(evaluatePolicy({ userId: 2, role: "user", resource: "phase12.stripePayments.create", action: "write", env: "test" })).toBe(false);
  });

  it("admin can access stripe payments", () => {
    expect(evaluatePolicy({ userId: 1, role: "admin", resource: "phase12.stripePayments.create", action: "write", env: "test" })).toBe(true);
  });

  // ── enforcePolicy: throws TRPCError on deny ────────────────────────────
  it("enforcePolicy throws FORBIDDEN for denied action", () => {
    expect(() =>
      enforcePolicy({ user: { id: 2, role: "user" } }, "banking.kyc", "delete")
    ).toThrow("PBAC");
  });

  it("enforcePolicy does not throw for allowed action", () => {
    expect(() =>
      enforcePolicy({ user: { id: 1, role: "admin" } }, "banking.kyc", "delete")
    ).not.toThrow();
  });
});
