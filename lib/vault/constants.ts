export const ALLOWED_VAULT_MIME_TYPES = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  video: ["video/mp4", "video/quicktime", "video/webm"],
  audio: ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4"],
} as const;

export const ALL_ALLOWED_VAULT_TYPES: string[] = Object.values(
  ALLOWED_VAULT_MIME_TYPES,
).flat();

export const MAX_VAULT_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

export function mediaKindFromMime(
  mime: string,
): "image" | "video" | "audio" | null {
  if ((ALLOWED_VAULT_MIME_TYPES.image as readonly string[]).includes(mime))
    return "image";
  if ((ALLOWED_VAULT_MIME_TYPES.video as readonly string[]).includes(mime))
    return "video";
  if ((ALLOWED_VAULT_MIME_TYPES.audio as readonly string[]).includes(mime))
    return "audio";
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
