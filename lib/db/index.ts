import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * postgres-js connection pool. Modules are loaded once per server process
 * in Next.js, so this singleton is safe and avoids connection pool exhaustion.
 *
 * prepare: false is required for PgBouncer compatibility — Supabase uses
 * Transaction pooling mode by default, which conflicts with prepared statements.
 */
const client = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

/**
 * Drizzle ORM instance with full schema awareness.
 *
 * Import `db` wherever you need to run queries — always inside /lib, never
 * directly in components or route handlers (rule #1 of this project).
 *
 * @example
 * import { db } from "@/lib/db";
 * import { users } from "@/lib/db/schema";
 *
 * const allUsers = await db.select().from(users);
 * // or with relational queries:
 * const user = await db.query.users.findFirst({ where: eq(users.id, id) });
 */
export const db = drizzle(client, {
  schema,
  logger: env.NODE_ENV === "development",
});

export type DB = typeof db;
