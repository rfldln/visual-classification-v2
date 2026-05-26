"use client";

import { useState, useRef } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export function UploadZone() {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragOver(false); }}
      className={cn(
        "relative rounded-lg border-2 border-dashed transition-colors cursor-pointer",
        "flex flex-col items-center justify-center gap-3 py-16 px-8",
        isDragOver
          ? "border-foreground bg-muted/50"
          : "border-border hover:border-foreground/40"
      )}
      style={{
        backgroundImage: "radial-gradient(circle, oklch(0.145 0 0 / 4%) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={() => {}}
      />
      <div className={cn(
        "flex h-12 w-12 items-center justify-center rounded-full border border-border transition-colors",
        isDragOver ? "border-foreground/40 bg-muted" : "bg-background"
      )}>
        <Upload className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">
          Drop an image to classify
        </p>
        <p className="text-xs text-muted-foreground">
          or click to browse — PNG, JPG, WEBP up to 10 MB
        </p>
      </div>
    </div>
  );
}
