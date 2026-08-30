const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;
const OCI_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const INCIDENT_RE = /^INC-[0-9]{4,}(?:-[0-9]+)*$/;
const RFC3339_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export const EVIDENCE_STATUSES = new Set([
  'pending_verification', 'verified', 'evidence_gap', 'integrity_failure', 'stale',
]);
export const COMPLIANCE_STATUSES = new Set([
  'normal', 'emergency_window_active', 'restoration_due', 'reconciliation_overdue',
  'closed_with_findings', 'closed_verified',
]);
export const REPORT_DELIVERY_STATUSES = new Set([
  'not_due', 'pending_review', 'signed', 'delivered', 'receipt_verified', 'delivery_failed',
]);
export const ELASTIC_PROJECTION_STATUSES = new Set([
  'not_applicable', 'pending_delivery', 'delivered', 'delivery_lag', 'integrity_conflict',
]);

const FORBIDDEN_KEY_PARTS = [
  'secret', 'token', 'password', 'rawevidenceuri', 'kubernetesrequestbody',
  'sourceip', 'approvaldocument', 'authorization', 'privatekey',
];

function fail(path, reason) {
  throw new Error(`Contract violation at ${path}: ${reason}`);
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value;
}

function requireString(value, path, pattern) {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'must be a non-empty string');
  if (pattern && !pattern.test(value)) fail(path, 'has invalid format');
  return value;
}

function requireBoolean(value, path) {
  if (typeof value !== 'boolean') fail(path, 'must be boolean');
  return value;
}

function requireEnum(value, path, allowed) {
  if (!allowed.has(value)) fail(path, `must be one of ${[...allowed].join(', ')}`);
  return value;
}

function checkNoForbiddenFields(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkNoForbiddenFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FORBIDDEN_KEY_PARTS.some((part) => normalized.includes(part))) {
      fail(`${path}.${key}`, 'contains a prohibited sensitive field');
    }
    checkNoForbiddenFields(child, `${path}.${key}`);
  }
}

function requireUtcTimestamp(value, path) {
  requireString(value, path, RFC3339_UTC_RE);
  if (Number.isNaN(Date.parse(value))) fail(path, 'is not a valid timestamp');
}

function requireNullableString(value, path, pattern) {
  if (value === null || value === undefined) return;
  requireString(value, path, pattern);
}

export function assertSummary(payload) {
  requireObject(payload, '$');
  requireUtcTimestamp(payload.asOf, '$.asOf');
  const portfolio = requireObject(payload.portfolio, '$.portfolio');
  requireEnum(portfolio.scopeType, '$.portfolio.scopeType', new Set([
    'assigned_supervisory_portfolio', 'own_institution', 'incident_assigned_scope',
  ]));
  if (!Number.isInteger(portfolio.institutionCount) || portfolio.institutionCount < 0) {
    fail('$.portfolio.institutionCount', 'must be a non-negative integer');
  }
  const counts = requireObject(payload.counts, '$.counts');
  for (const key of [
    'verifiedOpenEmergencyWindows', 'evidenceGaps', 'integrityFailures',
    'restorationDue', 'reconciliationOverdue', 'reportDeliveryFailures',
  ]) {
    if (!Number.isInteger(counts[key]) || counts[key] < 0) fail(`$.counts.${key}`, 'must be a non-negative integer');
  }
  checkNoForbiddenFields(payload);
}

export function assertBreakGlassEvent(event) {
  requireObject(event, '$');
  requireString(event.eventId, '$.eventId', UUID_RE);
  requireUtcTimestamp(event.occurredAt, '$.occurredAt');
  requireUtcTimestamp(event.recordedAt, '$.recordedAt');
  requireString(event.incidentId, '$.incidentId', INCIDENT_RE);
  requireString(event.eventType, '$.eventType');
  requireEnum(event.severity, '$.severity', new Set(['P0', 'P1', 'P2', 'P3']));
  requireString(event.clusterId, '$.clusterId');

  const institution = requireObject(event.institution, '$.institution');
  requireString(institution.display, '$.institution.display');
  if (institution.authorizedInstitutionId !== null && institution.authorizedInstitutionId !== undefined &&
      (!Number.isInteger(institution.authorizedInstitutionId) || institution.authorizedInstitutionId < 1)) {
    fail('$.institution.authorizedInstitutionId', 'must be a positive integer or null');
  }
  const actor = requireObject(event.actor, '$.actor');
  requireString(actor.subjectPseudonym, '$.actor.subjectPseudonym');
  const action = requireObject(event.action, '$.action');
  requireString(action.resource, '$.action.resource');
  requireString(action.targetName, '$.action.targetName');

  if (event.release !== undefined) {
    const release = requireObject(event.release, '$.release');
    requireNullableString(release.ociIndexDigest, '$.release.ociIndexDigest', OCI_DIGEST_RE);
    requireBoolean(release.signatureVerified, '$.release.signatureVerified');
    requireBoolean(release.releaseGateVerified, '$.release.releaseGateVerified');
    if (!Number.isInteger(release.unwaivedHighCritical) || release.unwaivedHighCritical < 0) {
      fail('$.release.unwaivedHighCritical', 'must be a non-negative integer');
    }
  }

  if (event.admission !== undefined) {
    const admission = requireObject(event.admission, '$.admission');
    for (const key of ['failurePolicyBefore', 'failurePolicyAfter']) {
      if (admission[key] !== null && admission[key] !== undefined && !['Fail', 'Ignore'].includes(admission[key])) {
        fail(`$.admission.${key}`, 'must be Fail, Ignore, or null');
      }
    }
  }

  const evidence = requireObject(event.evidence, '$.evidence');
  requireEnum(evidence.status, '$.evidence.status', EVIDENCE_STATUSES);
  requireString(evidence.recordSha256, '$.evidence.recordSha256', SHA256_RE);
  requireNullableString(evidence.previousRecordSha256, '$.evidence.previousRecordSha256', SHA256_RE);
  requireString(evidence.transparencyEntryId, '$.evidence.transparencyEntryId');
  requireNullableString(evidence.integrityLastVerifiedAt, '$.evidence.integrityLastVerifiedAt', RFC3339_UTC_RE);

  requireEnum(event.complianceStatus, '$.complianceStatus', COMPLIANCE_STATUSES);
  requireEnum(event.reportDeliveryStatus, '$.reportDeliveryStatus', REPORT_DELIVERY_STATUSES);
  const elastic = requireObject(event.elasticProjection, '$.elasticProjection');
  requireEnum(elastic.status, '$.elasticProjection.status', ELASTIC_PROJECTION_STATUSES);
  requireNullableString(elastic.documentId, '$.elasticProjection.documentId', UUID_RE);
  requireNullableString(elastic.deliveredAt, '$.elasticProjection.deliveredAt', RFC3339_UTC_RE);

  // A dashboard cannot show a successful CBN delivery/acknowledgement merely because
  // the Elastic operational projection was delivered. These semantics are independent.
  if (event.reportDeliveryStatus === 'receipt_verified' && evidence.status !== 'verified') {
    fail('$.reportDeliveryStatus', 'receipt_verified requires verified source evidence');
  }
  checkNoForbiddenFields(event);
}

export function assertEventList(payload) {
  requireObject(payload, '$');
  if (!Array.isArray(payload.items)) fail('$.items', 'must be an array');
  if (payload.items.length > 100) fail('$.items', 'must contain at most 100 events');
  payload.items.forEach(assertBreakGlassEvent);
  if (payload.nextCursor !== null && payload.nextCursor !== undefined) requireString(payload.nextCursor, '$.nextCursor');
  requireUtcTimestamp(payload.asOf, '$.asOf');
  checkNoForbiddenFields(payload);
}

export function assertIntegrityVerification(payload) {
  requireObject(payload, '$');
  requireString(payload.eventId, '$.eventId', UUID_RE);
  requireEnum(payload.result, '$.result', EVIDENCE_STATUSES);
  requireUtcTimestamp(payload.verifiedAt, '$.verifiedAt');
  const checks = requireObject(payload.checks, '$.checks');
  for (const key of [
    'canonicalHash', 'sourceSignature', 'trustedTimestamp', 'transparencyInclusion',
    'transparencyConsistency', 'sourceArtifacts',
  ]) {
    requireEnum(checks[key], `$.checks.${key}`, new Set(['pass', 'fail', 'unavailable']));
  }
  // A verifier must never label a result verified if an indispensable integrity proof is
  // unavailable or fails.
  if (payload.result === 'verified' && Object.values(checks).some((result) => result !== 'pass')) {
    fail('$.result', 'verified result requires every mandatory proof check to pass');
  }
  checkNoForbiddenFields(payload);
}

export function assertSseNotice(payload) {
  requireObject(payload, '$');
  requireString(payload.eventId, '$.eventId', UUID_RE);
  requireUtcTimestamp(payload.occurredAt, '$.occurredAt');
  requireString(payload.eventType, '$.eventType');
  requireEnum(payload.evidenceStatus, '$.evidenceStatus', EVIDENCE_STATUSES);
  requireEnum(payload.complianceStatus, '$.complianceStatus', COMPLIANCE_STATUSES);
  checkNoForbiddenFields(payload);
}

export function assertNoClientScopeInputs(url) {
  const forbidden = ['org_id', 'organization_id', 'institution_id', 'portfolio_id', 'bank_id'];
  for (const key of url.searchParams.keys()) {
    if (forbidden.includes(key.toLowerCase())) fail(`query.${key}`, 'client-supplied scope is prohibited');
  }
}
