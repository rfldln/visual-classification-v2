import "server-only";

import { db } from "@/lib/db";
import { vaultItems } from "@/lib/db/schema";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { eq, desc, and, gte, count, sum } from "drizzle-orm";
import type { VaultItem } from "@/lib/db/schema/vault";

export type VaultItemWithUrl = VaultItem & { signedUrl: string | null };

export interface VaultStats {
  totalItems: number;
  imageCount: number;
  videoCount: number;
  totalBytes: number;
  addedThisWeek: number;
}

export async function getVaultItems(
  userId: string,
  limit?: number,
): Promise<VaultItemWithUrl[]> {
  const items = await db.query.vaultItems.findMany({
    where: eq(vaultItems.userId, userId),
    orderBy: [desc(vaultItems.createdAt)],
    limit,
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

export async function getRecentVaultItems(
  userId: string,
  limit = 8,
): Promise<VaultItemWithUrl[]> {
  return getVaultItems(userId, limit);
}

export async function getVaultStats(userId: string): Promise<VaultStats> {
  const byKind = await db
    .select({
      mediaKind: vaultItems.mediaKind,
      count: count(),
      bytes: sum(vaultItems.fileSize),
    })
    .from(vaultItems)
    .where(eq(vaultItems.userId, userId))
    .groupBy(vaultItems.mediaKind);

  const stats: VaultStats = {
    totalItems: 0,
    imageCount: 0,
    videoCount: 0,
    totalBytes: 0,
    addedThisWeek: 0,
  };

  for (const row of byKind) {
    stats.totalItems += row.count;
    stats.totalBytes += Number(row.bytes ?? 0);
    if (row.mediaKind === "image") stats.imageCount = row.count;
    if (row.mediaKind === "video") stats.videoCount = row.count;
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [week] = await db
    .select({ value: count() })
    .from(vaultItems)
    .where(
      and(
        eq(vaultItems.userId, userId),
        gte(vaultItems.createdAt, sevenDaysAgo),
      ),
    );
  stats.addedThisWeek = week?.value ?? 0;

  return stats;
}
