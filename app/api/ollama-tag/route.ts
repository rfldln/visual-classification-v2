import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callOllama, submitRunPodJob, DEFAULT_OLLAMA_MODEL } from "@/lib/ollama-call";
import { buildGrokSystemPrompt, filterGrokTags, parseGrokResponse } from "@/lib/grok";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);

function bufferToBase64(buf: Buffer, mime: string): string {
  void mime;
  return buf.toString("base64");
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const baseUrl = (env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");

  try {
    const form = await req.formData();
    const filename = (form.get("filename") as string) || "upload";
    const kind = (form.get("kind") as string) || "image";
    const modelOverride = (form.get("model") as string) || "";
    const model = modelOverride.trim() || env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;

    const frames: File[] = [];
    const single = form.get("image");
    if (single instanceof File) frames.push(single);
    for (const v of form.getAll("frames")) {
      if (v instanceof File) frames.push(v);
    }

    if (frames.length === 0) {
      return NextResponse.json({ error: "No image or frames provided" }, { status: 400 });
    }
    if (frames.length > 200) {
      return NextResponse.json({ error: "Too many frames (max 200)" }, { status: 400 });
    }

    const imageBase64s = await Promise.all(
      frames.map(async (f) => {
        const mime = IMAGE_MIME.has(f.type) ? f.type : "image/jpeg";
        return bufferToBase64(Buffer.from(await f.arrayBuffer()), mime);
      }),
    );

    const frameCount = parseInt(form.get("frame_count") as string) || frames.length;
    const mainCount = parseInt(form.get("main_count") as string) || frameCount;
    const endCount = parseInt(form.get("end_count") as string) || 0;

    const userText =
      kind === "video"
        ? [
            `Tag this video. The image is a two-section contact sheet (grid, left-to-right top-to-bottom, cell numbers shown):`,
            `SECTION 1 (cells 1–${mainCount}): ${mainCount} frames sampled evenly across the FULL video.`,
            endCount > 0
              ? `SECTION 2 (cells ${mainCount + 1}–${frameCount}): ${endCount} frames densely sampled from the LAST 15% of the video. Look carefully for creampie and squirt tags here.`
              : null,
            `Examine EVERY cell. Use the most explicit/partnered tags found anywhere. JSON only.`,
          ].filter(Boolean).join(" ")
        : `Tag this image. Filename: "${filename}". JSON only.`;

    const systemPrompt = buildGrokSystemPrompt();

    // RunPod jobs can run for many minutes — longer than a Vercel function may live.
    // Submit the job and return its id immediately; the browser polls /api/ollama-tag/status.
    const rpKey = env.RUNPOD_API_KEY?.trim();
    const rpEndpoint = env.RUNPOD_ENDPOINT_ID?.trim();
    if (rpKey && rpEndpoint) {
      const sub = await submitRunPodJob({
        endpointId: rpEndpoint,
        apiKey: rpKey,
        model,
        systemPrompt,
        userText,
        imageBase64s,
      });
      if (!sub.ok) {
        return NextResponse.json({ error: `Ollama: ${sub.error}` }, { status: sub.status });
      }
      return NextResponse.json({
        jobId: sub.jobId,
        kind,
        filename,
        model,
        frames: kind === "video" ? frameCount : undefined,
      });
    }

    // Local Ollama (dev) — single streaming request, returns the full result inline.
    const result = await callOllama({
      baseUrl,
      model,
      systemPrompt,
      userText,
      imageBase64s,
    });

    if (!result.ok) {
      return NextResponse.json({ error: `Ollama: ${result.error}` }, { status: result.status });
    }

    const cleaned = result.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const parsed = parseGrokResponse(cleaned);
    parsed.tags = filterGrokTags(parsed.tags);

    return NextResponse.json({
      kind,
      filename,
      model,
      frames: kind === "video" ? frameCount : undefined,
      promptTokens: result.promptTokens ?? null,
      completionTokens: result.completionTokens ?? null,
      ...parsed,
      raw: parsed.raw ?? result.content,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
