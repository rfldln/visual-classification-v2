"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/supabase";

/**
 * Creates a Supabase client for Client Components.
 * Reads auth tokens from cookies automatically via @supabase/ssr.
 *
 * Typical usage: call this inside a hook or context provider rather than
 * directly inside a component to avoid creating a new client on every render.
 *
 * @example
 * // hooks/use-supabase.ts
 * const supabase = useMemo(() => createSupabaseBrowserClient(), []);
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
