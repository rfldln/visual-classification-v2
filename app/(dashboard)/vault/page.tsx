import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getVaultItems } from "@/lib/vault/queries";
import { VaultClient } from "./client";

export const metadata = { title: "Vault" };

export default async function VaultPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/sign-in");

  const items = await getVaultItems(user.id);

  return <VaultClient items={items} />;
}
