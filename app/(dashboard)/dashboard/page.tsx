import type { Metadata } from "next";
import Link from "next/link";
import {
  Archive,
  Film,
  HardDrive,
  TrendingUp,
  Sparkles,
  Wand2,
  Music,
  Play,
  ArrowRight,
} from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/dashboard/stat-card";
import { getVaultStats, getRecentVaultItems } from "@/lib/vault/queries";
import { formatFileSize } from "@/lib/vault/constants";
import type { VaultItemWithUrl } from "@/lib/vault/queries";

export const metadata: Metadata = { title: "Dashboard" };

const QUICK_ACTIONS = [
  {
    href: "/classify",
    label: "Classify media",
    description: "Tag images and videos with a vision model.",
    icon: Sparkles,
  },
  {
    href: "/generate",
    label: "Generate",
    description: "Create new images and videos from a prompt.",
    icon: Wand2,
  },
  {
    href: "/vault",
    label: "Vault",
    description: "Browse and manage your saved files.",
    icon: Archive,
  },
] as const;

function RecentEmpty() {
  return (
    <div className="rounded-lg border border-dashed border-border p-8">
      <div className="grid grid-cols-3 gap-3 mb-6 opacity-30">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-md border border-border bg-muted" />
        ))}
      </div>
      <p className="text-sm text-muted-foreground text-center font-mono">
        Nothing in your vault yet
      </p>
      <p className="text-xs text-muted-foreground/60 text-center mt-1">
        Generate or upload media to see it here.
      </p>
    </div>
  );
}

function RecentThumb({ item }: { item: VaultItemWithUrl }) {
  return (
    <Link
      href="/vault"
      className="group relative aspect-square rounded-md border border-border bg-muted overflow-hidden hover:border-foreground/30 transition-colors"
      title={item.fileName}
    >
      {item.mediaKind === "image" && item.signedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.signedUrl} alt={item.fileName} className="w-full h-full object-cover" />
      ) : item.mediaKind === "video" && item.signedUrl ? (
        <>
          <video
            src={item.signedUrl}
            preload="metadata"
            muted
            playsInline
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
              <Play className="h-3.5 w-3.5 text-white fill-white ml-0.5" />
            </div>
          </div>
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Music className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
    </Link>
  );
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? null;
  const firstName = fullName?.split(" ")[0] ?? null;

  const [stats, recent] = user
    ? await Promise.all([getVaultStats(user.id), getRecentVaultItems(user.id, 8)])
    : [
        { totalItems: 0, imageCount: 0, videoCount: 0, totalBytes: 0, addedThisWeek: 0 },
        [] as VaultItemWithUrl[],
      ];

  return (
    <div className="h-full overflow-y-auto">
      {/* Greeting */}
      <div className="px-8 pt-8 pb-6 border-b border-border">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">
          Dashboard
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back{firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here&apos;s an overview of your vault.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 px-8 py-6">
        <StatCard label="Total Items" value={stats.totalItems} icon={Archive} />
        <StatCard label="Videos" value={stats.videoCount} icon={Film} />
        <StatCard label="Storage Used" value={formatFileSize(stats.totalBytes)} icon={HardDrive} />
        <StatCard label="Added This Week" value={stats.addedThisWeek} icon={TrendingUp} />
      </div>

      {/* Quick actions */}
      <div className="px-8 pb-6">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">
          Quick Actions
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {QUICK_ACTIONS.map(({ href, label, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-lg border border-border bg-card p-5 hover:border-foreground/30 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background">
                  <Icon className="h-4 w-4 text-foreground" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
              </div>
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent uploads */}
      <div className="px-8 pb-8">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
            Recent Uploads
          </p>
          {recent.length > 0 && (
            <Link
              href="/vault"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View all →
            </Link>
          )}
        </div>
        {recent.length === 0 ? (
          <RecentEmpty />
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3">
            {recent.map((item) => (
              <RecentThumb key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
