#!/usr/bin/env node
/**
 * NDSEP API latency benchmark (autocannon-style, zero dependencies).
 *
 * Hammers key endpoints with a fixed number of concurrent connections for a
 * fixed duration and reports throughput + latency percentiles.
 *
 * Usage:
 *   node scripts/perf/bench-server.mjs [--base http://localhost:3000] [--duration 10]
 *        [--connections 10] [--endpoint /api/health] [--token <bearer>]
 *
 * Env: BENCH_BASE, BENCH_DURATION, BENCH_CONNECTIONS, BENCH_TOKEN
 *
 * Defaults hit the unauthenticated endpoints that dominate public traffic:
 *   /api/health, /api/metrics, and the public tRPC sanctions/FOIA/registry
 *   reads (GET batch form used by httpBatchLink). Authed endpoints can be
 *   exercised with --token.
 */

import { performance } from "node:perf_hooks";

// ── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
const BASE = (arg("base", process.env.BENCH_BASE ?? "http://localhost:3000")).replace(/\/$/, "");
const DURATION_SEC = Number(arg("duration", process.env.BENCH_DURATION ?? "10"));
const CONNECTIONS = Number(arg("connections", process.env.BENCH_CONNECTIONS ?? "10"));
const TOKEN = arg("token", process.env.BENCH_TOKEN ?? "");
const WARMUP_SEC = 1;

// Public tRPC GET endpoints use the batched query encoding that httpBatchLink
// produces: /api/trpc/<procedure>?batch=1&input=<urlencoded JSON>.
function trpcGet(procedure, input = { json: null }) {
  const encoded = encodeURIComponent(JSON.stringify({ "0": input }));
  return `/api/trpc/${procedure}?batch=1&input=${encoded}`;
}

const DEFAULT_ENDPOINTS = [
  { name: "health", path: "/api/health" },
  { name: "metrics", path: "/api/metrics" },
  { name: "sanctions.stats", path: trpcGet("sanctionsRegister.stats") },
  {
    name: "sanctions.search",
    path: trpcGet("sanctionsRegister.search", { json: { page: 1, limit: 20 } }),
  },
  {
    name: "publicRegistry.sectorStats",
    path: trpcGet("publicRegistry.sectorStats"),
  },
  {
    name: "publicRegistry.search",
    path: trpcGet("publicRegistry.search", { json: { page: 1, limit: 20 } }),
  },
  {
    name: "electionOversight.activePeriod",
    path: trpcGet("electionOversight.activePeriod"),
  },
];

const custom = arg("endpoint", null);
const endpoints = custom ? [{ name: custom, path: custom }] : DEFAULT_ENDPOINTS;

// ── Stats helpers ────────────────────────────────────────────────────────────
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

async function benchEndpoint({ name, path }) {
  const url = `${BASE}${path}`;
  const headers = { "user-agent": "ndsep-bench/1.0", accept: "application/json" };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;

  const latencies = [];
  let ok = 0, errors = 0, statusMismatch = 0;
  const deadline = performance.now() + DURATION_SEC * 1000;
  const warmupDeadline = performance.now() + WARMUP_SEC * 1000;

  async function worker() {
    while (performance.now() < deadline) {
      const t0 = performance.now();
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
        await res.arrayBuffer(); // fully drain body for accurate timing
        const dt = performance.now() - t0;
        if (performance.now() < warmupDeadline) continue; // warmup: discard
        if (res.status >= 200 && res.status < 400) ok++;
        else statusMismatch++;
        latencies.push(dt);
      } catch {
        if (performance.now() >= warmupDeadline) errors++;
        // Back off briefly on connection errors so a dead server doesn't
        // turn the benchmark into a tight error-spin.
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }

  await Promise.all(Array.from({ length: CONNECTIONS }, worker));

  latencies.sort((a, b) => a - b);
  const total = latencies.length;
  const wallSec = DURATION_SEC - WARMUP_SEC;
  const sum = latencies.reduce((a, b) => a + b, 0);
  return {
    name,
    requests: total,
    rps: (total / wallSec).toFixed(1),
    ok,
    non2xx: statusMismatch,
    errors,
    avg: total ? (sum / total).toFixed(2) : "0",
    p50: percentile(latencies, 50).toFixed(2),
    p90: percentile(latencies, 90).toFixed(2),
    p95: percentile(latencies, 95).toFixed(2),
    p99: percentile(latencies, 99).toFixed(2),
    max: (latencies[total - 1] ?? 0).toFixed(2),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log(`NDSEP bench — base=${BASE} duration=${DURATION_SEC}s connections=${CONNECTIONS}`);
console.log(
  "endpoint".padEnd(32),
  "reqs".padStart(8), "req/s".padStart(9),
  "avg".padStart(9), "p50".padStart(9), "p90".padStart(9),
  "p95".padStart(9), "p99".padStart(9), "max".padStart(9),
  "err".padStart(6), "non2xx".padStart(8),
);
for (const ep of endpoints) {
  const r = await benchEndpoint(ep);
  console.log(
    r.name.padEnd(32),
    String(r.requests).padStart(8), String(r.rps).padStart(9),
    String(r.avg).padStart(9), String(r.p50).padStart(9), String(r.p90).padStart(9),
    String(r.p95).padStart(9), String(r.p99).padStart(9), String(r.max).padStart(9),
    String(r.errors).padStart(6), String(r.non2xx).padStart(8),
  );
}
