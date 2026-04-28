/**
 * Shared MIME type utilities for file extension detection.
 * Fallback to application/octet-stream if extension is unknown.
 *
 * @module @ouitransfer/shared/mime-types
 */
/**
 * Get MIME type from file extension.
 * @param filename - The filename or extension (with or without leading dot)
 * @returns MIME type string, defaults to 'application/octet-stream' if unknown
 */
export declare function getMimeType(filename: string): string;
/**
 * Alias for getMimeType — returns the Content-Type for a file.
 */
export declare const getContentType: typeof getMimeType;
/**
 * Check if a MIME type represents an image.
 */
export declare function isImageMimeType(mimeType: string): boolean;
/**
 * Check if a MIME type represents audio.
 */
export declare function isAudioMimeType(mimeType: string): boolean;
/**
 * Check if a MIME type represents video.
 */
export declare function isVideoMimeType(mimeType: string): boolean;
/**
 * Extract filename from Content-Disposition header.
 *
 * Supports RFC 5987 `filename*=` with UTF-8 encoding only.
 * Handles both quoted (`filename="foo.txt"`) and unquoted (`filename=foo.txt`) values.
 *
 * @param contentDisposition - The Content-Disposition header value
 * @returns Extracted filename or null if not found
 */
export declare function extractFilenameFromContentDisposition(contentDisposition: string | null): string | null;
/**
 * Detect MIME type with fallback logic for proxy responses.
 * @param serverContentType - Content-Type from server
 * @param contentDisposition - Content-Disposition header
 * @param fallbackFilename - Fallback filename if not in Content-Disposition
 * @returns Detected MIME type
 */
export declare function detectMimeTypeWithFallback(serverContentType: string | null, contentDisposition: string | null, fallbackFilename?: string): string;
//# sourceMappingURL=mime-types.d.ts.map