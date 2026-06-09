"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Layers,
  LayoutDashboard,
  Sparkles,
  Settings,
  LogOut,
  Archive,
  Wand2,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
      className={cn(
        "relative w-60 shrink-0 flex flex-col h-full overflow-hidden",
        "bg-(--sidebar) text-(--sidebar-foreground) border-r border-(--sidebar-border)",
        "animate-in fade-in slide-in-from-left-2 duration-500",
      )}
    >
      {/* Adaptive top sheen — a dark wash in light mode, a light glow in dark */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(130% 55% at 0% 0%, color-mix(in oklch, var(--sidebar-foreground) 5%, transparent), transparent 55%)",
        }}
      />

      {/* Logo */}
      <div className="relative flex items-center gap-3 px-5 pt-6 pb-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-(--sidebar-foreground) shadow-sm">
          <Layers className="h-[18px] w-[18px] text-(--sidebar)" />
        </div>
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold tracking-tight text-(--sidebar-foreground)">
            Visual Classification
          </p>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--sidebar-muted)">
            Media Workspace
          </p>
        </div>
      </div>

      <div className="mx-5 h-px bg-(--sidebar-border)" />

      {/* Nav */}
      <nav className="relative flex-1 px-3 pt-5 pb-2">
        <p className="px-3 mb-2 text-[10px] font-mono uppercase tracking-[0.2em] text-(--sidebar-muted)">
          Menu
        </p>
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg pl-3.5 pr-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-(--sidebar-accent) text-(--sidebar-foreground)"
                      : "text-(--sidebar-muted) hover:text-(--sidebar-foreground) hover:bg-(--sidebar-hover)",
                  )}
                >
                  {/* Active indicator bar */}
                  <span
                    className={cn(
                      "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full bg-(--sidebar-marker) transition-all duration-200",
                      isActive ? "h-5 opacity-100" : "h-3 opacity-0 group-hover:opacity-30",
                    )}
                  />
                  <Icon
                    className={cn(
                      "h-[18px] w-[18px] shrink-0 transition-colors",
                      isActive
                        ? "text-(--sidebar-foreground)"
                        : "text-(--sidebar-muted) group-hover:text-(--sidebar-foreground)",
                    )}
                  />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="relative p-3">
        <div className="mx-2 mb-3 h-px bg-(--sidebar-border)" />
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-(--sidebar-accent) text-(--sidebar-foreground) text-xs font-mono ring-1 ring-(--sidebar-border)">
              {getInitials(user.fullName, user.email)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            {user.fullName && (
              <p className="text-xs font-medium text-(--sidebar-foreground) truncate">
                {user.fullName}
              </p>
            )}
            <p className="text-xs text-(--sidebar-muted) truncate font-mono">{user.email}</p>
          </div>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-(--sidebar-muted) hover:text-(--sidebar-foreground) hover:bg-(--sidebar-hover) transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
