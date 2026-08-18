import { describe, expect, it } from "vitest";
import { bytesToHex } from "@noble/ciphers/utils";
import { x25519 } from "@noble/curves/ed25519";
import { getAdministrativeSupportKeyFingerprint } from "../lib/stakeholder-support-crypto";
import { createDiagnosticExportReceipt, parseAndVerifyDiagnosticExportReceipt, verifyDiagnosticExportReceipt } from "../lib/stakeholder-export-receipt-crypto";

describe("diagnostic export receipts and administrative key identity", () => {
  it("derives a stable display fingerprint from an X25519 administrative public key", async () => { const publicKey = bytesToHex(x25519.getPublicKey(Uint8Array.from({ length: 32 }, (_, index) => index + 4))); const fingerprint = await getAdministrativeSupportKeyFingerprint(publicKey); expect(fingerprint).toMatch(/^[0-9a-f]{4}(:[0-9a-f]{4}){5}$/); await expect(getAdministrativeSupportKeyFingerprint("not-a-key")).rejects.toThrow("invalid"); });
  it("signs a receipt that verifies and rejects a modified package digest", async () => { const privateKey = bytesToHex(Uint8Array.from({ length: 32 }, (_, index) => index + 11)); const receipt = await createDiagnosticExportReceipt({ schema: "pkg", ciphertext: "opaque" }, "administrative_public_key", privateKey, "receipt-001", "2026-08-18T00:00:00.000Z"); await expect(verifyDiagnosticExportReceipt(receipt)).resolves.toBe(true); await expect(verifyDiagnosticExportReceipt({ ...receipt, packageSha256: "tampered" })).resolves.toBe(false); });
  it("parses a downloaded receipt and reports malformed or tampered content", async () => { const privateKey = bytesToHex(Uint8Array.from({ length: 32 }, (_, index) => index + 21)); const receipt = await createDiagnosticExportReceipt({ schema: "pkg", ciphertext: "opaque" }, "passphrase_encrypted", privateKey, "receipt-002", "2026-08-18T00:00:00.000Z"); await expect(parseAndVerifyDiagnosticExportReceipt(JSON.stringify(receipt))).resolves.toMatchObject({ valid: true }); await expect(parseAndVerifyDiagnosticExportReceipt(JSON.stringify({ ...receipt, signature: "00" }))).resolves.toMatchObject({ valid: false }); await expect(parseAndVerifyDiagnosticExportReceipt("not-json")).resolves.toMatchObject({ valid: false }); });
});
