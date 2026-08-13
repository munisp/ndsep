import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TrpcContext } from "../server/_core/context";
import { appRouter } from "../server/routers";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "idlr-payment-router-"));
const storePath = path.join(temporaryDirectory, "offline-payments.json");
process.env.PAYMENT_OPERATIONS_STORE_PATH = storePath;

function contextFor(openId: string, role: "user" | "admin"): TrpcContext {
  return {
    user: {
      id: role === "admin" ? 2 : 1,
      openId,
      email: `${openId}@example.test`,
      name: role === "admin" ? "Payment Administrator" : "Amina Musa",
      loginMethod: "test",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => fs.rmSync(storePath, { force: true }));
afterEach(() => fs.rmSync(storePath, { force: true }));

describe("payment operation routes", () => {
  it("keeps applicant alerts account-scoped while allowing only an administrator to review and scan a receipt", async () => {
    const applicant = appRouter.createCaller(contextFor("applicant-1", "user"));
    const administrator = appRouter.createCaller(contextFor("admin-1", "admin"));

    const submitted = await applicant.paymentOperations.submitOfflinePayment({
      reference: "LAG-COO-2026-001",
      amountKobo: 2500000,
      service: "Certificate of Occupancy statutory fee",
      evidenceDescription: "Bank transfer advice submitted for independent administrator review.",
    });

    expect(await applicant.paymentOperations.myAlerts()).toEqual([]);
    expect((await administrator.paymentOperations.pendingSummary()).pendingCount).toBe(1);

    await administrator.paymentOperations.review({ paymentId: submitted.id, decision: "approved", reason: "Transfer advice reconciled with the administrative review record." });
    const alerts = await applicant.paymentOperations.myAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.readAt).toBeNull();

    const scan = await administrator.paymentOperations.verifyReceiptAndLog({ reference: "lag-coo-2026-001" });
    expect(scan.scan.outcome).toBe("approved");
    expect((await administrator.paymentOperations.scanHistory({ limit: 25 }))[0]?.reference).toBe("LAG-COO-2026-001");
  });
});
