import { describe, expect, it } from "vitest";
import { authorizeTechnicalQueueView } from "../lib/technical-view-authorization";

describe("technical queue view authorization", () => {
  const adapter = (overrides: Partial<{ hardware: boolean; enrolled: boolean; success: boolean }> = {}) => ({ hasHardwareAsync: async () => overrides.hardware ?? true, isEnrolledAsync: async () => overrides.enrolled ?? true, authenticateAsync: async () => ({ success: overrides.success ?? true }) });
  it("authorizes technical history only after native device confirmation", async () => expect((await authorizeTechnicalQueueView(adapter())).approved).toBe(true));
  it("fails closed when device authorization is unavailable or declined", async () => { expect((await authorizeTechnicalQueueView(adapter({ hardware: false }))).approved).toBe(false); expect((await authorizeTechnicalQueueView(adapter({ enrolled: false }))).approved).toBe(false); expect((await authorizeTechnicalQueueView(adapter({ success: false }))).approved).toBe(false); });
});
