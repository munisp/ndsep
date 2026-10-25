/**
 * Anti-Wipe integrity-scoped REST status handler
 * ================================================
 * Unauthenticated by design BUT integrity-scoped: exposes ONLY the audit
 * chain head hash, entry count, and latest anchor date — enough for the
 * external watchdog (workers/python/antiwipe_watchdog.py) to detect a wiped
 * or rolled-back ledger, and nothing else (no payloads, no actors, no
 * per-entry data).
 *
 * Mount (one line in server/_core/index.ts, owned by another lane):
 *   import { antiwipeStatusHandler } from "./antiwipe/restStatus";
 *   app.get("/api/antiwipe/status", antiwipeStatusHandler);
 *
 * Alternatively, when ANTIWIPE_SERVICE_TOKEN is set the handler REQUIRES
 * `Authorization: Bearer <token>` — set the same env var on the watchdog.
 */
import type { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { ledgerStatus } from "./ledger";

function tokenOk(req: Request): boolean {
  const expected = process.env.ANTIWIPE_SERVICE_TOKEN;
  if (!expected) return true; // integrity-scoped payload is safe unauthenticated
  const header = req.header("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function antiwipeStatusHandler(req: Request, res: Response): Promise<void> {
  if (!tokenOk(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const status = await ledgerStatus();
    res.json({
      ledger: {
        headHash: status.headHash,
        entryCount: status.entryCount,
        headSeq: status.headSeq,
        genesisHash: status.genesisHash,
        latestAnchorDate: status.latestAnchorDate,
        tailCheck: { valid: status.tailCheck.valid },
      },
    });
  } catch (err) {
    res.status(503).json({ error: "antiwipe status unavailable", detail: err instanceof Error ? err.message : String(err) });
  }
}
