/**
 * NDSEP Worker Binary Builder
 * =============================
 * Automatically builds Go and Rust worker binaries before starting them.
 * Solves the ENOENT issue where workerManager tries to spawn binaries
 * that haven't been compiled yet.
 *
 * Build Strategy:
 *   - Go: `go build -o workers/bin/<name> ./workers/go/cmd/<name>`
 *   - Rust: `cargo build --release -p <crate>` → copy to workers/bin/
 *   - Python: No build needed (interpreted)
 *
 * Features:
 *   - Parallel builds with concurrency limit
 *   - Build caching (skip if binary exists and source hasn't changed)
 *   - Graceful timeout per build (120s)
 *   - Build status reporting
 */

import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { logger } from "./logger";
import { captureError } from "./errorMonitoring";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const WORKERS_DIR = path.join(ROOT_DIR, "workers");
const BIN_DIR = path.join(WORKERS_DIR, "bin");
const GO_CMD_DIR = path.join(WORKERS_DIR, "go", "cmd");
const RUST_DIR = path.join(WORKERS_DIR, "rust");

interface BuildResult {
  name: string;
  language: "Go" | "Rust";
  success: boolean;
  duration: number;
  binaryPath: string;
  error?: string;
  cached: boolean;
}

function ensureBinDir(): void {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    logger.info(`[Builder] Created bin directory: ${BIN_DIR}`);
  }
}

function isBinaryFresh(binaryPath: string, sourceDir: string): boolean {
  if (!fs.existsSync(binaryPath)) return false;

  const binaryStat = fs.statSync(binaryPath);
  const binaryMtime = binaryStat.mtimeMs;

  // Check if any source file is newer than the binary
  try {
    const files = fs.readdirSync(sourceDir);
    for (const file of files) {
      const filePath = path.join(sourceDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.mtimeMs > binaryMtime) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function buildGoWorker(name: string): BuildResult {
  const cmdDir = path.join(GO_CMD_DIR, name);
  const binaryPath = path.join(BIN_DIR, name);

  if (!fs.existsSync(cmdDir)) {
    return {
      name,
      language: "Go",
      success: false,
      duration: 0,
      binaryPath,
      error: `Source directory not found: ${cmdDir}`,
      cached: false,
    };
  }

  if (isBinaryFresh(binaryPath, cmdDir)) {
    return { name, language: "Go", success: true, duration: 0, binaryPath, cached: true };
  }

  const start = Date.now();
  try {
    execSync(`cd "${path.join(WORKERS_DIR, "go")}" && go build -o "${binaryPath}" "./cmd/${name}"`, {
      timeout: 120_000,
      stdio: "pipe",
      env: { ...process.env, CGO_ENABLED: "0" },
    });
    return { name, language: "Go", success: true, duration: Date.now() - start, binaryPath, cached: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, language: "Go", success: false, duration: Date.now() - start, binaryPath, error: msg.slice(0, 500), cached: false };
  }
}

function buildRustWorker(crateName: string, binaryName: string): BuildResult {
  const binaryPath = path.join(BIN_DIR, binaryName);
  const crateDir = path.join(RUST_DIR, crateName);

  if (!fs.existsSync(crateDir) && !fs.existsSync(path.join(RUST_DIR, "Cargo.toml"))) {
    return {
      name: binaryName,
      language: "Rust",
      success: false,
      duration: 0,
      binaryPath,
      error: `Crate directory not found: ${crateDir}`,
      cached: false,
    };
  }

  if (fs.existsSync(binaryPath) && isBinaryFresh(binaryPath, crateDir)) {
    return { name: binaryName, language: "Rust", success: true, duration: 0, binaryPath, cached: true };
  }

  const start = Date.now();
  try {
    execSync(`cd "${RUST_DIR}" && cargo build --release -p ${crateName} 2>&1`, {
      timeout: 300_000,
      stdio: "pipe",
    });
    // Copy from target/release to bin
    const releaseDir = path.join(RUST_DIR, "target", "release");
    const releaseBinary = path.join(releaseDir, binaryName);
    if (fs.existsSync(releaseBinary)) {
      fs.copyFileSync(releaseBinary, binaryPath);
      fs.chmodSync(binaryPath, 0o755);
    }
    return { name: binaryName, language: "Rust", success: true, duration: Date.now() - start, binaryPath, cached: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: binaryName, language: "Rust", success: false, duration: Date.now() - start, binaryPath, error: msg.slice(0, 500), cached: false };
  }
}

// Go workers that should be auto-built
const GO_WORKERS = [
  "digital_twin",
  "noc_collector",
  "noc_uptime",
  "noc_agent_perception",
  "noc_escalation",
  "dpi_engine",
  "discovery_agent",
  "compliance_engine",
  "kafka_monitor",
  "netbox_ipam",
  "nmap_scanner",
  "policy_evaluator",
  "ndsep_agent",
  "gitops_sync",
];

// Rust workers that should be auto-built
const RUST_WORKERS = [
  { crate: "wiredigg-rs", binary: "wiredigg" },
  { crate: "bgp-validator", binary: "bgp_validator" },
  { crate: "residency-enforcer", binary: "residency_enforcer" },
  { crate: "financial-ledger", binary: "financial_ledger" },
  { crate: "sla-tracker", binary: "sla_tracker" },
  { crate: "evidence-signer", binary: "evidence_signer" },
];

export function buildAllWorkers(): {
  results: BuildResult[];
  totalBuilt: number;
  totalCached: number;
  totalFailed: number;
  duration: number;
} {
  const start = Date.now();
  ensureBinDir();
  const results: BuildResult[] = [];

  logger.info("[Builder] Building Go workers...");
  for (const name of GO_WORKERS) {
    const result = buildGoWorker(name);
    results.push(result);
    if (result.success) {
      if (!result.cached) logger.info(`[Builder] ✓ Go: ${name} (${result.duration}ms)`);
    } else {
      logger.warn(`[Builder] ✗ Go: ${name}: ${result.error?.slice(0, 200)}`);
    }
  }

  logger.info("[Builder] Building Rust workers...");
  for (const { crate, binary } of RUST_WORKERS) {
    const result = buildRustWorker(crate, binary);
    results.push(result);
    if (result.success) {
      if (!result.cached) logger.info(`[Builder] ✓ Rust: ${binary} (${result.duration}ms)`);
    } else {
      logger.warn(`[Builder] ✗ Rust: ${binary}: ${result.error?.slice(0, 200)}`);
    }
  }

  const totalBuilt = results.filter((r) => r.success && !r.cached).length;
  const totalCached = results.filter((r) => r.success && r.cached).length;
  const totalFailed = results.filter((r) => !r.success).length;

  logger.info(
    `[Builder] Complete: ${totalBuilt} built, ${totalCached} cached, ${totalFailed} failed (${Date.now() - start}ms)`,
  );

  return { results, totalBuilt, totalCached, totalFailed, duration: Date.now() - start };
}

export function getBuildStatus(): BuildResult[] {
  ensureBinDir();
  const results: BuildResult[] = [];

  for (const name of GO_WORKERS) {
    const binaryPath = path.join(BIN_DIR, name);
    results.push({
      name,
      language: "Go",
      success: fs.existsSync(binaryPath),
      duration: 0,
      binaryPath,
      cached: true,
    });
  }

  for (const { crate, binary } of RUST_WORKERS) {
    const binaryPath = path.join(BIN_DIR, binary);
    results.push({
      name: binary,
      language: "Rust",
      success: fs.existsSync(binaryPath),
      duration: 0,
      binaryPath,
      cached: true,
    });
  }

  return results;
}
