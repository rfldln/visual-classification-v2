import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/types/supabase";

/**
 * Supabase admin client using the service role key.
 *
 * ⚠️  SECURITY: This client bypasses Row Level Security (RLS) entirely.
 *     - NEVER import this in Client Components
 *     - NEVER let it reach the browser bundle
 *     - Only use in: Server Actions, Route Handlers, scripts, background jobs
 *
 * For user-scoped operations, use createSupabaseServerClient() instead.
 */
export const supabaseAdmin = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      // This client represents the system, not a user session.
      // It must never store or refresh tokens.
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
