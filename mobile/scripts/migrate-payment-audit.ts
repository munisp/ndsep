import { Pool } from "pg";

import { runPaymentAuditMigrations } from "../server/paymentAuditMigrations";

const configuredUrl = process.env.PAYMENT_AUDIT_POSTGRES_URL?.trim();
if (!configuredUrl && process.env.NODE_ENV === "production") {
  throw new Error("PAYMENT_AUDIT_POSTGRES_URL is required to migrate the production payment audit database.");
}

const connectionString = configuredUrl || "postgresql://ubuntu@/idlr_payment?host=/var/run/postgresql";
const pool = new Pool({ connectionString, application_name: "idlr-pts-payment-audit-migration" });

async function main() {
  try {
    await runPaymentAuditMigrations(pool);
    console.log("Payment audit migrations completed successfully.");
  } finally {
    await pool.end();
  }
}

void main();
