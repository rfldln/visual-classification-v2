import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callQwen25Pod, DEFAULT_QWEN25_MODEL } from "@/lib/qwen25-call";
import { buildGrokSystemPrompt, parseGrokResponse, applyTaxonomyRules, PERCEPTION_ADDENDUM } from "@/lib/grok";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);

function bufferToDataUrl(buf: Buffer, mime: string): string {
  const m = IMAGE_MIME.has(mime) ? mime : "image/jpeg";
  return `data:${m};base64,${buf.toString("base64")}`;
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const podUrl = env.QWEN25_POD_URL;
  if (!podUrl) {
    return NextResponse.json({ error: "Qwen 2.5 pod is not configured. Set QWEN25_POD_URL in .env.local." }, { status: 503 });
  }

  try {
    const form = await req.formData();
    const filename = (form.get("filename") as string) || "upload";
    const kind = (form.get("kind") as string) || "image";
    const modelOverride = (form.get("model") as string) || "";
    const model = modelOverride.trim() || DEFAULT_QWEN25_MODEL;

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

    const imageDataUrls = await Promise.all(
      frames.map(async (f) => bufferToDataUrl(Buffer.from(await f.arrayBuffer()), f.type || "image/jpeg")),
    );

    const frameCount = parseInt(form.get("frame_count") as string) || frames.length;
    const mainCount = parseInt(form.get("main_count") as string) || frameCount;
    const endCount = parseInt(form.get("end_count") as string) || 0;
    const userText =
      kind === "video"
        ? [
            `Tag this video. You are given ${frameCount} separate frames in chronological order (frame 1 = start, frame ${frameCount} = end).`,
            `The first ${mainCount} frames are sampled evenly across the FULL video — early frames may be non-sexual intro/dialogue, acts appear in later frames.`,
            endCount > 0
              ? `The last ${endCount} frames are densely sampled from the LAST 15% of the video at ~2s intervals. This is where creampie and squirt most often occur — examine them carefully for those tags.`
              : null,
            `Examine EVERY frame. Count distinct performers across ALL frames combined. Use the most explicit/partnered tags found anywhere. JSON only.`,
          ].filter(Boolean).join(" ")
        : "Tag this SINGLE still image. It is NOT a video — there are no frames. Do NOT reference frame numbers in your evidence; describe only what is visible in this one image. JSON only.";

    const result = await callQwen25Pod({
      podUrl,
      apiKey: env.QWEN25_POD_API_KEY,
      model,
      systemPrompt: buildGrokSystemPrompt() + PERCEPTION_ADDENDUM,
      userText,
      imageDataUrls,
    });

    if (!result.ok) {
      return NextResponse.json({ error: `Qwen 2.5: ${result.error}` }, { status: result.status });
    }

    const parsed = parseGrokResponse(result.content);
    const tags = applyTaxonomyRules(parsed.tags, parsed.performers);
    return NextResponse.json({
      kind,
      filename,
      model,
      frames: kind === "video" ? frameCount : undefined,
      usage: result.usage ?? null,
      ...parsed,
      tags,
      raw: parsed.raw ?? result.content,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
