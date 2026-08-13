/**
 * Temporal Worker Registration — NDSEP
 * Registers all workflow and activity implementations with the Temporal server.
 *
 * Prerequisites:
 *   1. Run a Temporal server: docker run --rm -p 7233:7233 temporalio/auto-setup:latest
 *   2. Install deps: pnpm add @temporalio/worker @temporalio/workflow @temporalio/activity @temporalio/client
 *   3. Start this worker: npx ts-node workers/temporal/worker.ts
 *
 * Environment variables:
 *   TEMPORAL_ADDRESS   — default: localhost:7233
 *   TEMPORAL_NAMESPACE — default: default
 *   TEMPORAL_TLS_CERT  — PEM client certificate (Temporal Cloud mTLS)
 *   TEMPORAL_TLS_KEY   — PEM client private key  (Temporal Cloud mTLS)
 *   TEMPORAL_API_KEY   — Temporal Cloud API key (alternative to mTLS)
 */

import { logger } from "../../server/logger";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";
const TEMPORAL_TLS_CERT = process.env.TEMPORAL_TLS_CERT;
const TEMPORAL_TLS_KEY = process.env.TEMPORAL_TLS_KEY;
const TEMPORAL_API_KEY = process.env.TEMPORAL_API_KEY;

const IS_TEMPORAL_CLOUD =
  TEMPORAL_ADDRESS.includes(".tmprl.cloud") ||
  !!(TEMPORAL_TLS_CERT && TEMPORAL_TLS_KEY) ||
  !!TEMPORAL_API_KEY;

export const temporalConfig = {
  address: TEMPORAL_ADDRESS,
  namespace: TEMPORAL_NAMESPACE,
  taskQueues: {
    accreditation: "ndsep-accreditation",
    breach: "ndsep-breach",
    car: "ndsep-car",
    dsar: "ndsep-dsar",
  },
};

/**
 * Start the Temporal worker.
 * Dynamically imports @temporalio/worker. Missing runtime dependencies are a
 * startup failure because the platform must not claim workflows are running.
 */
export async function startTemporalWorker(): Promise<void> {
  logger.info(
    { address: TEMPORAL_ADDRESS, namespace: TEMPORAL_NAMESPACE, isCloud: IS_TEMPORAL_CLOUD },
    "[Temporal] Starting worker"
  );

  let Worker: typeof import("@temporalio/worker").Worker;
  let NativeConnection: typeof import("@temporalio/worker").NativeConnection;
  try {
    const mod = await import("@temporalio/worker");
    Worker = mod.Worker;
    NativeConnection = mod.NativeConnection;
  } catch (error) {
    throw new Error(`@temporalio/worker is required to start Temporal workflows: ${error instanceof Error ? error.message : String(error)}`);
  }

  const connectionOptions: Record<string, unknown> = { address: TEMPORAL_ADDRESS };
  if (IS_TEMPORAL_CLOUD) {
    if (TEMPORAL_TLS_CERT && TEMPORAL_TLS_KEY) {
      connectionOptions.tls = {
        clientCertPair: {
          crt: Buffer.from(TEMPORAL_TLS_CERT),
          key: Buffer.from(TEMPORAL_TLS_KEY),
        },
      };
    } else if (TEMPORAL_API_KEY) {
      connectionOptions.apiKey = TEMPORAL_API_KEY;
      connectionOptions.tls = {};
    }
  }

  const connection = await NativeConnection.connect(
    connectionOptions as Parameters<typeof NativeConnection.connect>[0]
  );

  const [accreditationActivities, breachActivities] = await Promise.all([
    import("./activities/accreditation"),
    import("./activities/breachNotification"),
  ]);
  const workflowsPath = require.resolve("./workflows");
  const workers = await Promise.all([
    Worker.create({ workflowsPath, taskQueue: temporalConfig.taskQueues.accreditation, connection, namespace: TEMPORAL_NAMESPACE, activities: accreditationActivities }),
    Worker.create({ workflowsPath, taskQueue: temporalConfig.taskQueues.breach, connection, namespace: TEMPORAL_NAMESPACE, activities: breachActivities }),
  ]);

  logger.info(
    { taskQueues: [temporalConfig.taskQueues.accreditation, temporalConfig.taskQueues.breach], namespace: TEMPORAL_NAMESPACE },
    "[Temporal] Workers started — listening for durable workflow tasks"
  );
  await Promise.all(workers.map((worker) => worker.run()));
}

/**
 * Temporal client helper for starting workflows.
 * Dynamically imports @temporalio/client and rejects when the server cannot be reached.
 */
export async function getTemporalClient() {
  try {
    const { Client, Connection } = await import("@temporalio/client");

    const connectionOptions: Record<string, unknown> = { address: TEMPORAL_ADDRESS };
    if (IS_TEMPORAL_CLOUD) {
      if (TEMPORAL_TLS_CERT && TEMPORAL_TLS_KEY) {
        connectionOptions.tls = {
          clientCertPair: {
            crt: Buffer.from(TEMPORAL_TLS_CERT),
            key: Buffer.from(TEMPORAL_TLS_KEY),
          },
        };
      } else if (TEMPORAL_API_KEY) {
        connectionOptions.apiKey = TEMPORAL_API_KEY;
        connectionOptions.tls = {};
      }
    }

    const connection = await Connection.connect(
      connectionOptions as Parameters<typeof Connection.connect>[0]
    );
    return new Client({ connection, namespace: TEMPORAL_NAMESPACE });
  } catch (error) {
    throw new Error(`Temporal client is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Start an accreditation workflow.
 * Rejects when Temporal is not available.
 */
export async function startAccreditationWorkflow(params: {
  applicationId: number;
  dpcoOrgId: number;
  applicantEmail: string;
}): Promise<{ workflowId: string }> {
  const client = await getTemporalClient();

  const workflowId = `accreditation-${params.applicationId}`;
  const handle = await client.workflow.start("accreditationWorkflow", {
    taskQueue: temporalConfig.taskQueues.accreditation,
    workflowId,
    args: [{
      applicationId: params.applicationId,
      dpcoOrgId: params.dpcoOrgId,
      applicantEmail: params.applicantEmail,
      submittedAt: new Date().toISOString(),
    }],
  });
  return { workflowId: handle.workflowId };
}

/**
 * Start a breach notification workflow.
 * Rejects when Temporal is not available.
 */
export async function startBreachNotificationWorkflow(params: {
  breachId: number;
  orgId: number;
  dpoEmail: string;
  ceoEmail: string;
  severity: "low" | "medium" | "high" | "critical";
  estimatedAffectedRecords: number;
}): Promise<{ workflowId: string }> {
  const client = await getTemporalClient();

  const workflowId = `breach-notification-${params.breachId}`;
  const handle = await client.workflow.start("breachNotificationWorkflow", {
    taskQueue: temporalConfig.taskQueues.breach,
    workflowId,
    args: [{
      breachId: params.breachId,
      orgId: params.orgId,
      dpoEmail: params.dpoEmail,
      ceoEmail: params.ceoEmail,
      severity: params.severity,
      estimatedAffectedRecords: params.estimatedAffectedRecords,
      detectedAt: new Date().toISOString(),
    }],
  });
  return { workflowId: handle.workflowId };
}

if (require.main === module) {
  startTemporalWorker().catch(console.error);
}
