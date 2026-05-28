"use client";

import { useState, useRef } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  generateTextToImage,
  generateImageToImage,
  generateTextToVideo,
  generateMultimodalToVideo,
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

type Mode = "t2i" | "i2i" | "t2v" | "m2v";
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
  t2i: { label: "Text to Image",  icon: Wand2,     isVideo: false },
  i2i: { label: "Image to Image", icon: ImageIcon, isVideo: false },
  t2v: { label: "Text to Video",  icon: Film,      isVideo: true  },
  m2v: { label: "Multimodal",     icon: Layers,    isVideo: true  },
};

const IMAGE_MODES: Mode[] = ["t2i", "i2i"];
const VIDEO_MODES: Mode[] = ["t2v", "m2v"];

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

  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [count, setCount] = useState<GenerationCount>(1);
  const [duration, setDuration] = useState<VideoDuration>(5);
  const [resolution, setResolution] = useState<VideoResolution>("720p");
  const [generateAudio, setGenerateAudio] = useState(false);

  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [mRefs, setMRefs] = useState<MultimodalRef[]>([]);

  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isVideoMode = MODES[mode].isVideo;

  function switchMode(next: Mode) {
    setMode(next);
    setResults([]);
    setError(null);
    setStatus("idle");
    if (MODES[next].isVideo !== isVideoMode) setReferenceImages([]);
    if (next !== "m2v") setMRefs([]);
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
    (mode === "t2i" || mode === "t2v" ? true : mode === "m2v" ? m2vHasNonAudio : referenceImages.length > 0);

  async function handleGenerate() {
    if (!canGenerate) return;
    setStatus("generating");
    setResults([]);
    setError(null);

    if (mode === "t2v") {
      const res = await generateTextToVideo({ prompt, aspectRatio, duration, resolution, generateAudio });
      if (!res.ok) { setError(res.error); setStatus("error"); return; }
      setResults([{ url: res.dataUrl, isVideo: true }]);
      setStatus("done");
      return;
    }

    if (mode === "m2v") {
      const res = await generateMultimodalToVideo({
        prompt, aspectRatio, duration, resolution,
        refs: mRefs.map(({ type, dataBase64, role, mimeType }) => ({ type, dataBase64, role, mimeType })),
        generateAudio,
      });
      if (!res.ok) { setError(res.error); setStatus("error"); return; }
      setResults([{ url: res.dataUrl, isVideo: true }]);
      setStatus("done");
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

  const pct = ((duration - VIDEO_DURATION_MIN) / (VIDEO_DURATION_MAX - VIDEO_DURATION_MIN)) * 100;

  const hint =
    mode === "m2v" && !m2vHasNonAudio
      ? "Add at least one image or video reference to continue"
      : mode === "i2i" && referenceImages.length === 0
        ? "Upload a reference image to continue"
        : isVideoMode
          ? "30 – 120 s per generation  ·  ⌘ Enter"
          : "⌘ Enter to generate";

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: Mode selector ───────────────────────────────────────────── */}
      <aside className="w-52 shrink-0 border-r border-border flex flex-col bg-card">
        <div className="px-5 py-5 border-b border-border">
          <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">Generate</p>
        </div>

        <nav className="flex-1 px-2 py-5 space-y-5 overflow-y-auto">
          <ModeGroup
            label="Seedream 4.5"
            badge="Image"
            modes={IMAGE_MODES}
            active={mode}
            onSelect={switchMode}
          />
          <div className="mx-3 h-px bg-border" />
          <ModeGroup
            label="Seedance 2.0"
            badge="Video"
            modes={VIDEO_MODES}
            active={mode}
            onSelect={switchMode}
          />
        </nav>
      </aside>

      {/* ── Right: Workspace ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Controls */}
        <div className="shrink-0 border-b border-border px-8 py-6 space-y-5 overflow-y-auto max-h-[60vh]">

          {/* I2I reference images */}
          {mode === "i2i" && (
            <ControlBlock
              label="Reference images"
              badge={referenceImages.length > 0 ? `${referenceImages.length} / ${MAX_REFERENCES}` : undefined}
            >
              {referenceImages.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {referenceImages.map((src, i) => (
                    <div key={i} className="relative group h-20 w-20 rounded-md overflow-hidden border border-border bg-muted flex-shrink-0">
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
                      className="h-20 w-20 flex-shrink-0 rounded-md border-2 border-dashed border-border hover:border-foreground/30 hover:bg-muted/50 flex items-center justify-center transition-colors"
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

          {/* M2V multimodal refs — horizontal 3-column layout */}
          {mode === "m2v" && (
            <MultimodalRefPanel refs={mRefs} onChange={setMRefs} />
          )}

          {/* Prompt */}
          <ControlBlock label="Prompt">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                mode === "m2v"
                  ? "e.g. @Image1 walking through @Image2 environment, motion like @Video1…"
                  : "Describe what you want to create…"
              }
              rows={4}
              className="w-full resize-none rounded-lg border border-input bg-background px-3.5 py-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring leading-relaxed"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
            />
          </ControlBlock>

          {/* Settings row */}
          <div className="flex flex-wrap gap-x-8 gap-y-4 items-start">
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
                  <div className="w-44 space-y-2">
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

          {/* Generate */}
          <div className="space-y-2">
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
            <p className="text-[11px] text-muted-foreground/70 text-center">{hint}</p>
          </div>
        </div>

        {/* Output */}
        <div className="flex-1 overflow-y-auto">
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

// ── MultimodalRefPanel — horizontal 3-column in main area ─────────────────────

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
    <div className="grid grid-cols-3 gap-4">
      {/* Images */}
      <RefSection label="Images" count={images.length} max={M2V_MAX_IMAGES} onAdd={() => imgInput.current?.click()}>
        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5 mb-1.5">
            {images.map((ref) => (
              <div key={ref.id} className="relative group">
                <div className="aspect-square rounded-md overflow-hidden border border-border bg-muted">
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
                <RoleSelect value={ref.role} mediaType="image" onChange={(r) => updateRole(ref.id, r)} />
              </div>
            ))}
            {images.length < M2V_MAX_IMAGES && (
              <button onClick={() => imgInput.current?.click()}
                className="aspect-square rounded-md border-2 border-dashed border-border hover:border-foreground/30 hover:bg-muted/50 flex items-center justify-center transition-colors">
                <Upload className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        )}
        <input ref={imgInput} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => addFiles(e.target.files, "image", M2V_MAX_IMAGES, "subject")} />
      </RefSection>

      {/* Videos */}
      <RefSection label="Videos" count={videos.length} max={M2V_MAX_VIDEOS} onAdd={() => vidInput.current?.click()}>
        {videos.map((ref) => (
          <MediaRow key={ref.id}
            icon={<Film className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
            label={getLabel(refs, ref.id)} fileName={ref.fileName} role={ref.role} mediaType="video"
            onRoleChange={(r) => updateRole(ref.id, r)} onRemove={() => remove(ref.id)} />
        ))}
        <input ref={vidInput} type="file" accept="video/mp4,video/quicktime,video/webm" multiple className="hidden"
          onChange={(e) => addFiles(e.target.files, "video", M2V_MAX_VIDEOS, "motion")} />
      </RefSection>

      {/* Audio */}
      <RefSection label="Audio" count={audios.length} max={M2V_MAX_AUDIO} onAdd={() => audInput.current?.click()}>
        {audios.map((ref) => (
          <MediaRow key={ref.id}
            icon={<Music className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
            label={getLabel(refs, ref.id)} fileName={ref.fileName} role={ref.role} mediaType="audio"
            onRoleChange={(r) => updateRole(ref.id, r)} onRemove={() => remove(ref.id)} />
        ))}
        <input ref={audInput} type="file" accept="audio/mpeg,audio/wav,audio/mp3,audio/*" multiple className="hidden"
          onChange={(e) => addFiles(e.target.files, "audio", M2V_MAX_AUDIO, "audio")} />
      </RefSection>
    </div>
  );
}

function RefSection({ label, count, max, onAdd, children }: {
  label: string; count: number; max: number; onAdd: () => void; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">{count}/{max}</span>
          {count < max && (
            <button onClick={onAdd} className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
              + add
            </button>
          )}
        </div>
      </div>
      {children}
      {count === 0 && (
        <button onClick={onAdd}
          className="w-full flex items-center justify-center gap-2 h-16 rounded-lg border-2 border-dashed border-border hover:border-foreground/30 hover:bg-muted/40 transition-colors text-xs text-muted-foreground">
          <Upload className="h-3.5 w-3.5" />
          Add {label.toLowerCase()}
        </button>
      )}
    </div>
  );
}

function MediaRow({ icon, label, fileName, role, mediaType, onRoleChange, onRemove }: {
  icon: React.ReactNode; label: string; fileName: string;
  role: RefRole; mediaType: "image" | "video" | "audio";
  onRoleChange: (r: RefRole) => void; onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 mb-1">
      {icon}
      <span className="text-[10px] font-mono bg-muted rounded px-1 py-0.5 text-muted-foreground flex-shrink-0">{label}</span>
      <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{fileName}</span>
      <RoleSelect value={role} mediaType={mediaType} onChange={onRoleChange} />
      <button onClick={onRemove} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
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
  // Single-option types (video → motion, audio → audio): show as a static badge
  if (options.length === 1) {
    return (
      <span className="text-[10px] font-mono rounded border border-border bg-muted text-muted-foreground px-1.5 py-0.5 flex-shrink-0">
        {options[0].label}
      </span>
    );
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as RefRole)}
      className="text-[10px] font-mono rounded border border-border bg-background text-muted-foreground px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring flex-shrink-0 cursor-pointer"
      onClick={(e) => e.stopPropagation()}>
      {options.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
    </select>
  );
}

// ── Shared primitives ──────────────────────────────────────────────────────────

function ModeGroup({ label, badge, modes, active, onSelect }: {
  label: string; badge: string; modes: Mode[];
  active: Mode; onSelect: (m: Mode) => void;
}) {
  return (
    <div className="space-y-0.5">
      <div className="px-3 mb-2">
        <p className="text-xs font-semibold text-foreground/80 tracking-tight">{label}</p>
        <span className="inline-flex items-center rounded-sm px-1.5 py-px text-[10px] font-mono bg-muted text-muted-foreground mt-1">
          {badge}
        </span>
      </div>
      {modes.map((m) => {
        const cfg = MODES[m];
        const Icon = cfg.icon;
        const isActive = active === m;
        return (
          <button key={m} onClick={() => onSelect(m)}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all relative",
              isActive
                ? "bg-foreground/[0.06] text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
            )}>
            {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r-full bg-foreground" />}
            <Icon className={cn("h-3.5 w-3.5 flex-shrink-0", isActive ? "text-foreground" : "text-muted-foreground")} />
            <span>{cfg.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ControlBlock({ label, badge, children }: { label: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">{label}</span>
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
      <div className="flex flex-col items-center justify-center h-full text-center gap-4 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-muted">
          {isVideoMode ? <Film className="h-9 w-9 text-muted-foreground" /> : <Wand2 className="h-9 w-9 text-muted-foreground" />}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">{isVideoMode ? "No video yet" : "No images yet"}</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            {isVideoMode
              ? "Set up your references and prompt above, then click Generate."
              : "Write a prompt above and click Generate to create your first image."}
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
