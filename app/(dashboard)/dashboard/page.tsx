import type { Metadata } from "next";
import { Scan, TrendingUp, Target } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/dashboard/stat-card";
import { UploadZone } from "@/components/dashboard/upload-zone";

export const metadata: Metadata = { title: "Dashboard" };

function RecentEmpty() {
  return (
    <div className="rounded-lg border border-dashed border-border p-8">
      <div className="grid grid-cols-3 gap-3 mb-6 opacity-30">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-md border border-border bg-muted" />
        ))}
      </div>
      <p className="text-sm text-muted-foreground text-center font-mono">
        No classifications yet
      </p>
      <p className="text-xs text-muted-foreground/60 text-center mt-1">
        Upload an image above to get started.
      </p>
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? null;
  const firstName = fullName?.split(" ")[0] ?? null;

  return (
    <div>
      {/* Greeting */}
      <div className="px-8 pt-8 pb-6 border-b border-border">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">
          Dashboard
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back{firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here&apos;s an overview of your classification activity.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 px-8 py-6">
        <StatCard label="Total Classifications" value="0" icon={Scan} />
        <StatCard label="This Week" value="0" icon={TrendingUp} />
        <StatCard label="Avg. Confidence" value="—" icon={Target} />
      </div>

      {/* Upload */}
      <div className="px-8 pb-6">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">
          New Classification
        </p>
        <UploadZone />
      </div>

      {/* Recent */}
      <div className="px-8 pb-8">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">
          Recent Classifications
        </p>
        <RecentEmpty />
      </div>
    </div>
  );
}
