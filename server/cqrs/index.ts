/**
 * NDSEP CQRS — Command/Query Responsibility Segregation
 *
 * Commands: Write operations that produce domain events
 * Queries: Read from materialized projections (fast, denormalized)
 * Projections: Subscribe to events and update read models
 */
import { appendEvent, type DomainEvent, type AggregateType, type EventMetadata, getEvents } from "../eventstore";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";
import crypto from "crypto";

// ── Command Bus ─────────────────────────────────────────────────────────────

type CommandHandler<T = unknown> = (cmd: T, meta: EventMetadata) => Promise<DomainEvent[]>;
const commandHandlers = new Map<string, CommandHandler>();

export function registerCommand<T>(name: string, handler: CommandHandler<T>): void {
  commandHandlers.set(name, handler as CommandHandler);
}

export async function dispatch<T>(commandName: string, payload: T, meta: EventMetadata): Promise<string[]> {
  const handler = commandHandlers.get(commandName);
  if (!handler) throw new Error(`Unknown command: ${commandName}`);

  const events = await handler(payload, meta);
  const ids: string[] = [];
  for (const event of events) {
    const id = await appendEvent(event);
    ids.push(id);
  }

  // Notify projections asynchronously
  for (const event of events) {
    runProjections(event).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error({ err: msg, eventType: event.eventType }, "Projection failed");
    });
  }

  return ids;
}

// ── Projection Engine ───────────────────────────────────────────────────────

type ProjectionHandler = (event: DomainEvent) => Promise<void>;
const projections = new Map<string, { eventTypes: string[]; handler: ProjectionHandler }>();

export function registerProjection(
  name: string,
  eventTypes: string[],
  handler: ProjectionHandler,
): void {
  projections.set(name, { eventTypes, handler });
}

async function runProjections(event: DomainEvent): Promise<void> {
  for (const [name, proj] of Array.from(projections.entries())) {
    if (proj.eventTypes.includes(event.eventType) || proj.eventTypes.includes("*")) {
      try {
        await proj.handler(event);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error({ err: msg, projection: name, eventType: event.eventType }, "Projection error");
      }
    }
  }
}

// ── Built-in Commands ───────────────────────────────────────────────────────

// Helper to get next version for an aggregate
async function nextVersion(aggregateType: AggregateType, aggregateId: string): Promise<number> {
  const events = await getEvents(aggregateType, aggregateId);
  return events.length + 1;
}

// --- Enforcement Case Commands ---

type CreateEnforcementCmd = {
  orgId: number;
  orgName: string;
  caseType: string;
  severity: string;
  description: string;
};

registerCommand<CreateEnforcementCmd>("enforcement.create", async (cmd, meta) => {
  const caseId = crypto.randomUUID();
  return [{
    aggregateType: "EnforcementCase" as AggregateType,
    aggregateId: caseId,
    eventType: "EnforcementCaseCreated",
    version: 1,
    payload: { ...cmd, caseId, status: "open" },
    metadata: meta,
  }];
});

type IssuePenaltyCmd = {
  caseId: string;
  amount: number;
  currency: string;
  reason: string;
  deadline: string;
};

registerCommand<IssuePenaltyCmd>("penalty.issue", async (cmd, meta) => {
  const penaltyId = crypto.randomUUID();
  const version = await nextVersion("Penalty", penaltyId);
  return [{
    aggregateType: "Penalty" as AggregateType,
    aggregateId: penaltyId,
    eventType: "PenaltyIssued",
    version,
    payload: { ...cmd, penaltyId, status: "pending" },
    metadata: meta,
  }];
});

type ReportBreachCmd = {
  orgId: number;
  orgName: string;
  breachType: string;
  severity: string;
  affectedSubjects: number;
  description: string;
};

registerCommand<ReportBreachCmd>("breach.report", async (cmd, meta) => {
  const breachId = crypto.randomUUID();
  return [{
    aggregateType: "BreachIncident" as AggregateType,
    aggregateId: breachId,
    eventType: "BreachReported",
    version: 1,
    payload: {
      ...cmd,
      breachId,
      status: "reported",
      reportedAt: new Date().toISOString(),
      slaDeadline: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    },
    metadata: meta,
  }];
});

type ApproveTransferCmd = {
  transferId: string;
  sourceCountry: string;
  destCountry: string;
  dataCategories: string[];
  legalBasis: string;
};

registerCommand<ApproveTransferCmd>("transfer.approve", async (cmd, meta) => {
  const version = await nextVersion("DataTransfer", cmd.transferId);
  return [{
    aggregateType: "DataTransfer" as AggregateType,
    aggregateId: cmd.transferId,
    eventType: "TransferApproved",
    version,
    payload: { ...cmd, approvedAt: new Date().toISOString() },
    metadata: meta,
  }];
});

// --- Compliance Audit Commands ---

type StartAuditCmd = {
  orgId: number;
  orgName: string;
  auditType: string;
  scope: string[];
};

registerCommand<StartAuditCmd>("audit.start", async (cmd, meta) => {
  const auditId = crypto.randomUUID();
  return [{
    aggregateType: "ComplianceAudit" as AggregateType,
    aggregateId: auditId,
    eventType: "AuditStarted",
    version: 1,
    payload: { ...cmd, auditId, status: "in_progress", startedAt: new Date().toISOString() },
    metadata: meta,
  }];
});

// ── Built-in Projections ────────────────────────────────────────────────────

const COMPLIANCE_TIMELINE_DDL = `
CREATE TABLE IF NOT EXISTS compliance_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id INTEGER,
  org_name TEXT,
  event_type VARCHAR(128) NOT NULL,
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_id VARCHAR(128) NOT NULL,
  summary TEXT NOT NULL,
  severity VARCHAR(32),
  actor_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_timeline_org ON compliance_timeline (org_id, created_at DESC);
`;

const ENFORCEMENT_SUMMARY_DDL = `
CREATE TABLE IF NOT EXISTS enforcement_summary (
  org_id INTEGER PRIMARY KEY,
  org_name TEXT,
  open_cases INTEGER DEFAULT 0,
  total_penalties_ngn NUMERIC(15,2) DEFAULT 0,
  pending_penalties INTEGER DEFAULT 0,
  breaches_reported INTEGER DEFAULT 0,
  last_event_at TIMESTAMPTZ,
  compliance_score_impact REAL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

export async function initProjections(): Promise<void> {
  const db = (await getDb())!;
  try {
    await db.execute(sql.raw(COMPLIANCE_TIMELINE_DDL));
    await db.execute(sql.raw(ENFORCEMENT_SUMMARY_DDL));
    logger.info("CQRS projections initialized");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg }, "Projection init (tables may already exist)");
  }
}

// Timeline projection — feeds the compliance timeline read model
registerProjection("compliance-timeline", ["*"], async (event) => {
  const db = (await getDb())!;
  const orgId = (event.payload.orgId as number) ?? null;
  const orgName = (event.payload.orgName as string) ?? null;
  const summary = buildSummary(event);
  const severity = (event.payload.severity as string) ?? null;

  await db.execute(sql`
    INSERT INTO compliance_timeline (org_id, org_name, event_type, aggregate_type, aggregate_id, summary, severity, actor_id)
    VALUES (${orgId}, ${orgName}, ${event.eventType}, ${event.aggregateType}, ${event.aggregateId}, ${summary}, ${severity}, ${event.metadata.userId ?? null})
  `);
});

// Enforcement summary projection — materialized aggregate per org
registerProjection("enforcement-summary", [
  "EnforcementCaseCreated", "PenaltyIssued", "BreachReported",
], async (event) => {
  const db = (await getDb())!;
  const orgId = event.payload.orgId as number;
  if (!orgId) return;

  const orgName = (event.payload.orgName as string) ?? "Unknown";

  await db.execute(sql`
    INSERT INTO enforcement_summary (org_id, org_name, last_event_at, updated_at)
    VALUES (${orgId}, ${orgName}, NOW(), NOW())
    ON CONFLICT (org_id) DO UPDATE SET last_event_at = NOW(), updated_at = NOW()
  `);

  if (event.eventType === "EnforcementCaseCreated") {
    await db.execute(sql`
      UPDATE enforcement_summary SET open_cases = open_cases + 1 WHERE org_id = ${orgId}
    `);
  } else if (event.eventType === "PenaltyIssued") {
    const amount = Number(event.payload.amount) || 0;
    await db.execute(sql`
      UPDATE enforcement_summary
      SET pending_penalties = pending_penalties + 1,
          total_penalties_ngn = total_penalties_ngn + ${amount}
      WHERE org_id = ${orgId}
    `);
  } else if (event.eventType === "BreachReported") {
    await db.execute(sql`
      UPDATE enforcement_summary SET breaches_reported = breaches_reported + 1 WHERE org_id = ${orgId}
    `);
  }
});

function buildSummary(event: DomainEvent): string {
  switch (event.eventType) {
    case "EnforcementCaseCreated":
      return `Enforcement case opened: ${event.payload.caseType} (${event.payload.severity})`;
    case "PenaltyIssued":
      return `Penalty of NGN ${Number(event.payload.amount).toLocaleString()} issued: ${event.payload.reason}`;
    case "BreachReported":
      return `Data breach reported: ${event.payload.breachType}, ${event.payload.affectedSubjects} subjects affected`;
    case "TransferApproved":
      return `Cross-border transfer approved: ${event.payload.sourceCountry} → ${event.payload.destCountry}`;
    case "AuditStarted":
      return `Compliance audit started: ${event.payload.auditType}`;
    default:
      return `${event.eventType} on ${event.aggregateType}:${event.aggregateId}`;
  }
}
