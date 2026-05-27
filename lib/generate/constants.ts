export type AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
export type GenerationCount = 1 | 2 | 3 | 4;

export const ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: "1:1",  label: "1:1"  },
  { value: "4:3",  label: "4:3"  },
  { value: "3:4",  label: "3:4"  },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
];

export const GENERATION_MODEL = "bytedance-seed/seedream-4.5";
export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
