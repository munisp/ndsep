/**
 * NDSEP CQRS Command Bus
 * Dispatches domain commands to registered handlers and records events.
 */
import { appendEvent, type DomainEvent, type AggregateType } from "../eventstore";
import { logger } from "../logger";
import crypto from "crypto";

// ── Command Types ────────────────────────────────────────────────────────────

export interface Command {
  type: string;
  aggregateType: AggregateType;
  aggregateId: string;
  payload: Record<string, unknown>;
  metadata: {
    userId: number;
    correlationId?: string;
    source?: string;
  };
}

export interface CommandResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

type CommandHandler = (cmd: Command) => Promise<CommandResult>;

// ── Registry ─────────────────────────────────────────────────────────────────

const handlers = new Map<string, CommandHandler>();

export function registerCommand(type: string, handler: CommandHandler): void {
  handlers.set(type, handler);
  logger.debug({ command: type }, "CQRS command registered");
}

export async function dispatch(cmd: Command): Promise<CommandResult> {
  const handler = handlers.get(cmd.type);
  if (!handler) {
    logger.warn({ command: cmd.type }, "No handler registered for command");
    return { success: false, error: `No handler for command: ${cmd.type}` };
  }

  const correlationId = cmd.metadata.correlationId ?? crypto.randomUUID();
  try {
    const result = await handler(cmd);

    // Record the command as a domain event in the event store
    const event: DomainEvent = {
      aggregateType: cmd.aggregateType,
      aggregateId: cmd.aggregateId,
      eventType: `${cmd.type}.executed`,
      version: Date.now(), // Using timestamp as version for simplicity
      payload: { ...cmd.payload, result: result.success },
      metadata: {
        userId: cmd.metadata.userId,
        correlationId,
        source: cmd.metadata.source ?? "command-bus",
      },
    };

    appendEvent(event).catch((e: unknown) => {
      logger.debug({ err: e instanceof Error ? e.message : String(e) }, "Event store append failed (fire-and-forget)");
    });

    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ command: cmd.type, err: msg }, "Command execution failed");
    return { success: false, error: msg };
  }
}

// ── Pre-registered Domain Commands ───────────────────────────────────────────

registerCommand("enforcement.create", async (cmd) => {
  logger.info({ caseId: cmd.aggregateId }, "CQRS: enforcement.create dispatched");
  return { success: true, eventId: crypto.randomUUID() };
});

registerCommand("enforcement.escalate", async (cmd) => {
  logger.info({ caseId: cmd.aggregateId, to: cmd.payload.targetStatus }, "CQRS: enforcement.escalate dispatched");
  return { success: true, eventId: crypto.randomUUID() };
});

registerCommand("penalty.issue", async (cmd) => {
  logger.info({ penaltyId: cmd.aggregateId, amount: cmd.payload.amount }, "CQRS: penalty.issue dispatched");
  return { success: true, eventId: crypto.randomUUID() };
});

registerCommand("breach.report", async (cmd) => {
  logger.info({ breachId: cmd.aggregateId, severity: cmd.payload.severity }, "CQRS: breach.report dispatched");
  return { success: true, eventId: crypto.randomUUID() };
});

registerCommand("breach.notify-ndpc", async (cmd) => {
  logger.info({ breachId: cmd.aggregateId }, "CQRS: breach.notify-ndpc dispatched");
  return { success: true, eventId: crypto.randomUUID() };
});

registerCommand("transfer.approve", async (cmd) => {
  logger.info({ transferId: cmd.aggregateId }, "CQRS: transfer.approve dispatched");
  return { success: true, eventId: crypto.randomUUID() };
});

registerCommand("audit.start", async (cmd) => {
  logger.info({ auditId: cmd.aggregateId, orgId: cmd.payload.orgId }, "CQRS: audit.start dispatched");
  return { success: true, eventId: crypto.randomUUID() };
});

registerCommand("dsar.fulfill", async (cmd) => {
  logger.info({ dsarId: cmd.aggregateId }, "CQRS: dsar.fulfill dispatched");
  return { success: true, eventId: crypto.randomUUID() };
});

registerCommand("consent.revoke", async (cmd) => {
  logger.info({ consentId: cmd.aggregateId, subject: cmd.payload.subjectEmail }, "CQRS: consent.revoke dispatched");
  return { success: true, eventId: crypto.randomUUID() };
});

registerCommand("dpia.submit", async (cmd) => {
  logger.info({ dpiaId: cmd.aggregateId }, "CQRS: dpia.submit dispatched");
  return { success: true, eventId: crypto.randomUUID() };
});
