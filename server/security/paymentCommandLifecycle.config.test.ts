import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("payment command durable lifecycle source contract", () => {
  const migration = read("drizzle/0040_payment_command_durable_lifecycle.sql");
  const journal = read("drizzle/meta/_journal.json");
  const schema = read("drizzle/schema.ts");
  const processor = read("server/paymentCommandProcessor.ts");
  const banking = read("server/routers/banking.ts");
  const callback = read("server/mojaloopCallback.ts");
  const lifecycle = read("server/_core/index.ts");
  const ci = read(".github/workflows/ci.yml");

  it("registers a DDL-only migration that binds each command to exactly one payment row", () => {
    expect(journal).toContain('"tag": "0040_payment_command_durable_lifecycle"');
    expect(migration).toContain("CREATE TABLE payment_commands");
    expect(migration).toContain("payment_commands_target_shape CHECK");
    expect(migration).toMatch(/payment_commands_nip_transaction_unique/);
    expect(migration).toMatch(/payment_commands_rtgs_transaction_unique/);
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|COPY)\b/im);
  });

  it("keeps the active Drizzle declarations aligned with the command and confirmation lifecycle", () => {
    expect(schema).toContain('pgEnum("payment_command_status"');
    expect(schema).toContain('"pending_confirmation"');
    expect(schema).toContain('pgTable("payment_commands"');
    expect(schema).toContain('tigerbeetleTransactionId');
    expect(schema).toContain('mojaloopReference');
  });

  it("persists NIP and RTGS instructions with commands in one PostgreSQL transaction", () => {
    expect(banking).toContain("async function persistPaymentAndCommand(");
    expect(banking).toContain('await client.query("BEGIN")');
    expect(banking).toContain("await enqueuePaymentCommand(client");
    expect(banking).toContain('paymentKind: "nip"');
    expect(banking).toContain('paymentKind: "rtgs"');
    expect(banking).not.toContain("[Mojaloop] NIP settlement fire-and-forget");
    expect(banking).not.toContain("[TigerBeetle] RTGS ledger fire-and-forget");
  });

  it("claims work through PostgreSQL leases and uses only signed callbacks for terminal completion", () => {
    expect(processor).toContain("FOR UPDATE SKIP LOCKED");
    expect(processor).toContain("lease_expires_at");
    expect(processor).toContain("applyMojaloopPaymentCallback");
    expect(callback).toContain("verifyCallback(req)");
    expect(callback).toContain("applyMojaloopPaymentCallback(transferId, state, completedAt)");
    expect(callback).not.toContain("FROM financial_ledger WHERE reference");
  });

  it("starts only after database initialization and runs its real PostgreSQL test in Node CI", () => {
    expect(lifecycle).toContain("startPaymentCommandProcessor();");
    expect(lifecycle).toContain("stopPaymentCommandProcessor();");
    expect(ci).toContain("PAYMENT_COMMAND_TEST_DATABASE_URL:");
  });
});
