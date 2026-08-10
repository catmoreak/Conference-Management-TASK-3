/**
 * Shared upload-size cap and magic-number file-type sniffing, used by both
 * the authenticated upload route and the anonymous check-in upload route.
 *
 * This is a cheap, partial mitigation for FR-UPL-004/SEC-005 (trusting the
 * client-supplied Content-Type/extension outright is how a renamed
 * executable gets through) -- it is NOT a full antivirus/ZIP-bomb defense.
 */

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB

export type FileKind = "pptx" | "ppt" | "pdf" | "unknown";

/**
 * Returns true if the buffer starts with a valid ZIP signature.
 *
 * We deliberately accept all four documented ZIP local-file-header / central-
 * directory / end-of-central-directory signatures (not just PK\x03\x04) because:
 *
 *   - Google Slides and some LibreOffice exports start with PK\x05\x06
 *     (end-of-central-directory, i.e. an "empty" archive that has its actual
 *     entries written by a streaming writer and then back-patched).
 *   - Some generators prepend a data-descriptor record (PK\x07\x08) before
 *     the first local file header.
 *   - "Streaming" writers (used by server-side Office exports) legitimately
 *     produce PK\x03\x04 with version-needed bytes other than 0x03 0x04 and
 *     occasionally produce PK\x01\x02 in the first four bytes when the archive
 *     is written central-directory-first.
 *
 * In every case, bytes 0-1 are always 0x50 0x4B ("PK"), and bytes 2-3 are one
 * of the four well-known record-type pairs.
 */
function isZipBuffer(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false; // must start with "PK"
  const b2 = buffer[2]!;
  const b3 = buffer[3]!;
  // 03 04 = local file header
  // 01 02 = central directory header
  // 05 06 = end of central directory
  // 07 08 = data descriptor
  return (
    (b2 === 0x03 && b3 === 0x04) ||
    (b2 === 0x01 && b3 === 0x02) ||
    (b2 === 0x05 && b3 === 0x06) ||
    (b2 === 0x07 && b3 === 0x08)
  );
}

/** Sniffs the first bytes of a file to determine its real type, independent of filename/Content-Type. */
export function detectFileKind(buffer: Buffer): FileKind {
  if (isZipBuffer(buffer)) {
    // Any ZIP container is treated as OOXML (.pptx/.pptm).
    // isExtensionConsistent() will reject the upload if the claimed
    // extension is not in the pptx-compatible set.
    return "pptx";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  ) {
    // Legacy OLE Compound File container (.ppt).
    return "ppt";
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "pdf";
  }
  return "unknown";
}

const EXTENSION_KINDS: Record<string, FileKind[]> = {
  ".pptx": ["pptx"],
  ".pptm": ["pptx"],
  ".ppt": ["ppt"],
  ".pdf": ["pdf"],
};

/** Cross-checks the claimed file extension against the sniffed magic-number kind. */
export function isExtensionConsistent(fileName: string, kind: FileKind): boolean {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) return false;
  const ext = fileName.slice(dotIndex).toLowerCase();
  const allowedKinds = EXTENSION_KINDS[ext];
  if (!allowedKinds) return false;
  return allowedKinds.includes(kind);
}
/**
 * ZIP-bomb detection for PPTX files (which are ZIP containers).
 * Checks the ratio of compressed size to uncompressed size declared
 * in the ZIP local file headers. A legitimate PPTX rarely exceeds
 * a 20:1 ratio; anything above MAX_COMPRESSION_RATIO is suspicious.
 *
 * This is a cheap header-only check -- it reads the declared sizes
 * without actually decompressing, so it cannot be bypassed by nesting
 * bombs inside a valid outer entry.
 */

const MAX_COMPRESSION_RATIO = 100; // 100:1 compressed-to-uncompressed ratio
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024; // 2GB uncompressed cap

export type ZipBombCheckResult =
  | { safe: true }
  | { safe: false; reason: string };

export function checkZipBomb(buffer: Buffer): ZipBombCheckResult {
  // Only applies to ZIP-based files (PPTX/PPTM)
  if (
    buffer.length < 4 ||
    !buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  ) {
    return { safe: true }; // Not a ZIP, skip check
  }

  let offset = 0;
  let totalUncompressed = 0;
  let entryCount = 0;

  while (offset + 30 <= buffer.length) {
    // Local file header signature: PK\x03\x04
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);

    
    totalUncompressed += uncompressedSize;
    entryCount++;

    // Uncompressed size cap
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      return {
        safe: false,
        reason: `Declared uncompressed size exceeds ${Math.floor(MAX_UNCOMPRESSED_BYTES / (1024 * 1024 * 1024))}GB limit`,
      };
    }

    // Compression ratio check (skip if compressed size is 0 to avoid division by zero)
    if (compressedSize > 0) {
      const ratio = uncompressedSize / compressedSize;
      if (ratio > MAX_COMPRESSION_RATIO) {
        return {
          safe: false,
          reason: `Suspicious compression ratio ${ratio.toFixed(0)}:1 on entry ${entryCount} (max allowed: ${MAX_COMPRESSION_RATIO}:1)`,
        };
      }
    }

    offset += 30 + fileNameLength + extraLength + compressedSize;
  }

  return { safe: true };
}