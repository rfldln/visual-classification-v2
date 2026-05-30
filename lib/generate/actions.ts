"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { db } from "@/lib/db";
import { vaultItems } from "@/lib/db/schema";
import { env } from "@/lib/env";
import {
  GENERATION_MODEL,
  VIDEO_GENERATION_MODEL,
  OPENROUTER_CHAT_URL,
  OPENROUTER_VIDEO_URL,
  OPENROUTER_GENERATION_URL,
  M2V_MAX_IMAGES,
  M2V_MAX_VIDEOS,
  M2V_MAX_AUDIO,
  type AspectRatio,
  type GenerationCount,
  type VideoDuration,
  type VideoResolution,
  type RefRole,
} from "./constants";

interface OpenRouterChatResponse {
  choices?: {
    message?: {
      content?: string;
      images?: { type: string; image_url: { url: string } }[];
    };
  }[];
  error?: {
    message: string;
    code?: number;
    metadata?: { raw?: string; provider_name?: string };
  };
}

async function callOpenRouterImage(
  prompt: string,
  aspectRatio: AspectRatio,
  referenceUrls?: string[],
): Promise<string> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const message = referenceUrls?.length
    ? {
        role: "user",
        content: prompt,
        images: referenceUrls.map((url) => ({
          type: "image_url",
          image_url: { url },
        })),
      }
    : { role: "user", content: prompt };

  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://visual-classification.app",
      "X-Title": "Visual Classification",
    },
    body: JSON.stringify({
      model: GENERATION_MODEL,
      messages: [message],
      modalities: ["image"],
      image_config: { aspect_ratio: aspectRatio },
    }),
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    console.error("[OpenRouter] Non-JSON response", res.status, text.slice(0, 500));
    throw new Error(`Generation service error (${res.status})`);
  }

  const json = (await res.json()) as OpenRouterChatResponse;

  if (!res.ok || json.error) {
    console.error("[OpenRouter] API error", res.status, json.error);
    // Unwrap provider errors buried in metadata.raw
    const raw = json.error?.metadata?.raw;
    if (raw) {
      try {
        const inner = JSON.parse(raw) as { error?: { code?: string; message?: string } };
        const code = inner.error?.code;
        if (code === "InputImageSensitiveContentDetected") {
          throw new Error("Reference image was flagged by the provider's content filter. Try a different image.");
        }
        if (inner.error?.message) throw new Error(inner.error.message);
      } catch (e) {
        if (e instanceof Error && e.message !== raw) throw e;
      }
    }
    throw new Error(json.error?.message ?? `OpenRouter error ${res.status}`);
  }

  const imageUrl = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!imageUrl) {
    console.error("[OpenRouter] No image in response", JSON.stringify(json).slice(0, 500));
    throw new Error("No image returned from model");
  }

  return imageUrl;
}

async function saveToVault(userId: string, dataUrl: string, fileName: string): Promise<void> {
  const [header, b64] = dataUrl.split(",");
  const mimeMatch = header.match(/data:([^;]+);base64/);
  const mimeType = mimeMatch?.[1] ?? "image/png";
  const ext = mimeType.split("/")[1] ?? "png";
  const buffer = Buffer.from(b64, "base64");
  const storageKey = `vault/${userId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("vault")
    .upload(storageKey, buffer, { contentType: mimeType, upsert: false });

  if (uploadError) throw new Error(uploadError.message);

  await db.insert(vaultItems).values({
    userId,
    storageKey,
    fileName,
    fileType: mimeType,
    fileSize: buffer.byteLength,
    mediaKind: "image",
  });
}

function makeSlug(prompt: string): string {
  return prompt.trim().split(/\s+/).slice(0, 4).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "") || "generated";
}

// ── Video generation (Seedance 2.0) ───────────────────────────────────────────

// Loose shape covering both the initial POST response and poll responses
interface VideoApiResponse {
  id?: string;
  polling_url?: string;
  generation_id?: string;
  status?: string;
  error?: { message?: string; code?: number };
  // Completed video response — primary field
  unsigned_urls?: string[];
  // Other flat variants
  url?: string;
  video_url?: string;
  data?: { url?: string; b64_json?: string }[];
  output?: { url?: string; video_url?: string };
  // Legacy chat-completions shape
  choices?: { message?: { content?: string | null; videos?: { video_url?: { url?: string } }[] } }[];
}

interface ResolvedRef {
  type: "image" | "video" | "audio";
  url: string;
  role: RefRole;
}

interface VideoSubmitOptions {
  multimodalRefs?: ResolvedRef[];
  frameImages?: { url: string; frameType: "first_frame" | "last_frame" }[];
  generateAudio?: boolean;
}

// Submits the generation job and returns the job reference immediately — NO polling.
// The browser drives polling via pollVideoJob so no single request runs long (Vercel timeout).
async function submitOpenRouterVideo(
  prompt: string,
  aspectRatio: AspectRatio,
  duration: VideoDuration,
  resolution: VideoResolution,
  options?: VideoSubmitOptions,
): Promise<{ jobId: string | null; pollingUrl: string | null }> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  // /api/v1/videos uses a flat body — no messages array
  const body: Record<string, unknown> = {
    model: VIDEO_GENERATION_MODEL,
    prompt,
    duration,
    aspect_ratio: aspectRatio,
    resolution,
    generate_audio: options?.generateAudio ?? false,
  };

  if (options?.multimodalRefs?.length) {
    // OpenRouter only accepts image_url type in input_references — split by media kind.
    const imageRefs = options.multimodalRefs.filter((r) => r.type === "image");
    const mediaRefs = options.multimodalRefs.filter((r) => r.type !== "image");

    if (imageRefs.length) {
      body.input_references = imageRefs.map((r) => ({
        type: "image_url",
        image_url: { url: r.url },
        role: r.role,
      }));
    }

    if (mediaRefs.length) {
      // video/audio refs use BytePlus native format passed through to the provider
      body.references = mediaRefs.map((r) => ({
        type: r.type,
        url: r.url,
        role: r.role,
      }));
    }
  }

  if (options?.frameImages?.length) {
    // I2V — first/last frame control. frame_images takes precedence over references.
    body.frame_images = options.frameImages.map((f) => ({
      type: "image_url",
      image_url: { url: f.url },
      frame_type: f.frameType,
    }));
  }

  console.log("[OpenRouter/Video] POST /api/v1/videos", JSON.stringify(body));

  const res = await fetch(OPENROUTER_VIDEO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://visual-classification.app",
      "X-Title": "Visual Classification",
    },
    body: JSON.stringify(body),
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    console.error("[OpenRouter/Video] Non-JSON response", res.status, text.slice(0, 800));
    throw new Error(`Video generation service error (${res.status})`);
  }

  const json = (await res.json()) as VideoApiResponse;
  console.log("[OpenRouter/Video] Submit response", res.status, JSON.stringify(json));

  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `OpenRouter video error (${res.status})`);
  }

  if (!json.id && !json.polling_url) {
    throw new Error("Video service did not return a job reference");
  }

  return { jobId: json.id ?? null, pollingUrl: json.polling_url ?? null };
}

async function downloadVideo(videoUrl: string, apiKey: string): Promise<Buffer> {
  // unsigned_urls require the API key to download
  const videoRes = await fetch(videoUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!videoRes.ok) throw new Error(`Failed to fetch generated video (${videoRes.status})`);
  const arrayBuffer = await videoRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function extractVideoUrl(json: VideoApiResponse): string | null {
  // Primary: completed polling response uses unsigned_urls[0]
  const unsigned = json.unsigned_urls?.[0];
  if (typeof unsigned === "string" && unsigned.startsWith("http")) return unsigned;
  // Other flat fields
  if (typeof json.url === "string" && json.url.startsWith("http")) return json.url;
  if (typeof json.video_url === "string" && json.video_url.startsWith("http")) return json.video_url;
  // data[0].url (OpenAI images style)
  const dataUrl = json.data?.[0]?.url;
  if (typeof dataUrl === "string" && dataUrl.startsWith("http")) return dataUrl;
  // Nested output object
  const outputUrl = json.output?.url ?? json.output?.video_url;
  if (typeof outputUrl === "string" && outputUrl.startsWith("http")) return outputUrl;
  // Legacy chat-completions shape
  const fromVideos = json.choices?.[0]?.message?.videos?.[0]?.video_url?.url;
  if (fromVideos) return fromVideos;
  const content = json.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.startsWith("http")) return content;
  return null;
}

// Single poll. Transient/network errors map to "pending" so the client keeps polling;
// only an explicit provider error/terminal status returns "failed".
async function pollOpenRouterVideoOnce(
  pollingUrl: string,
  apiKey: string,
): Promise<{ status: "pending" | "completed" | "failed"; videoUrl?: string }> {
  let res: Response;
  try {
    res = await fetch(pollingUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    return { status: "pending" };
  }
  if (!res.ok) return { status: "pending" };

  const json = (await res.json()) as VideoApiResponse;
  console.log("[OpenRouter/Video] Poll", JSON.stringify(json).slice(0, 400));

  if (json.status === "error" || json.error) return { status: "failed" };

  const url = extractVideoUrl(json);
  if (url) return { status: "completed", videoUrl: url };

  if (json.status === "failed" || json.status === "cancelled" || json.status === "expired") {
    return { status: "failed" };
  }
  return { status: "pending" };
}

async function saveVideoToVault(userId: string, buffer: Buffer, fileName: string): Promise<void> {
  const mimeType = "video/mp4";
  const storageKey = `vault/${userId}/${crypto.randomUUID()}.mp4`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("vault")
    .upload(storageKey, buffer, { contentType: mimeType, upsert: false });

  if (uploadError) throw new Error(uploadError.message);

  await db.insert(vaultItems).values({
    userId,
    storageKey,
    fileName,
    fileType: mimeType,
    fileSize: buffer.byteLength,
    mediaKind: "video",
  });
}

// ── Video job lifecycle (submit → client-poll → finalize) ────────────────────
//
// Video generation can take minutes — far longer than a Vercel function may run.
// So each start* action only SUBMITS and returns a job reference; the browser then
// calls pollVideoJob on an interval. The poll that observes completion downloads the
// video, saves it to the vault, and cleans up any temp references — all short requests.

export type VideoStartResult =
  | { ok: true; jobId: string | null; pollingUrl: string | null; tempKeys: string[] }
  | { ok: false; error: string };

export type VideoPollResult =
  | { ok: true; status: "pending" }
  | { ok: true; status: "completed"; dataUrl: string }
  | { ok: false; error: string };

export async function pollVideoJob(args: {
  pollingUrl: string | null;
  jobId: string | null;
  prompt: string;
  tempKeys: string[];
}): Promise<VideoPollResult> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY is not configured" };

  const url = args.pollingUrl ?? (args.jobId ? `${OPENROUTER_VIDEO_URL}/${args.jobId}` : null);
  if (!url) return { ok: false, error: "Missing job reference" };

  try {
    const { status, videoUrl } = await pollOpenRouterVideoOnce(url, apiKey);

    if (status === "failed") {
      await cleanupTempReferences(args.tempKeys);
      return { ok: false, error: "Video generation failed on provider" };
    }
    if (status !== "completed" || !videoUrl) {
      return { ok: true, status: "pending" };
    }

    // Completed — download, persist, and clean up temp refs (all quick).
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated" };

    const buffer = await downloadVideo(videoUrl, apiKey);
    const fileName = `${makeSlug(args.prompt)}-${Date.now()}.mp4`;
    await saveVideoToVault(user.id, buffer, fileName);
    revalidatePath("/vault");
    await cleanupTempReferences(args.tempKeys);

    const dataUrl = `data:video/mp4;base64,${buffer.toString("base64")}`;
    return { ok: true, status: "completed", dataUrl };
  } catch (err) {
    await cleanupTempReferences(args.tempKeys);
    return { ok: false, error: err instanceof Error ? err.message : "Video polling failed" };
  }
}

// ── Text to Video ──────────────────────────────────────────────────────────────

interface T2VParams {
  prompt: string;
  aspectRatio: AspectRatio;
  duration: VideoDuration;
  resolution: VideoResolution;
  generateAudio: boolean;
}

export async function startTextToVideo(params: T2VParams): Promise<VideoStartResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated" };
    if (!params.prompt.trim()) return { ok: false, error: "Prompt is required" };

    const { jobId, pollingUrl } = await submitOpenRouterVideo(
      params.prompt.trim(),
      params.aspectRatio,
      params.duration,
      params.resolution,
      { generateAudio: params.generateAudio },
    );

    return { ok: true, jobId, pollingUrl, tempKeys: [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Video generation failed" };
  }
}


// ── Multimodal Reference to Video ────────────────────────────────────────────

async function uploadTempReference(
  userId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ signedUrl: string; storageKey: string }> {
  const ext = mimeType.split("/")[1]?.split(";")[0] ?? "bin";
  const storageKey = `vault/${userId}/temp/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from("vault")
    .upload(storageKey, buffer, { contentType: mimeType, upsert: false });
  if (error) throw new Error(`Temp upload failed: ${error.message}`);

  const { data, error: signErr } = await supabaseAdmin.storage
    .from("vault")
    .createSignedUrl(storageKey, 3600);
  if (signErr || !data?.signedUrl) throw new Error(`Signed URL failed: ${signErr?.message}`);

  return { signedUrl: data.signedUrl, storageKey };
}

async function cleanupTempReferences(storageKeys: string[]): Promise<void> {
  if (!storageKeys.length) return;
  await supabaseAdmin.storage.from("vault").remove(storageKeys);
}

interface M2VRef {
  type: "image" | "video" | "audio";
  dataBase64: string;
  role: RefRole;
  mimeType: string;
}

interface M2VParams {
  prompt: string;
  aspectRatio: AspectRatio;
  duration: VideoDuration;
  resolution: VideoResolution;
  refs: M2VRef[];
  generateAudio: boolean;
}

export async function startMultimodalToVideo(params: M2VParams): Promise<VideoStartResult> {
  const tempKeys: string[] = [];

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated" };
    if (!params.prompt.trim()) return { ok: false, error: "Prompt is required" };
    if (!params.refs.length) return { ok: false, error: "At least one reference is required" };

    const images = params.refs.filter((r) => r.type === "image");
    const videos = params.refs.filter((r) => r.type === "video");
    const audios = params.refs.filter((r) => r.type === "audio");

    if (images.length === 0 && videos.length === 0) {
      return { ok: false, error: "Audio cannot be submitted alone — add at least one image or video reference" };
    }
    if (images.length > M2V_MAX_IMAGES) return { ok: false, error: `Maximum ${M2V_MAX_IMAGES} image references allowed` };
    if (videos.length > M2V_MAX_VIDEOS) return { ok: false, error: `Maximum ${M2V_MAX_VIDEOS} video references allowed` };
    if (audios.length > M2V_MAX_AUDIO)  return { ok: false, error: `Maximum ${M2V_MAX_AUDIO} audio references allowed` };

    const resolvedRefs: ResolvedRef[] = [];

    for (const ref of params.refs) {
      // All ref types need a public HTTPS URL — upload to temp storage and get a signed URL.
      // Temp refs are cleaned up by pollVideoJob once the job finishes.
      const [, b64] = ref.dataBase64.split(",");
      const buffer = Buffer.from(b64, "base64");
      const { signedUrl, storageKey } = await uploadTempReference(user.id, buffer, ref.mimeType);
      tempKeys.push(storageKey);
      resolvedRefs.push({ type: ref.type, url: signedUrl, role: ref.role });
    }

    // Convert UI labels @Image1/@Video1/@Audio1 → [Image 1]/[Video 1]/[Audio 1] (BytePlus prompt format)
    const cleanPrompt = params.prompt.trim()
      .replace(/@Image(\d+)/gi, (_, n) => `[Image ${n}]`)
      .replace(/@Video(\d+)/gi, (_, n) => `[Video ${n}]`)
      .replace(/@Audio(\d+)/gi, (_, n) => `[Audio ${n}]`);

    const { jobId, pollingUrl } = await submitOpenRouterVideo(
      cleanPrompt,
      params.aspectRatio,
      params.duration,
      params.resolution,
      { multimodalRefs: resolvedRefs, generateAudio: params.generateAudio },
    );

    return { ok: true, jobId, pollingUrl, tempKeys };
  } catch (err) {
    await cleanupTempReferences(tempKeys);
    return { ok: false, error: err instanceof Error ? err.message : "Multimodal video generation failed" };
  }
}

// ── Image to Video (first / last frame) ─────────────────────────────────────

interface I2VParams {
  prompt: string;
  aspectRatio: AspectRatio;
  duration: VideoDuration;
  resolution: VideoResolution;
  firstFrameBase64: string;
  lastFrameBase64?: string;
  generateAudio: boolean;
}

export async function startImageToVideo(params: I2VParams): Promise<VideoStartResult> {
  const tempKeys: string[] = [];

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated" };
    if (!params.prompt.trim()) return { ok: false, error: "Prompt is required" };
    if (!params.firstFrameBase64) return { ok: false, error: "A first frame image is required" };

    const frameImages: { url: string; frameType: "first_frame" | "last_frame" }[] = [];

    const frames: { base64: string; frameType: "first_frame" | "last_frame" }[] = [
      { base64: params.firstFrameBase64, frameType: "first_frame" },
    ];
    if (params.lastFrameBase64) {
      frames.push({ base64: params.lastFrameBase64, frameType: "last_frame" });
    }

    for (const frame of frames) {
      // Temp refs are cleaned up by pollVideoJob once the job finishes.
      const [header, b64] = frame.base64.split(",");
      const mimeType = header.match(/data:([^;]+);base64/)?.[1] ?? "image/png";
      const buffer = Buffer.from(b64, "base64");
      const { signedUrl, storageKey } = await uploadTempReference(user.id, buffer, mimeType);
      tempKeys.push(storageKey);
      frameImages.push({ url: signedUrl, frameType: frame.frameType });
    }

    const { jobId, pollingUrl } = await submitOpenRouterVideo(
      params.prompt.trim(),
      params.aspectRatio,
      params.duration,
      params.resolution,
      { frameImages, generateAudio: params.generateAudio },
    );

    return { ok: true, jobId, pollingUrl, tempKeys };
  } catch (err) {
    await cleanupTempReferences(tempKeys);
    return { ok: false, error: err instanceof Error ? err.message : "Image-to-video generation failed" };
  }
}

// ── Text to Image ─────────────────────────────────────────────────────────────

interface T2IParams {
  prompt: string;
  aspectRatio: AspectRatio;
  count: GenerationCount;
}

export async function generateTextToImage(
  params: T2IParams,
): Promise<{ ok: true; urls: string[] } | { ok: false; error: string }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated" };
    if (!params.prompt.trim()) return { ok: false, error: "Prompt is required" };

    const slug = makeSlug(params.prompt);

    const urls = await Promise.all(
      Array.from({ length: params.count }, async (_, i) => {
        const dataUrl = await callOpenRouterImage(params.prompt.trim(), params.aspectRatio);
        await saveToVault(user.id, dataUrl, `${slug}-${Date.now()}-${i + 1}.png`);
        return dataUrl;
      }),
    );

    revalidatePath("/vault");
    return { ok: true, urls };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Generation failed" };
  }
}

// ── Image to Image ────────────────────────────────────────────────────────────

interface I2IParams extends T2IParams {
  referenceBase64: string[];
}

export async function generateImageToImage(
  params: I2IParams,
): Promise<{ ok: true; urls: string[] } | { ok: false; error: string }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated" };
    if (!params.prompt.trim()) return { ok: false, error: "Prompt is required" };
    if (!params.referenceBase64.length) return { ok: false, error: "Reference image is required" };

    const slug = makeSlug(params.prompt);

    const urls = await Promise.all(
      Array.from({ length: params.count }, async (_, i) => {
        const dataUrl = await callOpenRouterImage(params.prompt.trim(), params.aspectRatio, params.referenceBase64);
        await saveToVault(user.id, dataUrl, `${slug}-${Date.now()}-${i + 1}.png`);
        return dataUrl;
      }),
    );

    revalidatePath("/vault");
    return { ok: true, urls };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Generation failed" };
  }
}
