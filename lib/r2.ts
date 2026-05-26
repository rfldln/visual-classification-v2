import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

// ─── Lazy client ──────────────────────────────────────────────────────────────

let _client: S3Client | null = null;

/**
 * Returns the R2 S3Client, initializing it on first use.
 * Throws a clear error if R2 credentials are not configured.
 *
 * R2 is optional — Supabase Storage is used by default. Wire up R2 by
 * setting R2_* variables in .env.local.
 */
function getClient(): S3Client {
  if (_client) return _client;

  if (
    !env.R2_ACCOUNT_ID ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY
  ) {
    throw new Error(
      "R2 is not configured. Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and " +
        "R2_SECRET_ACCESS_KEY to .env.local before using R2 helpers.",
    );
  }

  _client = new S3Client({
    // R2 requires region "auto" — it ignores the value but the SDK requires it
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });

  return _client;
}

function getBucket(): string {
  if (!env.R2_BUCKET_NAME) {
    throw new Error("R2_BUCKET_NAME is not set in .env.local.");
  }
  return env.R2_BUCKET_NAME;
}

function getPublicBase(): string {
  if (!env.R2_PUBLIC_URL) {
    throw new Error("R2_PUBLIC_URL is not set in .env.local.");
  }
  return env.R2_PUBLIC_URL;
}

// ─── Upload ──────────────────────────────────────────────────────────────────

export interface UploadFileOptions {
  /** Storage key (path) in the bucket, e.g. "images/user-123/avatar.webp" */
  key: string;
  /** File body — Buffer, Uint8Array, ReadableStream, or string */
  body: PutObjectCommandInput["Body"];
  /** MIME type, e.g. "image/webp" */
  contentType: string;
  /** Cache-Control header sent with the object */
  cacheControl?: string;
}

/**
 * Uploads a file directly to R2 from the server and returns its public URL.
 *
 * For large files or client-side uploads, use getPresignedUploadUrl() to
 * avoid routing the file body through the Next.js server.
 */
export async function uploadFile({
  key,
  body,
  contentType,
  cacheControl = "public, max-age=31536000, immutable",
}: UploadFileOptions): Promise<string> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );

  return getPublicUrl(key);
}

// ─── Presigned URLs ──────────────────────────────────────────────────────────

export interface PresignedUploadOptions {
  /** Storage key where the client will upload */
  key: string;
  /** MIME type the client must send — enforced by the presigned signature */
  contentType: string;
  /** Seconds until the URL expires (default: 5 minutes) */
  expiresIn?: number;
}

/**
 * Generates a presigned PUT URL so the client can upload directly to R2.
 */
export async function getPresignedUploadUrl({
  key,
  contentType,
  expiresIn = 300,
}: PresignedUploadOptions): Promise<string> {
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({ Bucket: getBucket(), Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

/**
 * Generates a presigned GET URL for temporary access to a private R2 object.
 * Only needed when the bucket does NOT have public access enabled.
 */
export async function getPresignedDownloadUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
    { expiresIn },
  );
}

/**
 * Deletes an object from R2 by key.
 */
export async function deleteFile(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  );
}

/**
 * Returns the public URL for an object without signing.
 * Only valid when the bucket has public access enabled.
 */
export function getPublicUrl(key: string): string {
  return `${getPublicBase()}/${key}`;
}
