import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkRunPodJob } from "@/lib/ollama-call";
import { applyTaxonomyRules, parseGrokResponse } from "@/lib/grok";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Serverless tab only: hide low-confidence tags. The taxonomy rules still run on
// the full set first (so suppression/count logic is unaffected); we just drop
// anything the model wasn't at least 80% sure about before returning to the UI.
const SERVERLESS_MIN_CONFIDENCE = 0.8;

// Lightweight status check for a RunPod serverless classification job. The browser
// polls this on an interval, so each request is short regardless of how long the
// job itself takes (cold start + inference can run for minutes).
export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

  const apiKey = env.RUNPOD_API_KEY?.trim();
  const endpointId = env.RUNPOD_QWEN_ENDPOINT_ID?.trim();
  if (!apiKey || !endpointId) {
    return NextResponse.json({ error: "Serverless endpoint is not configured" }, { status: 503 });
  }

  const job = await checkRunPodJob({ endpointId, apiKey, jobId });

  if (job.status === "failed") {
    return NextResponse.json({ status: "failed", error: job.error });
  }
  if (job.status !== "completed") {
    return NextResponse.json({ status: "pending" });
  }

  const cleaned = job.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const parsed = parseGrokResponse(cleaned);
  const tags = applyTaxonomyRules(parsed.tags, parsed.performers).filter(
    (t) => t.confidence >= SERVERLESS_MIN_CONFIDENCE,
  );

  // Reshape RunPod's token counts into the {prompt,completion,total}_tokens object
  // the shared TaggerPanel already renders.
  const usage =
    job.promptTokens != null || job.completionTokens != null
      ? {
          prompt_tokens: job.promptTokens ?? 0,
          completion_tokens: job.completionTokens ?? 0,
          total_tokens: (job.promptTokens ?? 0) + (job.completionTokens ?? 0),
        }
      : null;

  return NextResponse.json({
    status: "completed",
    ...parsed,
    tags,
    usage,
    raw: parsed.raw ?? job.content,
  });
}
