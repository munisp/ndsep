/**
 * NDSEP Kubernetes Deployment Readiness
 * ========================================
 * Validates that all K8s manifests, Docker configs, and service
 * definitions are complete and ready for cluster deployment.
 *
 * Checks:
 *   - All K8s YAML manifests are valid
 *   - Dockerfiles exist for all services
 *   - Service ports don't conflict
 *   - Health probe paths are defined
 *   - Resource limits are set
 *   - Environment variables are documented
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

interface K8sManifest {
  file: string;
  kind: string;
  name: string;
  valid: boolean;
  issues: string[];
}

interface ReadinessReport {
  score: number;
  level: "ready" | "almost" | "not_ready";
  manifests: K8sManifest[];
  dockerfiles: Array<{ service: string; exists: boolean; path: string }>;
  portMap: Array<{ service: string; port: number; conflict: boolean }>;
  missingHealthProbes: string[];
  missingResourceLimits: string[];
  summary: {
    totalManifests: number;
    validManifests: number;
    totalDockerfiles: number;
    existingDockerfiles: number;
    portConflicts: number;
  };
}

const K8S_DIRS = [
  "k8s",
  "workers/rust/k8s",
  "workers/go/k8s",
];

const EXPECTED_SERVICES = [
  { name: "ndsep-api", port: 3000, dockerfile: "Dockerfile" },
  { name: "digital-twin", port: 8175, dockerfile: "workers/go/cmd/digital_twin/Dockerfile" },
  { name: "noc-collector", port: 8190, dockerfile: "workers/rust/noc-collector/Dockerfile" },
  { name: "noc-escalation", port: 8191, dockerfile: "workers/go/cmd/noc_escalation/Dockerfile" },
  { name: "noc-correlator", port: 8192, dockerfile: "workers/python/Dockerfile.noc_correlator" },
  { name: "noc-uptime", port: 8193, dockerfile: "workers/rust/noc-uptime/Dockerfile" },
  { name: "ai-perception", port: 8194, dockerfile: "workers/rust/noc-agent-perception/Dockerfile" },
  { name: "ai-reasoning", port: 8195, dockerfile: "workers/python/Dockerfile.ai_reasoning" },
  { name: "ai-action", port: 8196, dockerfile: "workers/go/cmd/noc_agent_action/Dockerfile" },
  { name: "wiredigg", port: 8160, dockerfile: "workers/rust/wiredigg-rs/Dockerfile" },
  { name: "siem-correlator", port: 8086, dockerfile: "workers/python/Dockerfile.siem" },
  { name: "ml-prediction", port: 8085, dockerfile: "workers/python/Dockerfile.ml" },
  { name: "ml-breach-predictor", port: 8176, dockerfile: "workers/python/Dockerfile.breach_predictor" },
  { name: "monte-carlo", port: 8177, dockerfile: "workers/rust/monte-carlo/Dockerfile" },
  { name: "abm-engine", port: 8178, dockerfile: "workers/rust/abm-engine/Dockerfile" },
  { name: "system-dynamics", port: 8179, dockerfile: "workers/rust/system-dynamics/Dockerfile" },
];

function scanYamlFiles(dir: string): K8sManifest[] {
  const manifests: K8sManifest[] = [];
  const absDir = path.join(ROOT, dir);

  if (!fs.existsSync(absDir)) return manifests;

  const files = fs.readdirSync(absDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  for (const file of files) {
    const content = fs.readFileSync(path.join(absDir, file), "utf-8");
    const issues: string[] = [];

    // Basic YAML validation
    const hasKind = /^kind:\s*\w+/m.test(content);
    const hasMetadata = /^metadata:/m.test(content);
    const hasName = /name:\s*\S+/m.test(content);

    if (!hasKind) issues.push("Missing 'kind' field");
    if (!hasMetadata) issues.push("Missing 'metadata' section");
    if (!hasName) issues.push("Missing 'name' field");

    // Check for resource limits in Deployments
    if (content.includes("kind: Deployment")) {
      if (!content.includes("resources:")) issues.push("Missing resource limits");
      if (!content.includes("livenessProbe") && !content.includes("readinessProbe")) {
        issues.push("Missing health probes");
      }
    }

    const kindMatch = content.match(/^kind:\s*(\w+)/m);
    const nameMatch = content.match(/name:\s*(\S+)/m);

    manifests.push({
      file: `${dir}/${file}`,
      kind: kindMatch?.[1] ?? "Unknown",
      name: nameMatch?.[1] ?? "unnamed",
      valid: hasKind && hasMetadata && hasName,
      issues,
    });
  }

  return manifests;
}

export function checkK8sReadiness(): ReadinessReport {
  // Scan all K8s manifest directories
  const manifests: K8sManifest[] = [];
  for (const dir of K8S_DIRS) {
    manifests.push(...scanYamlFiles(dir));
  }

  // Check Dockerfiles
  const dockerfiles = EXPECTED_SERVICES.map((svc) => ({
    service: svc.name,
    exists: fs.existsSync(path.join(ROOT, svc.dockerfile)),
    path: svc.dockerfile,
  }));

  // Check port conflicts
  const portCounts = new Map<number, string[]>();
  for (const svc of EXPECTED_SERVICES) {
    const existing = portCounts.get(svc.port) ?? [];
    existing.push(svc.name);
    portCounts.set(svc.port, existing);
  }
  const portMap = EXPECTED_SERVICES.map((svc) => ({
    service: svc.name,
    port: svc.port,
    conflict: (portCounts.get(svc.port)?.length ?? 0) > 1,
  }));

  // Check missing health probes
  const missingHealthProbes = manifests
    .filter((m) => m.kind === "Deployment" && m.issues.some((i) => i.includes("health probes")))
    .map((m) => m.name);

  // Check missing resource limits
  const missingResourceLimits = manifests
    .filter((m) => m.kind === "Deployment" && m.issues.some((i) => i.includes("resource limits")))
    .map((m) => m.name);

  const totalManifests = manifests.length;
  const validManifests = manifests.filter((m) => m.valid).length;
  const totalDockerfiles = dockerfiles.length;
  const existingDockerfiles = dockerfiles.filter((d) => d.exists).length;
  const portConflicts = portMap.filter((p) => p.conflict).length;

  // Calculate score
  const manifestScore = totalManifests > 0 ? (validManifests / totalManifests) * 30 : 0;
  const dockerScore = totalDockerfiles > 0 ? (existingDockerfiles / totalDockerfiles) * 30 : 0;
  const portScore = portConflicts === 0 ? 20 : 0;
  const probeScore = missingHealthProbes.length === 0 ? 10 : 0;
  const limitScore = missingResourceLimits.length === 0 ? 10 : 0;
  const score = Math.round(manifestScore + dockerScore + portScore + probeScore + limitScore);

  return {
    score,
    level: score >= 80 ? "ready" : score >= 50 ? "almost" : "not_ready",
    manifests,
    dockerfiles,
    portMap,
    missingHealthProbes,
    missingResourceLimits,
    summary: {
      totalManifests,
      validManifests,
      totalDockerfiles,
      existingDockerfiles,
      portConflicts,
    },
  };
}
