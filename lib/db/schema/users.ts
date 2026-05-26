import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Application-level user profiles, linked 1:1 to Supabase's auth.users table.
 *
 * The FK to auth.users(id) cannot be expressed in Drizzle's schema builder
 * because it crosses the `auth` schema boundary. It is enforced via raw SQL
 * in lib/db/migrations/0001_initial_users.md instead.
 *
 * RLS is enabled on this table — see the migration file for policies.
 */
export const users = pgTable(
  "users",
  {
    // Matches auth.users.id — linked via FK in migration SQL
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull().unique(),
    fullName: text("full_name"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index("users_email_idx").on(t.email),
    index("users_created_at_idx").on(t.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
