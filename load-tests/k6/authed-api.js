/* global __ENV */
/**
 * NDSEP k6 — Authenticated API load test (tRPC batch call patterns)
 * Exercises the authenticated portal traffic mix the way the real web client
 * issues it: batched tRPC calls (httpBatchLink) over POST /api/trpc with
 * superjson-wrapped inputs.
 *
 * Mix per iteration (approximate):
 *   - 1 batched dashboard read fan-in (dashboard.getStats + organizations.list
 *     + fieldInspection.listCases in ONE HTTP request, like the app's batch link)
 *   - 1 single read
 *   - every 10th VU iteration: 1 write (fieldInspection.createCase, idempotent
 *     by client-generated case_uuid)
 *
 * SLO targets: reads p50 < 100ms / p95 < 500ms / p99 < 1s; writes p95 < 1s.
 *
 * Auth (one of):
 *   -e AUTH_TOKEN=<keycloak-jwt>   sent as Authorization: Bearer
 *   -e SESSION_COOKIE=<name=value> sent as a Cookie header
 * Without credentials the script still runs but authed calls return
 * UNAUTHORIZED — useful only for verifying the auth wall holds under load.
 *
 * Run:
 *   k6 run -e BASE_URL=http://localhost:3000 -e AUTH_TOKEN=$TOKEN \
 *     load-tests/k6/authed-api.js
 */
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// Local RFC4122 v4 generator — avoids the remote jslib import so the script
// also runs in fully offline/air-gapped load-test environments.
function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const errorRate = new Rate("errors");
const unauthorized = new Counter("unauthorized_responses");
const batchReadLatency = new Trend("batch_read_latency", true);
const singleReadLatency = new Trend("single_read_latency", true);
const writeLatency = new Trend("write_latency", true);

export const options = {
  scenarios: {
    authed_api: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 10 },  // warm-up
        { duration: "1m", target: 25 },   // normal portal load
        { duration: "1m", target: 50 },   // peak
        { duration: "2m", target: 50 },   // sustained peak
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    errors: ["rate<0.02"],
    batch_read_latency: ["p(50)<150", "p(95)<700", "p(99)<1500"], // fan-in: slightly above single-call SLO
    single_read_latency: ["p(50)<100", "p(95)<500", "p(99)<1000"],
    write_latency: ["p(95)<1000"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "";
const SESSION_COOKIE = __ENV.SESSION_COOKIE || "";

// One case_uuid per VU (init context): writes stay idempotent on the server
// (createCase upserts on client case_uuid), so a full run creates at most
// `max VUs` rows regardless of duration or re-runs.
const VU_CASE_UUID = uuidv4();

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  if (SESSION_COOKIE) headers.Cookie = SESSION_COOKIE;
  return headers;
}

function countAuthFailures(res) {
  if (res.status === 401) unauthorized.add(1);
  return res.status === 200;
}

/**
 * Batched tRPC call, mirroring @trpc/client httpBatchLink:
 * POST /api/trpc/<procA>,<procB>?batch=1 with body {"0":{json:...},"1":{json:...}}
 */
function trpcBatch(calls, trend) {
  const path = calls.map((c) => c.procedure).join(",");
  const body = {};
  calls.forEach((c, i) => {
    body[String(i)] = { json: c.input ?? null };
  });
  const res = http.post(`${BASE_URL}/api/trpc/${path}?batch=1`, JSON.stringify(body), {
    headers: authHeaders(),
  });
  if (trend) trend.add(res.timings.duration);
  return res;
}

function trpcQuery(procedure, input, trend) {
  const url = `${BASE_URL}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`;
  const res = http.get(url, { headers: authHeaders() });
  if (trend) trend.add(res.timings.duration);
  return res;
}

function trpcMutation(procedure, input, trend) {
  const res = http.post(`${BASE_URL}/api/trpc/${procedure}`, JSON.stringify({ json: input }), {
    headers: authHeaders(),
  });
  if (trend) trend.add(res.timings.duration);
  return res;
}

export default function () {
  group("batched dashboard fan-in", () => {
    const res = trpcBatch(
      [
        { procedure: "dashboard.getStats" },
        { procedure: "organizations.list", input: { page: 1, pageSize: 20 } },
        { procedure: "fieldInspection.listCases" },
      ],
      batchReadLatency,
    );
    if (!check(res, {
      "batch 200 or auth-walled": (r) => r.status === 200 || r.status === 401,
      "batch not 5xx": (r) => r.status < 500,
    }) || !countAuthFailures(res)) {
      errorRate.add(res.status === 401 ? 0 : 1);
    } else {
      errorRate.add(0);
    }
  });

  group("single read", () => {
    const res = trpcQuery("fieldInspection.listCases", {}, singleReadLatency);
    if (!check(res, {
      "read 200 or auth-walled": (r) => r.status === 200 || r.status === 401,
      "read not 5xx": (r) => r.status < 500,
    }) || !countAuthFailures(res)) {
      errorRate.add(res.status === 401 ? 0 : 1);
    } else {
      errorRate.add(0);
    }
  });

  // ~10% of iterations issue a write; idempotent on the per-VU case_uuid so
  // writes exercise the upsert path without unbounded row growth.
  if ((__VU + __ITER) % 10 === 0) {
    group("write: create inspection case", () => {
      const res = trpcMutation(
        "fieldInspection.createCase",
        {
          case_uuid: VU_CASE_UUID,
          title: `k6 load-test case vu${__VU}`,
          scope: "automated load test",
        },
        writeLatency,
      );
      if (!check(res, {
        "write 200 or auth-walled": (r) => r.status === 200 || r.status === 401,
        "write not 5xx": (r) => r.status < 500,
      }) || !countAuthFailures(res)) {
        errorRate.add(res.status === 401 ? 0 : 1);
      } else {
        errorRate.add(0);
      }
    });
  }

  sleep(0.5);
}
