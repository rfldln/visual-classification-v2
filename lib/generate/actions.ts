"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { db } from "@/lib/db";
import { vaultItems } from "@/lib/db/schema";
import { env } from "@/lib/env";
import {
  GENERATION_MODEL,
  OPENROUTER_CHAT_URL,
  type AspectRatio,
  type GenerationCount,
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
