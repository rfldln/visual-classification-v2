"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { db } from "@/lib/db";
import { vaultItems } from "@/lib/db/schema";

/**
 * Permanently deletes the current user's account: removes all their vault
 * storage objects, deletes the auth user (which cascades the public.users row
 * and vault_items via FK), then signs out and redirects to sign-in.
 */
export async function deleteAccount(): Promise<{ ok: false; error: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  // Clean up storage objects first — deleting the auth user only cascades DB rows.
  const items = await db.query.vaultItems.findMany({
    where: eq(vaultItems.userId, user.id),
    columns: { storageKey: true },
  });
  if (items.length > 0) {
    await supabaseAdmin.storage
      .from("vault")
      .remove(items.map((i) => i.storageKey));
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, error: error.message };

  await supabase.auth.signOut();
  redirect("/sign-in");
}
