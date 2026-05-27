"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  Trash2,
  Music,
  Archive,
  Play,
  X,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  requestVaultUpload,
  commitVaultUpload,
  deleteVaultItem,
} from "@/lib/vault/actions";
import {
  ALL_ALLOWED_VAULT_TYPES,
  formatFileSize,
} from "@/lib/vault/constants";
import type { VaultItemWithUrl } from "@/lib/vault/queries";

interface UploadEntry {
  id: string;
  name: string;
  status: "uploading" | "done" | "error";
  error?: string;
}

interface Props {
  items: VaultItemWithUrl[];
}

export function VaultClient({ items }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [optimisticDeleted, setOptimisticDeleted] = useState<Set<string>>(new Set());
  const [previewItem, setPreviewItem] = useState<VaultItemWithUrl | null>(null);

  function setEntryStatus(id: string, status: UploadEntry["status"], error?: string) {
    setUploads((prev) => prev.map((e) => (e.id === id ? { ...e, status, error } : e)));
  }

  async function handleFiles(files: FileList) {
    const entries: UploadEntry[] = Array.from(files).map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      status: "uploading",
    }));
    setUploads((prev) => [...prev, ...entries]);

    await Promise.all(
      Array.from(files).map(async (file, i) => {
        const entry = entries[i];
        try {
          const req = await requestVaultUpload({
            fileName: file.name,
            contentType: file.type,
            sizeBytes: file.size,
          });
          if (!req.ok) { setEntryStatus(entry.id, "error", req.error); return; }

          const put = await fetch(req.data.uploadUrl, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": file.type },
          });
          if (!put.ok) { setEntryStatus(entry.id, "error", "Upload failed"); return; }

          const commit = await commitVaultUpload({
            storageKey: req.data.storageKey,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
          });
          if (!commit.ok) { setEntryStatus(entry.id, "error", commit.error); return; }

          setEntryStatus(entry.id, "done");
        } catch {
          setEntryStatus(entry.id, "error", "Unexpected error");
        }
      }),
    );

    router.refresh();
    setTimeout(() => setUploads((prev) => prev.filter((e) => e.status !== "done")), 2500);
  }

  async function handleDelete(itemId: string) {
    setOptimisticDeleted((prev) => new Set(prev).add(itemId));
    if (previewItem?.id === itemId) setPreviewItem(null);
    const result = await deleteVaultItem(itemId);
    if (!result.ok) {
      setOptimisticDeleted((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    } else {
      router.refresh();
    }
  }

  const visibleItems = items.filter((i) => !optimisticDeleted.has(i.id));

  return (
    <div>
      {/* Header */}
      <div className="px-8 pt-8 pb-6 border-b border-border flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">
            Vault
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Your Vault</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload and manage your saved files.
          </p>
        </div>
        <Button onClick={() => inputRef.current?.click()} className="mt-1 shrink-0">
          <Upload className="h-4 w-4 mr-2" />
          Upload
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ALL_ALLOWED_VAULT_TYPES.join(",")}
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="px-8 pt-5 space-y-2">
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-3 text-sm py-2 px-3 rounded-md bg-muted">
              <span className="flex-1 truncate font-mono text-xs">{u.name}</span>
              {u.status === "uploading" && <span className="text-muted-foreground text-xs">Uploading…</span>}
              {u.status === "done"      && <span className="text-xs text-green-600">Done</span>}
              {u.status === "error"     && <span className="text-xs text-destructive">{u.error}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="px-8 py-6">
        {visibleItems.length === 0 ? (
          <EmptyState onUpload={() => inputRef.current?.click()} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {visibleItems.map((item) => (
              <VaultCard
                key={item.id}
                item={item}
                onOpen={() => setPreviewItem(item)}
                onDelete={() => handleDelete(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Preview modal */}
      {previewItem && (
        <PreviewModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onDelete={() => handleDelete(previewItem.id)}
        />
      )}
    </div>
  );
}

// ── VaultCard ─────────────────────────────────────────────────────────────────

function VaultCard({
  item,
  onOpen,
  onDelete,
}: {
  item: VaultItemWithUrl;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setDeleting(true);
    await onDelete();
  }

  return (
    <div
      onClick={onOpen}
      className="group relative rounded-lg border border-border bg-card overflow-hidden cursor-pointer hover:border-foreground/30 transition-colors"
    >
      {/* Thumbnail */}
      <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
        {item.mediaKind === "image" && item.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.signedUrl} alt={item.fileName} className="w-full h-full object-cover" />
        ) : item.mediaKind === "video" && item.signedUrl ? (
          <div className="relative w-full h-full">
            <video
              src={item.signedUrl}
              preload="metadata"
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                <Play className="h-4 w-4 text-white fill-white ml-0.5" />
              </div>
            </div>
          </div>
        ) : (
          <Music className="h-10 w-10 text-muted-foreground" />
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" title={item.fileName}>
            {item.fileName}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatFileSize(item.fileSize)}
          </p>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className={cn(
            "shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors",
            "hover:text-destructive hover:bg-destructive/10",
            "opacity-0 group-hover:opacity-100",
            deleting && "opacity-50 cursor-not-allowed",
          )}
          aria-label="Delete file"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── PreviewModal ──────────────────────────────────────────────────────────────

function PreviewModal({
  item,
  onClose,
  onDelete,
}: {
  item: VaultItemWithUrl;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleDownload() {
    if (!item.signedUrl) return;
    setDownloading(true);
    try {
      const res = await fetch(item.signedUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    await onDelete();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Toolbar */}
      <div
        className="flex items-center justify-between gap-4 px-5 py-3 border-b border-white/10 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium text-white truncate">{item.fileName}</p>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-white/40 font-mono">{formatFileSize(item.fileSize)}</span>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? "Downloading…" : "Download"}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-white/70 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Media area */}
      <div
        className="flex-1 flex items-center justify-center p-6 min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
        {item.mediaKind === "image" && item.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.signedUrl}
            alt={item.fileName}
            className="max-w-full max-h-full object-contain rounded-md"
          />
        ) : item.mediaKind === "video" && item.signedUrl ? (
          <video
            src={item.signedUrl}
            controls
            autoPlay
            className="max-w-full max-h-full rounded-md"
          />
        ) : item.mediaKind === "audio" && item.signedUrl ? (
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10">
              <Music className="h-9 w-9 text-white/60" />
            </div>
            <p className="text-sm text-white/60">{item.fileName}</p>
            <audio src={item.signedUrl} controls autoPlay className="w-80" />
          </div>
        ) : (
          <p className="text-sm text-white/40">Preview unavailable</p>
        )}
      </div>
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted mb-4">
        <Archive className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground mb-1">Your vault is empty</p>
      <p className="text-sm text-muted-foreground mb-5">
        Upload images, videos, or audio files to get started.
      </p>
      <Button variant="outline" onClick={onUpload}>
        <Upload className="h-4 w-4 mr-2" />
        Upload files
      </Button>
    </div>
  );
}
