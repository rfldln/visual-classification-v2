import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/dashboard/sidebar";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const email = user.email ?? "";
  const fullName = (user.user_metadata?.full_name as string | undefined) ?? null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={{ email, fullName }} />
      <main className="flex-1 overflow-hidden bg-background">
        {children}
      </main>
    </div>
  );
}
