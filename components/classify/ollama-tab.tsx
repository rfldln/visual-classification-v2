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
import { cn } from "@/lib/utils";

interface OllamaTag {
  id: string;
  confidence: number;
  evidence?: string;
}

interface OllamaResponse {
  kind: "image" | "video";
  filename: string;
  model: string;
  frames?: number;
  frameImages?: string[];
  promptTokens?: number | null;
  completionTokens?: number | null;
  tags: OllamaTag[];
  summary?: string;
  notes?: string;
  raw?: string;
  error?: string;
}

const PRESET_MODELS = [
  { id: "huihui_ai/Qwen3.6-abliterated:27b", label: "27B" },
];

const DEFAULT_MODEL = PRESET_MODELS[0].id;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isOllamaUnreachable(err: string): boolean {
  return err.includes("Cannot reach Ollama") || err.includes("localhost:11434") || err.includes("ECONNREFUSED");
}

export function OllamaTab() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"image" | "video" | null>(null);
  const [result, setResult] = useState<OllamaResponse | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [intervalSec, setIntervalSec] = useState(5);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [isDragOver, setIsDragOver] = useState(false);
  const [frameCountForStatus, setFrameCountForStatus] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Bumped whenever a new file is picked or cleared, to abort any in-flight RunPod poll loop.
  const pollRef = useRef(0);

  const labelById = useMemo(() => {
    const m = new Map<string, { label: string; description: string }>();
    for (const c of CATEGORIES) m.set(c.id, { label: c.label, description: c.description });
    return m;
  }, []);

  async function runTag(f: File) {
    const token = pollRef.current;
    setStatus("Preparing…");
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
        setFrameCountForStatus(allBlobs.length);
        setStatus(`Asking ${model} (${allBlobs.length} frames / ${intervalSec}s)… This may take a moment.`);
      } else {
        form.set("kind", "image");
        form.set("image", f, f.name);
        setStatus(`Asking ${model}…`);
      }

      const res = await fetch("/api/ollama-tag", { method: "POST", body: form });
      const json = (await res.json()) as OllamaResponse & { jobId?: string };
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }

      // RunPod async path — poll the status endpoint from the browser until done.
      if (json.jobId) {
        const jobId = json.jobId;
        setStatus(`Processing on RunPod… (this can take a few minutes)`);
        const POLL_MS = 3000;
        while (pollRef.current === token) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          if (pollRef.current !== token) return;

          let sres: Response;
          try {
            sres = await fetch(`/api/ollama-tag/status?jobId=${encodeURIComponent(jobId)}`);
          } catch {
            continue; // transient — keep polling
          }
          if (pollRef.current !== token) return;
          if (!sres.ok) continue;

          const sjson = (await sres.json()) as OllamaResponse & { status?: string };
          if (pollRef.current !== token) return;

          if (sjson.status === "failed") {
            setError(sjson.error ?? "RunPod job failed");
            return;
          }
          if (sjson.status === "completed") {
            setResult({
              kind: json.kind,
              filename: json.filename,
              model: json.model,
              frames: json.frames,
              tags: sjson.tags ?? [],
              summary: sjson.summary,
              notes: sjson.notes,
              raw: sjson.raw,
              promptTokens: sjson.promptTokens,
              completionTokens: sjson.completionTokens,
              frameImages: frameDataUrls,
            });
            return;
          }
          // pending — keep polling
        }
        return; // superseded by a newer pick
      }

      // Local Ollama path — full result returned inline.
      if (frameDataUrls) json.frameImages = frameDataUrls;
      setResult(json);
    } catch (e) {
      if (pollRef.current === token) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (pollRef.current === token) setStatus(null);
    }
  }

  function onPick(f: File | null) {
    pollRef.current++; // abort any in-flight poll from a previous file
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

  void frameCountForStatus;

  return (
    <div className="space-y-5">
      {/* Settings */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-start gap-6">
          {/* Model */}
          <div className="space-y-2 flex-1 min-w-0">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
              Model
            </span>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {PRESET_MODELS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setModel(p.id)}
                  className={cn(
                    "rounded-md border px-3 py-1 text-xs font-mono transition-colors",
                    model === p.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={DEFAULT_MODEL}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground placeholder-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Frame interval */}
          <div className="flex items-end gap-3 pb-0.5">
            <div className="space-y-2">
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
            </div>
            <span className="text-xs text-muted-foreground/60 hidden sm:block pb-1.5">
              max 25 frames
            </span>
          </div>
        </div>
      </div>

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

      {/* Status / loading */}
      {status && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
          <span className="inline-block h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground" />
          <span className="font-mono text-muted-foreground">{status}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive space-y-1.5">
          <p>{error}</p>
          {isOllamaUnreachable(error) && (
            <p className="text-xs text-destructive/70">
              Make sure Ollama is running locally (<code className="font-mono">ollama serve</code>) and the model is pulled.
            </p>
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Token usage */}
          {(result.promptTokens != null || result.completionTokens != null) && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted px-4 py-3">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Tokens</span>
              <div className="flex items-center gap-3 ml-2">
                {result.promptTokens != null && (
                  <span className="text-sm font-mono text-foreground">
                    {result.promptTokens.toLocaleString()}
                    <span className="text-muted-foreground ml-1 text-xs">prompt</span>
                  </span>
                )}
                {result.promptTokens != null && result.completionTokens != null && (
                  <span className="text-muted-foreground/40">+</span>
                )}
                {result.completionTokens != null && (
                  <span className="text-sm font-mono text-foreground">
                    {result.completionTokens.toLocaleString()}
                    <span className="text-muted-foreground ml-1 text-xs">completion</span>
                  </span>
                )}
              </div>
              <span className="ml-auto text-xs font-mono text-muted-foreground/60">{result.model}</span>
            </div>
          )}

          {/* Frame thumbnails */}
          {result.frameImages && result.frameImages.length > 0 && (
            <div>
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
                Frames Sent to Ollama ({result.frameImages.length})
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
                  Ollama did not assign any tags from the taxonomy.
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
      )}
    </div>
  );
}
