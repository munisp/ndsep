import { describe, expect, it } from "vitest";
// Staging contract: substitute pgTestDb, WebAuthn virtual authenticators, and a KMS drill mock.
describe("dual approval recovery", () => {
  it("rejects KMS revocation, then accepts one replay only after distinct WebAuthn approvals", async () => {
    const harness = await createStagingRecoveryHarness();
    const request = await harness.createAuthorization({queueId:"q1",payloadHash:"a".repeat(64),device:"device-a"});
    await expect(harness.rewrap({authorizationId:request.id, kmsMode:"revoked"})).rejects.toMatchObject({code:"KMS_ACCESS_DENIED"});
    await harness.approve({authorizationId:request.id, principal:"sec-1", role:"security_engineer", webauthn:"valid"});
    await expect(harness.replay({authorizationId:request.id, device:"device-a"})).rejects.toMatchObject({code:"FORBIDDEN"});
    await harness.approve({authorizationId:request.id, principal:"ops-1", role:"planning_supervisor", webauthn:"valid"});
    const first = await harness.replay({authorizationId:request.id, device:"device-a", idempotencyKey:request.idempotencyKey});
    const second = await harness.replay({authorizationId:request.id, device:"device-a", idempotencyKey:request.idempotencyKey});
    expect(second).toEqual(first); expect(await harness.outboundSideEffects()).toBe(1);
  });
});
declare function createStagingRecoveryHarness(): any;
