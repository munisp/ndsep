import crypto from "node:crypto";

import { KMSClient, ReEncryptCommand } from "@aws-sdk/client-kms";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { generateRegistrationOptions, verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { Pool, type PoolClient } from "pg";

import { type EnterprisePrincipal } from "./_core/enterpriseAuth";
import { getConfiguredIntegrationValue, type IntegrationField } from "./integrationSettingsRepository";
import { runRecoveryMigrations } from "./recoveryMigrations";

export const RECOVERY_APPROVER_ROLES = ["security_engineer", "planning_supervisor"] as const;
export type RecoveryApproverRole = (typeof RECOVERY_APPROVER_ROLES)[number];
export type RecoveryStatus = "pending" | "authorized" | "rewrap_in_progress" | "replay_in_progress" | "consumed" | "expired" | "denied";

type RecoveryAuthorizationRow = {
  id: string;
  queue_id: string;
  payload_hash: string;
  idempotency_key: string;
  owner_subject: string;
  target_device_fingerprint: string;
  challenge: string;
  status: RecoveryStatus;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type RecoveryLockedRow = RecoveryAuthorizationRow & {
  kms_ciphertext: string;
  kms_encryption_context: Record<string, string>;
  rewrapped_ciphertext: string | null;
};

type CredentialRow = {
  id: string;
  credential_id: string;
  credential_public_key: string;
  sign_count: string | number;
  transports: string[] | null;
};

const pools = new Map<string, Pool>();
const migrations = new Map<string, Promise<void>>();
const RECOVERY_TTL_MS = 10 * 60_000;

export class RecoveryUnavailableError extends Error {}
export class RecoveryAuthorizationError extends Error {}

export async function generateEnrollmentChallenge(principal: EnterprisePrincipal) {
  if (!isRecoveryApproverRole(principal.agencyRoles[0] ?? "")) throw new RecoveryAuthorizationError("Only designated recovery approvers can enroll passkeys.");
  const config = recoveryConfig();
  if (!config.rpId || !config.origin) throw new RecoveryUnavailableError("WebAuthn enrollment requires a configured RP ID and origin.");
  const pool = await readyPool();
  const existing = await pool.query<{ credential_id: string }>("SELECT credential_id FROM webauthn_credentials WHERE subject = $1 AND revoked_at IS NULL", [principal.subject]);
  const excludeCredentials = existing.rows.map((row) => ({ id: row.credential_id, type: "public-key" as const }));
  const options = await generateRegistrationOptions({
    rpName: "IDLR-PTS Recovery",
    rpID: config.rpId,
    userName: principal.subject,
    userDisplayName: principal.subject,
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "required", authenticatorAttachment: "platform" },
    excludeCredentials,
  });
  return { options, rpId: config.rpId, origin: config.origin.origin };
}

export async function completeEnrollment(principal: EnterprisePrincipal, response: RegistrationResponseJSON, expectedChallenge: string) {
  if (!isRecoveryApproverRole(principal.agencyRoles[0] ?? "")) throw new RecoveryAuthorizationError("Only designated recovery approvers can enroll passkeys.");
  const config = recoveryConfig();
  if (!config.rpId || !config.origin) throw new RecoveryUnavailableError("WebAuthn enrollment requires a configured RP ID and origin.");
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.origin.origin,
    expectedRPID: config.rpId,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) throw new RecoveryAuthorizationError("WebAuthn registration verification failed.");
  const { credential } = verification.registrationInfo;
  return transaction(async (client) => {
    const id = crypto.randomUUID();
    await client.query("INSERT INTO webauthn_credentials (id, subject, credential_id, credential_public_key, sign_count, transports, created_at) VALUES ($1::uuid,$2,$3,$4,$5,$6::jsonb,now())", [id, principal.subject, credential.id, Buffer.from(credential.publicKey).toString("base64"), credential.counter, JSON.stringify(response.response.transports ?? [])]);
    return { credentialId: id, credentialExternalId: credential.id, subject: principal.subject };
  });
}

export async function listEnrolledCredentials(subject: string) {
  const pool = await readyPool();
  const result = await pool.query<{ id: string; credential_id: string; sign_count: string; created_at: Date }>("SELECT id, credential_id, sign_count, created_at FROM webauthn_credentials WHERE subject = $1 AND revoked_at IS NULL ORDER BY created_at DESC", [subject]);
  return result.rows.map((row) => ({ id: row.id, credentialIdHash: sha256(row.credential_id).slice(0, 16), signCount: Number(row.sign_count), createdAt: row.created_at.toISOString() }));
}

export async function revokeCredential(principal: EnterprisePrincipal, credentialId: string) {
  const pool = await readyPool();
  const result = await pool.query("UPDATE webauthn_credentials SET revoked_at = now() WHERE id = $1::uuid AND subject = $2 AND revoked_at IS NULL RETURNING id", [credentialId, principal.subject]);
  if (!result.rowCount) throw new RecoveryAuthorizationError("Credential was not found or already revoked.");
  return { revoked: true, credentialId };
}

function configuredValue(field: IntegrationField) {
  return getConfiguredIntegrationValue(field)?.trim() || process.env[field]?.trim() || null;
}

function recoveryAuditUrl() {
  const configured = process.env.RECOVERY_AUDIT_POSTGRES_URL?.trim() || process.env.PAYMENT_AUDIT_POSTGRES_URL?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new RecoveryUnavailableError("Recovery operations are unavailable because RECOVERY_AUDIT_POSTGRES_URL is not configured.");
  return "postgresql://ubuntu@/idlr_payment?host=/var/run/postgresql";
}

function poolFor(url: string) {
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 3_000, application_name: "idlr-pts-recovery-controller" });
    pools.set(url, pool);
  }
  return pool;
}

async function readyPool() {
  const url = recoveryAuditUrl();
  const pool = poolFor(url);
  let migration = migrations.get(url);
  if (!migration) {
    migration = runRecoveryMigrations(pool);
    migrations.set(url, migration);
  }
  try {
    await migration;
    return pool;
  } catch (error) {
    migrations.delete(url);
    throw new RecoveryUnavailableError(`Recovery operations are unavailable because durable recovery storage could not be initialized: ${error instanceof Error ? error.message : "unknown PostgreSQL error"}`);
  }
}

async function transaction<T>(operation: (client: PoolClient) => Promise<T>) {
  const pool = await readyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function eventHash(input: { authorizationId: string; sequence: number; eventType: string; occurredAt: string; previousHash: string | null; payload: Record<string, unknown> }) {
  return sha256(JSON.stringify(input));
}

async function appendEvent(client: PoolClient, input: { authorizationId: string; eventType: string; actorSubject: string | null; occurredAt: string; payload: Record<string, unknown> }) {
  const prior = await client.query<{ sequence_number: string; event_hash: string }>("SELECT sequence_number, event_hash FROM recovery_audit_events WHERE authorization_id = $1::uuid ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE", [input.authorizationId]);
  const sequence = prior.rowCount ? Number(prior.rows[0]!.sequence_number) + 1 : 1;
  const previousHash = prior.rowCount ? prior.rows[0]!.event_hash : null;
  const hash = eventHash({ authorizationId: input.authorizationId, sequence, eventType: input.eventType, occurredAt: input.occurredAt, previousHash, payload: input.payload });
  await client.query("INSERT INTO recovery_audit_events (id, authorization_id, sequence_number, event_type, actor_subject, payload, occurred_at, previous_event_hash, event_hash) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,$7::timestamptz,$8,$9)", [crypto.randomUUID(), input.authorizationId, sequence, input.eventType, input.actorSubject, JSON.stringify(input.payload), input.occurredAt, previousHash, hash]);
}

function mapAuthorization(row: RecoveryAuthorizationRow) {
  return {
    id: row.id,
    queueId: row.queue_id,
    payloadHash: row.payload_hash,
    idempotencyKey: row.idempotency_key,
    ownerSubject: row.owner_subject,
    targetDeviceFingerprint: row.target_device_fingerprint,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    consumedAt: row.consumed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function isRecoveryApproverRole(value: string): value is RecoveryApproverRole {
  return (RECOVERY_APPROVER_ROLES as readonly string[]).includes(value);
}

function requireRecoveryRole(principal: EnterprisePrincipal, role: RecoveryApproverRole) {
  if (!principal.agencyRoles.includes(role)) throw new RecoveryAuthorizationError("The authenticated agency role is not authorized for that recovery approval.");
}

function parseHttpsUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function recoveryConfig() {
  const origin = parseHttpsUrl(configuredValue("RECOVERY_WEBAUTHN_ORIGIN"));
  const rpId = configuredValue("RECOVERY_WEBAUTHN_RP_ID");
  const kmsRegion = configuredValue("RECOVERY_KMS_REGION");
  const kmsKeyId = configuredValue("RECOVERY_KMS_KEY_ID");
  const replayUrl = parseHttpsUrl(configuredValue("RECOVERY_REPLAY_URL"));
  const replaySecret = configuredValue("RECOVERY_REPLAY_SHARED_SECRET");
  const replayHosts = (configuredValue("RECOVERY_REPLAY_ALLOWED_HOSTS") ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const webauthnReady = Boolean(origin && rpId && origin.hostname === rpId);
  const kmsReady = Boolean(kmsRegion && kmsKeyId);
  const replayReady = Boolean(replayUrl && replaySecret && replayHosts.includes(replayUrl.hostname.toLowerCase()));
  return { origin, rpId, kmsRegion, kmsKeyId, replayUrl, replaySecret, replayHosts, webauthnReady, kmsReady, replayReady };
}

type ActiveRecoveryConfig = ReturnType<typeof recoveryConfig> & {
  origin: URL;
  rpId: string;
  kmsRegion: string;
  kmsKeyId: string;
  replayUrl: URL;
  replaySecret: string;
};

export function getRecoveryControllerStatus() {
  const config = recoveryConfig();
  const reasons = [
    !config.webauthnReady ? "WebAuthn approval verification requires an HTTPS origin whose hostname equals the configured RP ID." : null,
    !config.kmsReady ? "KMS envelope rewrap requires an approved region and destination key ID." : null,
    !config.replayReady ? "Idempotent replay requires an approved HTTPS endpoint, shared worker credential, and host allowlist." : null,
  ].filter((value): value is string => Boolean(value));
  return {
    available: false,
    configurationComplete: reasons.length === 0,
    operationalVerification: "not_run" as const,
    webauthn: { available: config.webauthnReady, origin: config.origin?.origin ?? null, rpId: config.rpId ?? null },
    kms: { available: config.kmsReady, region: config.kmsRegion ?? null, keyConfigured: Boolean(config.kmsKeyId) },
    replay: { available: config.replayReady, host: config.replayUrl?.hostname ?? null },
    reason: reasons[0] ?? null,
    reasons,
  } as const;
}

function requireControllerConfiguration(): ActiveRecoveryConfig {
  const status = getRecoveryControllerStatus();
  if (!status.configurationComplete) throw new RecoveryUnavailableError(status.reason ?? "Recovery execution is not configured.");
  const config = recoveryConfig();
  if (!config.origin || !config.rpId || !config.kmsRegion || !config.kmsKeyId || !config.replayUrl || !config.replaySecret) throw new RecoveryUnavailableError("Recovery execution is not configured.");
  return {
    ...config,
    origin: config.origin,
    rpId: config.rpId,
    kmsRegion: config.kmsRegion,
    kmsKeyId: config.kmsKeyId,
    replayUrl: config.replayUrl,
    replaySecret: config.replaySecret,
  };
}

function validHash(value: string) {
  return /^[a-f0-9]{64}$/i.test(value);
}

export async function createRecoveryAuthorization(input: { principal: EnterprisePrincipal; queueId: string; payloadHash: string; idempotencyKey: string; targetDeviceFingerprint: string; kmsCiphertext: string }) {
  requireRecoveryRole(input.principal, "security_engineer");
  const config = requireControllerConfiguration();
  if (!input.queueId.trim() || !validHash(input.payloadHash) || !validHash(input.targetDeviceFingerprint) || !/^[0-9a-f-]{36}$/i.test(input.idempotencyKey) || !/^[A-Za-z0-9+/=_-]+$/.test(input.kmsCiphertext)) {
    throw new RecoveryAuthorizationError("Recovery request binding is invalid.");
  }
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + RECOVERY_TTL_MS).toISOString();
  const nonce = crypto.randomBytes(32).toString("base64url");
  const context = { queueId: input.queueId.trim(), payloadHash: input.payloadHash.toLowerCase(), idempotencyKey: input.idempotencyKey.toLowerCase(), targetDeviceFingerprint: input.targetDeviceFingerprint.toLowerCase() };
  const challenge = sha256(["idlr-pts-recovery-v1", id, nonce, context.queueId, context.payloadHash, context.idempotencyKey, context.targetDeviceFingerprint, expiresAt, config.kmsKeyId].join("|"));
  return transaction(async (client) => {
    await client.query("INSERT INTO recovery_authorizations (id, queue_id, payload_hash, idempotency_key, owner_subject, target_device_fingerprint, challenge, kms_ciphertext, kms_encryption_context, status, expires_at, created_at, updated_at) VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8,$9::jsonb,'pending',$10::timestamptz,now(),now())", [id, context.queueId, context.payloadHash, context.idempotencyKey, input.principal.subject, context.targetDeviceFingerprint, challenge, input.kmsCiphertext, JSON.stringify(context), expiresAt]);
    await appendEvent(client, { authorizationId: id, eventType: "recovery_requested", actorSubject: input.principal.subject, occurredAt: new Date().toISOString(), payload: { queueId: context.queueId, payloadHash: context.payloadHash, idempotencyKey: context.idempotencyKey, targetDeviceFingerprint: context.targetDeviceFingerprint, expiresAt } });
    const inserted = await client.query<RecoveryAuthorizationRow>("SELECT id, queue_id, payload_hash, idempotency_key, owner_subject, target_device_fingerprint, challenge, status, expires_at, consumed_at, created_at, updated_at FROM recovery_authorizations WHERE id = $1::uuid", [id]);
    return { authorization: mapAuthorization(inserted.rows[0]!), challenge };
  });
}

export async function getRecoveryAuthorization(authorizationId: string) {
  const pool = await readyPool();
  const result = await pool.query<RecoveryAuthorizationRow>("SELECT id, queue_id, payload_hash, idempotency_key, owner_subject, target_device_fingerprint, challenge, status, expires_at, consumed_at, created_at, updated_at FROM recovery_authorizations WHERE id = $1::uuid", [authorizationId]);
  return result.rowCount ? mapAuthorization(result.rows[0]!) : null;
}

export async function approveRecoveryAuthorization(input: { principal: EnterprisePrincipal; authorizationId: string; approvalRole: RecoveryApproverRole; assertion: AuthenticationResponseJSON }) {
  const config = requireControllerConfiguration();
  requireRecoveryRole(input.principal, input.approvalRole);
  return transaction(async (client) => {
    const locked = await client.query<RecoveryLockedRow>("SELECT * FROM recovery_authorizations WHERE id = $1::uuid FOR UPDATE", [input.authorizationId]);
    if (!locked.rowCount) throw new RecoveryAuthorizationError("Recovery authorization was not found.");
    const authorization = locked.rows[0]!;
    if (authorization.status !== "pending" || authorization.expires_at <= new Date()) {
      if (authorization.status === "pending") await client.query("UPDATE recovery_authorizations SET status = 'expired', updated_at = now() WHERE id = $1::uuid", [authorization.id]);
      throw new RecoveryAuthorizationError("Recovery authorization is no longer pending.");
    }
    const credential = await client.query<CredentialRow>("SELECT id, credential_id, credential_public_key, sign_count, transports FROM webauthn_credentials WHERE subject = $1 AND credential_id = $2 AND revoked_at IS NULL FOR UPDATE", [input.principal.subject, input.assertion.id]);
    if (!credential.rowCount) throw new RecoveryAuthorizationError("No active registered passkey is available for this recovery approver.");
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: input.assertion,
        expectedChallenge: authorization.challenge,
        expectedOrigin: config.origin.origin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
        credential: {
          id: credential.rows[0]!.credential_id,
          publicKey: Buffer.from(credential.rows[0]!.credential_public_key, "base64"),
          counter: Number(credential.rows[0]!.sign_count),
        },
      });
    } catch {
      throw new RecoveryAuthorizationError("WebAuthn verification rejected this recovery approval.");
    }
    if (!verification.verified || verification.authenticationInfo.newCounter <= Number(credential.rows[0]!.sign_count)) throw new RecoveryAuthorizationError("WebAuthn verification did not advance the credential counter.");
    await client.query("UPDATE webauthn_credentials SET sign_count = $1 WHERE id = $2::uuid", [verification.authenticationInfo.newCounter, credential.rows[0]!.id]);
    const signedAt = new Date().toISOString();
    try {
      await client.query("INSERT INTO recovery_approvals (id, authorization_id, approver_subject, approver_role, credential_id, assertion, signed_digest, sign_count, signed_at) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,$7,$8,$9::timestamptz)", [crypto.randomUUID(), authorization.id, input.principal.subject, input.approvalRole, credential.rows[0]!.credential_id, JSON.stringify(input.assertion), authorization.challenge, verification.authenticationInfo.newCounter, signedAt]);
    } catch {
      throw new RecoveryAuthorizationError("This subject or approval role has already signed the recovery authorization.");
    }
    await appendEvent(client, { authorizationId: authorization.id, eventType: "recovery_approval_verified", actorSubject: input.principal.subject, occurredAt: signedAt, payload: { approvalRole: input.approvalRole, credentialIdHash: sha256(credential.rows[0]!.credential_id), signedDigest: authorization.challenge, signCount: verification.authenticationInfo.newCounter } });
    const approvals = await client.query<{ approver_role: RecoveryApproverRole; approver_subject: string }>("SELECT approver_role, approver_subject FROM recovery_approvals WHERE authorization_id = $1::uuid", [authorization.id]);
    const approvedRoles = new Set(approvals.rows.map((entry) => entry.approver_role));
    const approvedSubjects = new Set(approvals.rows.map((entry) => entry.approver_subject));
    if (approvedSubjects.size === 2 && RECOVERY_APPROVER_ROLES.every((role) => approvedRoles.has(role))) {
      await client.query("UPDATE recovery_authorizations SET status = 'authorized', updated_at = now() WHERE id = $1::uuid", [authorization.id]);
      await appendEvent(client, { authorizationId: authorization.id, eventType: "recovery_quorum_authorized", actorSubject: input.principal.subject, occurredAt: new Date().toISOString(), payload: { roles: RECOVERY_APPROVER_ROLES, approvalCount: approvals.rowCount } });
    }
    return getRecoveryAuthorization(authorization.id);
  });
}

async function rewrapEnvelope(input: { ciphertext: string; context: Record<string, string>; region: string; keyId: string }) {
  const response = await new KMSClient({ region: input.region }).send(new ReEncryptCommand({ CiphertextBlob: Buffer.from(input.ciphertext, "base64"), DestinationKeyId: input.keyId, SourceEncryptionContext: input.context, DestinationEncryptionContext: input.context }));
  if (!response.CiphertextBlob) throw new RecoveryUnavailableError("KMS did not return a re-encrypted recovery envelope.");
  return Buffer.from(response.CiphertextBlob).toString("base64");
}

async function deliverReplay(input: { endpoint: URL; sharedSecret: string; authorization: RecoveryLockedRow; rewrappedCiphertext: string }) {
  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${input.sharedSecret}`, "idempotency-key": input.authorization.idempotency_key },
    body: JSON.stringify({ authorizationId: input.authorization.id, queueId: input.authorization.queue_id, payloadHash: input.authorization.payload_hash, idempotencyKey: input.authorization.idempotency_key, targetDeviceFingerprint: input.authorization.target_device_fingerprint, encryptedPayload: input.rewrappedCiphertext, encryptionContext: input.authorization.kms_encryption_context }),
  });
  if (!response.ok) throw new RecoveryUnavailableError(`Recovery replay endpoint rejected the authorized request (${response.status}).`);
}

export async function executeAuthorizedRecovery(authorizationId: string) {
  const config = requireControllerConfiguration();
  const claimed = await transaction(async (client) => {
    const result = await client.query<RecoveryLockedRow>("SELECT * FROM recovery_authorizations WHERE id = $1::uuid FOR UPDATE", [authorizationId]);
    if (!result.rowCount) throw new RecoveryAuthorizationError("Recovery authorization was not found.");
    const authorization = result.rows[0]!;
    if (authorization.status !== "authorized") throw new RecoveryAuthorizationError("Recovery authorization is not ready for controlled replay.");
    await client.query("UPDATE recovery_authorizations SET status = 'rewrap_in_progress', updated_at = now() WHERE id = $1::uuid", [authorization.id]);
    await appendEvent(client, { authorizationId: authorization.id, eventType: "kms_rewrap_started", actorSubject: null, occurredAt: new Date().toISOString(), payload: { destinationKeyConfigured: true } });
    return authorization;
  });
  let rewrappedCiphertext: string;
  try {
    rewrappedCiphertext = await rewrapEnvelope({ ciphertext: claimed.kms_ciphertext, context: claimed.kms_encryption_context, region: config.kmsRegion, keyId: config.kmsKeyId });
  } catch (error) {
    await transaction(async (client) => { await client.query("UPDATE recovery_authorizations SET status = 'authorized', updated_at = now() WHERE id = $1::uuid AND status = 'rewrap_in_progress'", [claimed.id]); await appendEvent(client, { authorizationId: claimed.id, eventType: "kms_rewrap_failed", actorSubject: null, occurredAt: new Date().toISOString(), payload: { reason: error instanceof Error ? error.message.slice(0, 240) : "KMS request failed" } }); });
    throw new RecoveryUnavailableError("KMS envelope rewrap failed; the authorization remains available for a controlled retry.");
  }
  await transaction(async (client) => { await client.query("UPDATE recovery_authorizations SET rewrapped_ciphertext = $1, status = 'replay_in_progress', updated_at = now() WHERE id = $2::uuid AND status = 'rewrap_in_progress'", [rewrappedCiphertext, claimed.id]); await client.query("INSERT INTO recovery_replays (authorization_id, idempotency_key, status, replay_endpoint, attempts) VALUES ($1::uuid,$2::uuid,'in_progress',$3,1) ON CONFLICT (authorization_id) DO UPDATE SET status = 'in_progress', attempts = recovery_replays.attempts + 1, last_error = NULL", [claimed.id, claimed.idempotency_key, config.replayUrl.toString()]); await appendEvent(client, { authorizationId: claimed.id, eventType: "recovery_replay_started", actorSubject: null, occurredAt: new Date().toISOString(), payload: { replayHost: config.replayUrl.hostname } }); });
  try {
    await deliverReplay({ endpoint: config.replayUrl, sharedSecret: config.replaySecret, authorization: claimed, rewrappedCiphertext });
  } catch (error) {
    await transaction(async (client) => { await client.query("UPDATE recovery_authorizations SET status = 'authorized', updated_at = now() WHERE id = $1::uuid AND status = 'replay_in_progress'", [claimed.id]); await client.query("UPDATE recovery_replays SET status = 'failed', last_error = $1 WHERE authorization_id = $2::uuid", [error instanceof Error ? error.message.slice(0, 500) : "Replay request failed", claimed.id]); await appendEvent(client, { authorizationId: claimed.id, eventType: "recovery_replay_failed", actorSubject: null, occurredAt: new Date().toISOString(), payload: { reason: error instanceof Error ? error.message.slice(0, 240) : "Replay request failed" } }); });
    throw error;
  }
  return transaction(async (client) => { await client.query("UPDATE recovery_replays SET status = 'succeeded', completed_at = now(), last_error = NULL WHERE authorization_id = $1::uuid", [claimed.id]); await client.query("UPDATE recovery_authorizations SET status = 'consumed', consumed_at = now(), updated_at = now() WHERE id = $1::uuid AND status = 'replay_in_progress'", [claimed.id]); await appendEvent(client, { authorizationId: claimed.id, eventType: "recovery_replay_consumed", actorSubject: null, occurredAt: new Date().toISOString(), payload: { idempotencyKey: claimed.idempotency_key, payloadHash: claimed.payload_hash } }); return getRecoveryAuthorization(claimed.id); });
}
