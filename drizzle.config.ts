import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration.
 *
 * No hardcoded credential defaults: the connection string MUST come from
 * DATABASE_URL or NDSEP_PG_URL. Local developers copy .env.example to .env
 * and set POSTGRES_PASSWORD / DATABASE_URL there.
 */
const connectionString = process.env.DATABASE_URL ?? process.env.NDSEP_PG_URL;

if (!connectionString) {
  throw new Error(
    "[drizzle.config] DATABASE_URL (or NDSEP_PG_URL) is required — refusing to fall back to a hardcoded credential. See .env.example."
  );
}

export default defineConfig({
  schema: ["./drizzle/schema.ts", "./drizzle/runtimeTables.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
