import { describe, it, expect, vi, beforeAll } from "vitest";

describe("encryption", () => {
  beforeAll(() => {
    process.env.FIELD_ENCRYPTION_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  });

  it("should encrypt and decrypt a string round-trip", async () => {
    const { encryptField, decryptField } = await import("./encryption");
    const plaintext = "test@citizen.ng";
    const encrypted = encryptField(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.startsWith("enc:v1:")).toBe(true);

    const decrypted = decryptField(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("should return original if already encrypted", async () => {
    const { encryptField } = await import("./encryption");
    const alreadyEncrypted = "enc:v1:aabbccdd:eeff0011:deadbeef";
    const result = encryptField(alreadyEncrypted);
    expect(result).toBe(alreadyEncrypted);
  });

  it("should return original if not encrypted on decrypt", async () => {
    const { decryptField } = await import("./encryption");
    const plaintext = "not-encrypted";
    const result = decryptField(plaintext);
    expect(result).toBe(plaintext);
  });

  it("should produce different ciphertexts for same plaintext (unique IV)", async () => {
    const { encryptField } = await import("./encryption");
    const plaintext = "same-input-different-output";
    const enc1 = encryptField(plaintext);
    const enc2 = encryptField(plaintext);
    expect(enc1).not.toBe(enc2);
  });

  it("should handle empty string", async () => {
    const { encryptField } = await import("./encryption");
    const result = encryptField("");
    expect(result).toBe("");
  });

  it("should handle Unicode characters", async () => {
    const { encryptField, decryptField } = await import("./encryption");
    const unicode = "Olúwafẹ́mi Adébólá 🇳🇬";
    const encrypted = encryptField(unicode);
    const decrypted = decryptField(encrypted);
    expect(decrypted).toBe(unicode);
  });
});
