/**
 * NDSEP k6 Smoke Test — verifies the platform handles baseline load
 * Run: k6 run load-tests/k6-smoke.js
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const tRPCLatency = new Trend('trpc_latency');

export const options = {
  stages: [
    { duration: '30s', target: 10 },  // ramp up
    { duration: '1m',  target: 10 },  // steady state
    { duration: '30s', target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // 95% of requests < 2s
    http_req_failed:   ['rate<0.01'],   // < 1% error rate
    errors:            ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Helper: tRPC batch request
function trpcQuery(procedure, input = {}) {
  const url = `${BASE_URL}/api/trpc/${procedure}`;
  const params = { headers: { 'Content-Type': 'application/json' } };
  const start = Date.now();
  const res = http.get(`${url}?input=${encodeURIComponent(JSON.stringify(input))}`, params);
  tRPCLatency.add(Date.now() - start);
  return res;
}

export default function () {
  group('Health Check', () => {
    const res = http.get(`${BASE_URL}/api/health`);
    check(res, {
      'health status 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  group('Dashboard Stats', () => {
    const res = trpcQuery('dashboard.getStats');
    check(res, {
      'dashboard stats 200': (r) => r.status === 200,
      'has data': (r) => r.body && r.body.length > 0,
    }) || errorRate.add(1);
  });

  group('Organizations List', () => {
    const res = trpcQuery('organizations.list', { page: 1, pageSize: 20 });
    check(res, {
      'organizations 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  group('Compliance Scores', () => {
    const res = trpcQuery('compliance.listScores', { page: 1, pageSize: 10 });
    check(res, {
      'compliance 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  sleep(1);
}
