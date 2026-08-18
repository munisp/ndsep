import { describe, expect, it } from "vitest";
import { decryptAuthorizedSupportDiagnostics, encryptAuthorizedSupportDiagnostics } from "../lib/stakeholder-support-crypto";

describe("authorized support diagnostics encryption", () => {
  const randomBytes = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 13 + 7) % 256);
  it("encrypts with AES-GCM and decrypts only with the authorized passphrase", async () => { const pkg = await encryptAuthorizedSupportDiagnostics('{"diagnostic":"private"}', "authorized-support-passphrase", randomBytes); expect(pkg.ciphertext).not.toContain("diagnostic"); await expect(decryptAuthorizedSupportDiagnostics(pkg, "authorized-support-passphrase")).resolves.toBe('{"diagnostic":"private"}'); await expect(decryptAuthorizedSupportDiagnostics(pkg, "incorrect-support-passphrase")).rejects.toThrow(); });
  it("rejects short support passphrases", async () => await expect(encryptAuthorizedSupportDiagnostics("data", "short", randomBytes)).rejects.toThrow("12-character"));
});
