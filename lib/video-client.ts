"use client";

export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
}

export async function probeVideoMeta(file: File): Promise<VideoMeta> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<VideoMeta>((resolve, reject) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.src = url;
      v.onloadedmetadata = () => {
        resolve({
          duration: Number.isFinite(v.duration) ? v.duration : 0,
          width: v.videoWidth || 0,
          height: v.videoHeight || 0,
        });
      };
      v.onerror = () => reject(new Error("Could not read video metadata"));
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function extractFramesEvenly(
  file: File,
  opts: { count?: number; maxWidth?: number; quality?: number } = {},
): Promise<Blob[]> {
  const count = Math.max(1, opts.count ?? 6);
  const maxWidth = opts.maxWidth ?? 512;
  const quality = opts.quality ?? 0.8;

  const url = URL.createObjectURL(file);
  const blobs: Blob[] = [];
  try {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.src = url;

    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => reject(new Error("Could not load video for frame extraction"));
    });
    const dur = Math.max(0.1, v.duration || 0.1);
    const stops = Array.from({ length: count }, (_, i) =>
      Math.min(dur - 0.05, ((i + 0.5) / count) * dur),
    );

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2d canvas context");

    for (const t of stops) {
      await new Promise<void>((resolve, reject) => {
        v.onseeked = () => resolve();
        v.onerror = () => reject(new Error("Seek failed"));
        v.currentTime = t;
      });
      const w = v.videoWidth;
      const h = v.videoHeight;
      const scale = w > maxWidth ? maxWidth / w : 1;
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob null"))),
          "image/jpeg",
          quality,
        ),
      );
      blobs.push(blob);
    }
    v.removeAttribute("src");
    v.load();
  } finally {
    URL.revokeObjectURL(url);
  }
  return blobs;
}

export async function extractFramesFromRange(
  file: File,
  opts: {
    startFraction: number;
    endFraction: number;
    count: number;
    maxWidth?: number;
    quality?: number;
  },
): Promise<Blob[]> {
  const { startFraction, endFraction, count } = opts;
  const maxWidth = opts.maxWidth ?? 512;
  const quality = opts.quality ?? 0.8;

  const url = URL.createObjectURL(file);
  const blobs: Blob[] = [];
  try {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.src = url;
    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => reject(new Error("Could not load video for range extraction"));
    });
    const dur = Math.max(0.1, v.duration || 0.1);
    const startSec = startFraction * dur;
    const rangeSec = (endFraction - startFraction) * dur;
    const stops = Array.from({ length: count }, (_, i) =>
      Math.min(dur - 0.05, startSec + ((i + 0.5) / count) * rangeSec),
    );

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2d canvas context");

    for (const t of stops) {
      await new Promise<void>((resolve, reject) => {
        v.onseeked = () => resolve();
        v.onerror = () => reject(new Error("Seek failed"));
        v.currentTime = t;
      });
      const w = v.videoWidth;
      const h = v.videoHeight;
      const scale = w > maxWidth ? maxWidth / w : 1;
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob null"))),
          "image/jpeg",
          quality,
        ),
      );
      blobs.push(blob);
    }
    v.removeAttribute("src");
    v.load();
  } finally {
    URL.revokeObjectURL(url);
  }
  return blobs;
}

export async function createContactSheet(
  blobs: Blob[],
  opts: { cols?: number; cellWidth?: number; quality?: number; sectionBreak?: number } = {},
): Promise<Blob> {
  const cols = Math.min(opts.cols ?? 5, blobs.length);
  const cellWidth = opts.cellWidth ?? 240;
  const quality = opts.quality ?? 0.75;
  const rows = Math.ceil(blobs.length / cols);

  const images = await Promise.all(blobs.map((b) => createImageBitmap(b)));
  const aspectRatio = images[0] ? images[0].height / images[0].width : 9 / 16;
  const cellHeight = Math.round(cellWidth * aspectRatio);

  const canvas = document.createElement("canvas");
  canvas.width = cols * cellWidth;
  canvas.height = rows * cellHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2d canvas context");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  images.forEach((img, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cellWidth;
    const y = row * cellHeight;

    if (opts.sectionBreak !== undefined && i === opts.sectionBreak) {
      ctx.fillStyle = "#ffcc00";
      ctx.fillRect(0, y, canvas.width, 3);
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(0, y + 3, 220, 16);
      ctx.fillStyle = "#ffcc00";
      ctx.font = "bold 10px monospace";
      ctx.fillText("END ZONE (dense – creampie/squirt zone)", 4, y + 14);
    }

    ctx.drawImage(img, x, y, cellWidth, cellHeight);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x, y, 28, 15);
    ctx.fillStyle = i >= (opts.sectionBreak ?? Infinity) ? "#ffcc00" : "#fff";
    ctx.font = "bold 10px monospace";
    ctx.fillText(String(i + 1), x + 3, y + 11);
  });

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob null"))),
      "image/jpeg",
      quality,
    ),
  );
}
