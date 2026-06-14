/**
 * Sanitize a filename to prevent path traversal and filesystem issues.
 *
 * - Strips path separators (/, \) — keeps only the basename
 * - Removes null bytes
 * - Strips Unicode bidi-override / zero-width control characters that can spoof
 *   the visible extension in the UI / Content-Disposition (e.g. U+202E RLO making
 *   "photo<RLO>gpj.exe" render as "photoexe.jpg")
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

/**
 * Unicode bidirectional-override and zero-width control characters that must be
 * stripped from filenames. These are invisible (or reorder) in most renderers and
 * are abused to disguise a file's real extension:
 * - U+200B–U+200F  zero-width space/joiner/non-joiner + LRM/RLM bidi marks
 * - U+202A–U+202E  LRE/RLE/PDF/LRO/RLO bidi embedding + overrides
 * - U+2066–U+2069  LRI/RLI/FSI isolates + PDI
 * - U+FEFF         zero-width no-break space (BOM)
 */
const BIDI_AND_ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Heuristic check for a dangerous double-extension where the TRAILING extension
 * is server-executable (e.g. "invoice.pdf.exe"). The authoritative defense is the
 * `DANGEROUS_EXTENSIONS` denylist enforced at register (see validate-file-content);
 * this is a defense-in-depth signal callers can log/flag. Returns `true` when the
 * filename has two or more extensions and the last one is in {@link dangerousExtensions}.
 */
export function hasDangerousDoubleExtension(
  filename: string,
  dangerousExtensions: ReadonlySet<string>,
): boolean {
  const parts = filename.toLowerCase().split(".");
  if (parts.length < 3) return false; // need name + at least two extensions
  const last = parts[parts.length - 1];
  return dangerousExtensions.has(last);
}

export function sanitizeFilename(filename: string): string {
  if (!filename || filename.trim() === "") return "unnamed";

  // Keep only the last segment (strip directory traversal)
  let safe = filename.replace(/\\/g, "/").split("/").pop() || "";

  // Remove null bytes
  safe = safe.replace(/\0/g, "");

  // Strip Unicode bidi-override / zero-width controls (extension-spoofing defense)
  safe = safe.replace(BIDI_AND_ZERO_WIDTH, "");

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
