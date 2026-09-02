import { eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let pool: Pool | null = null;
let db: NodePgDatabase | null = null;

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required for mobile persistence");
  if (!/^postgres(?:ql)?:\/\//i.test(value)) {
    throw new Error("mobile persistence requires a PostgreSQL DATABASE_URL");
  }
  return value;
}

/**
 * Lazily creates the PostgreSQL-backed Drizzle adapter. Importing portable
 * tooling remains possible without a database, but every persistence operation
 * requires an explicit PostgreSQL connection string and fails closed otherwise.
 */
export async function getDb(): Promise<NodePgDatabase> {
  if (!db) {
    pool = new Pool({ connectionString: databaseUrl() });
    db = drizzle(pool);
  }
  return db;
}

export async function closeDbForTests() {
  const activePool = pool;
  pool = null;
  db = null;
  await activePool?.end();
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];

  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  updateSet.updatedAt = new Date();

  await (await getDb()).insert(users).values(values).onConflictDoUpdate({
    target: users.openId,
    set: updateSet,
  });
}

export async function getUserByOpenId(openId: string) {
  const result = await (await getDb()).select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}
