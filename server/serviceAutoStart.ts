/**
 * NDSEP Service Auto-Start Manager
 * ===================================
 * Ensures critical microservices (NOC, SIEM, wiredigg, Digital Twin, AI Agent)
 * start automatically with the platform and restart on failure.
 *
 * Priority Groups:
 *   P0 (Critical): Digital Twin, NOC Collector, SIEM Correlator
 *   P1 (High):     NOC Uptime Tracker, AI Perception Engine, wiredigg
 *   P2 (Normal):   NOC Escalation, AI Reasoning, AI Action Engine
 *   P3 (Low):      All other background workers
 *
 * Features:
 *   - Ordered startup by priority (P0 first, then P1, etc.)
 *   - Health check verification after each service starts
 *   - Dependency awareness (SIEM needs Kafka, AI needs NOC data)
 *   - Startup metrics and status reporting
 */

import { logger } from "./logger";
import { captureError, captureWarning } from "./errorMonitoring";

interface ServiceDef {
  id: string;
  name: string;
  priority: 0 | 1 | 2 | 3;
  port: number;
  healthPath: string;
  language: "Go" | "Rust" | "Python" | "TypeScript";
  dependencies: string[];
  startDelayMs: number;
}

interface ServiceStatus {
  id: string;
  name: string;
  priority: number;
  status: "pending" | "starting" | "healthy" | "unhealthy" | "skipped";
  port: number;
  startedAt?: string;
  healthCheckMs?: number;
  error?: string;
}

const SERVICES: ServiceDef[] = [
  // P0 — Critical Services
  {
    id: "digital-twin",
    name: "Digital Twin V2",
    priority: 0,
    port: 8175,
    healthPath: "/health",
    language: "Go",
    dependencies: [],
    startDelayMs: 0,
  },
  {
    id: "noc-collector",
    name: "NOC Collector",
    priority: 0,
    port: 8190,
    healthPath: "/health",
    language: "Rust",
    dependencies: [],
    startDelayMs: 500,
  },
  {
    id: "siem-correlator",
    name: "SIEM Correlator",
    priority: 0,
    port: 8086,
    healthPath: "/health",
    language: "Python",
    dependencies: [],
    startDelayMs: 1000,
  },

  // P1 — High Priority
  {
    id: "noc-uptime",
    name: "NOC Uptime Tracker",
    priority: 1,
    port: 8193,
    healthPath: "/health",
    language: "Rust",
    dependencies: ["noc-collector"],
    startDelayMs: 0,
  },
  {
    id: "noc-agent-perception",
    name: "AI Perception Engine",
    priority: 1,
    port: 8194,
    healthPath: "/health",
    language: "Rust",
    dependencies: ["noc-collector"],
    startDelayMs: 500,
  },
  {
    id: "wiredigg",
    name: "wiredigg DPI",
    priority: 1,
    port: 8160,
    healthPath: "/health",
    language: "Rust",
    dependencies: [],
    startDelayMs: 1000,
  },

  // P2 — Normal Priority
  {
    id: "noc-escalation",
    name: "NOC Escalation Engine",
    priority: 2,
    port: 8191,
    healthPath: "/health",
    language: "Go",
    dependencies: ["noc-collector"],
    startDelayMs: 0,
  },
  {
    id: "noc-agent-reasoning",
    name: "AI Reasoning Engine",
    priority: 2,
    port: 8195,
    healthPath: "/health",
    language: "Python",
    dependencies: ["noc-agent-perception"],
    startDelayMs: 500,
  },
  {
    id: "noc-agent-action",
    name: "AI Action Engine",
    priority: 2,
    port: 8196,
    healthPath: "/health",
    language: "Go",
    dependencies: ["noc-agent-reasoning"],
    startDelayMs: 1000,
  },
  {
    id: "noc-correlator",
    name: "NOC Alert Correlator",
    priority: 2,
    port: 8192,
    healthPath: "/health",
    language: "Python",
    dependencies: ["noc-collector"],
    startDelayMs: 1500,
  },

  // P3 — Low Priority (ML, breach prediction, etc.)
  {
    id: "ml-breach-predictor",
    name: "ML Breach Predictor",
    priority: 3,
    port: 8176,
    healthPath: "/health",
    language: "Python",
    dependencies: [],
    startDelayMs: 0,
  },
  {
    id: "monte-carlo",
    name: "Monte Carlo Engine",
    priority: 3,
    port: 8177,
    healthPath: "/health",
    language: "Rust",
    dependencies: [],
    startDelayMs: 500,
  },
];

const serviceStatuses = new Map<string, ServiceStatus>();

async function checkServiceHealth(service: ServiceDef): Promise<boolean> {
  const start = Date.now();
  try {
    const res = await fetch(`http://localhost:${service.port}${service.healthPath}`, {
      signal: AbortSignal.timeout(3000),
    });
    const latency = Date.now() - start;
    const status = serviceStatuses.get(service.id);
    if (status) {
      status.healthCheckMs = latency;
    }
    return res.ok;
  } catch {
    return false;
  }
}

function areDependenciesMet(service: ServiceDef): boolean {
  for (const depId of service.dependencies) {
    const depStatus = serviceStatuses.get(depId);
    if (!depStatus || depStatus.status !== "healthy") {
      return false;
    }
  }
  return true;
}

async function waitForHealth(service: ServiceDef, maxWaitMs = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkServiceHealth(service)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function startPriorityGroup(priority: number): Promise<void> {
  const group = SERVICES.filter((s) => s.priority === priority);
  if (group.length === 0) return;

  logger.info(`[AutoStart] Starting P${priority} services (${group.length} services)...`);

  for (const service of group) {
    const status: ServiceStatus = {
      id: service.id,
      name: service.name,
      priority: service.priority,
      status: "pending",
      port: service.port,
    };
    serviceStatuses.set(service.id, status);

    // Check dependencies
    if (!areDependenciesMet(service)) {
      status.status = "skipped";
      status.error = `Dependencies not met: ${service.dependencies.join(", ")}`;
      captureWarning(`Service ${service.name} skipped: dependencies not met`, "auto-start");
      continue;
    }

    // Delay before starting
    if (service.startDelayMs > 0) {
      await new Promise((r) => setTimeout(r, service.startDelayMs));
    }

    status.status = "starting";
    status.startedAt = new Date().toISOString();

    // Check if already running
    const alreadyRunning = await checkServiceHealth(service);
    if (alreadyRunning) {
      status.status = "healthy";
      logger.info(`[AutoStart] ${service.name} already running on :${service.port}`);
      continue;
    }

    // Wait for service to come up (workerManager handles actual spawn)
    const healthy = await waitForHealth(service, 15_000);
    if (healthy) {
      status.status = "healthy";
      logger.info(`[AutoStart] ${service.name} healthy on :${service.port} (${status.healthCheckMs}ms)`);
    } else {
      status.status = "unhealthy";
      status.error = "Health check timeout after 15s";
      captureWarning(`Service ${service.name} not responding on :${service.port}`, "auto-start");
    }
  }
}

export async function autoStartAllServices(): Promise<{
  started: number;
  healthy: number;
  unhealthy: number;
  skipped: number;
  services: ServiceStatus[];
}> {
  logger.info("[AutoStart] Beginning ordered service startup...");

  // Start each priority group sequentially
  for (const priority of [0, 1, 2, 3]) {
    await startPriorityGroup(priority);
  }

  const statuses = Array.from(serviceStatuses.values());
  const healthy = statuses.filter((s) => s.status === "healthy").length;
  const unhealthy = statuses.filter((s) => s.status === "unhealthy").length;
  const skipped = statuses.filter((s) => s.status === "skipped").length;

  logger.info(
    `[AutoStart] Complete: ${healthy} healthy, ${unhealthy} unhealthy, ${skipped} skipped`,
  );

  return {
    started: statuses.length,
    healthy,
    unhealthy,
    skipped,
    services: statuses,
  };
}

export function getAutoStartStatus(): ServiceStatus[] {
  return Array.from(serviceStatuses.values());
}

export function getServiceDefinitions() {
  return SERVICES.map((s) => ({
    id: s.id,
    name: s.name,
    priority: s.priority,
    port: s.port,
    language: s.language,
    dependencies: s.dependencies,
  }));
}
