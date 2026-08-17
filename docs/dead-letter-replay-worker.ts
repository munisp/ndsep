/** Proposed worker: device submits plaintext only over TLS after local SQLCipher integrity verification. */
export async function consumeAndReplay(db: any, request: {subject:string;deviceFingerprint:string;authorizationId:string;idempotencyKey:string;payloadHash:string;payload:unknown}, submit: (payload:unknown,key:string)=>Promise<unknown>) {
  return db.transaction(async (tx:any) => {
    await tx.query("set transaction isolation level serializable");
    const a = await tx.one("select * from recovery_authorizations where id=$1 for update", [request.authorizationId]);
    if (a.status !== "authorized" || a.expires_at <= new Date() || a.owner_subject !== request.subject || a.target_device_fingerprint !== request.deviceFingerprint || a.idempotency_key !== request.idempotencyKey || a.payload_hash !== request.payloadHash) throw Object.assign(new Error("invalid recovery grant"), {code:"FORBIDDEN"});
    await tx.query("update recovery_authorizations set status='consumed', consumed_at=now() where id=$1", [a.id]);
    const prior = await tx.maybeOne("select response_json from replay_idempotency where idempotency_key=$1 for update", [request.idempotencyKey]);
    if (prior) return prior.response_json;
    const response = await submit(request.payload, request.idempotencyKey);
    await tx.query("insert into replay_idempotency(idempotency_key,payload_hash,response_json) values($1,$2,$3)", [request.idempotencyKey,request.payloadHash,response]);
    await tx.query("insert into recovery_audit_events(authorization_id,event_type,actor_subject,event_hash) values($1,'replayed',$2,$3)", [a.id,request.subject,request.payloadHash]);
    return response;
  });
}
