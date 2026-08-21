/**
 * NDSEP Event Store — Append-only event log for CQRS/Event Sourcing
 *
 * Every compliance-critical state change is recorded as an immutable event.
 * Events are projected into read models (materialized views) for fast queries.
 * Fluvio streams provide real-time event distribution to subscribers.
 */
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";
import crypto from "crypto";

// ── Event Types ─────────────────────────────────────────────────────────────

export type DomainEvent = {
  id?: string;
  aggregateType: AggregateType;
  aggregateId: string;
  eventType: string;
  version: number;
  payload: Record<string, unknown>;
  metadata: EventMetadata;
  timestamp?: Date;
};

export type EventMetadata = {
  userId?: number;
  correlationId: string;
  causationId?: string;
  source: string;
  ipAddress?: string;
  userAgent?: string;
};

export type AggregateType =
  | "Organization"
  | "EnforcementCase"
  | "BreachIncident"
  | "Penalty"
  | "ComplianceAudit"
  | "DataTransfer"
  | "DPOAppointment"
  | "DPIA"
  | "ConsentRecord"
  | "DSAR"
  | "CitizenRequest"
  | "KYCRecord"
  | "Certificate"
  | "ThreatEvent"
  | "NetworkCapture";

// ── Event Store Schema (created via migration) ──────────────────────────────

const EVENT_STORE_DDL = `
CREATE TABLE IF NOT EXISTS event_store (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  version INTEGER NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  hash VARCHAR(64) NOT NULL,
  prev_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(aggregate_type, aggregate_id, version)
);

CREATE INDEX IF NOT EXISTS idx_event_store_aggregate
  ON event_store (aggregate_type, aggregate_id, version);
CREATE INDEX IF NOT EXISTS idx_event_store_type
  ON event_store (event_type);
CREATE INDEX IF NOT EXISTS idx_event_store_created
  ON event_store (created_at DESC);
`;

const SNAPSHOT_DDL = `
CREATE TABLE IF NOT EXISTS event_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_id VARCHAR(128) NOT NULL,
  version INTEGER NOT NULL,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(aggregate_type, aggregate_id)
);
`;

const PROJECTION_DDL = `
CREATE TABLE IF NOT EXISTS event_projections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projection_name VARCHAR(128) NOT NULL UNIQUE,
  last_event_id UUID,
  last_processed_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

// ── Initialize Event Store ──────────────────────────────────────────────────

export async function initEventStore(): Promise<void> {
  const db = (await getDb())!;
  try {
    await db.execute(sql.raw(EVENT_STORE_DDL));
    await db.execute(sql.raw(SNAPSHOT_DDL));
    await db.execute(sql.raw(PROJECTION_DDL));
    logger.info("Event store initialized");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg }, "Event store init (tables may already exist)");
  }
}

// ── Hash Chain ──────────────────────────────────────────────────────────────

function computeHash(event: DomainEvent, prevHash: string | null): string {
  const data = JSON.stringify({
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    version: event.version,
    payload: event.payload,
    prevHash,
  });
  return crypto.createHash("sha256").update(data).digest("hex");
}

// ── Append Event ────────────────────────────────────────────────────────────

export async function appendEvent(event: DomainEvent): Promise<string> {
  const db = (await getDb())!;

  // Get previous hash for chain integrity
  const prev = await db.execute(sql`
    SELECT hash FROM event_store
    WHERE aggregate_type = ${event.aggregateType}
      AND aggregate_id = ${event.aggregateId}
    ORDER BY version DESC LIMIT 1
  `);
  const prevHash = (prev.rows[0] as { hash?: string } | undefined)?.hash ?? null;
  const hash = computeHash(event, prevHash);

  const result = await db.execute(sql`
    INSERT INTO event_store (aggregate_type, aggregate_id, event_type, version, payload, metadata, hash, prev_hash)
    VALUES (
      ${event.aggregateType},
      ${event.aggregateId},
      ${event.eventType},
      ${event.version},
      ${JSON.stringify(event.payload)}::jsonb,
      ${JSON.stringify(event.metadata)}::jsonb,
      ${hash},
      ${prevHash}
    )
    RETURNING id
  `);

  const eventId = String((result.rows[0] as { id: string }).id);
  logger.debug({ eventId, type: event.eventType, aggregate: event.aggregateId }, "Event appended");
  return eventId;
}

// ── Read Events ─────────────────────────────────────────────────────────────

export async function getEvents(
  aggregateType: AggregateType,
  aggregateId: string,
  afterVersion = 0,
): Promise<StoredEvent[]> {
  const db = (await getDb())!;
  const result = await db.execute(sql`
    SELECT id, aggregate_type, aggregate_id, event_type, version, payload, metadata, hash, prev_hash, created_at
    FROM event_store
    WHERE aggregate_type = ${aggregateType}
      AND aggregate_id = ${aggregateId}
      AND version > ${afterVersion}
    ORDER BY version ASC
  `);
  return result.rows as StoredEvent[];
}

export type StoredEvent = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  version: number;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  hash: string;
  prev_hash: string | null;
  created_at: Date;
};

export async function getEventsByType(eventType: string, limit = 100): Promise<StoredEvent[]> {
  const db = (await getDb())!;
  const result = await db.execute(sql`
    SELECT * FROM event_store
    WHERE event_type = ${eventType}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return result.rows as StoredEvent[];
}

export async function getAllEvents(afterId?: string, limit = 500): Promise<StoredEvent[]> {
  const db = (await getDb())!;
  if (afterId) {
    const result = await db.execute(sql`
      SELECT * FROM event_store
      WHERE created_at > (SELECT created_at FROM event_store WHERE id = ${afterId}::uuid)
      ORDER BY created_at ASC
      LIMIT ${limit}
    `);
    return result.rows as StoredEvent[];
  }
  const result = await db.execute(sql`
    SELECT * FROM event_store ORDER BY created_at ASC LIMIT ${limit}
  `);
  return result.rows as StoredEvent[];
}

// ── Verify Chain Integrity ──────────────────────────────────────────────────

export async function verifyChain(
  aggregateType: AggregateType,
  aggregateId: string,
): Promise<{ valid: boolean; brokenAt?: number }> {
  const events = await getEvents(aggregateType, aggregateId);
  let prevHash: string | null = null;

  for (const event of events) {
    const expected = computeHash(
      {
        aggregateType: event.aggregate_type as AggregateType,
        aggregateId: event.aggregate_id,
        eventType: event.event_type,
        version: event.version,
        payload: event.payload,
        metadata: event.metadata as EventMetadata,
      },
      prevHash,
    );
    if (expected !== event.hash) {
      return { valid: false, brokenAt: event.version };
    }
    prevHash = event.hash;
  }
  return { valid: true };
}

// ── Snapshots ───────────────────────────────────────────────────────────────

export async function saveSnapshot(
  aggregateType: AggregateType,
  aggregateId: string,
  version: number,
  state: Record<string, unknown>,
): Promise<void> {
  const db = (await getDb())!;
  await db.execute(sql`
    INSERT INTO event_snapshots (aggregate_type, aggregate_id, version, state)
    VALUES (${aggregateType}, ${aggregateId}, ${version}, ${JSON.stringify(state)}::jsonb)
    ON CONFLICT (aggregate_type, aggregate_id)
    DO UPDATE SET version = ${version}, state = ${JSON.stringify(state)}::jsonb, created_at = NOW()
  `);
}

export async function getSnapshot(
  aggregateType: AggregateType,
  aggregateId: string,
): Promise<{ version: number; state: Record<string, unknown> } | null> {
  const db = (await getDb())!;
  const result = await db.execute(sql`
    SELECT version, state FROM event_snapshots
    WHERE aggregate_type = ${aggregateType} AND aggregate_id = ${aggregateId}
  `);
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as { version: number; state: Record<string, unknown> };
  return { version: row.version, state: row.state };
}

// ── Event Statistics ────────────────────────────────────────────────────────

export async function getEventStats(): Promise<{
  totalEvents: number;
  aggregateTypes: { type: string; count: number }[];
  recentEvents: StoredEvent[];
  eventsPerHour: { hour: string; count: number }[];
}> {
  const db = (await getDb())!;

  const totalResult = await db.execute(sql`SELECT COUNT(*)::int as count FROM event_store`);
  const totalEvents = (totalResult.rows[0] as { count: number })?.count ?? 0;

  const typeResult = await db.execute(sql`
    SELECT aggregate_type as type, COUNT(*)::int as count
    FROM event_store GROUP BY aggregate_type ORDER BY count DESC
  `);

  const recentResult = await db.execute(sql`
    SELECT * FROM event_store ORDER BY created_at DESC LIMIT 20
  `);

  const hourResult = await db.execute(sql`
    SELECT date_trunc('hour', created_at)::text as hour, COUNT(*)::int as count
    FROM event_store
    WHERE created_at > NOW() - INTERVAL '24 hours'
    GROUP BY 1 ORDER BY 1
  `);

  return {
    totalEvents,
    aggregateTypes: typeResult.rows as { type: string; count: number }[],
    recentEvents: recentResult.rows as StoredEvent[],
    eventsPerHour: hourResult.rows as { hour: string; count: number }[],
  };
}
