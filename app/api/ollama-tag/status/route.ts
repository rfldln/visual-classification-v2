import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkRunPodJob } from "@/lib/ollama-call";
import { filterGrokTags, parseGrokResponse } from "@/lib/grok";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Lightweight status check for a RunPod classification job. The browser polls this on an
// interval, so each request is short regardless of how long the job itself takes.
export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

  const rpKey = env.RUNPOD_API_KEY?.trim();
  const rpEndpoint = env.RUNPOD_ENDPOINT_ID?.trim();
  if (!rpKey || !rpEndpoint) {
    return NextResponse.json({ error: "RunPod is not configured" }, { status: 503 });
  }

  const job = await checkRunPodJob({ endpointId: rpEndpoint, apiKey: rpKey, jobId });

  if (job.status === "failed") {
    return NextResponse.json({ status: "failed", error: job.error });
  }
  if (job.status !== "completed") {
    return NextResponse.json({ status: "pending" });
  }

  const cleaned = job.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const parsed = parseGrokResponse(cleaned);
  parsed.tags = filterGrokTags(parsed.tags);

  return NextResponse.json({
    status: "completed",
    promptTokens: job.promptTokens ?? null,
    completionTokens: job.completionTokens ?? null,
    ...parsed,
    raw: parsed.raw ?? job.content,
  });
}
