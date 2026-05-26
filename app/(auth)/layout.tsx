import type { ReactNode } from "react";
import { Layers } from "lucide-react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* ── Left branding panel (desktop only) ─────────────────────────── */}
      <div
        className="relative hidden lg:flex flex-col justify-between p-12 bg-foreground text-background overflow-hidden"
        style={{
          backgroundImage:
            "radial-gradient(circle, oklch(1 0 0 / 8%) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-background/10 ring-1 ring-background/20">
            <Layers className="h-4 w-4 text-background" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-background">
            Visual Classification
          </span>
        </div>

        {/* Tagline */}
        <div className="space-y-3">
          <p className="text-2xl font-semibold leading-snug tracking-tight text-background">
            Classify anything,
            <br />
            in seconds.
          </p>
          <p className="text-sm text-background/50">
            AI-powered visual classification at scale.
          </p>
        </div>
      </div>

      {/* ── Right form panel ────────────────────────────────────────────── */}
      <div className="flex flex-col items-center justify-center px-6 py-12 bg-background">
        {/* Mobile logo */}
        <div className="mb-8 flex items-center gap-2 lg:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground">
            <Layers className="h-4 w-4 text-background" />
          </div>
          <span className="text-sm font-semibold tracking-tight">
            Visual Classification
          </span>
        </div>

        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
