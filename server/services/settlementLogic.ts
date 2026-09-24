/**
 * Pure settlement-workflow logic (no I/O, no DB) — state machine, terms
 * validation, instalment schedule construction and default detection for
 * NDPA 2023 enforcement-case settlements.
 *
 * Consumed by server/routers/settlementWorkflow.ts (which adds persistence,
 * dual control, TigerBeetle posting and audit emission) and unit-tested by
 * tests/round8/settlementLogic.test.ts.
 */

// ─── Status machine ──────────────────────────────────────────────────────────

export const SETTLEMENT_STATUSES = [
  "proposal",
  "counter",
  "agreement",
  "approval",
  "active",
  "fulfilled",
  "defaulted",
  "void",
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const TERMINAL_STATUSES: readonly SettlementStatus[] = [
  "fulfilled",
  "defaulted",
  "void",
];

/**
 * Legal transitions:
 *   proposal  -> counter | agreement | void      (negotiation)
 *   counter   -> counter | agreement | void      (further counters allowed)
 *   agreement -> approval | void                 (submit for dual-control approval)
 *   approval  -> active | void                   (final commissioner approval / rejection)
 *   active    -> fulfilled | defaulted           (performance or breach)
 *   fulfilled / defaulted / void                 (terminal)
 */
const TRANSITIONS: Readonly<Record<SettlementStatus, readonly SettlementStatus[]>> = {
  proposal: ["counter", "agreement", "void"],
  counter: ["counter", "agreement", "void"],
  agreement: ["approval", "void"],
  approval: ["active", "void"],
  active: ["fulfilled", "defaulted"],
  fulfilled: [],
  defaulted: [],
  void: [],
};

export function canTransition(from: SettlementStatus, to: SettlementStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: SettlementStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Throws with a human-readable reason when the transition is illegal. */
export function assertTransition(from: SettlementStatus, to: SettlementStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `settlement: illegal transition '${from}' -> '${to}'` +
        (isTerminal(from) ? ` ('${from}' is terminal)` : ""),
    );
  }
}

// ─── Terms ───────────────────────────────────────────────────────────────────

export interface InstalmentSpec {
  seq: number;
  dueDate: string; // ISO date/time
  amount: number;
}

export interface SettlementTermsInput {
  monetaryAmount: number;
  currency: string;
  nonMonetaryObligations: string[];
  instalmentSchedule: InstalmentSpec[];
  confidentialityFlag: boolean;
  transparencyRationale: string;
}

export const MIN_TRANSPARENCY_RATIONALE_LEN = 20;
export const MAX_INSTALMENTS = 36;
export const MONEY_TOLERANCE = 0.01;

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Validate structured settlement terms. Returns a list of problems (empty =
 * valid) so callers can surface ALL issues at once rather than failing fast.
 *
 * NDPA transparency rule: a confidential settlement MUST carry a substantive
 * public transparency rationale explaining why confidentiality is justified;
 * the rationale is encouraged (but not mandated) for public settlements.
 */
export function validateSettlementTerms(terms: SettlementTermsInput): string[] {
  const errors: string[] = [];

  if (!Number.isFinite(terms.monetaryAmount) || terms.monetaryAmount < 0) {
    errors.push("monetaryAmount must be a finite number >= 0");
  }
  if (!/^[A-Z]{3}$/.test(terms.currency)) {
    errors.push(`currency must be an ISO-4217 code, got '${terms.currency}'`);
  }
  if (
    terms.confidentialityFlag &&
    terms.transparencyRationale.trim().length < MIN_TRANSPARENCY_RATIONALE_LEN
  ) {
    errors.push(
      `confidential settlement requires a transparency rationale of at least ${MIN_TRANSPARENCY_RATIONALE_LEN} characters`,
    );
  }
  for (const [i, ob] of Array.from(terms.nonMonetaryObligations.entries())) {
    if (typeof ob !== "string" || ob.trim().length === 0) {
      errors.push(`nonMonetaryObligations[${i}] must be a non-empty string`);
    }
  }

  if (terms.instalmentSchedule.length > MAX_INSTALMENTS) {
    errors.push(`instalment schedule exceeds ${MAX_INSTALMENTS} entries`);
  }
  let prevDue = -Infinity;
  for (const inst of terms.instalmentSchedule) {
    if (!Number.isInteger(inst.seq) || inst.seq < 1) {
      errors.push(`instalment seq must be a positive integer, got ${inst.seq}`);
    }
    if (!Number.isFinite(inst.amount) || inst.amount <= 0) {
      errors.push(`instalment ${inst.seq}: amount must be > 0`);
    }
    const t = Date.parse(inst.dueDate);
    if (Number.isNaN(t)) {
      errors.push(`instalment ${inst.seq}: dueDate '${inst.dueDate}' is not a valid date`);
    } else {
      if (t < prevDue) {
        errors.push(`instalment ${inst.seq}: due dates must be non-decreasing`);
      }
      prevDue = t;
    }
  }
  if (terms.instalmentSchedule.length > 0 && Number.isFinite(terms.monetaryAmount)) {
    const scheduled = roundMoney(
      terms.instalmentSchedule.reduce((s, i) => s + (Number.isFinite(i.amount) ? i.amount : 0), 0),
    );
    if (Math.abs(scheduled - roundMoney(terms.monetaryAmount)) > MONEY_TOLERANCE) {
      errors.push(
        `instalment schedule sums to ${scheduled} but monetaryAmount is ${roundMoney(terms.monetaryAmount)}`,
      );
    }
  }
  return errors;
}

// ─── Instalment schedule construction ───────────────────────────────────────

/**
 * Split `totalAmount` into `count` equal instalments (first due on
 * `firstDueDate`, then every `intervalDays`). Rounding residue lands on the
 * FINAL instalment so the sum is always exact to the kobo/cent.
 */
export function buildInstalmentSchedule(
  totalAmount: number,
  count: number,
  firstDueDate: string,
  intervalDays = 30,
): InstalmentSpec[] {
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error("buildInstalmentSchedule: totalAmount must be > 0");
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALMENTS) {
    throw new Error(`buildInstalmentSchedule: count must be 1..${MAX_INSTALMENTS}`);
  }
  if (!Number.isInteger(intervalDays) || intervalDays < 1) {
    throw new Error("buildInstalmentSchedule: intervalDays must be a positive integer");
  }
  const start = Date.parse(firstDueDate);
  if (Number.isNaN(start)) {
    throw new Error(`buildInstalmentSchedule: invalid firstDueDate '${firstDueDate}'`);
  }
  const per = Math.floor((totalAmount * 100) / count) / 100;
  const schedule: InstalmentSpec[] = [];
  let allocated = 0;
  for (let i = 1; i <= count; i += 1) {
    const amount = i === count ? roundMoney(totalAmount - allocated) : per;
    allocated = roundMoney(allocated + amount);
    schedule.push({
      seq: i,
      dueDate: new Date(start + (i - 1) * intervalDays * 86_400_000).toISOString(),
      amount,
    });
  }
  return schedule;
}

// ─── Instalment lifecycle + default detection ───────────────────────────────

export const INSTALMENT_STATUSES = [
  "scheduled",
  "posted", // posted to the ledger, awaiting payment
  "partial",
  "paid",
  "overdue",
  "waived",
] as const;
export type InstalmentStatus = (typeof INSTALMENT_STATUSES)[number];

export interface InstalmentRecord {
  seq: number;
  dueDate: string;
  amount: number;
  status: InstalmentStatus;
  amountPaid?: number;
}

/** Default grace period after a due date before escalation (days). */
export const DEFAULT_GRACE_DAYS = 7;

function isOpenForPayment(status: InstalmentStatus): boolean {
  return status === "scheduled" || status === "posted" || status === "partial" || status === "overdue";
}

/** Result of applying a payment to one instalment (pure). */
export function applyPayment(
  inst: InstalmentRecord,
  paymentAmount: number,
): { instalment: InstalmentRecord; overpayment: number } {
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new Error("applyPayment: paymentAmount must be > 0");
  }
  if (!isOpenForPayment(inst.status)) {
    throw new Error(`applyPayment: instalment ${inst.seq} is '${inst.status}' and accepts no payment`);
  }
  const alreadyPaid = inst.amountPaid ?? 0;
  const totalPaid = roundMoney(alreadyPaid + paymentAmount);
  const outstanding = roundMoney(inst.amount - alreadyPaid);
  const applied = Math.min(paymentAmount, outstanding);
  const newPaid = roundMoney(alreadyPaid + applied);
  const status: InstalmentStatus =
    newPaid >= roundMoney(inst.amount) - MONEY_TOLERANCE ? "paid" : "partial";
  return {
    instalment: { ...inst, amountPaid: newPaid, status },
    overpayment: roundMoney(totalPaid - newPaid),
  };
}

export interface DefaultEvaluation {
  overdueSeqs: number[];
  /** True when the settlement must flip active -> defaulted. */
  shouldDefault: boolean;
  /** Human-readable escalation reason for the audit event. */
  escalationReason: string | null;
}

/**
 * Detect overdue instalments and decide whether the settlement defaults.
 * Rule: an open instalment whose dueDate + graceDays is in the past is
 * overdue; a single overdue instalment escalates and reopens the case
 * (the router emits the escalation audit event and flips the settlement to
 * 'defaulted' and the linked fine back to 'outstanding').
 */
export function evaluateDefaults(
  settlementStatus: SettlementStatus,
  instalments: InstalmentRecord[],
  now: Date = new Date(),
  graceDays: number = DEFAULT_GRACE_DAYS,
): DefaultEvaluation {
  if (settlementStatus !== "active") {
    return { overdueSeqs: [], shouldDefault: false, escalationReason: null };
  }
  const graceMs = graceDays * 86_400_000;
  const overdueSeqs = instalments
    .filter((i) => isOpenForPayment(i.status))
    .filter((i) => {
      const due = Date.parse(i.dueDate);
      return !Number.isNaN(due) && due + graceMs < now.getTime();
    })
    .map((i) => i.seq)
    .sort((a, b) => a - b);
  if (overdueSeqs.length === 0) {
    return { overdueSeqs, shouldDefault: false, escalationReason: null };
  }
  return {
    overdueSeqs,
    shouldDefault: true,
    escalationReason:
      `instalment(s) ${overdueSeqs.join(", ")} overdue beyond ${graceDays}-day grace period; ` +
      "settlement defaulted and enforcement case reopens",
  };
}

/**
 * A settlement is fulfilled when every monetary instalment is paid (or
 * waived) — non-monetary obligation sign-off is asserted separately by the
 * router caller (officer attestation), which is why it is a parameter here.
 */
export function isFulfilled(
  instalments: InstalmentRecord[],
  obligationsSignedOff: boolean,
): boolean {
  const monetaryDone = instalments.every(
    (i) => i.status === "paid" || i.status === "waived",
  );
  return monetaryDone && obligationsSignedOff;
}

// ─── Waiver / reduction ──────────────────────────────────────────────────────

export const MIN_LEGAL_BASIS_LEN = 20;

/**
 * Waiver/reduction of any part of an agreed monetary settlement requires a
 * documented statutory basis (e.g. "NDPA 2023 s.49(4) — Commission's
 * discretion to remit penalty") — the router additionally routes the waiver
 * through maker-checker dual control ('fine_settlement').
 */
export function validateWaiver(input: {
  reductionAmount: number;
  outstandingAmount: number;
  legalBasis: string;
}): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.reductionAmount) || input.reductionAmount <= 0) {
    errors.push("reductionAmount must be > 0");
  }
  if (input.reductionAmount > input.outstandingAmount + MONEY_TOLERANCE) {
    errors.push(
      `reductionAmount ${input.reductionAmount} exceeds outstanding amount ${input.outstandingAmount}`,
    );
  }
  if (input.legalBasis.trim().length < MIN_LEGAL_BASIS_LEN) {
    errors.push(
      `waiver/reduction requires a documented legal basis of at least ${MIN_LEGAL_BASIS_LEN} characters`,
    );
  }
  return errors;
}
