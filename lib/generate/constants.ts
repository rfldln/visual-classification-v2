export type AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
export type GenerationCount = 1 | 2 | 3 | 4;
export type VideoDuration = number; // 4–15 seconds
export type VideoResolution = "480p" | "720p" | "1080p";

export const ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: "1:1",  label: "1:1"  },
  { value: "4:3",  label: "4:3"  },
  { value: "3:4",  label: "3:4"  },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
];

export const VIDEO_DURATION_MIN = 4;
export const VIDEO_DURATION_MAX = 15;

export const VIDEO_RESOLUTIONS: { value: VideoResolution; label: string }[] = [
  { value: "480p",  label: "480p"  },
  { value: "720p",  label: "720p"  },
  { value: "1080p", label: "1080p" },
];

// Per BytePlus Seedance 2.0 docs: M2V multimodal roles
export type RefRole = "reference_image" | "reference_video" | "reference_audio";

export const REF_ROLES_BY_TYPE: Record<"image" | "video" | "audio", { value: RefRole; label: string }[]> = {
  image: [
    { value: "reference_image", label: "Reference" },
  ],
  video: [
    { value: "reference_video", label: "Reference" },
  ],
  audio: [
    { value: "reference_audio", label: "Reference" },
  ],
};

export const M2V_MAX_IMAGES = 9;
export const M2V_MAX_VIDEOS = 3;
export const M2V_MAX_AUDIO  = 3;

export const GENERATION_MODEL = "bytedance-seed/seedream-4.5";
export const VIDEO_GENERATION_MODEL = "bytedance/seedance-2.0";
export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_VIDEO_URL = "https://openrouter.ai/api/v1/videos";
export const OPENROUTER_GENERATION_URL = "https://openrouter.ai/api/v1/generation";
