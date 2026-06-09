"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { db } from "@/lib/db";
import { vaultItems } from "@/lib/db/schema";
import {
  ALL_ALLOWED_VAULT_TYPES,
  MAX_VAULT_FILE_BYTES,
  mediaKindFromMime,
} from "./constants";

type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requestVaultUpload(input: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<ActionResult<{ uploadUrl: string; storageKey: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  if (!ALL_ALLOWED_VAULT_TYPES.includes(input.contentType)) {
    return { ok: false, error: "File type not allowed" };
  }
  if (input.sizeBytes > MAX_VAULT_FILE_BYTES) {
    return { ok: false, error: "File exceeds 100 MB limit" };
  }

  const ext = input.fileName.split(".").pop();
  const storageKey = `${user.id}/${randomUUID()}${ext ? `.${ext}` : ""}`;

  const { data, error } = await supabaseAdmin.storage
    .from("vault")
    .createSignedUploadUrl(storageKey);

  if (error || !data) {
    return { ok: false, error: "Failed to create upload URL" };
  }

  return { ok: true, data: { uploadUrl: data.signedUrl, storageKey } };
}

export async function commitVaultUpload(input: {
  storageKey: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  if (!input.storageKey.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Invalid storage key" };
  }

  const mediaKind = mediaKindFromMime(input.fileType);
  if (!mediaKind) return { ok: false, error: "Invalid file type" };

  await db.insert(vaultItems).values({
    userId: user.id,
    storageKey: input.storageKey,
    fileName: input.fileName.slice(0, 255),
    fileType: input.fileType,
    fileSize: input.fileSize,
    mediaKind,
  });

  revalidatePath("/vault");
  return { ok: true };
}

export async function deleteVaultItem(itemId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const item = await db.query.vaultItems.findFirst({
    where: and(eq(vaultItems.id, itemId), eq(vaultItems.userId, user.id)),
  });
  if (!item) return { ok: false, error: "Not found" };

  await supabaseAdmin.storage.from("vault").remove([item.storageKey]);
  await db.delete(vaultItems).where(eq(vaultItems.id, itemId));

  revalidatePath("/vault");
  return { ok: true };
}

export async function clearVault(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const items = await db.query.vaultItems.findMany({
    where: eq(vaultItems.userId, user.id),
    columns: { storageKey: true },
  });

  if (items.length > 0) {
    await supabaseAdmin.storage
      .from("vault")
      .remove(items.map((i) => i.storageKey));
    await db.delete(vaultItems).where(eq(vaultItems.userId, user.id));
  }

  revalidatePath("/vault");
  revalidatePath("/dashboard");
  return { ok: true };
}
