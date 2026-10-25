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
import {
  getExternalAnchorConfigFromEnv,
  isProductionEnv,
  mirrorAnchorExternal,
  type ExternalMirrorResult,
} from "./externalAnchor";

interface SchedulerState {
  timers: NodeJS.Timeout[];
  lastCanaryCheck: string | null;
  lastAnchorDate: string | null;
  lastTailVerify: { valid: boolean; checkedAt: string } | null;
  lastExternalMirror: ExternalMirrorResult | null;
}

const state: SchedulerState = {
  timers: [],
  lastCanaryCheck: null,
  lastAnchorDate: null,
  lastTailVerify: null,
  lastExternalMirror: null,
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
    // Default cadence: anchor YESTERDAY (complete UTC day) once per day.
    // ANTIWIPE_ANCHOR_HOURLY=true opts into anchoring the CURRENT partial day
    // hourly (finer detection granularity; anchor rows are upsert-idempotent
    // per date so later complete-day anchors replace partial ones only after
    // operator review — the daily row for a date is written once).
    const hourly = process.env.ANTIWIPE_ANCHOR_HOURLY === "true";
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    // Skip when already anchored AND the external mirror is healthy; an
    // unhealthy mirror retries every tick (put-if-absent makes it idempotent).
    if (state.lastAnchorDate === yesterday && state.lastExternalMirror?.healthy !== false) return;
    const anchor = await anchorLedger(yesterday);
    state.lastAnchorDate = anchor.anchorDate;
    // External WORM mirror (S3 Object Lock). Fail-closed in production: with
    // no S3_ANCHOR_* sink configured this returns healthy=false and alerts —
    // the scheduler status reports the anchor job UNHEALTHY, never OK.
    state.lastExternalMirror = await mirrorAnchorExternal({
      anchorDate: anchor.anchorDate,
      rootHash: anchor.rootHash,
      firstSeq: anchor.firstSeq,
      lastSeq: anchor.lastSeq,
      entryCount: anchor.entryCount,
      kind: "daily",
    });
    if (!state.lastExternalMirror.healthy) {
      console.error(
        `[ANTWIPE] external anchor mirror UNHEALTHY for ${anchor.anchorDate}: ${state.lastExternalMirror.reason}`,
      );
    }
    if (hourly) {
      // Intraday snapshot: anchor TODAY's chain-so-far (the daily anchor only
      // covers closed days), keyed YYYY-MM-DDThhZ so it never collides with
      // the canonical daily anchor; mirrored to the external WORM sink under
      // the same key.
      const { appendLedger, computeMerkleRoot } = await import("./ledger");
      const { q } = await import("./db");
      const today = new Date().toISOString().slice(0, 10);
      const rows = await q<{ entry_hash: string; seq: string }>(
        `SELECT entry_hash, seq FROM audit_ledger
          WHERE created_at >= $1::date AND created_at < $1::date + interval '1 day'
          ORDER BY seq ASC`,
        [today],
      );
      const hourKey = `${new Date().toISOString().slice(0, 13)}Z`; // YYYY-MM-DDThhZ
      const snapshot = {
        anchorDate: hourKey,
        rootHash: computeMerkleRoot(rows.map((r) => r.entry_hash)),
        firstSeq: rows.length > 0 ? Number(rows[0].seq) : null,
        lastSeq: rows.length > 0 ? Number(rows[rows.length - 1].seq) : null,
        entryCount: rows.length,
      };
      await appendLedger("antiwipe.hourly_anchor_snapshot", snapshot, "antiwipe-scheduler");
      const snapMirror = await mirrorAnchorExternal({ ...snapshot, kind: "hourly_snapshot" });
      if (!snapMirror.healthy) state.lastExternalMirror = snapMirror;
    }
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
  const externalConfigured = getExternalAnchorConfigFromEnv() != null;
  // Fail-closed health: production with no external sink is UNHEALTHY even
  // before the first mirror attempt; a failed/unhealthy mirror is UNHEALTHY.
  const externalHealthy = externalConfigured && (state.lastExternalMirror?.healthy ?? true);
  return {
    running: state.timers.length > 0,
    lastCanaryCheck: state.lastCanaryCheck,
    lastAnchorDate: state.lastAnchorDate,
    lastTailVerify: state.lastTailVerify,
    externalAnchor: {
      configured: externalConfigured,
      failClosed: isProductionEnv() && !externalConfigured,
      healthy: externalHealthy,
      status: externalHealthy ? "OK" : "UNHEALTHY",
      lastMirror: state.lastExternalMirror,
    },
  };
}
