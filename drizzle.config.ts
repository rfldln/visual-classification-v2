import { defineConfig } from "drizzle-kit";
import { env } from "@/lib/env";

export default defineConfig({
  // SQL migration files land in a subdirectory so they don't mix with the
  // .md documentation files in lib/db/migrations/
  out: "./lib/db/migrations/sql",
  schema: "./lib/db/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
