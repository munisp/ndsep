import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { enqueuePaymentCommand, applyMojaloopPaymentCallback } from "./paymentCommandProcessor";

const testUrl = process.env.PAYMENT_COMMAND_TEST_DATABASE_URL;
const enabled = Boolean(testUrl);
const authority = testUrl?.split("@", 2)[1]?.split("/", 1)[0] ?? "";
const localOnly = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(authority);
let client: Client | undefined;

describe.skipIf(!enabled || !localOnly)("payment command PostgreSQL integration", () => {
  beforeAll(async () => {
    if (!testUrl) throw new Error("PAYMENT_COMMAND_TEST_DATABASE_URL is required");
    client = new Client({ connectionString: testUrl });
    await client.connect();
    await client.query(`
      DROP TABLE IF EXISTS payment_commands CASCADE;
      DROP TABLE IF EXISTS nip_transactions CASCADE;
      DROP TABLE IF EXISTS rtgs_transactions CASCADE;
      DROP TYPE IF EXISTS payment_command_status CASCADE;
      DROP TYPE IF EXISTS payment_command_kind CASCADE;
      DROP TYPE IF EXISTS nip_status CASCADE;
      DROP TYPE IF EXISTS rtgs_status CASCADE;
      CREATE TYPE nip_status AS ENUM ('initiated', 'processing', 'completed', 'failed', 'reversed', 'pending_confirmation');
      CREATE TYPE rtgs_status AS ENUM ('queued', 'processing', 'settled', 'rejected', 'cancelled', 'pending_funds');
      CREATE TABLE nip_transactions (
        id SERIAL PRIMARY KEY,
        status nip_status NOT NULL DEFAULT 'initiated',
        completed_at TIMESTAMPTZ,
        response_code VARCHAR(10),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE rtgs_transactions (
        id SERIAL PRIMARY KEY,
        status rtgs_status NOT NULL DEFAULT 'queued',
        settled_at TIMESTAMPTZ,
        rejection_reason TEXT
      );
    `);
    const migration = await readFile(new URL("../drizzle/0040_payment_command_durable_lifecycle.sql", import.meta.url), "utf8");
    await client.query(migration);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`
      DROP TABLE IF EXISTS payment_commands CASCADE;
      DROP TABLE IF EXISTS nip_transactions CASCADE;
      DROP TABLE IF EXISTS rtgs_transactions CASCADE;
      DROP TYPE IF EXISTS payment_command_status CASCADE;
      DROP TYPE IF EXISTS payment_command_kind CASCADE;
      DROP TYPE IF EXISTS nip_status CASCADE;
      DROP TYPE IF EXISTS rtgs_status CASCADE;
    `).catch(() => undefined);
    await client.end();
  });

  it("persists an NIP command atomically with a pending ledger lifecycle and immutable target shape", async () => {
    if (!client) throw new Error("Test PostgreSQL client unavailable");
    const nip = await client.query<{ id: number }>("INSERT INTO nip_transactions DEFAULT VALUES RETURNING id");
    await client.query("BEGIN");
    const command = await enqueuePaymentCommand(client, {
      paymentKind: "nip",
      paymentReference: "NIP-TEST-0001",
      nipTransactionId: nip.rows[0].id,
      amount: 500_000,
      currency: "NGN",
      debitAccount: "000001",
      creditAccount: "000002",
    });
    await client.query("COMMIT");

    expect(command.status).toBe("pending_ledger");
    const stored = await client.query(
      "SELECT payment_kind, status, amount, nip_transaction_id, rtgs_transaction_id FROM payment_commands WHERE id = $1",
      [command.id],
    );
    expect(stored.rows[0]).toMatchObject({
      payment_kind: "nip",
      status: "pending_ledger",
      amount: "500000",
      nip_transaction_id: nip.rows[0].id,
      rtgs_transaction_id: null,
    });

    await expect(client.query(
      `INSERT INTO payment_commands (id, payment_kind, payment_reference, nip_transaction_id, rtgs_transaction_id,
        amount, currency, debit_account, credit_account)
       VALUES ('00000000-0000-4000-8000-000000000001', 'nip', 'NIP-TEST-INVALID', $1, $1, 1, 'NGN', '000001', '000002')`,
      [nip.rows[0].id],
    )).rejects.toThrow();
  });

  it("finalizes only a pending-confirmation command and updates the matching NIP row", async () => {
    if (!client) throw new Error("Test PostgreSQL client unavailable");
    const nip = await client.query<{ id: number }>("INSERT INTO nip_transactions DEFAULT VALUES RETURNING id");
    await client.query("BEGIN");
    await enqueuePaymentCommand(client, {
      paymentKind: "nip",
      paymentReference: "NIP-TEST-0002",
      nipTransactionId: nip.rows[0].id,
      amount: 1_000,
      currency: "NGN",
      debitAccount: "000001",
      creditAccount: "000002",
    });
    await client.query("COMMIT");
    await client.query(`UPDATE payment_commands
      SET status = 'pending_confirmation', mojaloop_reference = 'NIP-TEST-0002'
      WHERE payment_reference = 'NIP-TEST-0002'`);

    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = testUrl;
    try {
      await expect(applyMojaloopPaymentCallback("NIP-TEST-0002", "COMMITTED", new Date("2026-09-01T00:00:00.000Z"))).resolves.toBe("updated");
      await expect(applyMojaloopPaymentCallback("NIP-TEST-0002", "ABORTED", new Date("2026-09-01T00:01:00.000Z"))).resolves.toBe("illegal_transition");
    } finally {
      if (originalUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalUrl;
    }

    const command = await client.query("SELECT status, completed_at FROM payment_commands WHERE payment_reference = 'NIP-TEST-0002'");
    const payment = await client.query("SELECT status, response_code, completed_at FROM nip_transactions WHERE id = $1", [nip.rows[0].id]);
    expect(command.rows[0].status).toBe("completed");
    expect(command.rows[0].completed_at).not.toBeNull();
    expect(payment.rows[0]).toMatchObject({ status: "completed", response_code: "00" });
    expect(payment.rows[0].completed_at).not.toBeNull();
  });
});
