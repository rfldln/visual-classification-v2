"use client";

import { useState, useRef, useEffect } from "react";
import {
  Wand2,
  Image as ImageIcon,
  Film,
  Layers,
  Music,
  Download,
  Loader2,
  X,
  Upload,
  RotateCcw,
  Clapperboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  generateTextToImage,
  generateImageToImage,
  startTextToVideo,
  startMultimodalToVideo,
  startImageToVideo,
  pollVideoJob,
  type VideoStartResult,
} from "@/lib/generate/actions";
import {
  ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
  VIDEO_DURATION_MIN,
  VIDEO_DURATION_MAX,
  REF_ROLES_BY_TYPE,
  M2V_MAX_IMAGES,
  M2V_MAX_VIDEOS,
  M2V_MAX_AUDIO,
  type AspectRatio,
  type GenerationCount,
  type VideoDuration,
  type VideoResolution,
  type RefRole,
} from "@/lib/generate/constants";

type Mode = "t2i" | "i2i" | "t2v" | "m2v" | "i2v";
type Status = "idle" | "generating" | "done" | "error";

interface ResultItem { url: string; isVideo: boolean; }

export interface MultimodalRef {
  id: string;
  type: "image" | "video" | "audio";
  dataBase64: string;
  role: RefRole;
  fileName: string;
  mimeType: string;
}

const MAX_REFERENCES = 8;

interface ModeConfig { label: string; icon: React.ElementType; isVideo: boolean; }

const MODES: Record<Mode, ModeConfig> = {
  t2i: { label: "Text to Image",  icon: Wand2,         isVideo: false },
  i2i: { label: "Image to Image", icon: ImageIcon,     isVideo: false },
  t2v: { label: "Text to Video",  icon: Film,          isVideo: true  },
  m2v: { label: "Multimodal",     icon: Layers,        isVideo: true  },
  i2v: { label: "Image to Video", icon: Clapperboard,  isVideo: true  },
};

const IMAGE_MODES: Mode[] = ["t2i", "i2i"];
const VIDEO_MODES: Mode[] = ["t2v", "m2v", "i2v"];

function getLabel(refs: MultimodalRef[], id: string): string {
  const ref = refs.find((r) => r.id === id);
  if (!ref) return "";
  const sameType = refs.filter((r) => r.type === ref.type);
  const idx = sameType.findIndex((r) => r.id === id) + 1;
  const prefix = { image: "Image", video: "Video", audio: "Audio" } as const;
  return `@${prefix[ref.type]}${idx}`;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function GenerateClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("t2i");

  useEffect(() => {
    const stored = localStorage.getItem("generate-mode") as Mode | null;
    if (stored && stored in MODES) setMode(stored);
  }, []);

  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [count, setCount] = useState<GenerationCount>(1);
  const [duration, setDuration] = useState<VideoDuration>(5);
  const [resolution, setResolution] = useState<VideoResolution>("720p");
  const [generateAudio, setGenerateAudio] = useState(false);

  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [mRefs, setMRefs] = useState<MultimodalRef[]>([]);
  const [firstFrame, setFirstFrame] = useState<string | null>(null);
  const [lastFrame, setLastFrame] = useState<string | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Bumped on every cancel (mode switch / reset / unmount) to abort any in-flight video poll loop.
  const pollGenerationRef = useRef(0);
  useEffect(() => () => { pollGenerationRef.current++; }, []);

  const isVideoMode = MODES[mode].isVideo;

  function switchMode(next: Mode) {
    pollGenerationRef.current++; // abort any in-flight video poll
    setMode(next);
    setPrompt("");
    setResults([]);
    setError(null);
    setStatus("idle");
    if (MODES[next].isVideo !== isVideoMode) setReferenceImages([]);
    if (next !== "m2v") setMRefs([]);
    if (next !== "i2v") { setFirstFrame(null); setLastFrame(null); }
    localStorage.setItem("generate-mode", next);
  }

  function addReferenceFiles(files: FileList | File[]) {
    const remaining = MAX_REFERENCES - referenceImages.length;
    if (remaining <= 0) return;
    Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, remaining).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setReferenceImages((prev) => prev.length < MAX_REFERENCES ? [...prev, result] : prev);
      };
      reader.readAsDataURL(file);
    });
  }

  function removeReference(index: number) {
    setReferenceImages((prev) => prev.filter((_, i) => i !== index));
    if (inputRef.current) inputRef.current.value = "";
  }

  const m2vHasNonAudio = mRefs.some((r) => r.type === "image" || r.type === "video");

  const canGenerate =
    !!prompt.trim() &&
    status !== "generating" &&
    (mode === "t2i" || mode === "t2v"
      ? true
      : mode === "m2v"
        ? m2vHasNonAudio
        : mode === "i2v"
          ? !!firstFrame
          : referenceImages.length > 0);

  // Drives the submit → poll → finalize loop for a video job entirely from the browser,
  // so no single server request runs long enough to hit Vercel's function timeout.
  async function runVideoJob(start: VideoStartResult) {
    if (!start.ok) { setError(start.error); setStatus("error"); return; }

    const token = pollGenerationRef.current;
    const POLL_INTERVAL_MS = 5000;

    while (pollGenerationRef.current === token) {
      const res = await pollVideoJob({
        pollingUrl: start.pollingUrl,
        jobId: start.jobId,
        prompt,
        tempKeys: start.tempKeys,
      });

      if (pollGenerationRef.current !== token) return; // cancelled while awaiting

      if (!res.ok) { setError(res.error); setStatus("error"); return; }
      if (res.status === "completed") {
        setResults([{ url: res.dataUrl, isVideo: true }]);
        setStatus("done");
        return;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  async function handleGenerate() {
    if (!canGenerate) return;
    pollGenerationRef.current++; // supersede any previous in-flight job
    setStatus("generating");
    setResults([]);
    setError(null);

    if (mode === "t2v") {
      const start = await startTextToVideo({ prompt, aspectRatio, duration, resolution, generateAudio });
      await runVideoJob(start);
      return;
    }

    if (mode === "m2v") {
      const start = await startMultimodalToVideo({
        prompt, aspectRatio, duration, resolution,
        refs: mRefs.map(({ type, dataBase64, role, mimeType }) => ({ type, dataBase64, role, mimeType })),
        generateAudio,
      });
      await runVideoJob(start);
      return;
    }

    if (mode === "i2v") {
      if (!firstFrame) { setError("A first frame image is required"); setStatus("error"); return; }
      const start = await startImageToVideo({
        prompt, aspectRatio, duration, resolution,
        firstFrameBase64: firstFrame,
        lastFrameBase64: lastFrame ?? undefined,
        generateAudio,
      });
      await runVideoJob(start);
      return;
    }

    const params = { prompt, aspectRatio, count };
    const res = mode === "t2i"
      ? await generateTextToImage(params)
      : await generateImageToImage({ ...params, referenceBase64: referenceImages });

    if (!res.ok) { setError(res.error); setStatus("error"); return; }
    setResults(res.urls.map((url) => ({ url, isVideo: false })));
    setStatus("done");
  }

  function handleDownload(url: string, index: number) {
    const a = document.createElement("a");
    a.href = url;
    a.download = results[index]?.isVideo ? `generated-video-${index + 1}.mp4` : `generated-${index + 1}.png`;
    a.click();
  }

  function resetParams() {
    pollGenerationRef.current++; // abort any in-flight video poll
    setPrompt("");
    setAspectRatio("16:9");
    setCount(1);
    setDuration(5);
    setResolution("720p");
    setGenerateAudio(false);
    setReferenceImages([]);
    setMRefs([]);
    setFirstFrame(null);
    setLastFrame(null);
    setResults([]);
    setError(null);
    setStatus("idle");
  }

  const pct = ((duration - VIDEO_DURATION_MIN) / (VIDEO_DURATION_MAX - VIDEO_DURATION_MIN)) * 100;

  const hint =
    mode === "m2v" && !m2vHasNonAudio
      ? "Add at least one image or video reference to continue"
      : mode === "i2v" && !firstFrame
        ? "Upload a first frame to continue"
        : mode === "i2i" && referenceImages.length === 0
          ? "Upload a reference image to continue"
          : isVideoMode
            ? "30 – 120 s per generation  ·  ⌘ Enter"
            : "⌘ Enter to generate";

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Mode tab header ───────────────────────────────────────────────── */}
      <header className="shrink-0 h-12 border-b border-border bg-card flex items-center px-5 gap-5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest pr-1.5">
            Seedream 4.5
          </span>
          {IMAGE_MODES.map((m) => (
            <ModeTab key={m} mode={m} active={mode === m} onSelect={switchMode} />
          ))}
        </div>

        <div className="w-px h-5 bg-border shrink-0" />

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest pr-1.5">
            Seedance 2.0
          </span>
          {VIDEO_MODES.map((m) => (
            <ModeTab key={m} mode={m} active={mode === m} onSelect={switchMode} />
          ))}
        </div>
      </header>

      {/* ── Body: controls left + output right ───────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Controls column */}
        <div className="w-96 shrink-0 flex flex-col border-r border-border bg-card">

          {/* Scrollable form area */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

            {/* I2I reference images */}
            {mode === "i2i" && (
              <ControlBlock
                label="Reference images"
                badge={referenceImages.length > 0 ? `${referenceImages.length} / ${MAX_REFERENCES}` : undefined}
              >
                {referenceImages.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {referenceImages.map((src, i) => (
                      <div key={i} className="relative group h-20 w-20 rounded-md overflow-hidden border border-border bg-muted shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={`Reference ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() => removeReference(i)}
                          className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                    {referenceImages.length < MAX_REFERENCES && (
                      <button
                        onClick={() => inputRef.current?.click()}
                        className="h-20 w-20 shrink-0 rounded-md border-2 border-dashed border-border hover:border-foreground/30 hover:bg-muted/50 flex items-center justify-center transition-colors"
                      >
                        <Upload className="h-4 w-4 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                ) : (
                  <DropZone
                    isDragging={isDragging}
                    hint={`up to ${MAX_REFERENCES} images`}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setIsDragging(false); addReferenceFiles(e.dataTransfer.files); }}
                    onClick={() => inputRef.current?.click()}
                  />
                )}
                <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={(e) => { if (e.target.files) addReferenceFiles(e.target.files); }} />
              </ControlBlock>
            )}

            {/* M2V multimodal refs */}
            {mode === "m2v" && (
              <MultimodalRefPanel refs={mRefs} onChange={setMRefs} />
            )}

            {/* I2V first / last frame */}
            {mode === "i2v" && (
              <FrameUploadPanel
                firstFrame={firstFrame}
                lastFrame={lastFrame}
                onFirstFrame={setFirstFrame}
                onLastFrame={setLastFrame}
              />
            )}

            {/* Prompt */}
            <ControlBlock label="Prompt">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  mode === "m2v"
                    ? "e.g. reference @Image1 for the subject, @Video1 for camera motion, @Audio1 for voice…"
                    : mode === "i2v"
                      ? "Describe the motion between your first and last frame…"
                      : "Describe what you want to create…"
                }
                rows={4}
                className="w-full resize-none rounded-lg border border-input bg-background px-3.5 py-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring leading-relaxed"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
              />
            </ControlBlock>

            {/* Settings */}
            <div className="space-y-5">
              <ControlBlock label="Aspect ratio">
                <div className="flex flex-wrap gap-1.5">
                  {ASPECT_RATIOS.map(({ value, label }) => (
                    <PillButton key={value} active={aspectRatio === value} onClick={() => setAspectRatio(value)}>
                      {label}
                    </PillButton>
                  ))}
                </div>
              </ControlBlock>

              {!isVideoMode && (
                <ControlBlock label="Images">
                  <div className="flex gap-1.5">
                    {([1, 2, 3, 4] as GenerationCount[]).map((n) => (
                      <PillButton key={n} active={count === n} onClick={() => setCount(n)}>{n}</PillButton>
                    ))}
                  </div>
                </ControlBlock>
              )}

              {isVideoMode && (
                <>
                  <ControlBlock label={`Duration · ${duration}s`}>
                    <div className="w-full space-y-2">
                      <input
                        type="range"
                        min={VIDEO_DURATION_MIN}
                        max={VIDEO_DURATION_MAX}
                        step={1}
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                        className={cn(
                          "w-full h-2 rounded-full appearance-none cursor-pointer",
                          "[&::-webkit-slider-thumb]:appearance-none",
                          "[&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5",
                          "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-background",
                          "[&::-webkit-slider-thumb]:shadow-[0_0_0_2.5px_var(--foreground)]",
                          "[&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform",
                          "[&::-webkit-slider-thumb]:hover:scale-110",
                          "[&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5",
                          "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-background",
                          "[&::-moz-range-thumb]:shadow-[0_0_0_2.5px_var(--foreground)]",
                          "[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer",
                        )}
                        style={{
                          background: `linear-gradient(to right, var(--foreground) 0%, var(--foreground) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`,
                        }}
                      />
                      <div className="flex justify-between text-[10px] font-mono text-muted-foreground/50">
                        <span>{VIDEO_DURATION_MIN}s</span>
                        <span>{VIDEO_DURATION_MAX}s</span>
                      </div>
                    </div>
                  </ControlBlock>

                  <ControlBlock label="Resolution">
                    <div className="flex gap-1.5">
                      {VIDEO_RESOLUTIONS.map(({ value, label }) => (
                        <PillButton key={value} active={resolution === value} onClick={() => setResolution(value)}>
                          {label}
                        </PillButton>
                      ))}
                    </div>
                  </ControlBlock>

                  <ControlBlock label="Audio">
                    <button
                      onClick={() => setGenerateAudio((a) => !a)}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-mono transition-all",
                        generateAudio
                          ? "bg-foreground text-background font-semibold"
                          : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/70",
                      )}
                    >
                      <Music className="h-3 w-3" />
                      {generateAudio ? "On" : "Off"}
                    </button>
                    <p className="text-[10px] text-muted-foreground/60 mt-1.5">
                      {generateAudio ? "Model generates audio output" : "No audio — avoids content filter issues"}
                    </p>
                  </ControlBlock>
                </>
              )}
            </div>
          </div>

          {/* Sticky generate footer */}
          <div className="shrink-0 px-6 py-4 border-t border-border space-y-2">
            <Button onClick={handleGenerate} disabled={!canGenerate} size="lg" className="w-full gap-2">
              {status === "generating"
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : isVideoMode
                  ? <Film className="h-4 w-4" />
                  : <Wand2 className="h-4 w-4" />}
              {status === "generating"
                ? isVideoMode ? "Generating video…" : "Generating…"
                : "Generate"}
            </Button>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground/70 flex-1">{hint}</p>
              <button
                onClick={resetParams}
                title="Reset parameters"
                className="flex items-center gap-1 text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
              >
                <RotateCcw className="h-2.5 w-2.5" />
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Output column */}
        <div className="flex-1 overflow-y-auto bg-background">
          <OutputArea
            status={status}
            results={results}
            error={error}
            count={isVideoMode ? 1 : count}
            aspectRatio={aspectRatio}
            isVideoMode={isVideoMode}
            onRetry={handleGenerate}
            onDownload={handleDownload}
          />
        </div>
      </div>
    </div>
  );
}

// ── MultimodalRefPanel — 3-column layout inside controls column ───────────────

function MultimodalRefPanel({ refs, onChange }: { refs: MultimodalRef[]; onChange: (refs: MultimodalRef[]) => void }) {
  const imgInput = useRef<HTMLInputElement>(null);
  const vidInput = useRef<HTMLInputElement>(null);
  const audInput = useRef<HTMLInputElement>(null);

  const images = refs.filter((r) => r.type === "image");
  const videos = refs.filter((r) => r.type === "video");
  const audios = refs.filter((r) => r.type === "audio");

  function readFile(file: File, type: MultimodalRef["type"], role: RefRole) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataBase64 = e.target?.result as string;
      onChange([...refs, { id: crypto.randomUUID(), type, dataBase64, role, fileName: file.name, mimeType: file.type }]);
    };
    reader.readAsDataURL(file);
  }

  function addFiles(files: FileList | null, type: MultimodalRef["type"], maxCount: number, defaultRole: RefRole) {
    if (!files) return;
    const remaining = maxCount - refs.filter((r) => r.type === type).length;
    Array.from(files).slice(0, remaining).forEach((f) => readFile(f, type, defaultRole));
  }

  function remove(id: string) { onChange(refs.filter((r) => r.id !== id)); }
  function updateRole(id: string, role: RefRole) { onChange(refs.map((r) => r.id === id ? { ...r, role } : r)); }

  return (
    <div className="space-y-4">

      {/* Images — wrapping thumbnail grid */}
      <div className="space-y-1.5">
        <RefSectionHeader label="Images" count={images.length} max={M2V_MAX_IMAGES} onAdd={() => imgInput.current?.click()} />
        {images.length === 0 ? (
          <button onClick={() => imgInput.current?.click()}
            className="w-full flex items-center justify-center gap-2 h-16 rounded-lg border-2 border-dashed border-border hover:border-foreground/30 hover:bg-muted/40 transition-colors text-xs text-muted-foreground">
            <Upload className="h-3.5 w-3.5" />
            Add images
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            {images.map((ref) => (
              <div key={ref.id} className="relative group h-16 w-16 shrink-0">
                <div className="h-full w-full rounded-md overflow-hidden border border-border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ref.dataBase64} alt={ref.fileName} className="w-full h-full object-cover" />
                </div>
                <span className="absolute top-0.5 left-0.5 text-[9px] font-mono bg-black/60 text-white rounded px-1 leading-4">
                  {getLabel(refs, ref.id)}
                </span>
                <button
                  onClick={() => remove(ref.id)}
                  className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
            {images.length < M2V_MAX_IMAGES && (
              <button onClick={() => imgInput.current?.click()}
                className="h-16 w-16 shrink-0 rounded-md border-2 border-dashed border-border hover:border-foreground/30 hover:bg-muted/50 flex items-center justify-center transition-colors">
                <Upload className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        )}
        <input ref={imgInput} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => addFiles(e.target.files, "image", M2V_MAX_IMAGES, "reference_image")} />
      </div>

      {/* Videos — row list */}
      <div className="space-y-1.5">
        <RefSectionHeader label="Videos" count={videos.length} max={M2V_MAX_VIDEOS} onAdd={() => vidInput.current?.click()} />
        {videos.length === 0 ? (
          <button onClick={() => vidInput.current?.click()}
            className="w-full flex items-center justify-center gap-2 h-16 rounded-lg border-2 border-dashed border-border hover:border-foreground/30 hover:bg-muted/40 transition-colors text-xs text-muted-foreground">
            <Upload className="h-3.5 w-3.5" />
            Add videos
          </button>
        ) : (
          <div className="space-y-1">
            {videos.map((ref) => (
              <MediaRow key={ref.id}
                icon={<Film className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                label={getLabel(refs, ref.id)} fileName={ref.fileName} role={ref.role} mediaType="video"
                onRoleChange={(r) => updateRole(ref.id, r)} onRemove={() => remove(ref.id)} />
            ))}
          </div>
        )}
        <input ref={vidInput} type="file" accept="video/mp4,video/quicktime,video/webm" multiple className="hidden"
          onChange={(e) => addFiles(e.target.files, "video", M2V_MAX_VIDEOS, "reference_video")} />
      </div>

      {/* Audio — row list */}
      <div className="space-y-1.5">
        <RefSectionHeader label="Audio" count={audios.length} max={M2V_MAX_AUDIO} onAdd={() => audInput.current?.click()} />
        {audios.length === 0 ? (
          <button onClick={() => audInput.current?.click()}
            className="w-full flex items-center justify-center gap-2 h-16 rounded-lg border-2 border-dashed border-border hover:border-foreground/30 hover:bg-muted/40 transition-colors text-xs text-muted-foreground">
            <Upload className="h-3.5 w-3.5" />
            Add audio
          </button>
        ) : (
          <div className="space-y-1">
            {audios.map((ref) => (
              <MediaRow key={ref.id}
                icon={<Music className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                label={getLabel(refs, ref.id)} fileName={ref.fileName} role={ref.role} mediaType="audio"
                onRoleChange={(r) => updateRole(ref.id, r)} onRemove={() => remove(ref.id)} />
            ))}
          </div>
        )}
        <input ref={audInput} type="file" accept="audio/mpeg,audio/wav,audio/mp3,audio/*" multiple className="hidden"
          onChange={(e) => addFiles(e.target.files, "audio", M2V_MAX_AUDIO, "reference_audio")} />
      </div>
    </div>
  );
}

// ── FrameUploadPanel — first / last frame slots for I2V ───────────────────────

function FrameUploadPanel({ firstFrame, lastFrame, onFirstFrame, onLastFrame }: {
  firstFrame: string | null;
  lastFrame: string | null;
  onFirstFrame: (src: string | null) => void;
  onLastFrame: (src: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FrameSlot label="First frame" required value={firstFrame} onChange={onFirstFrame} />
      <FrameSlot label="Last frame" value={lastFrame} onChange={onLastFrame} />
    </div>
  );
}

function FrameSlot({ label, required, value, onChange }: {
  label: string;
  required?: boolean;
  value: string | null;
  onChange: (src: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => onChange(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">{label}</span>
        {required && <span className="text-[10px] font-mono text-muted-foreground/40">required</span>}
      </div>
      {value ? (
        <div className="relative group aspect-square rounded-md overflow-hidden border border-border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={label} className="w-full h-full object-cover" />
          <button
            onClick={() => { onChange(null); if (input.current) input.current.value = ""; }}
            className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => input.current?.click()}
          className="aspect-square w-full rounded-md border-2 border-dashed border-border hover:border-foreground/30 hover:bg-muted/40 flex flex-col items-center justify-center gap-1.5 transition-colors"
        >
          <Upload className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground/60">Upload</span>
        </button>
      )}
      <input ref={input} type="file" accept="image/*" className="hidden"
        onChange={(e) => { handleFile(e.target.files?.[0]); }} />
    </div>
  );
}

function RefSectionHeader({ label, count, max, onAdd }: {
  label: string; count: number; max: number; onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">{count}/{max}</span>
        {count > 0 && count < max && (
          <button onClick={onAdd} className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
            + add
          </button>
        )}
      </div>
    </div>
  );
}

function MediaRow({ icon, label, fileName, role, mediaType, onRoleChange, onRemove }: {
  icon: React.ReactNode; label: string; fileName: string;
  role: RefRole; mediaType: "image" | "video" | "audio";
  onRoleChange: (r: RefRole) => void; onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 mb-1">
      {icon}
      <span className="text-[10px] font-mono bg-muted rounded px-1 py-0.5 text-muted-foreground shrink-0">{label}</span>
      <span className="text-[10px] text-muted-foreground truncate flex-1 min-w-0">{fileName}</span>
      <RoleSelect value={role} mediaType={mediaType} onChange={onRoleChange} />
      <button onClick={onRemove} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function RoleSelect({ value, mediaType, onChange }: {
  value: RefRole;
  mediaType: "image" | "video" | "audio";
  onChange: (r: RefRole) => void;
}) {
  const options = REF_ROLES_BY_TYPE[mediaType];
  if (options.length === 1) {
    return (
      <span className="text-[10px] font-mono rounded border border-border bg-muted text-muted-foreground px-1.5 py-0.5 shrink-0">
        {options[0].label}
      </span>
    );
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as RefRole)}
      className="text-[10px] font-mono rounded border border-border bg-background text-muted-foreground px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring shrink-0 cursor-pointer"
      onClick={(e) => e.stopPropagation()}>
      {options.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
    </select>
  );
}

// ── Shared primitives ──────────────────────────────────────────────────────────

function ModeTab({ mode, active, onSelect }: { mode: Mode; active: boolean; onSelect: (m: Mode) => void }) {
  const cfg = MODES[mode];
  const Icon = cfg.icon;
  return (
    <button
      onClick={() => onSelect(mode)}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {cfg.label}
    </button>
  );
}

function ControlBlock({ label, badge, children }: { label: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">{label}</span>
        {badge && <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">{badge}</span>}
      </div>
      {children}
    </div>
  );
}

function PillButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-mono transition-all",
        active
          ? "bg-foreground text-background font-semibold"
          : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/70",
      )}>
      {children}
    </button>
  );
}

function DropZone({ isDragging, hint, onDragOver, onDragLeave, onDrop, onClick }: {
  isDragging: boolean; hint: string;
  onDragOver: React.DragEventHandler; onDragLeave: React.DragEventHandler;
  onDrop: React.DragEventHandler; onClick: () => void;
}) {
  return (
    <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-2 h-24 rounded-lg border-2 border-dashed cursor-pointer transition-colors",
        isDragging ? "border-foreground/40 bg-muted/60" : "border-border hover:border-foreground/30 hover:bg-muted/40",
      )}>
      <Upload className="h-4 w-4 text-muted-foreground" />
      <p className="text-xs text-muted-foreground text-center px-3">
        Drop or click to browse<br />
        <span className="text-muted-foreground/50">{hint}</span>
      </p>
    </div>
  );
}

// ── Output area ────────────────────────────────────────────────────────────────

interface OutputAreaProps {
  status: Status; results: ResultItem[]; error: string | null;
  count: number; aspectRatio: AspectRatio; isVideoMode: boolean;
  onRetry: () => void; onDownload: (url: string, index: number) => void;
}

function OutputArea({ status, results, error, count, aspectRatio, isVideoMode, onRetry, onDownload }: OutputAreaProps) {
  if (status === "idle") {
    return (
      <div
        className="flex flex-col items-center justify-center h-full text-center gap-4 p-8"
        style={{
          backgroundImage: "radial-gradient(circle, oklch(0 0 0 / 5%) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-card border border-border shadow-sm">
          {isVideoMode ? <Film className="h-9 w-9 text-muted-foreground" /> : <Wand2 className="h-9 w-9 text-muted-foreground" />}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">{isVideoMode ? "No video yet" : "No images yet"}</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            {isVideoMode
              ? "Set up your references and prompt, then click Generate."
              : "Write a prompt and click Generate to create your first image."}
          </p>
        </div>
      </div>
    );
  }

  if (status === "generating") {
    return (
      <div className="p-8">
        {isVideoMode ? (
          <div className="max-w-xl mx-auto space-y-3">
            <div className="rounded-xl border border-border bg-muted animate-pulse" style={{ aspectRatio: aspectRatio.replace(":", "/") }} />
            <p className="text-xs text-muted-foreground text-center font-mono">Generating video — this may take 30–120 s…</p>
          </div>
        ) : (
          <div className={cn("grid gap-4", count === 1 ? "max-w-xl mx-auto grid-cols-1" : "grid-cols-2")}>
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-muted animate-pulse" style={{ aspectRatio: aspectRatio.replace(":", "/") }} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8">
        <p className="text-sm text-destructive text-center max-w-md">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
      </div>
    );
  }

  if (status === "done" && results.length > 0) {
    return (
      <div className="p-8">
        <div className={cn("grid gap-6", results.length === 1 ? "max-w-xl mx-auto grid-cols-1" : "grid-cols-2")}>
          {results.map((result, i) => (
            <div key={i} className="flex flex-col gap-3">
              {result.isVideo ? (
                <video src={result.url} controls className="w-full rounded-xl border border-border" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={result.url} alt={`Generated ${i + 1}`} className="w-full rounded-xl border border-border object-contain" />
              )}
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => onDownload(result.url, i)} aria-label="Download">
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
