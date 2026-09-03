import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Mojaloop receipt-integrity source contract", () => {
  it("does not fabricate a committed transfer state from a successful submission", () => {
    const adapter = read("server/mojaloop.ts");
    const transfer = adapter.slice(adapter.indexOf("export async function executeTransfer"), adapter.indexOf("// ─── Smoke Test"));
    expect(transfer).toContain('reportedState || "ACCEPTED"');
    expect(transfer).toContain("Terminal settlement");
    expect(transfer).not.toContain('d.transferState ?? "COMMITTED"');
  });

  it("requires a durable Mojaloop settlement identifier before reporting success", () => {
    const adapter = read("server/mojaloop.ts");
    const settlement = adapter.slice(adapter.indexOf("export async function createSettlement"), adapter.indexOf("export async function getSettlements"));
    expect(settlement).toContain("const settlementId");
    expect(settlement).toContain("ok: ok && settlementId.length > 0");
    expect(settlement).toContain("cannot be reconciled safely");
  });

  it("keeps authenticated callback reconciliation as the payment-command terminal path", () => {
    const callback = read("server/mojaloopCallback.ts");
    expect(callback).toContain("applyMojaloopPaymentCallback");
    expect(callback).toContain("verifyCallback");
    expect(callback).toContain("Illegal transfer state transition");
  });
});
