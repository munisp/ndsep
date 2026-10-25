/**
 * Round-9 static source invariants (same style as tests/round8/ninPrivacy).
 * These guard the hard rules that pure-logic tests cannot reach:
 * no DB-derived HMAC fallbacks, gateway auth, session binding, status vocab.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const src = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

describe("ninIdentity hardening invariants", () => {
  const nin = src("server/routers/ninIdentity.ts");

  it("NIN HMAC key is never derived from DATABASE_URL", () => {
    expect(nin).not.toMatch(/process\.env\.DATABASE_URL/);
  });

  it("fails closed via requireHmacKey", () => {
    expect(nin).toContain('requireHmacKey(NIN_HMAC_KEY, "NIN_HMAC_KEY"');
  });

  it("verifyBasic must never supersede nin_verified rows", () => {
    expect(nin).toContain("assurance_level = 'nin_verified'");
    // The revoke on the basic path must be scoped to 'basic' rows only.
    expect(nin).toMatch(/status = 'revoked'[\s\S]{0,300}assurance_level = 'basic'/);
  });

  it("checkVerification is staff-only", () => {
    expect(nin).toMatch(/checkVerification:\s*staffProcedure/);
  });

  it("verifyNin runs revoke+insert in one transaction", () => {
    expect(nin).toContain("BEGIN");
    expect(nin).toContain("COMMIT");
    expect(nin).toMatch(/23505/); // clean CONFLICT on the unique active-subject index
  });
});

describe("ussdChannel hardening invariants", () => {
  const ussd = src("server/routers/ussdChannel.ts");

  it("gateway authentication is verified before processing", () => {
    expect(ussd).toContain("verifyGatewayAuth");
    expect(ussd).toContain("x-gateway-secret");
    expect(ussd).toContain("x-ussd-signature");
    expect(ussd).toContain("USSD_GATEWAY_SECRET");
  });

  it("session resume is bound to the MSISDN HMAC", () => {
    expect(ussd).toMatch(/FROM ussd_sessions WHERE session_id = \$1 AND msisdn_hmac = \$2/);
  });

  it("lands complaints in public_complaints (queue is fallback only)", () => {
    expect(ussd).toContain("INSERT INTO public_complaints");
    expect(ussd).toContain("pending_sync");
    expect(ussd).toContain("syncPendingIntake");
  });

  it("duplicate-confirm idempotency reuses the stored complaint_ref", () => {
    expect(ussd).toMatch(/complaint_ref[\s\S]{0,200}duplicate: true/);
  });

  it("notifyStatusChange derives the recipient from the intake row", () => {
    expect(ussd).toMatch(/FROM ussd_intake_queue\s+WHERE complaint_ref = \$1/);
    expect(ussd).toContain("msisdnHmac(input.msisdn) !== intake[0].msisdn_hmac");
  });

  it("listIntakeQueue decrypts descriptions", () => {
    expect(ussd).toContain("decryptField(r.description)");
  });
});

describe("dsarEdgeCases hardening invariants", () => {
  const dsar = src("server/routers/dsarEdgeCases.ts");

  it("mergeRequests uses the 'merged' status, not 'completed'", () => {
    expect(dsar).toContain("status = 'merged'");
  });

  it("verify procedures are staff-only", () => {
    expect(dsar).toMatch(/verifyRepresentative:\s*staffProcedure/);
    expect(dsar).toMatch(/verifyExecutor:\s*staffProcedure/);
  });

  it("appeal pointer cites NDPA s.46 without an invented 30-day bar", () => {
    expect(dsar).toContain("section 46 of the Nigeria Data Protection Act 2023");
    const pointer = dsar.slice(dsar.indexOf("const APPEAL_POINTER"));
    expect(pointer.slice(0, pointer.indexOf(";"))).not.toMatch(/30[- ]day|thirty/i);
  });

  it("response clock pause/resume is implemented", () => {
    expect(dsar).toContain("dsar_clock_pauses");
    expect(dsar).toContain("pauseClock");
    expect(dsar).toContain("resumeClock");
  });

  it("extension is capped at 60 days with a mandatory notification", () => {
    expect(dsar).toContain("MAX_EXTENSION_DAYS_TOTAL = 60");
    expect(dsar).toContain("extension_notified_at");
    expect(dsar).toContain("dsar_notification_retries");
  });
});

describe("whistleblowerChannel hardening invariants", () => {
  const wb = src("server/routers/whistleblowerChannel.ts");

  it("getChannelMessages is read-only (no side-effect UPDATE)", () => {
    const body = wb.slice(wb.indexOf("getChannelMessages"), wb.indexOf("markRead"));
    expect(body).not.toContain("UPDATE");
  });

  it("markRead is a separate mutation", () => {
    expect(wb).toMatch(/markRead:\s*publicProcedure[\s\S]{0,200}\.mutation/);
  });

  it("reportRetaliation requires the channel token", () => {
    const body = wb.slice(wb.indexOf("reportRetaliation"), wb.indexOf("listProtectionFlags"));
    expect(body).toContain("accessToken: z.string().min(20)"); // required, not .optional()
    expect(body).toContain("resolveToken(input.accessToken)");
  });

  it("reporter emails are encrypted at write", () => {
    expect(wb.match(/encryptField\(input\.reporterEmail\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2); // reports + protection flags
  });
});

describe("consentPropagation hardening invariants", () => {
  const cp = src("server/routers/consentPropagation.ts");

  it("acknowledgeByToken matches only the hashed token", () => {
    const body = cp.slice(cp.indexOf("acknowledgeByToken: publicProcedure"), cp.indexOf("reissueAckToken: adminProcedure"));
    expect(body).toContain("sha256Hex(input.ackToken)");
    expect(body).not.toMatch(/ack_token = \$\d+ OR ack_token =/); // no plaintext fallback
  });

  it("failed dispatch never sets status 'notified'", () => {
    expect(cp).toContain("SET status = 'failed'");
    expect(cp).toContain("status: \"failed\"");
  });

  it("SSRF validation runs at registration and dispatch", () => {
    expect(cp.match(/assertSafeAckEndpoint/g)?.length ?? 0).toBeGreaterThanOrEqual(3); // def + register + dispatch + retry
  });

  it("self-service withdrawal endpoint exists (NDPA s.35 parity)", () => {
    expect(cp).toContain("createWithdrawalLink");
    expect(cp).toMatch(/withdrawByToken:\s*publicProcedure/);
    expect(cp).toContain("consent_withdrawal_links");
  });
});
