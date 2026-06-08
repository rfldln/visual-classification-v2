import { ListChecks } from "lucide-react";

/**
 * Right-column empty state for the classify tabs — shown before any file is
 * picked. Mirrors the drop-zone's dashed aesthetic so the input | output
 * columns read as a matched pair.
 */
export function ResultPlaceholder({ serviceName }: { serviceName: string }) {
  return (
    <div
      className="flex min-h-[20rem] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border px-8 py-16 text-center"
      style={{
        backgroundImage:
          "radial-gradient(circle, oklch(0.145 0 0 / 4%) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background">
        <ListChecks className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Results will appear here</p>
        <p className="text-xs text-muted-foreground">
          Upload an image or video to classify with {serviceName}.
        </p>
      </div>
    </div>
  );
}
