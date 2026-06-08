"use client";

import { TaggerPanel } from "@/components/classify/tagger-panel";

const VISION_MODELS = [
  { id: "huihui-ai/Huihui-Qwen3-VL-30B-A3B-Instruct-abliterated", label: "Qwen3-VL 30B-A3B abliterated" },
];

export function Qwen25Tab() {
  return <TaggerPanel serviceName="Qwen 2.5 VL" models={VISION_MODELS} />;
}
