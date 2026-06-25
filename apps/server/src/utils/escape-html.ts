/**
 * Escape user-provided strings for safe embedding in HTML.
 * Prevents XSS when interpolating values (appName, fromName, etc.) into
 * email templates or other HTML output.
 *
 * Handles: & < > " '
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
