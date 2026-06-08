"use client";

import { TaggerPanel, type TaggerModel } from "@/components/classify/tagger-panel";

// Candidate models to A/B against the current abliterated Qwen on the same pod.
// The pod (QWEN25_POD_URL) must actually have the chosen model loaded — these
// just set the `model` field sent to it. Use "Custom model id…" for anything
// not listed. See HuggingFace for exact, current repo names.
const TEST_MODELS: TaggerModel[] = [
  { id: "Qwen/Qwen3.6-35B-A3B", label: "Qwen3.6 35B-A3B (new hybrid arch, not abliterated — NSFW test)" },
  { id: "huihui-ai/Huihui-gemma-4-31B-it-abliterated-v2", label: "Gemma 4 31B abliterated v2 (Google lineage — NSFW test)" },
  { id: "huihui-ai/Huihui-Qwen3-VL-30B-A3B-Instruct-abliterated", label: "Qwen3-VL 30B-A3B abliterated (current)" },
  { id: "OpenGVLab/InternVL3-38B", label: "InternVL3-38B (different lineage, full bf16)" },
  { id: "OpenGVLab/InternVL3-78B", label: "InternVL3-78B (largest, needs 2 GPUs / AWQ)" },
  { id: "OpenGVLab/InternVL3_5-38B", label: "InternVL3.5-38B (newer, mid-size)" },
  { id: "Minthy/ToriiGate-v0.4-7B", label: "ToriiGate v0.4 7B (purpose-built NSFW tagger)" },
  { id: "Minthy/ToriiGate-0.5", label: "ToriiGate 0.5 (newest NSFW tagger)" },
];

export function TestingTab() {
  return <TaggerPanel serviceName="Testing model" models={TEST_MODELS} allowCustomModel showHealthCheck />;
}
