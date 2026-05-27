import { defineConfig } from "drizzle-kit";

// lib/env.ts is intentionally NOT imported here — drizzle-kit runs outside
// Next.js and doesn't load .env.local. The db:* scripts in package.json use
// `node --env-file=.env.local` to inject the env vars before this file runs.
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error(
    "DATABASE_URL is not set. Use the npm db:* scripts which load .env.local automatically.",
  );
}

export default defineConfig({
  out: "./lib/db/migrations/sql",
  schema: "./lib/db/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
  verbose: true,
  strict: true,
});
