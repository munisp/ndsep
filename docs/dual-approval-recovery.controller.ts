// @ts-nocheck
/** Proposed service module. Requires @simplewebauthn/server and PostgreSQL serializable transactions. */
import crypto from "node:crypto";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const digestFor = (a: any) => sha256([a.id,a.queue_id,a.payload_hash,a.idempotency_key,a.target_device_fingerprint,a.expires_at.toISOString(),Buffer.from(a.challenge).toString("base64url")].join("|"));

export async function approveRecovery(db: any, principal: {subject:string;role:string}, input: {authorizationId:string;response:any}) {
  if (!["security_engineer","planning_supervisor"].includes(principal.role)) throw Object.assign(new Error("forbidden"), {code:"FORBIDDEN"});
  return db.transaction(async (tx: any) => {
    await tx.query("set transaction isolation level serializable");
    const auth = await tx.one("select * from recovery_authorizations where id=$1 for update", [input.authorizationId]);
    if (auth.status !== "pending" || auth.expires_at <= new Date()) throw Object.assign(new Error("authorization unavailable"), {code:"PRECONDITION_FAILED"});
    const credential = await tx.one("select * from webauthn_credentials where subject=$1 and credential_id=$2", [principal.subject, Buffer.from(input.response.id, "base64url")]);
    const expectedChallenge = digestFor(auth);
    const verified = await verifyAuthenticationResponse({response:input.response, expectedChallenge, expectedOrigin:process.env.RECOVERY_WEBAUTHN_ORIGIN!, expectedRPID:process.env.RECOVERY_WEBAUTHN_RP_ID!, authenticator:{credentialID:credential.credential_id,credentialPublicKey:credential.public_key,counter:credential.sign_count}});
    if (!verified.verified || verified.authenticationInfo.newCounter <= credential.sign_count) throw Object.assign(new Error("webauthn verification failed"), {code:"UNAUTHORIZED"});
    await tx.query("update webauthn_credentials set sign_count=$1 where id=$2", [verified.authenticationInfo.newCounter, credential.id]);
    await tx.query("insert into recovery_approvals(authorization_id,approver_subject,approver_role,credential_id,assertion,signed_digest,sign_count) values($1,$2,$3,$4,$5,$6,$7)", [auth.id,principal.subject,principal.role,credential.credential_id,input.response,expectedChallenge,verified.authenticationInfo.newCounter]);
    const roles = await tx.many("select approver_subject,approver_role from recovery_approvals where authorization_id=$1", [auth.id]);
    if (new Set(roles.map((r:any)=>r.approver_subject)).size === 2 && new Set(roles.map((r:any)=>r.approver_role)).size === 2) await tx.query("update recovery_authorizations set status='authorized' where id=$1", [auth.id]);
    await tx.query("insert into recovery_audit_events(authorization_id,event_type,actor_subject,event_hash) values($1,'approval',$2,$3)", [auth.id,principal.subject,sha256(expectedChallenge+principal.subject)]);
  });
}
