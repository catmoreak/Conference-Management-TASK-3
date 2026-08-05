/**
 * S3/MinIO presigned URL client — STUB.
 *
 * This module defines the interface for minting presigned download URLs.
 * The actual AWS SDK integration (@aws-sdk/client-s3 and
 * @aws-sdk/s3-request-presigner) will be installed and wired up when
 * MinIO is configured for local dev.
 *
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

// ── S3 configuration check ───────────────────────────────────────────────

/**
 * Returns true if all required S3 env vars are configured.
 * When false, the download endpoint should return 501.
 */
export function isS3Configured(): boolean {
  return !!(
    process.env.S3_ENDPOINT &&
    process.env.S3_BUCKET &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  );
}

// ── Presigned URL minting ────────────────────────────────────────────────

/**
 * Generate a presigned download URL for an S3 object.
 *
 * TODO: Replace this stub with a real AWS SDK v3 implementation when
 * MinIO is set up for local dev. Install:
 *   npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 *
 * Implementation outline:
 * ```typescript
 * import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
 * import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
 *
 * const client = new S3Client({
 *   endpoint: process.env.S3_ENDPOINT,
 *   region: process.env.S3_REGION ?? "us-east-1",
 *   credentials: {
 *     accessKeyId: process.env.S3_ACCESS_KEY_ID!,
 *     secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
 *   },
 *   forcePathStyle: true, // Required for MinIO
 * });
 *
 * const command = new GetObjectCommand({
 *   Bucket: process.env.S3_BUCKET,
 *   Key: opts.objectKey,
 * });
 *
 * const url = await getSignedUrl(client, command, {
 *   expiresIn: opts.ttlSeconds,
 * });
 * ```
 *
 * @returns PresignedUrlResult, or null if S3 is not configured.
 */
export async function getPresignedDownloadUrl(
  opts: PresignDownloadOptions,
): Promise<PresignedUrlResult | null> {
  if (!isS3Configured()) {
    return null;
  }

  // TODO: Replace with real S3 presigning once @aws-sdk is installed.
  // This stub should never be reached in production without S3 configured,
  // but if it somehow is, return null to trigger the 501 response.
  console.warn(
    "[S3_STUB] getPresignedDownloadUrl called but AWS SDK is not installed. " +
      "Install @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner, then " +
      "replace this stub in src/server/storage/s3-client.ts.",
  );
  return null;
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
