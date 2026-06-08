"use client";

import { useMemo, useRef, useState } from "react";
import { ImageIcon, Film, X, Minus, Plus, ChevronRight, Activity } from "lucide-react";
import { CATEGORIES } from "@/lib/taxonomy";
import {
  probeVideoMeta,
  extractFramesEvenly,
  extractFramesFromRange,
} from "@/lib/video-client";
import { cn } from "@/lib/utils";

interface TaggerTag {
  id: string;
  confidence: number;
  evidence?: string;
}

interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface TaggerResponse {
  kind: "image" | "video";
  filename: string;
  model: string;
  frames?: number;
  frameImages?: string[];
  usage?: TokenUsage | null;
  tags: TaggerTag[];
  performers?: { males: number; females: number };
  summary?: string;
  notes?: string;
  raw?: string;
  error?: string;
}

export interface TaggerModel {
  id: string;
  label: string;
}

interface TaggerPanelProps {
  /** Display name used in labels, loading text and the empty state. */
  serviceName: string;
  /** Selectable models. The chosen id is sent as the `model` form field. */
  models: TaggerModel[];
  /** When true, adds a "Custom…" option that reveals a free-text model-id input. */
  allowCustomModel?: boolean;
  /** When true, shows a "Check pod" button that pings <endpoint>/health. */
  showHealthCheck?: boolean;
  /** API route to POST to. Defaults to the shared pod route. */
  endpoint?: string;
}

const CUSTOM_MODEL = "__custom__";

type HealthState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; models: string[] }
  | { status: "err"; error: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TaggerPanel({
  serviceName,
  models,
  allowCustomModel = false,
  showHealthCheck = false,
  endpoint = "/api/qwen25-tag",
}: TaggerPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"image" | "video" | null>(null);
  const [result, setResult] = useState<TaggerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [intervalSec, setIntervalSec] = useState(5);
  const [modelChoice, setModelChoice] = useState(models[0]?.id ?? "");
  const [customModel, setCustomModel] = useState("");
  const [health, setHealth] = useState<HealthState>({ status: "idle" });
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Bumped on every new pick/clear to abort an in-flight async RunPod poll loop.
  const pollRef = useRef(0);

  // Resolve the model id actually sent to the API: the dropdown value, unless
  // the user picked "Custom…", in which case the free-text field wins.
  const effectiveModel = modelChoice === CUSTOM_MODEL ? customModel.trim() : modelChoice;

  // True only after a successful check that returned a model list NOT containing
  // the selected model — the #1 footgun: pod is up but serving a different model.
  const modelMismatch =
    health.status === "ok" && effectiveModel.length > 0 && !health.models.includes(effectiveModel);

  async function checkHealth() {
    setHealth({ status: "checking" });
    try {
      const res = await fetch(`${endpoint}/health`);
      const json = (await res.json()) as { ok?: boolean; models?: string[]; error?: string };
      if (res.ok && json.ok) setHealth({ status: "ok", models: json.models ?? [] });
      else setHealth({ status: "err", error: json.error ?? `Request failed (${res.status})` });
    } catch (e) {
      setHealth({ status: "err", error: e instanceof Error ? e.message : String(e) });
    }
  }

  const labelById = useMemo(() => {
    const m = new Map<string, { label: string; description: string }>();
    for (const c of CATEGORIES) m.set(c.id, { label: c.label, description: c.description });
    return m;
  }, []);

  async function runTag(f: File) {
    if (!effectiveModel) {
      setError("Enter a model id before classifying.");
      return;
    }
    const token = pollRef.current;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const isVideo = f.type.startsWith("video") || /\.(mp4|mov|webm|mkv)$/i.test(f.name);
      const form = new FormData();
      form.set("filename", f.name);
      form.set("model", effectiveModel);

      let frameDataUrls: string[] | undefined;
      if (isVideo) {
        form.set("kind", "video");
        const meta = await probeVideoMeta(f);
        const dur = Math.max(1, meta.duration);

        // Qwen2.5-VL is natively multi-image — send individual frames instead of
        // one tiled contact sheet so the small model can actually resolve
        // performers and acts in each frame. 25 individual frames cost far more
        // tokens than a contact sheet, so resolution is held at 448px to stay
        // within the pod's 8192 context window.
        const mainCount = Math.min(25, Math.max(1, Math.ceil(dur / intervalSec)));
        const mainBlobs = await extractFramesEvenly(f, { count: mainCount, maxWidth: 448, quality: 0.65 });

        const END_FRACTION = 0.15;
        const endZoneDur = dur * END_FRACTION;
        const endCount = dur > 60 ? Math.min(6, Math.max(1, Math.ceil(endZoneDur / 2))) : 0;
        const endBlobs = endCount > 0
          ? await extractFramesFromRange(f, {
              startFraction: 1 - END_FRACTION,
              endFraction: 1,
              count: endCount,
              maxWidth: 448,
              quality: 0.65,
            })
          : [];

        const allBlobs = [...mainBlobs, ...endBlobs];
        frameDataUrls = allBlobs.map((b) => URL.createObjectURL(b));
        form.set("frame_count", String(allBlobs.length));
        form.set("main_count", String(mainBlobs.length));
        form.set("end_count", String(endBlobs.length));
        allBlobs.forEach((b, i) => {
          form.append("frames", new File([b], `frame_${i + 1}.jpg`, { type: "image/jpeg" }));
        });
      } else {
        form.set("kind", "image");
        form.set("image", f, f.name);
      }

      const res = await fetch(endpoint, { method: "POST", body: form });
      const json = (await res.json()) as TaggerResponse & { jobId?: string };
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }

      // Async RunPod serverless path — the route returns a jobId and the browser
      // polls /status until the job completes, sidestepping the Vercel timeout.
      // Sync routes (the pod) never return a jobId, so this branch is skipped.
      if (json.jobId) {
        const jobId = json.jobId;
        const POLL_MS = 3000;
        while (pollRef.current === token) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          if (pollRef.current !== token) return;

          let sres: Response;
          try {
            sres = await fetch(`${endpoint}/status?jobId=${encodeURIComponent(jobId)}`);
          } catch {
            continue; // transient — keep polling
          }
          if (pollRef.current !== token) return;
          if (!sres.ok) continue;

          const sjson = (await sres.json()) as TaggerResponse & { status?: string };
          if (pollRef.current !== token) return;

          if (sjson.status === "failed") {
            setError(sjson.error ?? "Serverless job failed");
            return;
          }
          if (sjson.status === "completed") {
            setResult({
              kind: json.kind,
              filename: json.filename,
              model: json.model,
              frames: json.frames,
              usage: sjson.usage ?? null,
              tags: sjson.tags ?? [],
              performers: sjson.performers,
              summary: sjson.summary,
              notes: sjson.notes,
              raw: sjson.raw,
              frameImages: frameDataUrls,
            });
            return;
          }
          // pending — keep polling
        }
        return; // superseded by a newer pick
      }

      // Sync path — full result returned inline.
      if (frameDataUrls) json.frameImages = frameDataUrls;
      setResult(json);
    } catch (e) {
      if (pollRef.current === token) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (pollRef.current === token) setLoading(false);
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

  return (
    <div className="space-y-5">
      {/* Settings */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest whitespace-nowrap">
              Model
            </span>
            <select
              value={modelChoice}
              onChange={(e) => setModelChoice(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
              {allowCustomModel && <option value={CUSTOM_MODEL}>Custom model id…</option>}
            </select>
            {allowCustomModel && modelChoice === CUSTOM_MODEL && (
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="org/model-name served by the pod"
                className="min-w-[20rem] flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            )}
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

        {showHealthCheck && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={checkHealth}
                disabled={health.status === "checking"}
                className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                {health.status === "checking" ? (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-border border-t-foreground" />
                ) : (
                  <Activity className="h-3 w-3" />
                )}
                Check pod
              </button>
              {health.status === "ok" && (
                <span className="text-xs font-mono text-emerald-500">
                  Pod live · {health.models.length} model{health.models.length !== 1 ? "s" : ""} loaded
                </span>
              )}
              {health.status === "err" && (
                <span className="text-xs font-mono text-destructive">{health.error}</span>
              )}
            </div>
            {health.status === "ok" && health.models.length > 0 && (
              <p className="text-xs font-mono text-muted-foreground/70">
                Loaded: {health.models.join(", ")}
              </p>
            )}
            {modelMismatch && (
              <p className="text-xs font-mono text-amber-500">
                ⚠ Selected model is not loaded on the pod — requests will fail. Load it on the pod or pick a loaded model above.
              </p>
            )}
          </div>
        )}

        {allowCustomModel && (
          <p className="mt-3 text-xs text-muted-foreground/60">
            The selected model must be the one currently loaded on the pod (set <span className="font-mono">QWEN25_POD_URL</span>). Swapping models here only changes the <span className="font-mono">model</span> field sent to that pod.
          </p>
        )}
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
                <Film className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className="text-sm font-mono truncate text-foreground">{file.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
            </div>
            <button
              onClick={() => onPick(null)}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 ml-3"
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

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
          <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground" />
          <span className="font-mono text-muted-foreground">
            {previewKind === "video"
              ? `Extracting frames & asking ${serviceName} (1 frame / ${intervalSec}s)…`
              : `Sending to ${serviceName}…`}
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Token usage */}
          {result.usage && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted px-4 py-3">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Tokens</span>
              <div className="flex items-center gap-3 ml-2">
                <span className="text-sm font-mono text-foreground">
                  {result.usage.prompt_tokens.toLocaleString()}
                  <span className="text-muted-foreground ml-1 text-xs">prompt</span>
                </span>
                <span className="text-muted-foreground/40">+</span>
                <span className="text-sm font-mono text-foreground">
                  {result.usage.completion_tokens.toLocaleString()}
                  <span className="text-muted-foreground ml-1 text-xs">completion</span>
                </span>
                <span className="text-muted-foreground/40">=</span>
                <span className="text-sm font-mono font-semibold text-foreground">
                  {result.usage.total_tokens.toLocaleString()}
                  <span className="text-muted-foreground ml-1 text-xs font-normal">total</span>
                </span>
              </div>
              <span className="ml-auto text-xs font-mono text-muted-foreground/60">{result.model}</span>
            </div>
          )}

          {/* Frame thumbnails */}
          {result.frameImages && result.frameImages.length > 0 && (
            <div>
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
                Frames Sent to {serviceName} ({result.frameImages.length})
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
              <div className="flex items-center gap-2">
                {result.performers && (
                  <span
                    className="text-xs font-mono bg-muted rounded px-2 py-0.5 text-muted-foreground"
                    title="Performer count reported by the model — drives the count tag and body-tag rules"
                  >
                    counted {result.performers.males}M / {result.performers.females}F
                  </span>
                )}
                <span className="text-xs font-mono text-muted-foreground">
                  {result.tags.length} tag{result.tags.length !== 1 ? "s" : ""}
                  {result.kind === "video" && result.frames ? ` · ${result.frames} frames` : ""}
                </span>
              </div>
            </div>

            {result.tags.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground italic">
                  {serviceName} did not assign any tags from the taxonomy.
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
                        <span className="text-xs font-mono text-muted-foreground mt-0.5 w-5 text-right shrink-0">
                          {i + 1}.
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={cn("text-sm font-semibold truncate", isTop && "text-foreground")}>
                                {meta?.label ?? t.id}
                              </span>
                              <span className="text-xs font-mono bg-muted rounded px-1.5 py-0.5 text-muted-foreground shrink-0">
                                {t.id}
                              </span>
                            </div>
                            <span className={cn(
                              "text-lg font-mono font-semibold shrink-0",
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
