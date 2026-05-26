import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/supabase";

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

/**
 * Creates a Supabase client for Server Components, Route Handlers, and
 * Server Actions. Uses the Next.js cookie store to persist the auth session.
 *
 * Must be called inside an async function — cookies() is async in Next.js 15+.
 *
 * Uses the anon key + RLS, not the service role key. For admin operations
 * that bypass RLS, use the client from lib/supabase/admin.ts instead.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot mutate cookies — the middleware
            // handles session refresh in that case. This catch is intentional.
          }
        },
      },
    },
  );
}
