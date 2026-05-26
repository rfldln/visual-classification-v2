import { z } from "zod";

const serverEnvSchema = z.object({
  // ── Database ─────────────────────────────────────────────────────────────
  DATABASE_URL: z
    .string()
    .url()
    .describe("Full PostgreSQL connection string for Drizzle ORM"),

  // ── Supabase (server-side secrets) ────────────────────────────────────────
  SUPABASE_URL: z.string().url().describe("Supabase project URL (server)"),
  SUPABASE_ANON_KEY: z.string().min(1).describe("Supabase anon key (server)"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1)
    .describe("Supabase service role key — never expose to the client"),

  // ── Supabase (client-side — NEXT_PUBLIC_ prefix required) ────────────────
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url()
    .describe("Supabase project URL (exposed to browser)"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1)
    .describe("Supabase anon key (exposed to browser)"),

  // ── OpenRouter (optional — required for Grok classification) ──────────────
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_REFERER: z.string().optional(),
  OPENROUTER_GROK_MODEL: z.string().min(1).optional(),

  // ── Ollama / RunPod (optional — required for Ollama classification) ─────────
  OLLAMA_BASE_URL: z.string().url().optional(),
  OLLAMA_MODEL: z.string().min(1).optional(),
  RUNPOD_API_KEY: z.string().min(1).optional(),
  RUNPOD_ENDPOINT_ID: z.string().min(1).optional(),

  // ── Cloudflare R2 (optional — using Supabase Storage instead for now) ──────
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET_NAME: z.string().min(1).optional(),
  R2_PUBLIC_URL: z.string().url().optional(),

  // ── Node environment ──────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

// Validate once at module load — missing variables throw at startup with a
// formatted message listing every offending field, not buried inside a request.
const _parsed = serverEnvSchema.safeParse(process.env);

if (!_parsed.success) {
  const missing = _parsed.error.errors
    .map((e) => `  ${e.path.join(".")}: ${e.message}`)
    .join("\n");
  throw new Error(
    `\n\nInvalid or missing environment variables:\n${missing}\n\n` +
      `Copy .env.local.example to .env.local and fill in all values.\n`,
  );
}

export const env = _parsed.data;

export type Env = z.infer<typeof serverEnvSchema>;
