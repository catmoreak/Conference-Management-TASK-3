/**
 * Ported from server/src/auth/presign-policy.ts, unchanged.
 */

/**
 * Maximum TTL for any S3 presigned URL minted through the downloads route.
 *
 * The revocation gap: once a URL is minted, S3 has no mechanism to revoke it
 * early. If a submission is rejected, deleted, or a reviewer's event
 * assignment is pulled a second after a presigned download URL was handed
 * out, that URL keeps working until it expires -- canUserPerform is not
 * consulted again. This constant is the entire bound on how long that gap
 * can be exploited, so it is kept short deliberately: submission:download /
 * submission:read_approved can be re-derived from a fresh authorization
 * check on demand, so there is no legitimate reason for a link to outlive
 * the page load or podium request that asked for it.
 *
 * Do not raise this above 300s without updating ADR 0001's presign section.
 */
export const PRESIGNED_URL_TTL_SECONDS = 300;
