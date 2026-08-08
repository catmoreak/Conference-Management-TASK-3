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

/** Sniffs the first bytes of a file to determine its real type, independent of filename/Content-Type. */
export function detectFileKind(buffer: Buffer): FileKind {
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    // "PK\x03\x04" -- OOXML (.pptx/.pptm) is a ZIP container.
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
