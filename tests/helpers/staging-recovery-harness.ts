type Authorization = {
  id: string;
  idempotencyKey: string;
  queueId: string;
  payloadHash: string;
  device: string;
  approvals: Array<{ principal: string; role: string }>;
  replayResult?: { authorizationId: string; queueId: string; replayed: true };
};

function codedError(code: string) {
  return Object.assign(new Error(code), { code });
}

/**
 * Deterministic test harness for recovery invariants. It is not a KMS,
 * WebAuthn provider, or replay worker; production integration remains covered
 * by target-environment recovery drills.
 */
export async function createStagingRecoveryHarness() {
  const authorizations = new Map<string, Authorization>();
  let outboundEffects = 0;

  return {
    async createAuthorization(input: { queueId: string; payloadHash: string; device: string }) {
      const id = `recovery-${authorizations.size + 1}`;
      const authorization: Authorization = {
        id,
        idempotencyKey: `idem-${id}`,
        ...input,
        approvals: [],
      };
      authorizations.set(id, authorization);
      return authorization;
    },
    async rewrap(input: { authorizationId: string; kmsMode: "healthy" | "revoked" }) {
      if (!authorizations.has(input.authorizationId)) throw codedError("NOT_FOUND");
      if (input.kmsMode === "revoked") throw codedError("KMS_ACCESS_DENIED");
      return { rewrapped: true };
    },
    async approve(input: { authorizationId: string; principal: string; role: string; webauthn: "valid" | "invalid" }) {
      const authorization = authorizations.get(input.authorizationId);
      if (!authorization) throw codedError("NOT_FOUND");
      if (input.webauthn !== "valid") throw codedError("WEBAUTHN_INVALID");
      if (authorization.approvals.some((approval) => approval.principal === input.principal)) throw codedError("DUPLICATE_APPROVER");
      authorization.approvals.push({ principal: input.principal, role: input.role });
    },
    async replay(input: { authorizationId: string; device: string; idempotencyKey?: string }) {
      const authorization = authorizations.get(input.authorizationId);
      if (!authorization || input.device !== authorization.device) throw codedError("FORBIDDEN");
      const hasSecurity = authorization.approvals.some((approval) => approval.role === "security_engineer");
      const hasSupervisor = authorization.approvals.some((approval) => approval.role === "planning_supervisor");
      if (!hasSecurity || !hasSupervisor) throw codedError("FORBIDDEN");
      if (input.idempotencyKey !== authorization.idempotencyKey) throw codedError("IDEMPOTENCY_KEY_INVALID");
      if (!authorization.replayResult) {
        authorization.replayResult = { authorizationId: authorization.id, queueId: authorization.queueId, replayed: true };
        outboundEffects += 1;
      }
      return authorization.replayResult;
    },
    async outboundSideEffects() {
      return outboundEffects;
    },
  };
}
