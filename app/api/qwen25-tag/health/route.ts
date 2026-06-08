import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ModelsResp { data?: Array<{ id?: string }> }

// Lightweight pod liveness check: hits the vLLM/LMDeploy server's OpenAI-compatible
// /v1/models endpoint and returns the loaded model ids. Lets the Testing tab confirm
// the pod is reachable and which model is actually served before uploading anything.
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const podUrl = env.QWEN25_POD_URL;
  if (!podUrl) {
    return NextResponse.json({ ok: false, error: "QWEN25_POD_URL is not set in .env.local." }, { status: 503 });
  }

  const headers: Record<string, string> = {};
  if (env.QWEN25_POD_API_KEY) headers["Authorization"] = `Bearer ${env.QWEN25_POD_API_KEY}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${podUrl.replace(/\/$/, "")}/v1/models`, { headers, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Pod returned ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }
    let parsed: ModelsResp;
    try { parsed = JSON.parse(text); }
    catch { return NextResponse.json({ ok: false, error: "Pod did not return JSON from /v1/models" }, { status: 502 }); }
    const models = (parsed.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string");
    return NextResponse.json({ ok: true, models });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    const msg = aborted ? "Pod did not respond within 10s" : e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}
