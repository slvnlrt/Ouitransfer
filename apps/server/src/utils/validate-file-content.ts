/**
 * File content validation utilities.
 *
 * Two-layer approach:
 * 1. isMimeTypeConsistent() — fast MIME/extension denylist check (synchronous)
 * 2. verifyMagicBytes() — reads first 4 KB from S3, compares against file-type database
 */
import { getMimeType } from "@ouitransfer/shared/mime-types";
import { fileTypeFromBuffer } from "file-type";
import { ValidationError } from "./app-error.js";
import { hasDangerousDoubleExtension } from "./sanitize-filename.js";

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
 * Extensions for browser-renderable ACTIVE content. These are not server
 * executables but, if served same-origin with an inline disposition, become
 * stored-XSS vectors (A3-02 + A3-03). They are rejected at register independent of
 * the declared MIME type. Forced-attachment download (R2) is the complementary
 * defense; blocking them here removes the storage surface entirely.
 */
export const ACTIVE_CONTENT_EXTENSIONS = new Set([
  "html",
  "htm",
  "xhtml",
  "shtml",
  "svg",
  "svgz",
  "xml",
  "xsl",
  "xslt",
  "mhtml",
  "mht",
  "htc",
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
 * LIMITATION (A3-13): this is header-only sniffing — `file-type` inspects only the
 * leading bytes (we read at most 4 KB, see S3StorageProvider.getObjectHead). A
 * polyglot whose first bytes match a benign type but whose tail is HTML/JS will
 * pass. Magic-byte verification is therefore ONE layer only; the authoritative
 * defenses are the extension denylist (assertExtensionAllowed) and forced
 * `attachment` download (handled in R2).
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

/**
 * Normalize an extension to its bare, lowercased form (no leading dot).
 */
function normalizeExtension(extension: string): string {
  return extension.toLowerCase().replace(/^\.+/, "");
}

/**
 * Enforce the dangerous-extension denylist independent of the declared MIME type
 * (A3-02). Unlike {@link isMimeTypeConsistent} — which is a MIME/extension
 * *consistency* heuristic — this is an unconditional gate: a file whose extension
 * (or, for double extensions, whose trailing extension) is server-executable is
 * always rejected, even when the client omits `mimeType`.
 *
 * @throws {ValidationError} when the extension is in {@link DANGEROUS_EXTENSIONS}.
 */
export function assertExtensionAllowed(extension: string): void {
  const ext = normalizeExtension(extension);
  if (DANGEROUS_EXTENSIONS.has(ext) || ACTIVE_CONTENT_EXTENSIONS.has(ext)) {
    throw new ValidationError("This file type is not allowed");
  }
}

/**
 * Result of {@link resolveEffectiveMimeType}: the MIME type that BOTH validation
 * layers should run against, always derived (never optional). When the client
 * omits `mimeType`, the extension-derived type is used so the consistency and
 * magic-byte checks ALWAYS execute (closing the A3-02 fail-open where an omitted
 * `mimeType` skipped all content validation).
 */
export function resolveEffectiveMimeType(
  clientMimeType: string | undefined,
  extension: string,
): string {
  if (clientMimeType?.trim()) return clientMimeType;
  // Derive from the extension. `getMimeType` returns application/octet-stream for
  // unknown extensions, which still lets the magic-byte layer run meaningfully.
  return getMimeType(`.${normalizeExtension(extension)}`);
}

/**
 * Run the FULL two-layer content-validation pipeline against an uploaded object,
 * failing CLOSED on any unexpected error (A3-02).
 *
 * 1. Dangerous-extension denylist (unconditional).
 * 2. MIME/extension consistency (against the *effective* MIME type).
 * 3. Magic-byte verification: reads the object head from storage and compares the
 *    detected type against the effective MIME type.
 *
 * Fail-closed policy: the only swallowed magic-byte failures are *expected*
 * storage limitations (Range not supported, empty body) where the object exists
 * but its head cannot be read — these degrade to "skip layer 3" with a warning.
 * A missing object (NoSuchKey/NotFound) or ANY other unexpected storage error is
 * rejected, because we must not register a file whose content we could not verify.
 *
 * @param readObjectHead reads the first bytes of the stored object (S3 head).
 * @throws {ValidationError} on a denylisted extension, MIME/extension mismatch,
 *   magic-byte mismatch, a missing object, or an unverifiable upload.
 */
export async function assertUploadedContentValid(
  params: {
    objectName: string;
    extension: string;
    mimeType: string | undefined;
  },
  readObjectHead: (objectName: string) => Promise<Buffer | Uint8Array>,
  log?: { warn: (obj: unknown, msg: string) => void; debug: (obj: unknown, msg: string) => void },
): Promise<void> {
  const { objectName, extension } = params;

  // Layer 0: unconditional dangerous-extension denylist.
  assertExtensionAllowed(extension);

  // A3-11: flag (do not block) a dangerous double-extension on the stored key —
  // the trailing extension is already covered by the denylist above, but a
  // benign-looking name like "invoice.pdf.exe" warrants an audit signal.
  const basename = objectName.substring(objectName.lastIndexOf("/") + 1);
  if (hasDangerousDoubleExtension(basename, DANGEROUS_EXTENSIONS)) {
    log?.warn({ objectName }, "Upload has a dangerous double-extension");
  }

  // Always derive an effective MIME type so layers 1 and 2 ALWAYS run.
  const mimeType = resolveEffectiveMimeType(params.mimeType, extension);

  // Layer 1: MIME/extension consistency.
  if (!isMimeTypeConsistent(mimeType, extension)) {
    throw new ValidationError("File type does not match the declared extension");
  }

  // Layer 2: magic-byte verification (read object head from storage).
  let headBuffer: Buffer | Uint8Array;
  try {
    headBuffer = await readObjectHead(objectName);
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    const isMissingObject =
      message.includes("nosuchkey") ||
      message.includes("not found") ||
      message.includes("notfound") ||
      message.includes("no such key");
    if (isMissingObject) {
      // The object the client asked us to register does not exist — reject.
      throw new ValidationError("Uploaded object not found");
    }
    const isExpectedHeadLimitation =
      message.includes("range") ||
      message.includes("not supported") ||
      message.includes("empty response");
    if (isExpectedHeadLimitation) {
      // The object exists but its head cannot be read on this backend — degrade
      // to skipping the magic-byte layer (layers 0 and 1 still applied).
      log?.debug(
        { objectName, reason: message },
        "Magic-byte verification skipped (expected storage limitation)",
      );
      return;
    }
    // Any other error is unexpected — FAIL CLOSED rather than register unverified.
    log?.warn(
      { err, objectName },
      "Magic-byte verification failed with an unexpected storage error — rejecting upload",
    );
    throw new ValidationError("File content could not be verified");
  }

  const magicResult = await verifyMagicBytes(headBuffer, mimeType);
  if (!magicResult.valid) {
    log?.warn(
      { declared: magicResult.declared, detected: magicResult.detected, objectName },
      "Magic-byte mismatch detected",
    );
    throw new ValidationError("File content does not match the declared file type");
  }
}
