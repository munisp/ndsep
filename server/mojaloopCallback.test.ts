import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { verifyMojaloopCallbackSignature } from "./mojaloopCallback";

const secret = "m".repeat(48);
const body = Buffer.from(
  '{"transferId":"NIP-123","transferState":"COMMITTED"}',
  "utf8"
);

function signature(value: Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(value).digest("hex")}`;
}

describe("Mojaloop callback signature verification", () => {
  beforeEach(() => {
    process.env.MOJALOOP_CALLBACK_HMAC_SECRET = secret;
  });

  it("accepts the exact signed raw payload", () => {
    expect(verifyMojaloopCallbackSignature(body, signature(body))).toBe(true);
  });

  it("rejects a valid signature after payload alteration", () => {
    const altered = Buffer.from(
      '{"transferId":"NIP-124","transferState":"COMMITTED"}',
      "utf8"
    );
    expect(verifyMojaloopCallbackSignature(altered, signature(body))).toBe(
      false
    );
  });

  it("rejects malformed and missing signatures", () => {
    expect(verifyMojaloopCallbackSignature(body, undefined)).toBe(false);
    expect(verifyMojaloopCallbackSignature(body, "sha256=not-hex")).toBe(false);
  });

  it("rejects a placeholder callback secret", () => {
    expect(() =>
      verifyMojaloopCallbackSignature(body, signature(body), "CHANGE_ME")
    ).toThrow(/non-placeholder secret/);
  });
});
