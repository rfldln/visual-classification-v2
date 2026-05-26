import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  className?: string;
}

export function StatCard({ label, value, icon: Icon, className }: StatCardProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-5 flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest font-mono">
          {label}
        </span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/50" />}
      </div>
      <span className="text-4xl font-mono font-semibold tracking-tight text-foreground">
        {value}
      </span>
    </div>
  );
}
