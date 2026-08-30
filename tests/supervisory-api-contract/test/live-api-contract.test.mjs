import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import tls from 'node:tls';
import { createHash, randomUUID } from 'node:crypto';
import {
  assertSummary,
  assertBreakGlassEvent,
  assertEventList,
  assertIntegrityVerification,
  assertSseNotice,
  assertNoClientScopeInputs,
} from '../validate.mjs';

const RUN_LIVE = process.env.RUN_CBN_CONTRACT_TESTS === 'true';
const REQUIRED = [
  'CBN_TEST_BASE_URL',
  'CBN_TEST_EXPECTED_RELEASE_DIGEST',
  'CBN_TEST_CA_FILE',
  'CBN_TEST_CLIENT_CERT_FILE',
  'CBN_TEST_CLIENT_KEY_FILE',
  'CBN_TEST_SERVER_SPKI_PINS',
  'CBN_TEST_OAUTH_TOKEN',
  'CBN_TEST_EVENT_ID_AUTHORIZED',
  'CBN_TEST_EVENT_ID_OUT_OF_SCOPE',
];

function requireLiveConfig() {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  assert.equal(missing.length, 0, `Missing required live-test variables: ${missing.join(', ')}`);
}

function loadMtlsConfig() {
  requireLiveConfig();
  const pins = new Set(process.env.CBN_TEST_SERVER_SPKI_PINS.split(',').map((value) => value.trim()).filter(Boolean));
  assert.ok(pins.size >= 2, 'Require active and next SPKI pins to validate rotation readiness.');
  const baseUrl = new URL(process.env.CBN_TEST_BASE_URL);
  assert.equal(baseUrl.protocol, 'https:', 'CBN_TEST_BASE_URL must use HTTPS.');

  return {
    baseUrl,
    ca: fs.readFileSync(process.env.CBN_TEST_CA_FILE),
    cert: fs.readFileSync(process.env.CBN_TEST_CLIENT_CERT_FILE),
    key: fs.readFileSync(process.env.CBN_TEST_CLIENT_KEY_FILE),
    pins,
  };
}

function createMtlsAgent(config) {
  return new https.Agent({
    keepAlive: false,
    minVersion: 'TLSv1.3',
    ca: config.ca,
    cert: config.cert,
    key: config.key,
    rejectUnauthorized: true,
    checkServerIdentity(host, certificate) {
      const defaultError = tls.checkServerIdentity(host, certificate);
      if (defaultError) return defaultError;
      if (!certificate.pubkey) return new Error('Server certificate did not expose a public key for SPKI pin validation.');
      const spkiPin = createHash('sha256').update(certificate.pubkey).digest('base64');
      if (!config.pins.has(spkiPin)) return new Error(`Unrecognized server SPKI pin for ${host}.`);
      return undefined;
    },
  });
}

function request(config, agent, method, path, { token = process.env.CBN_TEST_OAUTH_TOKEN, headers = {} } = {}) {
  const url = new URL(path, config.baseUrl);
  assertNoClientScopeInputs(url);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      agent,
      minVersion: 'TLSv1.3',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Request-ID': randomUUID(),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        if (text.length > 0 && res.headers['content-type']?.includes('application/json')) {
          try { body = JSON.parse(text); } catch (error) { reject(new Error(`Expected JSON response for ${method} ${url.pathname}: ${error.message}`)); return; }
        }
        resolve({ status: res.statusCode, headers: res.headers, body, text });
      });
    });
    req.setTimeout(15_000, () => req.destroy(new Error(`Request timeout: ${method} ${url.pathname}`)));
    req.on('error', reject);
    req.end();
  });
}

function safeResponseDetails(response) {
  const requestId = response.headers['x-request-id'] || 'absent';
  return `status=${response.status}; request_id=${requestId}`;
}

function assertEvidenceHeaders(response) {
  assert.ok(response.headers['x-request-id'], 'Expected server-generated X-Request-ID response header.');
  assert.ok(response.headers['x-ndsep-evidence-as-of'], 'Expected X-NDSEP-Evidence-As-Of response header.');
  assert.match(String(response.headers['x-ndsep-evidence-as-of']), /^\d{4}-\d{2}-\d{2}T/, 'Evidence timestamp must be RFC 3339-like.');
  const expectedDigest = process.env.CBN_TEST_EXPECTED_RELEASE_DIGEST;
  assert.match(expectedDigest, /^sha256:[a-f0-9]{64}$/, 'CBN_TEST_EXPECTED_RELEASE_DIGEST must be a full OCI SHA-256 digest.');
  assert.equal(
    response.headers['x-ndsep-release-digest'],
    expectedDigest,
    'Gateway response does not attest to the candidate release digest under test.',
  );
}

const options = { skip: !RUN_LIVE ? 'Set RUN_CBN_CONTRACT_TESTS=true with approved staging credentials to run network tests.' : false };

test('staging configuration has mTLS, TLS 1.3 and active-plus-next pin readiness', options, () => {
  const config = loadMtlsConfig();
  assert.ok(config.baseUrl.hostname.length > 0);
});

test('GET /break-glass/summary returns a schema-valid portfolio-scoped summary', options, async () => {
  const config = loadMtlsConfig();
  const response = await request(config, createMtlsAgent(config), 'GET', '/v1/break-glass/summary');
  assert.equal(response.status, 200, `Unexpected response: ${safeResponseDetails(response)}`);
  assertEvidenceHeaders(response);
  assertSummary(response.body);
});

test('GET /break-glass/events returns bounded schema-valid records without sensitive fields', options, async () => {
  const config = loadMtlsConfig();
  const response = await request(config, createMtlsAgent(config), 'GET', '/v1/break-glass/events?limit=50');
  assert.equal(response.status, 200, `Unexpected response: ${safeResponseDetails(response)}`);
  assertEvidenceHeaders(response);
  assertEventList(response.body);
});

test('GET /break-glass/events/{eventId} returns authorized event and never raw evidence material', options, async () => {
  const config = loadMtlsConfig();
  const eventId = process.env.CBN_TEST_EVENT_ID_AUTHORIZED;
  const response = await request(config, createMtlsAgent(config), 'GET', `/v1/break-glass/events/${eventId}`);
  assert.equal(response.status, 200, `Unexpected response: ${safeResponseDetails(response)}`);
  assert.ok(response.headers.etag, 'Expected ETag for detail revalidation.');
  assertEvidenceHeaders(response);
  assertBreakGlassEvent(response.body);
  assert.equal(response.body.eventId, eventId);
});

test('GET /break-glass/events/{eventId}/integrity returns fail-closed verification result', options, async () => {
  const config = loadMtlsConfig();
  const eventId = process.env.CBN_TEST_EVENT_ID_AUTHORIZED;
  const response = await request(config, createMtlsAgent(config), 'GET', `/v1/break-glass/events/${eventId}/integrity`);
  assert.equal(response.status, 200, `Unexpected response: ${safeResponseDetails(response)}`);
  assertIntegrityVerification(response.body);
  assert.equal(response.body.eventId, eventId);
});

test('access token absence is rejected without disclosing supervisory data', options, async () => {
  const config = loadMtlsConfig();
  const response = await request(config, createMtlsAgent(config), 'GET', '/v1/break-glass/summary', { token: '' });
  assert.equal(response.status, 401, `Expected 401 but received ${safeResponseDetails(response)}`);
  assert.ok(!response.body || !response.body.items, '401 response must not contain event data.');
});

test('out-of-scope event uses non-enumerating 404 semantics', options, async () => {
  const config = loadMtlsConfig();
  const eventId = process.env.CBN_TEST_EVENT_ID_OUT_OF_SCOPE;
  const response = await request(config, createMtlsAgent(config), 'GET', `/v1/break-glass/events/${eventId}`);
  assert.equal(response.status, 404, `Expected 404 for absent/out-of-scope event: ${safeResponseDetails(response)}`);
  assert.ok(!response.body || !response.body.evidence, '404 response must not contain evidence metadata.');
});

test('client-supplied scope is rejected and cannot override claims-derived scope', options, async () => {
  const config = loadMtlsConfig();
  const agent = createMtlsAgent(config);
  await assert.rejects(
    () => request(config, agent, 'GET', '/v1/break-glass/events?institution_id=42'),
    /client-supplied scope is prohibited/,
  );
});

test('write attempts to read-only supervisory endpoint are rejected', options, async () => {
  const config = loadMtlsConfig();
  const response = await request(config, createMtlsAgent(config), 'POST', '/v1/break-glass/events');
  assert.equal(response.status, 405, `Expected 405 for read-only API: ${safeResponseDetails(response)}`);
});

test('integrity-dependency failure is explicit and never becomes a verified response', options, async (t) => {
  if (!process.env.CBN_TEST_EVENT_ID_INTEGRITY_UNAVAILABLE) {
    t.skip('Set CBN_TEST_EVENT_ID_INTEGRITY_UNAVAILABLE to execute this controlled staging negative test.');
    return;
  }
  const config = loadMtlsConfig();
  const eventId = process.env.CBN_TEST_EVENT_ID_INTEGRITY_UNAVAILABLE;
  const response = await request(config, createMtlsAgent(config), 'GET', `/v1/break-glass/events/${eventId}/integrity`);
  assert.equal(response.status, 503, `Expected explicit 503 for unavailable verifier: ${safeResponseDetails(response)}`);
  assert.ok(!response.body || response.body.result !== 'verified', 'Unavailable verifier must not return a verified result.');
});

test('SSE event contract is minimized and forces client re-fetch', options, async (t) => {
  if (!process.env.CBN_TEST_SSE_SAMPLE_FILE) {
    t.skip('Set CBN_TEST_SSE_SAMPLE_FILE to a captured, redacted staging SSE event fixture.');
    return;
  }
  const sample = JSON.parse(fs.readFileSync(process.env.CBN_TEST_SSE_SAMPLE_FILE, 'utf8'));
  assertSseNotice(sample);
  assert.deepEqual(Object.keys(sample).sort(), ['complianceStatus', 'eventId', 'eventType', 'evidenceStatus', 'occurredAt']);
});


test('server certificate pin mismatch prevents the API request before HTTP processing', options, async (t) => {
  if (!process.env.CBN_TEST_BAD_SERVER_SPKI_PINS) {
    t.skip('Set CBN_TEST_BAD_SERVER_SPKI_PINS to intentionally incorrect base64 SPKI values for this staging-only negative test.');
    return;
  }
  const config = loadMtlsConfig();
  const badConfig = { ...config, pins: new Set(process.env.CBN_TEST_BAD_SERVER_SPKI_PINS.split(',').map((value) => value.trim()).filter(Boolean)) };
  await assert.rejects(
    () => request(badConfig, createMtlsAgent(badConfig), 'GET', '/v1/break-glass/summary'),
    /Unrecognized server SPKI pin/,
  );
});

test('insufficient token scope is rejected even when the client certificate is valid', options, async (t) => {
  if (!process.env.CBN_TEST_OAUTH_TOKEN_WRONG_SCOPE) {
    t.skip('Set CBN_TEST_OAUTH_TOKEN_WRONG_SCOPE to a staging token that lacks ndsep.supervisory.read.');
    return;
  }
  const config = loadMtlsConfig();
  const response = await request(config, createMtlsAgent(config), 'GET', '/v1/break-glass/summary', {
    token: process.env.CBN_TEST_OAUTH_TOKEN_WRONG_SCOPE,
  });
  assert.equal(response.status, 403, `Expected 403 for insufficient scope: ${safeResponseDetails(response)}`);
  assert.ok(!response.body || !response.body.counts, '403 response must not contain summary data.');
});

test('malformed event identifier is rejected before database/event lookup', options, async () => {
  const config = loadMtlsConfig();
  const response = await request(config, createMtlsAgent(config), 'GET', '/v1/break-glass/events/not-a-uuid');
  assert.equal(response.status, 400, `Expected 400 for malformed event ID: ${safeResponseDetails(response)}`);
  assert.ok(!response.body || !response.body.evidence, '400 response must not contain evidence metadata.');
});

test('expired or invalid mTLS-bound token is rejected', options, async (t) => {
  if (!process.env.CBN_TEST_OAUTH_TOKEN_INVALID) {
    t.skip('Set CBN_TEST_OAUTH_TOKEN_INVALID to an expired/invalid non-production token for this negative test.');
    return;
  }
  const config = loadMtlsConfig();
  const response = await request(config, createMtlsAgent(config), 'GET', '/v1/break-glass/summary', {
    token: process.env.CBN_TEST_OAUTH_TOKEN_INVALID,
  });
  assert.equal(response.status, 401, `Expected 401 for invalid token: ${safeResponseDetails(response)}`);
});
