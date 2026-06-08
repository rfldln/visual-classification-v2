"use client";

import { useMemo, useRef, useState } from "react";
import { ImageIcon, Film, X, Minus, Plus, ChevronRight } from "lucide-react";
import { CATEGORIES } from "@/lib/taxonomy";
import {
  probeVideoMeta,
  extractFramesEvenly,
  extractFramesFromRange,
  createContactSheet,
} from "@/lib/video-client";
import { ResultPlaceholder } from "@/components/classify/classifier-layout";
import { cn } from "@/lib/utils";

interface GrokTag {
  id: string;
  confidence: number;
  evidence?: string;
}

interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface GrokResponse {
  kind: "image" | "video";
  filename: string;
  model: string;
  frames?: number;
  frameImages?: string[];
  usage?: TokenUsage | null;
  tags: GrokTag[];
  summary?: string;
  notes?: string;
  raw?: string;
  error?: string;
}

const VISION_MODELS = [
  { id: "x-ai/grok-4.3",           label: "Grok 4.3 (recommended)" },
  { id: "x-ai/grok-2-vision-1212", label: "Grok 2 Vision 1212" },
  { id: "x-ai/grok-vision-beta",   label: "Grok Vision Beta" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function GrokTab() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"image" | "video" | null>(null);
  const [result, setResult] = useState<GrokResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [intervalSec, setIntervalSec] = useState(5);
  const [model, setModel] = useState(VISION_MODELS[0].id);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const labelById = useMemo(() => {
    const m = new Map<string, { label: string; description: string }>();
    for (const c of CATEGORIES) m.set(c.id, { label: c.label, description: c.description });
    return m;
  }, []);

  async function runTag(f: File) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const isVideo = f.type.startsWith("video") || /\.(mp4|mov|webm|mkv)$/i.test(f.name);
      const form = new FormData();
      form.set("filename", f.name);
      form.set("model", model);

      let frameDataUrls: string[] | undefined;
      if (isVideo) {
        form.set("kind", "video");
        const meta = await probeVideoMeta(f);
        const dur = Math.max(1, meta.duration);

        const mainCount = Math.min(25, Math.max(1, Math.ceil(dur / intervalSec)));
        const mainBlobs = await extractFramesEvenly(f, { count: mainCount, maxWidth: 320, quality: 0.6 });

        const END_FRACTION = 0.15;
        const endZoneDur = dur * END_FRACTION;
        const endCount = dur > 60 ? Math.min(15, Math.max(1, Math.ceil(endZoneDur / 2))) : 0;
        const endBlobs = endCount > 0
          ? await extractFramesFromRange(f, {
              startFraction: 1 - END_FRACTION,
              endFraction: 1,
              count: endCount,
              maxWidth: 320,
              quality: 0.6,
            })
          : [];

        const allBlobs = [...mainBlobs, ...endBlobs];
        frameDataUrls = allBlobs.map((b) => URL.createObjectURL(b));
        const sheet = await createContactSheet(allBlobs, {
          cols: 5,
          cellWidth: 240,
          sectionBreak: endBlobs.length > 0 ? mainBlobs.length : undefined,
        });
        form.set("frame_count", String(allBlobs.length));
        form.set("main_count", String(mainBlobs.length));
        form.set("end_count", String(endBlobs.length));
        form.append("frames", new File([sheet], "contact_sheet.jpg", { type: "image/jpeg" }));
      } else {
        form.set("kind", "image");
        form.set("image", f, f.name);
      }

      const res = await fetch("/api/grok-tag", { method: "POST", body: form });
      const json = (await res.json()) as GrokResponse;
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
      } else {
        if (frameDataUrls) json.frameImages = frameDataUrls;
        setResult(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function onPick(f: File | null) {
    setResult(null);
    setError(null);
    setShowRaw(false);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!f) {
      setFile(null);
      setPreviewUrl(null);
      setPreviewKind(null);
      return;
    }
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
    setPreviewKind(f.type.startsWith("video") || /\.(mp4|mov|webm|mkv)$/i.test(f.name) ? "video" : "image");
    runTag(f);
  }

  return (
    <div className="space-y-5">
      {/* Settings — full-width control bar */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest whitespace-nowrap">
              Model
            </span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {VISION_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest whitespace-nowrap">
              Frame Interval
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIntervalSec((s) => Math.max(1, s - 1))}
                className="flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="w-12 text-center text-sm font-mono text-foreground">
                {intervalSec}s
              </span>
              <button
                onClick={() => setIntervalSec((s) => Math.min(60, s + 1))}
                className="flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <span className="text-xs text-muted-foreground/60 hidden sm:block">
              max 25 frames — long videos auto-resample
            </span>
          </div>
        </div>
      </div>

      {/* Input | Output */}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {/* LEFT — input (pinned on desktop so it stays in view as results scroll) */}
        <div className="space-y-3 lg:sticky lg:top-6">
          {/* Drop zone */}
          {!file && (
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragOver(false); onPick(e.dataTransfer.files?.[0] ?? null); }}
              className={cn(
                "relative rounded-lg border-2 border-dashed transition-colors cursor-pointer",
                "flex flex-col items-center justify-center gap-4 py-16 px-8",
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
                accept="image/*,video/*"
                className="sr-only"
                onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              />
              <div className="flex items-center gap-2">
                <div className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full border border-border transition-colors",
                  isDragOver ? "border-foreground/40 bg-muted" : "bg-background"
                )}>
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full border border-border transition-colors",
                  isDragOver ? "border-foreground/40 bg-muted" : "bg-background"
                )}>
                  <Film className="h-5 w-5 text-muted-foreground" />
                </div>
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Drop an image or video to classify
                </p>
                <p className="text-xs text-muted-foreground">
                  jpg, png, webp, mp4, mov, webm, mkv
                </p>
              </div>
            </div>
          )}

          {/* File info + preview */}
          {file && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  {previewKind === "video" ? (
                    <Film className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ImageIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <span className="text-sm font-mono truncate text-foreground">{file.name}</span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">{formatBytes(file.size)}</span>
                </div>
                <button
                  onClick={() => onPick(null)}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0 ml-3"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              </div>

              {previewUrl && (
                <div className="overflow-hidden rounded-lg border border-border bg-black">
                  {previewKind === "video" ? (
                    <video src={previewUrl} controls className="max-h-[55vh] w-full" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewUrl} alt="preview" className="max-h-[55vh] w-full object-contain" />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT — output: one surface that swaps between states */}
        <div className="min-w-0">
          {loading ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
              <span className="inline-block h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground" />
              <span className="font-mono text-muted-foreground">
                {previewKind === "video"
                  ? `Extracting frames & asking Grok (1 frame / ${intervalSec}s)…`
                  : "Sending to Grok…"}
              </span>
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : result ? (
            <div className="space-y-4">
              {/* Frame thumbnails */}
              {result.frameImages && result.frameImages.length > 0 && (
                <div>
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
                    Frames Sent to Grok ({result.frameImages.length})
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {result.frameImages.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={src}
                        alt={`frame ${i + 1}`}
                        title={`Frame ${i + 1}`}
                        className="h-20 w-auto flex-none rounded border border-border object-cover"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Tags */}
              <div>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                    Classification Results
                  </p>
                  <span className="text-xs font-mono text-muted-foreground">
                    {result.tags.length} tag{result.tags.length !== 1 ? "s" : ""}
                    {result.kind === "video" && result.frames ? ` · ${result.frames} frames` : ""}
                  </span>
                </div>

                {result.tags.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                    <p className="text-sm text-muted-foreground italic">
                      Grok did not assign any tags from the taxonomy.
                    </p>
                  </div>
                ) : (
                  <ol className="space-y-2">
                    {result.tags.map((t, i) => {
                      const meta = labelById.get(t.id);
                      const pct = (t.confidence * 100).toFixed(1);
                      const isTop = i === 0;
                      return (
                        <li key={t.id} className={cn(
                          "rounded-lg border bg-card p-4",
                          isTop ? "border-foreground/20" : "border-border"
                        )}>
                          <div className="flex items-start gap-3">
                            <span className="text-xs font-mono text-muted-foreground mt-0.5 w-5 text-right flex-shrink-0">
                              {i + 1}.
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-3 mb-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={cn("text-sm font-semibold truncate", isTop && "text-foreground")}>
                                    {meta?.label ?? t.id}
                                  </span>
                                  <span className="text-xs font-mono bg-muted rounded px-1.5 py-0.5 text-muted-foreground flex-shrink-0">
                                    {t.id}
                                  </span>
                                </div>
                                <span className={cn(
                                  "text-lg font-mono font-semibold flex-shrink-0",
                                  isTop ? "text-foreground" : "text-muted-foreground"
                                )}>
                                  {pct}%
                                </span>
                              </div>
                              <div className="h-1 rounded-full bg-muted overflow-hidden mb-2">
                                <div
                                  className={cn("h-full rounded-full transition-all", isTop ? "bg-foreground" : "bg-muted-foreground/40")}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              {t.evidence && (
                                <p className="text-xs text-muted-foreground italic leading-relaxed">
                                  &ldquo;{t.evidence}&rdquo;
                                </p>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              {/* Summary + Notes */}
              {(result.summary || result.notes) && (
                <div className="rounded-lg bg-muted p-4 space-y-2 text-sm">
                  {result.summary && (
                    <p>
                      <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest mr-2">Summary</span>
                      <span className="text-foreground">{result.summary}</span>
                    </p>
                  )}
                  {result.notes && (
                    <p>
                      <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest mr-2">Notes</span>
                      <span className="text-muted-foreground">{result.notes}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Raw output */}
              {result.raw && (
                <div>
                  <button
                    onClick={() => setShowRaw((s) => !s)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
                  >
                    <ChevronRight className={cn("h-3 w-3 transition-transform", showRaw && "rotate-90")} />
                    {showRaw ? "Hide" : "Show"} raw model output
                  </button>
                  {showRaw && (
                    <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-4 text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                      {result.raw}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ) : (
            <ResultPlaceholder serviceName="Grok" />
          )}
        </div>
      </div>
    </div>
  );
}
