import "server-only";

import { db } from "@/lib/db";
import { vaultItems } from "@/lib/db/schema";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { eq, desc } from "drizzle-orm";
import type { VaultItem } from "@/lib/db/schema/vault";

export type VaultItemWithUrl = VaultItem & { signedUrl: string | null };

export async function getVaultItems(userId: string): Promise<VaultItemWithUrl[]> {
  const items = await db.query.vaultItems.findMany({
    where: eq(vaultItems.userId, userId),
    orderBy: [desc(vaultItems.createdAt)],
  });

  const itemsWithUrls = await Promise.all(
    items.map(async (item) => {
      const { data } = await supabaseAdmin.storage
        .from("vault")
        .createSignedUrl(item.storageKey, 3600);
      return { ...item, signedUrl: data?.signedUrl ?? null };
    }),
  );

  return itemsWithUrls;
}
