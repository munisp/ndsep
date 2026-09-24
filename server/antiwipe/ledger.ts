/**
 * Anti-Wipe Hash-Chained Audit Ledger
 * ====================================
 * Tamper-evident audit chain in Postgres (table `audit_ledger`):
 *
 *   entry_hash = sha256(prev_hash || canonical(payload) || created_at)
 *
 * where prev_hash is the entry_hash of the previous row (sha256("genesis")
 * for the first row — the same genesis convention as the Rust
 * workers/rust/audit_chain service).
 *
 * Properties:
 *  - Any rewrite/delete of a historical row breaks every subsequent link;
 *    verifyChain() walks the chain and reports the FIRST broken link.
 *  - Appends are serialized with a Postgres advisory lock so two concurrent
 *    writers can never fork the chain.
 *  - anchorLedger() folds a day's entry hashes into a merkle-style root
 *    (identical algorithm to the Rust audit_chain worker) and stores it in
 *    ledger_anchors; if the external audit_chain worker is reachable the
 *    anchor is also POSTed there for cross-system corroboration. The external
 *    POST is best-effort and degrades gracefully.
 *  - UPDATE/DELETE/TRUNCATE are blocked by DB triggers
 *    (drizzle/migrations/0061_antiwipe_audit_ledger.sql).
 */
import { sha256Hex } from "./vault";
import { getAntiwipePool, q } from "./db";

export const GENESIS_HASH = sha256Hex("genesis");

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function computeEntryHash(
  prevHash: string,
  payload: unknown,
  createdAt: string,
): string {
  return sha256Hex(`${prevHash}${canonicalJson(payload)}${createdAt}`);
}

export interface LedgerEntry {
  seq: number;
  prevHash: string;
  entryHash: string;
  payload: unknown;
  actor: string | null;
  action: string;
  createdAt: Date;
}

function rowToEntry(r: Record<string, unknown>): LedgerEntry {
  return {
    seq: Number(r.seq),
    prevHash: String(r.prev_hash),
    entryHash: String(r.entry_hash),
    payload: r.payload,
    actor: (r.actor as string) ?? null,
    action: String(r.action),
    createdAt: r.created_at as Date,
  };
}

/** Serialize appends across all app processes on this database. */
const LEDGER_APPEND_LOCK_KEY = 0xA07D1E; // "audit ledger" advisory lock id

/**
 * Append an entry to the chain. Returns the stored entry.
 * The advisory xact lock + read-head-then-insert happen in ONE transaction,
 * so the prev_hash read is race-free.
 */
export async function appendLedger(
  action: string,
  payload: unknown,
  actor: string | null = null,
): Promise<LedgerEntry> {
  const pool = getAntiwipePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LEDGER_APPEND_LOCK_KEY]);
    const head = await client.query(
      `SELECT entry_hash FROM audit_ledger ORDER BY seq DESC LIMIT 1`,
    );
    const prevHash: string = head.rows[0]?.entry_hash ?? GENESIS_HASH;
    // created_at is fixed client-side so the hash commits to it exactly.
    const createdAt = new Date().toISOString();
    const entryHash = computeEntryHash(prevHash, payload, createdAt);
    const inserted = await client.query(
      `INSERT INTO audit_ledger (prev_hash, entry_hash, payload, actor, action, created_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)
       RETURNING *`,
      [prevHash, entryHash, canonicalJson(payload), actor, action, createdAt],
    );
    await client.query("COMMIT");
    return rowToEntry(inserted.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface ChainVerification {
  valid: boolean;
  entriesChecked: number;
  brokenAtSeq: number | null;
  reason?: "prev_hash_mismatch" | "entry_hash_mismatch";
  headHash: string | null;
}

/**
 * Walk the chain in seq order and recompute every link. Reports the FIRST
 * broken link. `fromSeq`/`limit` allow incremental verification of a tail
 * window; when verifying a window, the first row's prev_hash is trusted as
 * the window anchor (full verification walks from genesis).
 */
export async function verifyChain(options: {
  fromSeq?: number;
  limit?: number;
} = {}): Promise<ChainVerification> {
  const fromSeq = options.fromSeq ?? 1;
  const limit = Math.min(options.limit ?? 100_000, 1_000_000);
  const rows = await q(
    `SELECT seq, prev_hash, entry_hash, payload, created_at
       FROM audit_ledger
      WHERE seq >= $1
      ORDER BY seq ASC
      LIMIT $2`,
    [fromSeq, limit],
  );

  let expectedPrev = GENESIS_HASH;
  if (fromSeq > 1) {
    const anchor = await q<{ entry_hash: string }>(
      `SELECT entry_hash FROM audit_ledger WHERE seq = $1`,
      [fromSeq - 1],
    );
    if (anchor.length === 0) {
      return {
        valid: false,
        entriesChecked: 0,
        brokenAtSeq: fromSeq,
        reason: "prev_hash_mismatch",
        headHash: null,
      };
    }
    expectedPrev = anchor[0].entry_hash;
  }

  let checked = 0;
  let headHash: string | null = null;
  for (const r of rows as Array<Record<string, unknown>>) {
    const seq = Number(r.seq);
    const prevHash = String(r.prev_hash);
    const entryHash = String(r.entry_hash);
    const createdAt = (r.created_at as Date).toISOString();
    if (prevHash !== expectedPrev) {
      return { valid: false, entriesChecked: checked, brokenAtSeq: seq, reason: "prev_hash_mismatch", headHash };
    }
    const recomputed = computeEntryHash(prevHash, r.payload, createdAt);
    if (recomputed !== entryHash) {
      return { valid: false, entriesChecked: checked, brokenAtSeq: seq, reason: "entry_hash_mismatch", headHash };
    }
    expectedPrev = entryHash;
    headHash = entryHash;
    checked += 1;
  }
  return { valid: true, entriesChecked: checked, brokenAtSeq: null, headHash };
}

/** Merkle-style root over hex hashes — identical to workers/rust/audit_chain. */
export function computeMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return sha256Hex("empty");
  let level = [...hashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(sha256Hex(`${level[i]}${right}`));
    }
    level = next;
  }
  return level[0];
}

export interface LedgerAnchor {
  anchorDate: string;
  rootHash: string;
  firstSeq: number | null;
  lastSeq: number | null;
  entryCount: number;
  externalAnchor: unknown | null;
  alreadyAnchored: boolean;
}

/**
 * Compute and store the daily anchor for a UTC date (default: today).
 * Idempotent: an existing anchor for the date is returned unchanged.
 * Best-effort mirror to the external Rust audit_chain worker; failures are
 * recorded in the anchor row's external_anchor field, never thrown.
 */
export async function anchorLedger(date?: string): Promise<LedgerAnchor> {
  const anchorDate = date ?? new Date().toISOString().slice(0, 10);

  const existing = await q(
    `SELECT anchor_date, root_hash, first_seq, last_seq, entry_count, external_anchor
       FROM ledger_anchors WHERE anchor_date = $1::date`,
    [anchorDate],
  );
  if (existing.length > 0) {
    const r = existing[0] as Record<string, unknown>;
    return {
      anchorDate,
      rootHash: String(r.root_hash),
      firstSeq: r.first_seq == null ? null : Number(r.first_seq),
      lastSeq: r.last_seq == null ? null : Number(r.last_seq),
      entryCount: Number(r.entry_count),
      externalAnchor: r.external_anchor ?? null,
      alreadyAnchored: true,
    };
  }

  const rows = await q<{ seq: string; entry_hash: string }>(
    `SELECT seq::text AS seq, entry_hash
       FROM audit_ledger
      WHERE created_at >= $1::date
        AND created_at <  $1::date + interval '1 day'
      ORDER BY seq ASC`,
    [anchorDate],
  );
  const hashes = rows.map((r) => r.entry_hash);
  const rootHash = computeMerkleRoot(hashes);
  const firstSeq = rows.length ? Number(rows[0].seq) : null;
  const lastSeq = rows.length ? Number(rows[rows.length - 1].seq) : null;

  // Best-effort external corroboration via the Rust audit_chain worker.
  const externalAnchor = await postAnchorToAuditChain({
    anchorDate,
    rootHash,
    firstSeq,
    lastSeq,
    entryCount: hashes.length,
  });

  await q(
    `INSERT INTO ledger_anchors
       (anchor_date, root_hash, first_seq, last_seq, entry_count, external_anchor)
     VALUES ($1::date, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (anchor_date) DO NOTHING`,
    [
      anchorDate,
      rootHash,
      firstSeq,
      lastSeq,
      hashes.length,
      externalAnchor == null ? null : JSON.stringify(externalAnchor),
    ],
  );

  return {
    anchorDate,
    rootHash,
    firstSeq,
    lastSeq,
    entryCount: hashes.length,
    externalAnchor,
    alreadyAnchored: false,
  };
}

async function postAnchorToAuditChain(anchor: {
  anchorDate: string;
  rootHash: string;
  firstSeq: number | null;
  lastSeq: number | null;
  entryCount: number;
}): Promise<unknown | null> {
  const base = process.env.AUDIT_CHAIN_URL ?? "http://localhost:8165";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    // HTTP shape per workers/rust/audit_chain/src/main.rs: POST /api/v1/audit/append
    const res = await fetch(`${base}/api/v1/audit/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        aggregate_type: "ledger_anchor",
        aggregate_id: anchor.anchorDate,
        event_type: "daily_anchor",
        actor_id: "antiwipe",
        payload: {
          root_hash: anchor.rootHash,
          first_seq: anchor.firstSeq,
          last_seq: anchor.lastSeq,
          entry_count: anchor.entryCount,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { mirrored: false, status: res.status };
    }
    const body = await res.json().catch(() => null);
    return { mirrored: true, base, response: body };
  } catch (err) {
    // Graceful degradation: external anchor is corroboration, not the root of trust.
    return { mirrored: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function ledgerStatus(): Promise<{
  entryCount: number;
  headHash: string | null;
  headSeq: number | null;
  genesisHash: string;
  anchorCount: number;
  latestAnchorDate: string | null;
  tailCheck: ChainVerification;
}> {
  const head = await q<{ seq: string; entry_hash: string; count: string }>(
    `SELECT (SELECT seq::text FROM audit_ledger ORDER BY seq DESC LIMIT 1) AS seq,
            (SELECT entry_hash FROM audit_ledger ORDER BY seq DESC LIMIT 1) AS entry_hash,
            COUNT(*)::text AS count
       FROM audit_ledger`,
  );
  const anchors = await q<{ count: string; latest: string | null }>(
    `SELECT COUNT(*)::text AS count, MAX(anchor_date)::text AS latest FROM ledger_anchors`,
  );
  // Cheap liveness check over the newest window; full walks are verifyChain().
  const headSeq = head[0]?.seq != null ? Number(head[0].seq) : null;
  const tailFrom = headSeq != null ? Math.max(1, headSeq - 99) : 1;
  const tailCheck = await verifyChain({ fromSeq: tailFrom, limit: 100 });
  return {
    entryCount: parseInt(head[0]?.count ?? "0", 10),
    headHash: head[0]?.entry_hash ?? null,
    headSeq,
    genesisHash: GENESIS_HASH,
    anchorCount: parseInt(anchors[0]?.count ?? "0", 10),
    latestAnchorDate: anchors[0]?.latest ?? null,
    tailCheck,
  };
}
