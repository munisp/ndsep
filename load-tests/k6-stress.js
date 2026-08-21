/**
 * NDSEP k6 Stress Test — finds breaking point under heavy load
 * Run: k6 run load-tests/k6-stress.js
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const tRPCLatency = new Trend('trpc_latency');
const requestCount = new Counter('requests');

export const options = {
  stages: [
    { duration: '2m',  target: 50  },  // ramp to 50 VUs
    { duration: '5m',  target: 100 },  // ramp to 100 VUs
    { duration: '2m',  target: 200 },  // ramp to 200 VUs (stress)
    { duration: '5m',  target: 200 },  // hold at 200 VUs
    { duration: '2m',  target: 0   },  // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(99)<5000'],  // 99% of requests < 5s under stress
    http_req_failed:   ['rate<0.05'],   // < 5% error rate
    errors:            ['rate<0.1'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

function trpcGet(procedure, input = {}) {
  const url = `${BASE_URL}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const start = Date.now();
  const res = http.get(url, { headers: { 'Content-Type': 'application/json' } });
  tRPCLatency.add(Date.now() - start);
  requestCount.add(1);
  return res;
}

export default function () {
  const scenario = Math.floor(Math.random() * 5);

  switch (scenario) {
    case 0:
      group('Dashboard', () => {
        const res = trpcGet('dashboard.getStats');
        check(res, { 'status 200': (r) => r.status === 200 }) || errorRate.add(1);
      });
      break;
    case 1:
      group('Organizations', () => {
        const res = trpcGet('organizations.list', { page: 1, pageSize: 20 });
        check(res, { 'status 200': (r) => r.status === 200 }) || errorRate.add(1);
      });
      break;
    case 2:
      group('Violations', () => {
        const res = trpcGet('compliance.listViolations', { page: 1, pageSize: 20 });
        check(res, { 'status 200': (r) => r.status === 200 }) || errorRate.add(1);
      });
      break;
    case 3:
      group('Breaches', () => {
        const res = trpcGet('breaches.list', { page: 1, pageSize: 20 });
        check(res, { 'status 200': (r) => r.status === 200 }) || errorRate.add(1);
      });
      break;
    case 4:
      group('Assets', () => {
        const res = trpcGet('assets.list', { page: 1, pageSize: 20 });
        check(res, { 'status 200': (r) => r.status === 200 }) || errorRate.add(1);
      });
      break;
  }

  sleep(Math.random() * 2 + 0.5);
}
