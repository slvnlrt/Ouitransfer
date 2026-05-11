/**
 * Sanitize a filename to prevent path traversal and filesystem issues.
 *
 * - Strips path separators (/, \) — keeps only the basename
 * - Removes null bytes
 * - Removes leading dots to prevent hidden files
 * - Strips trailing dots and spaces (Windows FS rejects these)
 * - Prefixes Windows reserved names (CON, PRN, NUL, COM1-9, LPT1-9)
 * - Truncates to 255 bytes at a UTF-8 code point boundary
 * - Falls back to "unnamed" for empty/whitespace-only input
 *
 * Scope: this function is designed for S3 object key segments and
 * user-facing filenames in API responses. S3 keys don't have Windows
 * reserved-name restrictions, but we sanitize anyway since filenames
 * are also used in Content-Disposition headers for downloads.
 */

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

export function sanitizeFilename(filename: string): string {
  if (!filename || filename.trim() === "") return "unnamed";

  // Keep only the last segment (strip directory traversal)
  let safe = filename.replace(/\\/g, "/").split("/").pop() || "";

  // Remove null bytes
  safe = safe.replace(/\0/g, "");

  // Remove leading dots
  safe = safe.replace(/^\.+/, "");

  // Strip trailing dots and spaces (Windows FS safety)
  safe = safe.replace(/[.\s]+$/, "");

  // Fallback if nothing remains
  if (!safe.trim()) return "unnamed";

  // Prefix Windows reserved names
  if (WINDOWS_RESERVED.test(safe)) {
    safe = `_${safe}`;
  }

  // Truncate to 255 bytes at a UTF-8 code point boundary
  const buf = Buffer.from(safe, "utf8");
  if (buf.length > 255) {
    // Use TextDecoder with fatal:false to handle truncated multi-byte chars.
    // Slice to 255 bytes, decode, then strip any trailing replacement char.
    const decoder = new TextDecoder("utf-8", { fatal: false });
    safe = decoder.decode(buf.subarray(0, 255));
    // Remove trailing replacement character (U+FFFD) from truncated code point
    safe = safe.replace(/\uFFFD+$/, "");
    // Re-strip trailing dots/spaces that may have been exposed
    safe = safe.replace(/[.\s]+$/, "");
  }

  return safe || "unnamed";
}
