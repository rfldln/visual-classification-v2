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

async function callOpenRouterVideo(
  prompt: string,
  aspectRatio: AspectRatio,
  duration: VideoDuration,
  resolution: VideoResolution,
  options?: {
    multimodalRefs?: ResolvedRef[];
    generateAudio?: boolean;
  },
): Promise<Buffer> {
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
    // M2V — references array with type/role/url
    body.references = options.multimodalRefs.map((r) => ({
      type: r.type,
      url: r.url,
      role: r.role,
    }));
  }

  // Log without flooding base64
  const logBody = { ...body };
  if (typeof logBody.image_url === "string" && logBody.image_url.startsWith("data:")) {
    logBody.image_url = "[base64 image]";
  }
  console.log("[OpenRouter/Video] POST /api/v1/videos", JSON.stringify(logBody));

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
  console.log("[OpenRouter/Video] Response", res.status, JSON.stringify(json));

  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `OpenRouter video error (${res.status})`);
  }

  // Try to extract a video URL from the immediate response
  let videoUrl = extractVideoUrl(json);

  // If not ready yet, poll using the polling_url from the response
  if (!videoUrl && json.polling_url) {
    videoUrl = await pollGeneration(json.polling_url, apiKey);
  } else if (!videoUrl && json.id) {
    // Fallback: reconstruct the polling URL from the id
    videoUrl = await pollGeneration(`${OPENROUTER_VIDEO_URL}/${json.id}`, apiKey);
  }

  if (!videoUrl) {
    throw new Error("No video URL returned from model");
  }

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

async function pollGeneration(pollingUrl: string, apiKey: string): Promise<string | null> {
  const POLL_INTERVAL_MS = 5000;
  const MAX_ATTEMPTS = 120; // 10 min

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(pollingUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) continue;

    const json = (await res.json()) as VideoApiResponse;
    console.log(`[OpenRouter/Video] Poll #${attempt + 1}`, JSON.stringify(json).slice(0, 400));

    if (json.status === "error" || json.error) {
      throw new Error(json.error?.message ?? "Video generation failed on provider");
    }

    const url = extractVideoUrl(json);
    if (url) return url;

    // Done statuses that mean we won't get a URL
    if (json.status === "failed" || json.status === "cancelled" || json.status === "expired") {
      throw new Error(`Video generation ${json.status}`);
    }
  }

  throw new Error("Video generation timed out. Try again or reduce duration/resolution.");
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

// ── Text to Video ──────────────────────────────────────────────────────────────

interface T2VParams {
  prompt: string;
  aspectRatio: AspectRatio;
  duration: VideoDuration;
  resolution: VideoResolution;
  generateAudio: boolean;
}

export async function generateTextToVideo(
  params: T2VParams,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated" };
    if (!params.prompt.trim()) return { ok: false, error: "Prompt is required" };

    const slug = makeSlug(params.prompt);
    const buffer = await callOpenRouterVideo(
      params.prompt.trim(),
      params.aspectRatio,
      params.duration,
      params.resolution,
      { generateAudio: params.generateAudio },
    );

    const fileName = `${slug}-${Date.now()}.mp4`;
    await saveVideoToVault(user.id, buffer, fileName);
    revalidatePath("/vault");

    const dataUrl = `data:video/mp4;base64,${buffer.toString("base64")}`;
    return { ok: true, dataUrl };
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

export async function generateMultimodalToVideo(
  params: M2VParams,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
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
      if (ref.type === "image") {
        resolvedRefs.push({ type: "image", url: ref.dataBase64, role: ref.role });
      } else {
        // video or audio — upload to temp storage and get a signed URL
        const [, b64] = ref.dataBase64.split(",");
        const buffer = Buffer.from(b64, "base64");
        const { signedUrl, storageKey } = await uploadTempReference(user.id, buffer, ref.mimeType);
        tempKeys.push(storageKey);
        resolvedRefs.push({ type: ref.type, url: signedUrl, role: ref.role });
      }
    }

    const slug = makeSlug(params.prompt);
    const buffer = await callOpenRouterVideo(
      params.prompt.trim(),
      params.aspectRatio,
      params.duration,
      params.resolution,
      { multimodalRefs: resolvedRefs, generateAudio: params.generateAudio },
    );

    const fileName = `${slug}-${Date.now()}.mp4`;
    await saveVideoToVault(user.id, buffer, fileName);
    revalidatePath("/vault");

    const dataUrl = `data:video/mp4;base64,${buffer.toString("base64")}`;
    return { ok: true, dataUrl };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Multimodal video generation failed" };
  } finally {
    await cleanupTempReferences(tempKeys);
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
