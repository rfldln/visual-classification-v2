import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { submitRunPodJob } from "@/lib/ollama-call";
import { buildGrokSystemPrompt, PERCEPTION_ADDENDUM } from "@/lib/grok";
import { env } from "@/lib/env";

export const runtime = "nodejs";
// Submit is fast — it only enqueues the RunPod job and returns a jobId. The
// long wait (cold start + inference) happens in the browser poll loop against
// /api/serverless-tag/status, so this never approaches the Vercel timeout.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = env.RUNPOD_API_KEY?.trim();
  const endpointId = env.RUNPOD_QWEN_ENDPOINT_ID?.trim();
  if (!apiKey || !endpointId) {
    return NextResponse.json(
      { error: "Serverless endpoint is not configured. Set RUNPOD_API_KEY and RUNPOD_QWEN_ENDPOINT_ID in .env.local." },
      { status: 503 },
    );
  }

  try {
    const form = await req.formData();
    const filename = (form.get("filename") as string) || "upload";
    const kind = (form.get("kind") as string) || "image";
    const model = ((form.get("model") as string) || "qwen/qwen3.6-35b-a3b").trim();

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

    // Frames arrive as JPEG from the client; submitRunPodJob wraps each in a
    // data:image/jpeg;base64 URL, so we only need the raw base64 here.
    const imageBase64s = await Promise.all(
      frames.map(async (f) => Buffer.from(await f.arrayBuffer()).toString("base64")),
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

    const sub = await submitRunPodJob({
      endpointId,
      apiKey,
      model,
      systemPrompt: buildGrokSystemPrompt() + PERCEPTION_ADDENDUM,
      userText,
      imageBase64s,
      // Cap the budget; disableThinking sends enable_thinking:false. Harmless for
      // the Instruct (non-thinking) variant, and keeps the Thinking variant from
      // burning the budget inside a <think> trace if the endpoint is ever swapped.
      maxTokens: 2048,
      disableThinking: true,
    });

    if (!sub.ok) {
      return NextResponse.json({ error: `Serverless: ${sub.error}` }, { status: sub.status });
    }

    return NextResponse.json({
      jobId: sub.jobId,
      kind,
      filename,
      model,
      frames: kind === "video" ? frameCount : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
