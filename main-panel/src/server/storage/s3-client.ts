import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * S3 key pattern (SEC-011):
 *   {tenantId}/{fileType}/{fileId}/{randomId}
 *
 * No original filename in the key — the display name is stored only in
 * the database. randomId prevents enumeration attacks.
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface PresignedUrlResult {
  url: string;
  expiresIn: number;
}

export type FileType = "original" | "display_package";

export interface PresignDownloadOptions {
  tenantId: string;
  fileType: FileType;
  fileId: string;
  /** S3 object key. If not provided, the stub returns null. */
  objectKey?: string;
  /** TTL in seconds for the presigned URL. */
  ttlSeconds: number;
}

export interface UploadObjectOptions {
  objectKey: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface UploadObjectResult {
  objectKey: string;
  bucket: string;
  etag?: string;
}

function hasStaticCredentials(): boolean {
  return Boolean(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
}

function isAnonymousUploadEnabled(): boolean {
  return process.env.S3_ALLOW_ANONYMOUS_PUT === "true";
}

// ── S3 configuration check ───────────────────────────────────────────────

/**
 * Returns true if all required S3 env vars are configured.
 * When false, the download endpoint should return 501.
 */
export function isS3Configured(): boolean {
  return !!(
    process.env.S3_ENDPOINT &&
    process.env.S3_BUCKET
  );
}

function getS3Client(): S3Client {
  if (!isS3Configured()) {
    throw new Error("S3 is not configured");
  }

  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const useStaticCredentials = hasStaticCredentials();

  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    ...(useStaticCredentials
      ? {
          credentials: {
            accessKeyId: accessKeyId!,
            secretAccessKey: secretAccessKey!,
          },
        }
      : {}),
  });
}

export async function uploadObjectToS3(
  options: UploadObjectOptions,
): Promise<UploadObjectResult> {
  if (!isS3Configured()) {
    throw new Error("S3 is not configured");
  }

  const bucket = process.env.S3_BUCKET!;
  if (!hasStaticCredentials() && isAnonymousUploadEnabled()) {
    const publicUrl = getPublicObjectUrl(options.objectKey);
    if (!publicUrl) {
      throw new Error("S3_PUBLIC_BASE_URL is required when S3_ALLOW_ANONYMOUS_PUT=true");
    }

    const response = await fetch(publicUrl, {
      method: "PUT",
      body: new Uint8Array(options.body),
      headers: {
        "Content-Type": options.contentType,
      },
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `Anonymous S3 upload failed (${response.status}): ${responseText.slice(0, 300)}`,
      );
    }

    return {
      objectKey: options.objectKey,
      bucket,
      etag: response.headers.get("etag") ?? undefined,
    };
  }

  const client = getS3Client();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: options.objectKey,
    Body: options.body,
    ContentType: options.contentType,
    Metadata: options.metadata,
  });

  const result = await client.send(command);

  return {
    objectKey: options.objectKey,
    bucket,
    etag: result.ETag,
  };
}

export function getPublicObjectUrl(objectKey: string): string | null {
  const baseUrl = process.env.S3_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (!baseUrl) {
    return null;
  }
  return `${baseUrl}/${objectKey}`;
}

// ── Presigned URL minting ────────────────────────────────────────────────

/**
 * Generate a presigned download URL for an S3 object.
 *
 * @returns PresignedUrlResult, or null if S3 is not configured or the
 *   object key is missing.
 */
export async function getPresignedDownloadUrl(
  opts: PresignDownloadOptions,
): Promise<PresignedUrlResult | null> {
  if (!isS3Configured() || !opts.objectKey) {
    return null;
  }

  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET!,
    Key: opts.objectKey,
  });

  const url = await getSignedUrl(client, command, {
    expiresIn: opts.ttlSeconds,
  });

  return { url, expiresIn: opts.ttlSeconds };
}

/**
 * Build the S3 object key for a file, following SEC-011 conventions:
 *   {tenantId}/{fileType}/{fileId}/{randomId}
 *
 * The randomId is generated server-side when the file is first uploaded
 * and stored in the database. This function reconstructs the key from
 * those stored components.
 */
export function buildObjectKey(
  tenantId: string,
  fileType: FileType,
  fileId: string,
  randomId: string,
): string {
  return `${tenantId}/${fileType}/${fileId}/${randomId}`;
}
