/**
 * OSIRIS intel snapshot store (Round-13 P1.7)
 * ============================================
 * In-memory latest-snapshot store fed by the SSE subscriber
 * (server/osiris/sseSubscriber.ts). This is the READ SIDE of the polling →
 * streaming upgrade: consumers read the freshest pushed snapshot BEFORE
 * falling back to a polling GET.
 *
 * INTEGRATOR NOTE (future osirisClient.ts refactor — osirisClient.ts is NOT
 * modified in this round):
 *   server/osirisClient.ts currently uses a cached-GET pattern (`cached()` /
 *   `setCache()` around `osirisGet()`). To make it stream-first:
 *     - in searchSanctions():     const snap = getSanctionsSnapshot();
 *                                 if (snap && !snap.stale) { filter snap.data
 *                                 by query; only fall through to osirisGet on
 *                                 miss/stale }
 *     - in getCyberThreats():     const snap = getThreatSnapshot();
 *                                 if (snap && !snap.stale) return snap.data;
 *   The SSE payloads must be validated to the OsirisSanctionEntity[] /
 *   {threats, stats} shapes at the seam (never trust the stream blindly) —
 *   same defensive parsing as the GET path.
 *
 * Snapshots carry the stream's lastEventId so reconnects resume exactly
 * where they left off, and a stale-after marker so readers can decide to
 * fall back to polling when the stream has been silent too long.
 */

export type SnapshotStream = "sanctions" | "threats";

export interface IntelSnapshot<T = unknown> {
  stream: SnapshotStream;
  /** Validated payload of the most recent snapshot event. */
  data: T;
  /** SSE event id (for Last-Event-ID reconnect bookkeeping). */
  eventId: string | null;
  /** When this snapshot was received (epoch ms). */
  updatedAt: number;
  /** True when older than the stream's stale threshold. */
  stale: boolean;
}

interface StoredSnapshot {
  stream: SnapshotStream;
  data: unknown;
  eventId: string | null;
  updatedAt: number;
}

/** Snapshots older than this are flagged stale (default 30 min). */
const STALE_AFTER_MS = 30 * 60 * 1000;

const store = new Map<SnapshotStream, StoredSnapshot>();

/** Replace the snapshot for a stream. Called ONLY by the SSE subscriber. */
export function setSnapshot(stream: SnapshotStream, data: unknown, eventId: string | null, now = Date.now()): void {
  store.set(stream, { stream, data, eventId, updatedAt: now });
}

function read(stream: SnapshotStream, now = Date.now()): IntelSnapshot | null {
  const s = store.get(stream);
  if (!s) return null;
  return { ...s, stale: now - s.updatedAt > STALE_AFTER_MS } as IntelSnapshot;
}

/**
 * Latest sanctions snapshot pushed over SSE, or null when none has arrived.
 * Callers should check `.stale` and fall back to the polling GET when stale.
 */
export function getSanctionsSnapshot<T = unknown>(now = Date.now()): IntelSnapshot<T> | null {
  return read("sanctions", now) as IntelSnapshot<T> | null;
}

/** Latest threat-feed snapshot pushed over SSE, or null when none arrived. */
export function getThreatSnapshot<T = unknown>(now = Date.now()): IntelSnapshot<T> | null {
  return read("threats", now) as IntelSnapshot<T> | null;
}

/** Test hook: wipe the store. */
export function __clearSnapshots(): void {
  store.clear();
}
