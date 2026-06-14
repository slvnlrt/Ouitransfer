/**
 * Render-time guard for user/admin-configurable URLs that become an `href`
 * (A7-01). The server already validates `footerUrl` at the config-write
 * boundary, but the frontend validates again so a value that reaches the client
 * by any other path (stale cache, future code path) can never become a DOM-XSS
 * sink via a `javascript:`/`data:`/`vbscript:` href, nor a silent off-origin
 * redirect via a protocol-relative `//evil` URL.
 *
 * A URL is considered safe only when it is an absolute `http:`/`https:` URL with
 * a hostname and no ASCII control characters. Protocol-relative URLs (`//host`)
 * are rejected because `new URL()` cannot parse them without a base.
 */
export function isSafeHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!url.hostname) return false;
  return true;
}

/**
 * Returns `value` if it is a safe `http(s)://` URL, otherwise `"#"`. Use for any
 * `href` derived from configurable/untrusted input.
 */
export function safeHttpUrlOrHash(value: string | null | undefined): string {
  return isSafeHttpUrl(value) ? value : "#";
}
