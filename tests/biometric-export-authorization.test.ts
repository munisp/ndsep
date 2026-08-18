import { describe, expect, it } from "vitest";
import { authorizeEncryptedDiagnosticsExport } from "../lib/biometric-export-authorization";

describe("encrypted diagnostics biometric authorization", () => {
  const adapter = (overrides: Partial<{ hardware: boolean; enrolled: boolean; success: boolean }> = {}) => ({ hasHardwareAsync: async () => overrides.hardware ?? true, isEnrolledAsync: async () => overrides.enrolled ?? true, authenticateAsync: async () => ({ success: overrides.success ?? true }) });
  it("approves export only after a strong biometric confirmation", async () => expect((await authorizeEncryptedDiagnosticsExport(adapter())).approved).toBe(true));
  it("fails closed when biometric hardware or enrollment is unavailable", async () => { expect((await authorizeEncryptedDiagnosticsExport(adapter({ hardware: false }))).approved).toBe(false); expect((await authorizeEncryptedDiagnosticsExport(adapter({ enrolled: false }))).approved).toBe(false); });
  it("does not approve when the user does not complete biometric confirmation", async () => expect((await authorizeEncryptedDiagnosticsExport(adapter({ success: false }))).approved).toBe(false));
});
