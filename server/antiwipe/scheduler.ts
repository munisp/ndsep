/**
 * Anti-Wipe Scheduler (OPTIONAL — see registration snippet, marked OPTIONAL)
 * ==========================================================================
 * In-process cadence for the antiwipe controls:
 *   - daily ledger anchor (anchorLedger) shortly after UTC midnight
 *   - periodic canary write + check (default hourly check, daily rewrite)
 *   - periodic tail-window chain verification
 * Failures are logged and appended to the ledger where possible; the
 * scheduler never crashes the host process.
 */
import { anchorLedger, verifyChain } from "./ledger";
import { checkCanaries, writeCanary } from "./backupGuard";
import { verifyRecentEvidence } from "./vault";

interface SchedulerState {
  timers: NodeJS.Timeout[];
  lastCanaryCheck: string | null;
  lastAnchorDate: string | null;
  lastTailVerify: { valid: boolean; checkedAt: string } | null;
}

const state: SchedulerState = {
  timers: [],
  lastCanaryCheck: null,
  lastAnchorDate: null,
  lastTailVerify: null,
};

function every(ms: number, fn: () => Promise<void>): void {
  const tick = async () => {
    try {
      await fn();
    } catch (err) {
      console.error("[ANTWIPE] scheduled task failed:", err);
    }
  };
  const t = setInterval(tick, ms);
  t.unref?.();
  state.timers.push(t);
  void tick();
}

export function startAntiwipeScheduler(options: {
  canaryCheckMs?: number;
  canaryWriteMs?: number;
  anchorMs?: number;
  tailVerifyMs?: number;
} = {}): void {
  const canaryCheckMs = options.canaryCheckMs ?? 60 * 60 * 1000; // hourly
  const canaryWriteMs = options.canaryWriteMs ?? 24 * 60 * 60 * 1000; // daily
  const anchorMs = options.anchorMs ?? 60 * 60 * 1000; // checks hourly, anchors once/day
  const tailVerifyMs = options.tailVerifyMs ?? 15 * 60 * 1000; // 15 min

  every(canaryCheckMs, async () => {
    const res = await checkCanaries();
    state.lastCanaryCheck = new Date().toISOString();
    if (res.failed.length > 0) {
      console.error(`[ANTWIPE] canary check: ${res.failed.length} FAILED`);
    }
  });

  every(canaryWriteMs, async () => {
    await writeCanary();
  });

  every(anchorMs, async () => {
    // Anchor YESTERDAY (complete UTC day) once per day.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (state.lastAnchorDate === yesterday) return;
    const anchor = await anchorLedger(yesterday);
    state.lastAnchorDate = anchor.anchorDate;
  });

  every(tailVerifyMs, async () => {
    const res = await verifyChain({ fromSeq: 1, limit: 10_000 });
    state.lastTailVerify = { valid: res.valid, checkedAt: new Date().toISOString() };
    if (!res.valid) {
      console.error(`[ANTWIPE] LEDGER CHAIN BROKEN at seq ${res.brokenAtSeq} (${res.reason})`);
    }
    const vault = await verifyRecentEvidence(25);
    if (vault.failures.length > 0) {
      console.error(`[ANTWIPE] vault integrity failures: ${JSON.stringify(vault.failures)}`);
    }
  });

  console.log("[ANTWIPE] scheduler started (canary/anchor/tail-verify)");
}

export function stopAntiwipeScheduler(): void {
  for (const t of state.timers) clearInterval(t);
  state.timers = [];
}

export function getAntiwipeSchedulerStatus() {
  return {
    running: state.timers.length > 0,
    lastCanaryCheck: state.lastCanaryCheck,
    lastAnchorDate: state.lastAnchorDate,
    lastTailVerify: state.lastTailVerify,
  };
}
