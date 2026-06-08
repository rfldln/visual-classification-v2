"use client";

import { TaggerPanel, type TaggerModel } from "@/components/classify/tagger-panel";

// Production fallback classifier — RunPod serverless (scales to zero, pay-per-use).
// One vLLM endpoint per model; today only Qwen3.6-35B-A3B is wired
// (RUNPOD_QWEN_ENDPOINT_ID). Add Gemma later by standing up its own endpoint,
// adding an entry here, and a model→endpoint switch in /api/serverless-tag.
// NOTE: `id` must match the worker's vLLM served-model-name EXACTLY (case-sensitive)
// or requests 404. The RunPod worker's HF cache stores the repo id lowercased, so it
// serves under the lowercase name `qwen/qwen3.6-35b-a3b` — match it here.
const SERVERLESS_MODELS: TaggerModel[] = [
  { id: "qwen/qwen3.6-35b-a3b", label: "Qwen3.6 35B-A3B" },
];

export function ServerlessTab() {
  return <TaggerPanel serviceName="Serverless" models={SERVERLESS_MODELS} endpoint="/api/serverless-tag" />;
}
