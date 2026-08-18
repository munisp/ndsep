import { describe, expect, it } from "vitest";
import { x25519 } from "@noble/curves/ed25519";
import { bytesToHex } from "@noble/ciphers/utils";
import { decryptAdministrativeSupportPackage, encryptForAdministrativeSupport } from "../lib/stakeholder-support-crypto";

describe("administrative public-key support diagnostics", () => {
  const randomBytes = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 29 + 11) % 256);
  it("encrypts for an X25519 administrator public key and decrypts only with its private key", async () => { const administratorPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1); const pkg = await encryptForAdministrativeSupport("authorized technical detail", bytesToHex(x25519.getPublicKey(administratorPrivateKey)), randomBytes); expect(pkg.ciphertext).not.toContain("technical detail"); await expect(decryptAdministrativeSupportPackage(pkg, bytesToHex(administratorPrivateKey))).resolves.toBe("authorized technical detail"); const otherPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 33); await expect(decryptAdministrativeSupportPackage(pkg, bytesToHex(otherPrivateKey))).rejects.toThrow(); });
});
