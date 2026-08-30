import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSummary,
  assertBreakGlassEvent,
  assertEventList,
  assertIntegrityVerification,
  assertSseNotice,
  assertNoClientScopeInputs,
} from '../validate.mjs';

const EVENT_ID = '018f4fd4-51d1-7c2d-b3a1-f27c1e45cf7a';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function validEvent(overrides = {}) {
  return {
    eventId: EVENT_ID,
    occurredAt: '2026-08-30T14:23:11Z',
    recordedAt: '2026-08-30T14:23:17Z',
    incidentId: 'INC-20260830-001',
    eventType: 'GATEKEEPER_POLICY_RESTORED',
    severity: 'P1',
    institution: { display: 'Authorized institution', authorizedInstitutionId: 42 },
    actor: { subjectPseudonym: 'sub:5c0c-pseudonym' },
    action: { resource: 'ValidatingWebhookConfiguration', targetName: 'gatekeeper-validating-webhook-configuration' },
    clusterId: 'ng-payments-staging-01',
    release: {
      ociIndexDigest: `sha256:${SHA_A}`,
      signatureVerified: true,
      releaseGateVerified: true,
      unwaivedHighCritical: 0,
    },
    admission: { failurePolicyBefore: 'Fail', failurePolicyAfter: 'Fail', policyResult: 'restored' },
    evidence: {
      status: 'verified',
      recordSha256: SHA_B,
      previousRecordSha256: SHA_A,
      transparencyEntryId: 'ndsep-log:2026-08-30:12345',
      integrityLastVerifiedAt: '2026-08-30T14:24:02Z',
    },
    complianceStatus: 'closed_verified',
    reportDeliveryStatus: 'receipt_verified',
    elasticProjection: { status: 'delivered', documentId: EVENT_ID, deliveredAt: '2026-08-30T14:23:20Z' },
    ...overrides,
  };
}

test('accepts a complete verified supervisory event', () => {
  assert.doesNotThrow(() => assertBreakGlassEvent(validEvent()));
});

test('rejects evidence labelled verified when required proof state is invalid in integrity response', () => {
  assert.throws(() => assertIntegrityVerification({
    eventId: EVENT_ID,
    result: 'verified',
    verifiedAt: '2026-08-30T14:24:02Z',
    checks: {
      canonicalHash: 'pass',
      sourceSignature: 'pass',
      trustedTimestamp: 'unavailable',
      transparencyInclusion: 'pass',
      transparencyConsistency: 'pass',
      sourceArtifacts: 'pass',
    },
  }), /verified result requires every mandatory proof check/);
});

test('rejects receipt-verified status when evidence is not verified', () => {
  assert.throws(() => assertBreakGlassEvent(validEvent({
    evidence: { status: 'evidence_gap', recordSha256: SHA_B, transparencyEntryId: 'ndsep-log:12345' },
  })), /receipt_verified requires verified source evidence/);
});

test('rejects a mutable or malformed OCI image digest', () => {
  assert.throws(() => assertBreakGlassEvent(validEvent({
    release: { ociIndexDigest: 'ghcr.io/munisp/ndsep:latest', signatureVerified: true, releaseGateVerified: true, unwaivedHighCritical: 0 },
  })), /ociIndexDigest.*invalid format/);
});

test('rejects an unexpected sensitive field in a dashboard response', () => {
  assert.throws(() => assertBreakGlassEvent(validEvent({
    rawEvidenceUri: 's3://restricted/raw-bundle',
  })), /prohibited sensitive field/);
});

test('accepts bounded, cursor-paginated result list and summary', () => {
  assert.doesNotThrow(() => assertEventList({
    items: [validEvent()], nextCursor: null, asOf: '2026-08-30T14:25:00Z',
  }));
  assert.doesNotThrow(() => assertSummary({
    asOf: '2026-08-30T14:25:00Z',
    portfolio: { scopeType: 'assigned_supervisory_portfolio', institutionCount: 2 },
    counts: {
      verifiedOpenEmergencyWindows: 0, evidenceGaps: 1, integrityFailures: 0,
      restorationDue: 0, reconciliationOverdue: 0, reportDeliveryFailures: 0,
    },
  }));
});

test('rejects more than 100 events in a response', () => {
  assert.throws(() => assertEventList({
    items: Array.from({ length: 101 }, () => validEvent()), nextCursor: null, asOf: '2026-08-30T14:25:00Z',
  }), /at most 100 events/);
});

test('accepts a minimized SSE notice and rejects sensitive fields', () => {
  assert.doesNotThrow(() => assertSseNotice({
    eventId: EVENT_ID,
    occurredAt: '2026-08-30T14:23:11Z',
    eventType: 'GATEKEEPER_POLICY_RESTORED',
    evidenceStatus: 'verified',
    complianceStatus: 'closed_verified',
  }));
  assert.throws(() => assertSseNotice({
    eventId: EVENT_ID,
    occurredAt: '2026-08-30T14:23:11Z',
    eventType: 'GATEKEEPER_POLICY_RESTORED',
    evidenceStatus: 'verified',
    complianceStatus: 'closed_verified',
    oidcToken: 'must-not-appear',
  }), /prohibited sensitive field/);
});

test('rejects client-supplied organization and institution scope', () => {
  for (const key of ['org_id', 'organization_id', 'institution_id', 'portfolio_id', 'bank_id']) {
    assert.throws(() => assertNoClientScopeInputs(new URL(`https://supervisory-api.example/v1/break-glass/events?${key}=42`)), /client-supplied scope/);
  }
  assert.doesNotThrow(() => assertNoClientScopeInputs(new URL('https://supervisory-api.example/v1/break-glass/events?limit=50')));
});
