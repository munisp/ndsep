/**
 * Unit tests for server/services/settlementLogic.ts — settlement state
 * machine, terms validation, instalment schedule construction, payment
 * application and default detection. Pure logic, no DB.
 *
 * Run: vitest run --root tests/round8
 */
import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  isTerminal,
  validateSettlementTerms,
  buildInstalmentSchedule,
  applyPayment,
  evaluateDefaults,
  isFulfilled,
  validateWaiver,
  roundMoney,
  type SettlementStatus,
  type InstalmentRecord,
} from "../../server/services/settlementLogic";

const DAYS = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();

// ─── State machine ───────────────────────────────────────────────────────────

describe("settlement state machine", () => {
  it("follows the happy path proposal->counter->agreement->approval->active->fulfilled", () => {
    const path: SettlementStatus[] = ["proposal", "counter", "agreement", "approval", "active", "fulfilled"];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
      expect(() => assertTransition(path[i], path[i + 1])).not.toThrow();
    }
  });

  it("supports the default and void exits", () => {
    expect(canTransition("active", "defaulted")).toBe(true);
    expect(canTransition("proposal", "void")).toBe(true);
    expect(canTransition("agreement", "void")).toBe(true);
    expect(canTransition("approval", "void")).toBe(true);
  });

  it("allows repeated counter-offers while negotiating", () => {
    expect(canTransition("counter", "counter")).toBe(true);
    expect(canTransition("proposal", "counter")).toBe(true);
  });

  it.each([
    ["proposal", "active"],
    ["proposal", "fulfilled"],
    ["counter", "approval"], // must pass through agreement first
    ["agreement", "active"], // must pass through approval first
    ["approval", "fulfilled"],
    ["active", "void"], // an active settlement cannot be silently voided
    ["active", "proposal"],
  ] as Array<[SettlementStatus, SettlementStatus]>)(
    "rejects illegal transition %s -> %s",
    (from, to) => {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(/illegal transition/);
    },
  );

  it("terminal states accept no further transitions", () => {
    for (const t of ["fulfilled", "defaulted", "void"] as SettlementStatus[]) {
      expect(isTerminal(t)).toBe(true);
      for (const target of ["proposal", "active", "fulfilled", "void"] as SettlementStatus[]) {
        expect(canTransition(t, target)).toBe(false);
      }
    }
  });
});

// ─── Terms validation ────────────────────────────────────────────────────────

const baseTerms = {
  monetaryAmount: 1_000_000,
  currency: "NGN",
  nonMonetaryObligations: ["Appoint a DPO within 60 days"],
  instalmentSchedule: [
    { seq: 1, dueDate: iso(Date.now() + 30 * DAYS), amount: 500_000 },
    { seq: 2, dueDate: iso(Date.now() + 60 * DAYS), amount: 500_000 },
  ],
  confidentialityFlag: false,
  transparencyRationale: "",
};

describe("validateSettlementTerms", () => {
  it("accepts well-formed terms", () => {
    expect(validateSettlementTerms(baseTerms)).toEqual([]);
  });

  it("accepts a zero-monetary settlement with no schedule (obligations only)", () => {
    expect(validateSettlementTerms({
      ...baseTerms, monetaryAmount: 0, instalmentSchedule: [],
    })).toEqual([]);
  });

  it("requires a substantive transparency rationale for confidential settlements", () => {
    const errs = validateSettlementTerms({ ...baseTerms, confidentialityFlag: true });
    expect(errs.join()).toMatch(/transparency rationale/);
    const ok = validateSettlementTerms({
      ...baseTerms,
      confidentialityFlag: true,
      transparencyRationale: "Confidentiality justified under NDPA 2023 to protect ongoing investigation.",
    });
    expect(ok).toEqual([]);
  });

  it("rejects when the schedule does not sum to the monetary amount", () => {
    const errs = validateSettlementTerms({
      ...baseTerms,
      instalmentSchedule: [{ seq: 1, dueDate: iso(Date.now() + 30 * DAYS), amount: 400_000 }],
    });
    expect(errs.join()).toMatch(/sums to 400000/);
  });

  it("rejects negative amounts, bad currency, non-ascending dates", () => {
    const errs = validateSettlementTerms({
      ...baseTerms,
      monetaryAmount: -5,
      currency: "ngn",
      instalmentSchedule: [
        { seq: 1, dueDate: iso(Date.now() + 60 * DAYS), amount: 500_000 },
        { seq: 2, dueDate: iso(Date.now() + 30 * DAYS), amount: 500_000 },
      ],
    });
    expect(errs.join()).toMatch(/>= 0/);
    expect(errs.join()).toMatch(/ISO-4217/);
    expect(errs.join()).toMatch(/non-decreasing/);
  });
});

// ─── Schedule construction ───────────────────────────────────────────────────

describe("buildInstalmentSchedule", () => {
  it("splits evenly with residue on the final instalment", () => {
    const s = buildInstalmentSchedule(1_000_001, 3, "2026-01-31T00:00:00Z", 30);
    expect(s).toHaveLength(3);
    expect(roundMoney(s.reduce((a, i) => a + i.amount, 0))).toBe(1_000_001);
    expect(s[2].amount).toBeCloseTo(333_333.68, 2);
  });

  it("spaces due dates by the interval", () => {
    const s = buildInstalmentSchedule(90_000, 3, "2026-03-01T00:00:00Z", 30);
    const days = s.map((i) => Date.parse(i.dueDate) / DAYS);
    expect(days[1] - days[0]).toBe(30);
    expect(days[2] - days[1]).toBe(30);
  });

  it("rejects bad inputs", () => {
    expect(() => buildInstalmentSchedule(0, 3, "2026-01-01")).toThrow(/> 0/);
    expect(() => buildInstalmentSchedule(100, 0, "2026-01-01")).toThrow(/1\.\./);
    expect(() => buildInstalmentSchedule(100, 3, "not-a-date")).toThrow(/invalid firstDueDate/);
  });
});

// ─── Payments ────────────────────────────────────────────────────────────────

const inst = (over: Partial<InstalmentRecord> = {}): InstalmentRecord => ({
  seq: 1,
  dueDate: iso(Date.now() + 30 * DAYS),
  amount: 500_000,
  status: "posted",
  amountPaid: 0,
  ...over,
});

describe("applyPayment", () => {
  it("marks a fully paid instalment as paid", () => {
    const { instalment, overpayment } = applyPayment(inst(), 500_000);
    expect(instalment.status).toBe("paid");
    expect(instalment.amountPaid).toBe(500_000);
    expect(overpayment).toBe(0);
  });

  it("marks a partial payment and accumulates", () => {
    const first = applyPayment(inst(), 200_000).instalment;
    expect(first.status).toBe("partial");
    const second = applyPayment(first, 300_000).instalment;
    expect(second.status).toBe("paid");
    expect(second.amountPaid).toBe(500_000);
  });

  it("returns overpayment instead of over-crediting the instalment", () => {
    const { instalment, overpayment } = applyPayment(inst(), 600_000);
    expect(instalment.status).toBe("paid");
    expect(instalment.amountPaid).toBe(500_000);
    expect(overpayment).toBe(100_000);
  });

  it("refuses payments on terminal instalments", () => {
    expect(() => applyPayment(inst({ status: "paid", amountPaid: 500_000 }), 1)).toThrow(/accepts no payment/);
    expect(() => applyPayment(inst({ status: "waived" }), 1)).toThrow(/accepts no payment/);
  });
});

// ─── Default detection ───────────────────────────────────────────────────────

describe("evaluateDefaults", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("flags an open instalment overdue beyond the grace period", () => {
    const v = evaluateDefaults("active", [
      inst({ seq: 1, dueDate: "2026-05-01T00:00:00Z" }), // 31 days overdue
    ], now, 7);
    expect(v.shouldDefault).toBe(true);
    expect(v.overdueSeqs).toEqual([1]);
    expect(v.escalationReason).toMatch(/reopens/);
  });

  it("does not default within the grace period", () => {
    const v = evaluateDefaults("active", [
      inst({ seq: 1, dueDate: "2026-05-28T00:00:00Z" }), // 4 days overdue, grace 7
    ], now, 7);
    expect(v.shouldDefault).toBe(false);
  });

  it("ignores paid and waived instalments", () => {
    const v = evaluateDefaults("active", [
      inst({ seq: 1, dueDate: "2026-01-01T00:00:00Z", status: "paid", amountPaid: 500_000 }),
      inst({ seq: 2, dueDate: "2026-02-01T00:00:00Z", status: "waived" }),
    ], now, 7);
    expect(v.shouldDefault).toBe(false);
  });

  it("only evaluates active settlements", () => {
    for (const st of ["proposal", "agreement", "fulfilled", "defaulted", "void"] as SettlementStatus[]) {
      const v = evaluateDefaults(st, [inst({ dueDate: "2020-01-01T00:00:00Z" })], now, 7);
      expect(v.shouldDefault).toBe(false);
    }
  });
});

describe("isFulfilled", () => {
  it("requires all instalments settled AND obligations signed off", () => {
    const paid = inst({ status: "paid", amountPaid: 500_000 });
    expect(isFulfilled([paid], true)).toBe(true);
    expect(isFulfilled([paid], false)).toBe(false);
    expect(isFulfilled([inst({ status: "partial", amountPaid: 250_000 })], true)).toBe(false);
  });
});

// ─── Waiver / reduction ──────────────────────────────────────────────────────

describe("validateWaiver", () => {
  it("requires a documented legal basis", () => {
    const errs = validateWaiver({
      reductionAmount: 100_000,
      outstandingAmount: 500_000,
      legalBasis: "",
    });
    expect(errs.join()).toMatch(/legal basis/);
  });

  it("rejects reductions above the outstanding amount", () => {
    const errs = validateWaiver({
      reductionAmount: 600_000,
      outstandingAmount: 500_000,
      legalBasis: "NDPA 2023 s.49(4) — Commission's remission discretion",
    });
    expect(errs.join()).toMatch(/exceeds outstanding/);
  });

  it("accepts a properly grounded waiver", () => {
    expect(validateWaiver({
      reductionAmount: 100_000,
      outstandingAmount: 500_000,
      legalBasis: "NDPA 2023 s.49(4) — Commission's remission discretion",
    })).toEqual([]);
  });
});
