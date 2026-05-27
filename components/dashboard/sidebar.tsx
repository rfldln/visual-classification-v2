"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Layers,
  LayoutDashboard,
  Sparkles,
  Clock,
  Settings,
  LogOut,
  Archive,
  Wand2,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

interface SidebarProps {
  user: { email: string; fullName: string | null };
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/classify",  label: "Classify",  icon: Sparkles },
  { href: "/generate",  label: "Generate",  icon: Wand2 },
  { href: "/vault",     label: "Vault",     icon: Archive },
  { href: "/history",   label: "History",   icon: Clock },
  { href: "/settings",  label: "Settings",  icon: Settings },
] as const;

function getInitials(fullName: string | null, email: string): string {
  if (fullName) {
    return fullName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0].toUpperCase())
      .join("");
  }
  return email.slice(0, 2).toUpperCase();
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className="w-60 shrink-0 flex flex-col h-full bg-foreground overflow-hidden"
      style={{
        backgroundImage: "radial-gradient(circle, oklch(1 0 0 / 8%) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 p-6 pb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-background/10 ring-1 ring-background/20">
          <Layers className="h-4 w-4 text-background" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-background">
          Visual Classification
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-background/10 text-background"
                  : "text-background/60 hover:text-background hover:bg-background/5"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 space-y-3">
        <Separator className="bg-background/10" />
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-background/10 text-background text-xs font-mono">
              {getInitials(user.fullName, user.email)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            {user.fullName && (
              <p className="text-xs font-medium text-background truncate">{user.fullName}</p>
            )}
            <p className="text-xs text-background/50 truncate">{user.email}</p>
          </div>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-background/60 hover:text-background hover:bg-background/5 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
