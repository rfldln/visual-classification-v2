"use client";

import { useState, useRef } from "react";
import {
  Wand2,
  Image as ImageIcon,
  Download,
  Loader2,
  X,
  Upload,
  PanelLeftOpen,
  PanelLeftClose,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  generateTextToImage,
  generateImageToImage,
} from "@/lib/generate/actions";
import {
  ASPECT_RATIOS,
  type AspectRatio,
  type GenerationCount,
} from "@/lib/generate/constants";

type Mode = "t2i" | "i2i";
type Status = "idle" | "generating" | "done" | "error";

interface ResultImage {
  url: string;
}

const MAX_REFERENCES = 8;

export function GenerateClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [mode, setMode] = useState<Mode>("t2i");

  // Shared form state
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [count, setCount] = useState<GenerationCount>(1);

  // I2I only — up to 8 reference images
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Output state
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<ResultImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  function addReferenceFiles(files: FileList | File[]) {
    const remaining = MAX_REFERENCES - referenceImages.length;
    if (remaining <= 0) return;
    const toAdd = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, remaining);
    toAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setReferenceImages((prev) =>
          prev.length < MAX_REFERENCES ? [...prev, result] : prev,
        );
      };
      reader.readAsDataURL(file);
    });
  }

  function removeReference(index: number) {
    setReferenceImages((prev) => prev.filter((_, i) => i !== index));
    if (inputRef.current) inputRef.current.value = "";
  }

  const canGenerate =
    !!prompt.trim() &&
    status !== "generating" &&
    (mode === "t2i" || referenceImages.length > 0);

  async function handleGenerate() {
    if (!canGenerate) return;
    setStatus("generating");
    setResults([]);
    setError(null);

    const params = { prompt, aspectRatio, count };

    const res =
      mode === "t2i"
        ? await generateTextToImage(params)
        : await generateImageToImage({ ...params, referenceBase64: referenceImages });

    if (!res.ok) {
      setError(res.error);
      setStatus("error");
      return;
    }

    setResults(res.urls.map((url) => ({ url })));
    setStatus("done");
  }

  function handleDownload(url: string, index: number) {
    const a = document.createElement("a");
    a.href = url;
    a.download = `generated-${index + 1}.png`;
    a.click();
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Generate panel (secondary sidebar) ──────────────────────── */}
      {panelOpen ? (
        <aside className="w-80 shrink-0 border-r border-border flex flex-col h-full">
          {/* Panel header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
            <span className="text-sm font-semibold flex-1">Generate</span>
            <button
              onClick={() => setPanelOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Collapse panel"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          {/* Mode switcher */}
          <div className="flex gap-1.5 p-3 border-b border-border shrink-0">
            <button
              onClick={() => setMode("t2i")}
              className={cn(
                "flex items-center gap-1.5 flex-1 justify-center rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                mode === "t2i"
                  ? "bg-foreground text-background font-semibold"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <Wand2 className="h-3.5 w-3.5" />
              Text to Image
            </button>
            <button
              onClick={() => setMode("i2i")}
              className={cn(
                "flex items-center gap-1.5 flex-1 justify-center rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                mode === "i2i"
                  ? "bg-foreground text-background font-semibold"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Img to Image
            </button>
          </div>

          {/* Controls — scrollable */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">

            {/* I2I: Reference images (up to 8) */}
            {mode === "i2i" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                    Reference images
                  </span>
                  {referenceImages.length > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {referenceImages.length}/{MAX_REFERENCES}
                    </span>
                  )}
                </div>

                {referenceImages.length > 0 ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {referenceImages.map((src, i) => (
                      <div
                        key={i}
                        className="relative aspect-square rounded-md overflow-hidden border border-border bg-muted"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={`Reference ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() => removeReference(i)}
                          className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 transition-colors"
                          aria-label={`Remove reference ${i + 1}`}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}

                    {/* Add-more slot */}
                    {referenceImages.length < MAX_REFERENCES && (
                      <button
                        onClick={() => inputRef.current?.click()}
                        className="aspect-square rounded-md border-2 border-dashed border-border hover:border-foreground/30 hover:bg-muted/50 flex items-center justify-center transition-colors"
                        aria-label="Add more reference images"
                      >
                        <Upload className="h-4 w-4 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      addReferenceFiles(e.dataTransfer.files);
                    }}
                    onClick={() => inputRef.current?.click()}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 h-28 rounded-lg border-2 border-dashed cursor-pointer transition-colors",
                      isDragging
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-foreground/30 hover:bg-muted/50",
                    )}
                  >
                    <Upload className="h-5 w-5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground text-center px-3">
                      Drop images or click to browse
                      <br />
                      <span className="text-muted-foreground/60">up to {MAX_REFERENCES} images</span>
                    </p>
                  </div>
                )}

                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addReferenceFiles(e.target.files);
                  }}
                />
              </div>
            )}

            {/* Prompt */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                Prompt
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  mode === "t2i"
                    ? "Describe what you want to create…"
                    : "Describe your desired output…"
                }
                rows={mode === "i2i" ? 4 : 6}
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
                }}
              />
            </div>

            {/* Aspect ratio */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                Aspect ratio
              </span>
              <div className="flex flex-wrap gap-1.5">
                {ASPECT_RATIOS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setAspectRatio(value)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-mono transition-all",
                      aspectRatio === value
                        ? "bg-foreground text-background font-semibold"
                        : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/70",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Count */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                Images
              </span>
              <div className="flex gap-1.5">
                {([1, 2, 3, 4] as GenerationCount[]).map((n) => (
                  <button
                    key={n}
                    onClick={() => setCount(n)}
                    className={cn(
                      "rounded-md px-3 py-1 text-xs font-mono transition-all",
                      count === n
                        ? "bg-foreground text-background font-semibold"
                        : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/70",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Generate button — always visible at bottom */}
          <div className="p-4 border-t border-border shrink-0">
            <Button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="w-full"
            >
              {status === "generating" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4 mr-2" />
              )}
              {status === "generating" ? "Generating…" : "Generate"}
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-2">
              {mode === "i2i" && referenceImages.length === 0
                ? "Upload a reference image to continue"
                : "⌘ + Enter"}
            </p>
          </div>
        </aside>
      ) : (
        /* ── Collapsed strip ──────────────────────────────────────────── */
        <div className="w-10 shrink-0 border-r border-border flex flex-col items-center py-3 gap-3">
          <button
            onClick={() => setPanelOpen(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Open panel"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
          <div className="w-5 h-px bg-border" />
          <span
            className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            {mode === "t2i" ? "Text to Image" : "Img to Image"}
          </span>
        </div>
      )}

      {/* ── Output area ─────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <OutputArea
          status={status}
          results={results}
          error={error}
          count={count}
          aspectRatio={aspectRatio}
          onRetry={handleGenerate}
          onDownload={handleDownload}
          mode={mode}
        />
      </main>
    </div>
  );
}

// ── Output area ────────────────────────────────────────────────────────────────

interface OutputAreaProps {
  status: Status;
  results: ResultImage[];
  error: string | null;
  count: GenerationCount;
  aspectRatio: AspectRatio;
  mode: Mode;
  onRetry: () => void;
  onDownload: (url: string, index: number) => void;
}

function OutputArea({
  status,
  results,
  error,
  count,
  aspectRatio,
  mode,
  onRetry,
  onDownload,
}: OutputAreaProps) {
  if (status === "idle") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          {mode === "t2i" ? (
            <Wand2 className="h-7 w-7 text-muted-foreground" />
          ) : (
            <ImageIcon className="h-7 w-7 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm font-medium">No images yet</p>
        <p className="text-sm text-muted-foreground max-w-xs">
          {mode === "t2i"
            ? "Write a prompt and click Generate to create your first image."
            : "Upload reference images, write a prompt, then generate."}
        </p>
      </div>
    );
  }

  if (status === "generating") {
    return (
      <div className="p-6">
        <div
          className={cn(
            "grid gap-4",
            count === 1 ? "max-w-xl mx-auto grid-cols-1" : "grid-cols-2",
          )}
        >
          {Array.from({ length: count }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-muted animate-pulse"
              style={{ aspectRatio: aspectRatio.replace(":", "/") }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (status === "done" && results.length > 0) {
    return (
      <div className="p-6">
        <div
          className={cn(
            "grid gap-6",
            results.length === 1 ? "max-w-xl mx-auto grid-cols-1" : "grid-cols-2",
          )}
        >
          {results.map((result, i) => (
            <div key={i} className="flex flex-col gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.url}
                alt={`Generated image ${i + 1}`}
                className="w-full rounded-xl border border-border object-contain"
              />
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onDownload(result.url, i)}
                  aria-label="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}
