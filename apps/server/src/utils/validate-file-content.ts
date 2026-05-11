/**
 * File content validation utilities.
 *
 * Two-layer approach:
 * 1. isMimeTypeConsistent() — fast MIME/extension denylist check (synchronous)
 * 2. verifyMagicBytes() — reads first 4 KB from S3, compares against file-type database
 */
import { fileTypeFromBuffer } from "file-type";

/**
 * MIME types that are never acceptable regardless of file extension.
 *
 * This denylist is intentionally non-exhaustive — it covers the most
 * dangerous server-executable types but cannot enumerate every possible
 * malicious MIME type. Defense-in-depth is provided by `DANGEROUS_EXTENSIONS`
 * (extension denylist) and `verifyMagicBytes` (content-level check), which
 * together catch cases that slip through MIME-type spoofing.
 */
export const BLOCKED_MIME_TYPES = new Set([
  "application/x-executable",
  "application/x-msdownload",
  "application/x-sh",
  "application/x-shellscript",
  "application/x-msdos-program",
]);

/** Extensions associated with executable/script files */
export const DANGEROUS_EXTENSIONS = new Set([
  "exe",
  "dll",
  "bat",
  "cmd",
  "com",
  "ps1",
  "psm1",
  "psd1",
  "vbs",
  "js",
  "msi",
  "scr",
  "jar",
  "sh",
  "bash",
  "zsh",
  "php",
  "asp",
  "aspx",
  "py",
  "rb",
  "pl",
]);

/**
 * Check if the declared MIME type is consistent with the file extension.
 *
 * Returns `false` (invalid) if any of the following are true:
 * - The extension is in `DANGEROUS_EXTENSIONS` and MIME is absent or "application/octet-stream"
 * - The declared MIME type is in `BLOCKED_MIME_TYPES`
 * - The declared MIME type is `application/octet-stream` (treated as "unknown")
 *   and the extension is in `DANGEROUS_EXTENSIONS`
 * - The declared MIME type is a clearly benign type (image/*, video/*, audio/*,
 *   application/pdf, text/plain) but the extension is dangerous (spoofing signal)
 *
 * Returns `true` for exotic/unknown combinations to avoid false positives.
 * Defense-in-depth is provided by `DANGEROUS_EXTENSIONS` and `verifyMagicBytes`.
 */
export function isMimeTypeConsistent(mimeType: string | undefined, extension: string): boolean {
  const lowerExt = extension.toLowerCase().replace(/^\./, "");

  // Extension check runs independently of MIME type.
  // If mimeType is absent or "application/octet-stream" (effectively unknown),
  // still block dangerous extensions.
  if (!mimeType || mimeType.toLowerCase() === "application/octet-stream") {
    if (DANGEROUS_EXTENSIONS.has(lowerExt)) {
      return false;
    }
    // For truly absent MIME, no further checks are possible; allow.
    if (!mimeType) return true;
  }

  const lowerMime = mimeType.toLowerCase();

  // Block explicitly dangerous MIME types
  if (BLOCKED_MIME_TYPES.has(lowerMime)) {
    return false;
  }

  // Dangerous extension with a clearly benign MIME → likely spoofing
  if (DANGEROUS_EXTENSIONS.has(lowerExt)) {
    const isBenignMime =
      lowerMime.startsWith("image/") ||
      lowerMime.startsWith("video/") ||
      lowerMime.startsWith("audio/") ||
      lowerMime === "application/pdf" ||
      lowerMime.startsWith("text/plain");
    if (isBenignMime) {
      return false;
    }
  }

  return true;
}

/**
 * Verify file content against declared MIME type using magic bytes.
 * Reads the provided buffer (first N bytes of the file) and compares
 * the detected type against the declared MIME.
 *
 * Returns { valid: true } if consistent, or { valid: false, detected, declared }
 * if a mismatch is found. Returns { valid: true } if the file type cannot
 * be determined (many file formats have no magic bytes — e.g. plain text, CSV).
 */
export async function verifyMagicBytes(
  buffer: Buffer | Uint8Array,
  declaredMime: string | undefined,
): Promise<{ valid: boolean; detected?: string; declared?: string }> {
  if (!declaredMime) return { valid: true };

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) {
    // file-type couldn't identify — this is common for text files, CSVs, etc.
    return { valid: true };
  }

  const declaredLower = declaredMime.toLowerCase();
  const detectedLower = detected.mime.toLowerCase();

  // Exact match
  if (declaredLower === detectedLower) return { valid: true };

  // Allow equivalent MIME types (e.g. image/jpg vs image/jpeg)
  const equivalences: Record<string, string> = {
    "image/jpg": "image/jpeg",
    "audio/mp3": "audio/mpeg",
  };
  const normalizedDeclared = equivalences[declaredLower] ?? declaredLower;
  const normalizedDetected = equivalences[detectedLower] ?? detectedLower;
  if (normalizedDeclared === normalizedDetected) return { valid: true };

  // Same major type (e.g. image/* vs image/*) — allow as consistent
  const declaredMajor = declaredLower.split("/")[0];
  const detectedMajor = detectedLower.split("/")[0];
  if (declaredMajor === detectedMajor) return { valid: true };

  // Mismatch
  return { valid: false, detected: detected.mime, declared: declaredMime };
}
