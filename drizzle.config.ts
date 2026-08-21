import { defineConfig } from "drizzle-kit";

const connectionString =
  process.env.DATABASE_URL ??
  process.env.NDSEP_PG_URL ??
  "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db";

export default defineConfig({
  schema: ["./drizzle/schema.ts", "./drizzle/runtimeTables.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
