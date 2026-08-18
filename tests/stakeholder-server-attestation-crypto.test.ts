import { describe, expect, it } from "vitest";
import { bytesToHex } from "@noble/ciphers/utils";
import { createServerDiagnosticExportReceipt, parseAndVerifyServerDiagnosticExportReceipt, verifyServerDiagnosticExportReceipt } from "../lib/stakeholder-server-attestation-crypto";

describe("organization diagnostic export receipts", () => {
  it("signs and verifies an organization receipt while rejecting tampering", async () => { const privateKey = bytesToHex(Uint8Array.from({ length: 32 }, (_, index) => index + 71)); const receipt = await createServerDiagnosticExportReceipt({ receiptId: "org-001", attestedAt: "2026-08-18T00:00:00.000Z", packageType: "administrative_public_key", packageSha256: "a".repeat(64), attestedForSubject: "agency-admin" }, privateKey, "org-key-v1"); await expect(verifyServerDiagnosticExportReceipt(receipt)).resolves.toBe(true); await expect(parseAndVerifyServerDiagnosticExportReceipt(JSON.stringify(receipt))).resolves.toMatchObject({ valid: true }); await expect(verifyServerDiagnosticExportReceipt({ ...receipt, packageSha256: "b".repeat(64) })).resolves.toBe(false); });
});
