/**
 * NDSEP Temporal Client — Cloud-Aware
 *
 * Supports both self-hosted Temporal (Docker Compose) and Temporal Cloud.
 * Requires the official Temporal SDK and a reachable Temporal cluster. Workflow
 * starts fail explicitly when either prerequisite is unavailable.
 *
 * Environment variables:
 *   TEMPORAL_ADDRESS      gRPC address (default: localhost:7233)
 *                         For Temporal Cloud: <namespace>.tmprl.cloud:7233
 *   TEMPORAL_NAMESPACE    Temporal namespace (default: default)
 *                         For Temporal Cloud: <account-id>.<region>
 *   TEMPORAL_TLS_CERT     PEM-encoded client certificate (Temporal Cloud only)
 *   TEMPORAL_TLS_KEY      PEM-encoded client private key (Temporal Cloud only)
 *   TEMPORAL_API_KEY      Temporal Cloud API key (alternative to mTLS)
 *   TEMPORAL_TASK_QUEUE   Default task queue (default: ndsep-main)
 *
 * Usage:
 *   import { startWorkflow, describeWorkflow, listWorkflows } from "./temporal";
 *
 *   // Start a workflow
 *   const { workflowId, runId } = await startWorkflow("penalty_enforcement", {
 *     workflowId: `penalty-${penaltyId}`,
 *     input: { penaltyId, orgId, amount },
 *   });
 *
 *   // Describe a running workflow
 *   const info = await describeWorkflow(workflowId);
 *
 *   // List recent workflows
 *   const runs = await listWorkflows({ pageSize: 20 });
 */

import { logger } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";
const TEMPORAL_TLS_CERT = process.env.TEMPORAL_TLS_CERT;
const TEMPORAL_TLS_KEY = process.env.TEMPORAL_TLS_KEY;
const TEMPORAL_API_KEY = process.env.TEMPORAL_API_KEY;
const TEMPORAL_TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "ndsep-main";

// Detect Temporal Cloud by checking if address ends with .tmprl.cloud
const IS_TEMPORAL_CLOUD =
  TEMPORAL_ADDRESS.includes(".tmprl.cloud") ||
  !!(TEMPORAL_TLS_CERT && TEMPORAL_TLS_KEY) ||
  !!TEMPORAL_API_KEY;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface WorkflowStartOptions {
  /** Unique workflow ID — idempotency key */
  workflowId: string;
  /** Workflow type / function name registered on the worker */
  workflowType?: string;
  /** Serialisable input passed to the workflow */
  input?: Record<string, unknown>;
  /** Task queue (defaults to TEMPORAL_TASK_QUEUE env var) */
  taskQueue?: string;
  /** Execution timeout in seconds (default: 3600) */
  executionTimeoutSeconds?: number;
}

export interface WorkflowInfo {
  workflowId: string;
  runId?: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TERMINATED" | "TIMED_OUT" | "UNKNOWN";
  workflowType?: string;
  taskQueue?: string;
  startTime?: string;
  closeTime?: string;
  namespace: string;
}

export interface WorkflowStartResult {
  ok: boolean;
  workflowId: string;
  runId?: string;
  namespace: string;
  taskQueue: string;
  address: string;
  isCloud: boolean;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy SDK loader — avoids hard dependency when @temporalio/client is absent
// ─────────────────────────────────────────────────────────────────────────────
let _Client: typeof import("@temporalio/client").Client | null = null;
let _Connection: typeof import("@temporalio/client").Connection | null = null;
let _sdkLoaded = false;
let _sdkAvailable = false;

async function loadTemporalSdk(): Promise<boolean> {
  if (_sdkLoaded) return _sdkAvailable;
  _sdkLoaded = true;
  try {
    const mod = await import("@temporalio/client");
    _Client = mod.Client;
    _Connection = mod.Connection;
    _sdkAvailable = true;
    logger.info(
      { address: TEMPORAL_ADDRESS, namespace: TEMPORAL_NAMESPACE, isCloud: IS_TEMPORAL_CLOUD },
      "[Temporal] SDK loaded"
    );
  } catch {
    _sdkAvailable = false;
    logger.error("[Temporal] @temporalio/client is not installed; workflow starts are unavailable");
  }
  return _sdkAvailable;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection factory (cached per process)
// ─────────────────────────────────────────────────────────────────────────────

let _connection: unknown = null;

let _client: unknown = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTemporalClient(): Promise<any> {
  if (_client) return _client;
  const sdkAvailable = await loadTemporalSdk();
  if (!sdkAvailable || !_Connection || !_Client) return null;

  try {
    const connectionOptions: Record<string, unknown> = {
      address: TEMPORAL_ADDRESS,
    };

    if (IS_TEMPORAL_CLOUD) {
      if (TEMPORAL_TLS_CERT && TEMPORAL_TLS_KEY) {
        // mTLS — Temporal Cloud certificate-based auth
        connectionOptions.tls = {
          clientCertPair: {
            crt: Buffer.from(TEMPORAL_TLS_CERT),
            key: Buffer.from(TEMPORAL_TLS_KEY),
          },
        };
      } else if (TEMPORAL_API_KEY) {
        // API key auth — newer Temporal Cloud auth method
        connectionOptions.apiKey = TEMPORAL_API_KEY;
        connectionOptions.tls = {};
      }
    }

    _connection = await _Connection.connect(connectionOptions as Parameters<typeof _Connection.connect>[0]);
    _client = new _Client({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: _connection as any,
      namespace: TEMPORAL_NAMESPACE,
    });

    logger.info(
      { address: TEMPORAL_ADDRESS, namespace: TEMPORAL_NAMESPACE, isCloud: IS_TEMPORAL_CLOUD },
      "[Temporal] Client connected"
    );
    return _client;
  } catch (err) {
    logger.error({ err, address: TEMPORAL_ADDRESS }, "[Temporal] Could not connect");
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start a Temporal workflow through the official gRPC SDK.
 */
export async function startWorkflow(
  workflowType: string,
  options: WorkflowStartOptions
): Promise<WorkflowStartResult> {
  const client = await getTemporalClient();

  if (!client) {
    throw new Error("Temporal SDK is unavailable; workflow start cannot be acknowledged");
  }
  try {
      const handle = await client.workflow.start(workflowType, {
        workflowId: options.workflowId,
        taskQueue: options.taskQueue ?? TEMPORAL_TASK_QUEUE,
        args: options.input ? [options.input] : [],
        workflowExecutionTimeout: `${options.executionTimeoutSeconds ?? 3600}s`,
      });
      logger.info(
        { workflowId: options.workflowId, runId: handle.firstExecutionRunId, workflowType },
        "[Temporal] Workflow started via SDK"
      );
      return {
        ok: true,
        workflowId: options.workflowId,
        runId: handle.firstExecutionRunId,
        namespace: TEMPORAL_NAMESPACE,
        taskQueue: options.taskQueue ?? TEMPORAL_TASK_QUEUE,
        address: TEMPORAL_ADDRESS,
        isCloud: IS_TEMPORAL_CLOUD,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ err, workflowId: options.workflowId }, "[Temporal] Failed to start workflow via SDK");
      throw new Error(`Temporal workflow ${options.workflowId} was not started: ${error}`, { cause: err });
    }
}

/**
 * Describe a workflow execution by workflowId (and optional runId).
 * Returns null if not found or Temporal is unreachable.
 */
export async function describeWorkflow(
  workflowId: string,
  runId?: string
): Promise<WorkflowInfo | null> {
  const client = await getTemporalClient();
  if (!client) throw new Error("Temporal SDK is unavailable; workflow description cannot be determined");

  try {
    const handle = client.workflow.getHandle(workflowId, runId);
    const desc = await handle.describe();
    const statusName = desc.status.name as string;
    return {
      workflowId,
      runId: desc.runId,
      status: (statusName as WorkflowInfo["status"]) ?? "UNKNOWN",
      workflowType: desc.type,
      taskQueue: desc.taskQueue,
      startTime: desc.startTime?.toISOString(),
      closeTime: desc.closeTime?.toISOString(),
      namespace: TEMPORAL_NAMESPACE,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, workflowId }, "[Temporal] Workflow description failed");
    throw new Error(`Temporal workflow ${workflowId} could not be described: ${error}`, { cause: err });
  }
}

/**
 * List recent workflow executions in the namespace.
 */
export async function listWorkflows(options?: {
  pageSize?: number;
  query?: string;
}): Promise<WorkflowInfo[]> {
  const client = await getTemporalClient();
  if (!client) throw new Error("Temporal SDK is unavailable; workflow list cannot be determined");

  try {
    const results: WorkflowInfo[] = [];
    const iter = client.workflow.list({
      pageSize: options?.pageSize ?? 20,
      query: options?.query,
    });
    for await (const wf of iter) {
      results.push({
        workflowId: wf.workflowId,
        runId: wf.runId,
        status: (wf.status.name as WorkflowInfo["status"]) ?? "UNKNOWN",
        workflowType: wf.type,
        taskQueue: wf.taskQueue,
        startTime: wf.startTime?.toISOString(),
        closeTime: wf.closeTime?.toISOString(),
        namespace: TEMPORAL_NAMESPACE,
      });
      if (results.length >= (options?.pageSize ?? 20)) break;
    }
    return results;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[Temporal] Workflow listing failed");
    throw new Error(`Temporal workflows could not be listed: ${error}`, { cause: err });
  }
}

/**
 * Returns Temporal connection metadata for health checks and UI display.
 */
export function getTemporalConfig(): {
  address: string;
  namespace: string;
  taskQueue: string;
  isCloud: boolean;
  authMethod: "mtls" | "apikey" | "none";
  sdkLoaded: boolean;
} {
  return {
    address: TEMPORAL_ADDRESS,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TEMPORAL_TASK_QUEUE,
    isCloud: IS_TEMPORAL_CLOUD,
    authMethod: TEMPORAL_TLS_CERT ? "mtls" : TEMPORAL_API_KEY ? "apikey" : "none",
    sdkLoaded: _sdkAvailable,
  };
}

/**
 * Smoke-test: attempts to list workflows and returns connection health.
 */
export async function temporalSmokeTest(): Promise<{
  ok: boolean;
  address: string;
  namespace: string;
  isCloud: boolean;
  authMethod: string;
  workflowCount?: number;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  const config = getTemporalConfig();

  try {
    const workflows = await listWorkflows({ pageSize: 5 });
    const latencyMs = Date.now() - start;
    logger.info({ address: TEMPORAL_ADDRESS, namespace: TEMPORAL_NAMESPACE, latencyMs }, "[Temporal] Smoke test PASSED");
    return {
      ok: true,
      address: config.address,
      namespace: config.namespace,
      isCloud: config.isCloud,
      authMethod: config.authMethod,
      workflowCount: workflows.length,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ err, address: TEMPORAL_ADDRESS }, "[Temporal] Smoke test FAILED");
    return {
      ok: false,
      address: config.address,
      namespace: config.namespace,
      isCloud: config.isCloud,
      authMethod: config.authMethod,
      latencyMs,
      error,
    };
  }
}
