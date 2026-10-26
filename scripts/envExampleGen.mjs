#!/usr/bin/env node
/**
 * NDSEP .env.example generator (round-9)
 * ======================================
 * Scans server/ + workers/ + ml/ for environment variable references
 * (process.env.X, process.env["X"], os.environ.get("X"), os.environ["X"],
 * os.getenv("X")) and regenerates .env.example, grouped by domain with
 * comments.
 *
 * Rules:
 *   - Secret-looking names (KEY/SECRET/PASSWORD/TOKEN/PRIVATE/SALT/HMAC)
 *     are NEVER emitted with their in-code default — always CHANGE_ME.
 *   - URL defaults have any userinfo (user:pass@) stripped.
 *   - Names on the REQUIRED list below are emitted even when the scanner
 *     does not find them (deploy contract must not silently drop a var).
 *
 * Usage:  node scripts/envExampleGen.mjs [--check]
 *   --check  exit non-zero if .env.example is stale (for CI)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["server", "workers", "ml"];
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "__pycache__",
  ".git", "coverage", "tests", "test"]);
const OUT_FILE = path.join(ROOT, ".env.example");

/** Vars that must appear even if the scanner misses them. */
const REQUIRED = [
  "DATABASE_URL", "FIELD_ENCRYPTION_KEY", "KMS_KEY_ID", "KMS_REGION",
  "KMS_ENDPOINT", "PERMIFY_URL", "PERMIFY_TENANT_ID", "OPA_URL",
  "OPA_POLICY_PATH", "COMPLAINT_WEBHOOK_SECRET", "SMS_PROVIDER",
  "SMS_API_KEY", "USSD_GATEWAY_URL", "USSD_API_KEY", "NIMC_API_URL",
  "NIMC_API_KEY", "NIN_API_ENDPOINT", "FIRS_API_URL", "FIRS_API_KEY",
  "CAC_API_URL", "CAC_API_KEY", "KAFKA_BROKERS", "KAFKA_REST_URL",
  "WORKER_DATABASE_URL", "WORKER_RELAY_URL", "WORKER_AUTH_TOKEN",
  "TB_LEDGER_URL", "TB_LEDGER_CLUSTER_ID", "REMITA_API_KEY",
  "REMITA_MERCHANT_ID", "EVIDENCE_HMAC_SECRET",
  "NDSEP_TRUSTED_PROXY_COUNT", "NEO4J_URI", "NEO4J_USER", "NEO4J_PASSWORD",
  "JWT_SECRET", "REDIS_URL", "QDRANT_URL", "OLLAMA_URL",
];

/** Secret detection — defaults are redacted for these. */
const SECRET_RE = /(KEY|SECRET|PASSWORD|TOKEN|PRIVATE|SALT|HMAC|CREDENTIAL)/i;

/** Domain groups: [title, test(name)]. First match wins. */
const GROUPS = [
  ["Core platform", n => ["NODE_ENV", "PORT", "HOST", "TZ", "LOG_LEVEL"].includes(n) || n.startsWith("NDSEP_")],
  ["PostgreSQL / database", n => n.includes("DATABASE_URL") || n.startsWith("POSTGRES") || n.startsWith("PG") || n.startsWith("DB_")],
  ["Redis / cache", n => n.startsWith("REDIS") || n.startsWith("CACHE")],
  ["Kafka / streaming", n => n.startsWith("KAFKA") || n.startsWith("FLUVIO")],
  ["Authentication / IAM (Keycloak, OAuth, JWT, session)", n => n.startsWith("KEYCLOAK") || n.startsWith("JWT") || n.startsWith("OAUTH") || n.startsWith("SESSION") || n.startsWith("AUTH")],
  ["Authorization (Permify / OPA)", n => n.startsWith("PERMIFY") || n.startsWith("OPA")],
  ["Encryption / KMS / evidence integrity", n => n.startsWith("KMS") || n.includes("ENCRYPTION") || n.startsWith("EVIDENCE_HMAC") || n.startsWith("ANTIWIPE")],
  ["ML / AI (models, drift, retraining, inference)", n => n.startsWith("ML_") || n.startsWith("OLLAMA") || n.startsWith("LLAMACPP") || n.startsWith("EMBED") || n.startsWith("GNN") || n.startsWith("RAY") || n.startsWith("DRIFT") || n.startsWith("RETRAIN") || n.startsWith("CONTINUOUS_TRAINING") || n.startsWith("CHAMPION") || n.startsWith("MLFLOW") || n.startsWith("QDRANT") || n.startsWith("OPENSEARCH") || n.startsWith("COCOINDEX")],
  ["Graph stores (Neo4j / FalkorDB)", n => n.startsWith("NEO4J") || n.startsWith("FALKORDB")],
  ["Lakehouse / object storage", n => n.startsWith("LAKEHOUSE") || n.startsWith("MINIO") || n.startsWith("S3") || n.startsWith("DUCKDB") || n.startsWith("ICEBERG")],
  ["Nigerian regulator / identity integrations (NIMC, NIN, BVN, NIBSS, FIRS, CAC, NFIU, CBN, NCC, NHIA, FMOH, NERC, DPR, NAICOM)", n => /^(NIMC|NIN|BVN|NIBSS|FIRS|CAC|NFIU|CBN|NCC|NHIA|FMOH|NERC|DPR|NAICOM)/.test(n)],
  ["Payments / ledger (TigerBeetle, Remita, Mojaloop, DPCO)", n => n.startsWith("TB_LEDGER") || n.startsWith("TIGERBEETLE") || n.startsWith("REMITA") || n.startsWith("MOJALOOP") || n.startsWith("PAYMENT") || n.startsWith("DPCO")],
  ["Messaging channels (SMS / USSD / email)", n => /^(SMS|USSD|SMTP|EMAIL|MAIL|TWILIO|TERMII|WHATSAPP)/.test(n)],
  ["Complaints management", n => n.startsWith("COMPLAINT")],
  ["Worker framework (ports, relays, intervals)", n => n.startsWith("WORKER_") || n.endsWith("_PORT") || n.endsWith("_INTERVAL") || n.startsWith("RELAY")],
  ["Security / rate limiting / proxy trust", n => n.startsWith("RATE_") || n.startsWith("CORS") || n.includes("PROXY") || n.startsWith("DDOS") || n.startsWith("RANSOMWARE")],
  ["Observability (OTel, Prometheus, Grafana, Sentry)", n => n.startsWith("OTEL") || n.startsWith("GRAFANA") || n.startsWith("PROM") || n.startsWith("SENTRY") || n.startsWith("METRICS")],
  ["Other", () => true],
];

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (SCAN_EXT.has(path.extname(e.name))) yield full;
  }
}

const PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]+)/g,
  /process\.env\[["'`]([A-Z][A-Z0-9_]+)["'`]\]/g,
  /os\.environ\.get\(\s*["']([A-Z][A-Z0-9_]+)["']/g,
  /os\.environ\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g,
  /os\.getenv\(\s*["']([A-Z][A-Z0-9_]+)["']/g,
];

// Default-value extractors (best effort, per name)
const DEFAULT_PATTERNS = [
  n => new RegExp(`os\\.environ\\.get\\(\\s*["']${n}["']\\s*,\\s*["']([^"']*)["']`),
  n => new RegExp(`os\\.getenv\\(\\s*["']${n}["']\\s*,\\s*["']([^"']*)["']`),
  n => new RegExp(`process\\.env\\.${n}\\s*\\?\\?\\s*["'\`]([^"'\`]*)["'\`]`),
  n => new RegExp(`process\\.env\\.${n}\\s*\\|\\|\\s*["']([^"']*)["']`),
];

function sanitizeDefault(name, value) {
  if (value == null || value === "") return null;
  if (SECRET_RE.test(name)) return null; // never emit real secret defaults
  let v = String(value);
  if (v.includes("${") || v.includes("??") || v.includes("||")) return null; // composed expression, not a literal
  if (/(^|_)(URL|URI|DSN|ENDPOINT)$/.test(name) && !v.includes("://") && !v.includes("/")) return null; // URL-ish vars: only emit plausible defaults
  v = v.replace(/:\/\/[^/@\s]*@/, "://"); // strip userinfo from URLs
  if (v.length > 60) return null;
  return v;
}

function collect() {
  const vars = new Map(); // name -> {default, files:Set}
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const src = fs.readFileSync(file, "utf8");
      const rel = path.relative(ROOT, file);
      for (const pat of PATTERNS) {
        pat.lastIndex = 0;
        let m;
        while ((m = pat.exec(src))) {
          const name = m[1];
          if (!vars.has(name)) vars.set(name, { default: null, files: new Set() });
          vars.get(name).files.add(rel);
        }
      }
      // defaults (only fill once — first seen wins, deterministic walk order)
      for (const [name, info] of vars) {
        if (info.default != null) continue;
        for (const mk of DEFAULT_PATTERNS) {
          const dm = src.match(mk(name));
          if (dm) {
            const clean = sanitizeDefault(name, dm[1]);
            if (clean) info.default = clean;
            break;
          }
        }
      }
    }
  }
  for (const name of REQUIRED) {
    if (!vars.has(name)) vars.set(name, { default: null, files: new Set() });
  }
  return vars;
}

function groupOf(name) {
  for (const [title, test] of GROUPS) {
    if (title !== "Other" && test(name)) return title;
  }
  return "Other";
}

function render(vars) {
  const byGroup = new Map(GROUPS.map(([t]) => [t, []]));
  for (const [name, info] of [...vars.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    byGroup.get(groupOf(name)).push([name, info]);
  }
  const lines = [
    "# NDSEP Environment Variables — GENERATED FILE",
    "#",
    "# Regenerate with:  node scripts/envExampleGen.mjs",
    "# (CI: node scripts/envExampleGen.mjs --check fails when stale)",
    "#",
    "# Scanned from server/, workers/, ml/ source. Secret defaults are never",
    "# emitted — every KEY/SECRET/PASSWORD/TOKEN must be supplied per",
    "# environment. Copy to .env and fill in the values.",
    "",
  ];
  for (const [title] of GROUPS) {
    const entries = byGroup.get(title);
    if (!entries.length) continue;
    lines.push(`# ─── ${title} ${"─".repeat(Math.max(4, 74 - title.length))}`);
    for (const [name, info] of entries) {
      const secret = SECRET_RE.test(name);
      const required = REQUIRED.includes(name) && info.files.size === 0;
      const comment = required
        ? "  # REQUIRED — no in-code default (fail closed)"
        : secret
          ? "  # secret — set per environment, no default"
          : info.files.size
            ? `  # used by: ${[...info.files].slice(0, 2).join(", ")}${info.files.size > 2 ? ` +${info.files.size - 2} more` : ""}`
            : "";
      lines.push(`${name}=${secret ? "CHANGE_ME_IN_PRODUCTION" : info.default ?? ""}${comment}`);
    }
    lines.push("");
  }
  for (const block of STATIC_BLOCKS) {
    lines.push(...block, "");
  }
  return lines.join("\n");
}

/**
 * Static commented-only blocks appended after the scanned groups. These
 * carry deployment ALTERNATIVES (commented out, so they never set a value)
 * that the scanner cannot infer from code — e.g. the self-hosted OSIRIS
 * sidecar override (round 13 W6). Keep every line commented.
 */
const STATIC_BLOCKS = [
  [
    "# ─── Self-hosted OSIRIS sidecar (optional, round 13 W6) ─────────────",
    "# Run OSIRIS alongside NDSEP instead of the hosted API",
    "# (infra/osiris/docker-compose.osiris.yml, docs/infra-osiris.md):",
    "#   docker compose -f infra/osiris/docker-compose.osiris.yml up -d",
    "# Then override the scanned defaults above with:",
    "# OSIRIS_URL=http://osiris:3000",
    "# OSIRIS_SELF_HOSTED=true",
    "# OSIRIS_PORT=3000",
    "# Generate the shared scanner key with: openssl rand -hex 32",
  ],
];

const vars = collect();
const output = render(vars);

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, "utf8") : "";
  if (current !== output) {
    console.error("[envExampleGen] .env.example is STALE — run `node scripts/envExampleGen.mjs`");
    process.exit(1);
  }
  console.log("[envExampleGen] .env.example is up to date");
} else {
  fs.writeFileSync(OUT_FILE, output);
  console.log(`[envExampleGen] wrote ${OUT_FILE} — ${vars.size} variables, ` +
    `${GROUPS.filter(([t]) => t !== "Other").length} domain groups`);
}
