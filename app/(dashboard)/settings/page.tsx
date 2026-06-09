import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SettingsClient } from "./client";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email ?? "";
  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? "";

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-8 pt-8 pb-6 border-b border-border">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">
          Settings
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account, appearance, and data.
        </p>
      </div>

      <div className="px-8 py-6 max-w-2xl space-y-6">
        <SettingsClient email={email} fullName={fullName} />
      </div>
    </div>
  );
}
