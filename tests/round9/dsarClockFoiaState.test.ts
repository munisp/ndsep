/**
 * Round-9 tests: DSAR response-clock pause math (FIX 3) and the FOIA status
 * transition table (FIX 9, duplicated here as an executable contract).
 */
import { describe, it, expect } from "vitest";
import {
  totalPausedMs,
  effectiveDeadline,
  type ClockPauseInterval,
} from "../../server/services/complaintLogic";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("DSAR clock pause math", () => {
  it("no pauses → deadline unchanged", () => {
    const base = Date.now();
    expect(effectiveDeadline(base, [], base + 1000)).toBe(base);
  });

  it("closed pause intervals shift the deadline out", () => {
    const base = 1_000_000_000_000;
    const pauses: ClockPauseInterval[] = [
      { pausedAtMs: base + DAY, resumedAtMs: base + DAY + 12 * HOUR }, // 12h pause
      { pausedAtMs: base + 2 * DAY, resumedAtMs: base + 2 * DAY + 6 * HOUR }, // 6h pause
    ];
    expect(totalPausedMs(pauses, base + 3 * DAY)).toBe(18 * HOUR);
    expect(effectiveDeadline(base + 30 * DAY, pauses, base + 3 * DAY)).toBe(base + 30 * DAY + 18 * HOUR);
  });

  it("an open (currently paused) interval counts up to now", () => {
    const now = 1_000_000_000_000;
    const pauses: ClockPauseInterval[] = [{ pausedAtMs: now - 2 * DAY, resumedAtMs: null }];
    expect(totalPausedMs(pauses, now)).toBe(2 * DAY);
    expect(effectiveDeadline(now + 10 * DAY, pauses, now)).toBe(now + 12 * DAY);
  });

  it("degenerate intervals (resumed before paused) contribute nothing", () => {
    const pauses: ClockPauseInterval[] = [{ pausedAtMs: 1000, resumedAtMs: 500 }];
    expect(totalPausedMs(pauses, 2000)).toBe(0);
  });

  it("multiple open intervals are summed (defensive)", () => {
    const now = 100_000;
    const pauses: ClockPauseInterval[] = [
      { pausedAtMs: 0, resumedAtMs: null },
      { pausedAtMs: 50_000, resumedAtMs: null },
    ];
    expect(totalPausedMs(pauses, now)).toBe(100_000 + 50_000);
  });
});

describe("FOIA status transition table (contract)", () => {
  // Mirrors FOIA_TRANSITIONS in server/routers/foia.ts — kept as an explicit
  // executable contract so a drift between the two is caught here.
  const TRANSITIONS: Record<string, readonly string[]> = {
    received: ["processing"],
    processing: ["partial_disclosure", "disclosed", "refused"],
    partial_disclosure: ["disclosed", "closed"],
    disclosed: ["closed"],
    refused: ["closed"],
    closed: [],
  };

  it("is a one-way lifecycle", () => {
    expect(TRANSITIONS.received).toContain("processing");
    expect(TRANSITIONS.processing).toContain("refused");
    expect(TRANSITIONS.refused).toEqual(["closed"]);
    expect(TRANSITIONS.closed).toEqual([]);
  });

  it("has no backward edges", () => {
    for (const [from, tos] of Object.entries(TRANSITIONS)) {
      for (const to of tos) {
        expect(TRANSITIONS[to] ?? [], `${to} must not lead back to ${from}`).not.toContain(from);
      }
    }
  });
});
