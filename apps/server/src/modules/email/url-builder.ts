import { getConfigValue } from "../config/service.js";

// ─── App URL ──────────────────────────────────────────────────────────────────

/**
 * Returns the configured application base URL (e.g. "https://transfer.example.com").
 *
 * Reads from the config store on every call — `getConfigValue` is fast (in-memory
 * config cache with DB fallback) and the queue processes emails one at a time,
 * so per-call overhead is negligible. This ensures admin config changes take
 * effect immediately without server restart.
 */
export async function getAppUrl(): Promise<string> {
  const url = await getConfigValue("appUrl");
  if (!url) throw new Error("appUrl is not configured or empty");
  return url;
}

/**
 * No-op retained for backward compatibility with callers that invalidate the cache.
 * The cache has been removed — `getAppUrl()` now reads fresh on every call.
 * @deprecated No longer needed; will be removed in a future cleanup.
 */
export function invalidateAppUrlCache(): void {
  // No-op: appUrl is no longer cached
}

// ─── URL builders ─────────────────────────────────────────────────────────────

/**
 * Build a public share link for a recipient.
 * Format: `{appUrl}/s/{alias}` with optional `?t={trackingToken}`.
 */
export async function buildShareLink(alias: string, trackingToken?: string): Promise<string> {
  const base = await getAppUrl();
  const url = `${base}/s/${alias}`;
  if (trackingToken) {
    return `${url}?t=${trackingToken}`;
  }
  return url;
}

/**
 * Build the share management URL (owner dashboard).
 * Format: `{appUrl}/shares/{shareId}`.
 */
export async function buildShareManageUrl(shareId: string): Promise<string> {
  const base = await getAppUrl();
  return `${base}/shares/${shareId}`;
}

/**
 * Build the password reset URL.
 * Format: `{appUrl}/auth/reset-password/{token}`.
 */
export async function buildResetPasswordUrl(token: string): Promise<string> {
  const base = await getAppUrl();
  return `${base}/auth/reset-password/${token}`;
}

/**
 * Build the one-click unsubscribe URL.
 * Format: `{appUrl}/api/notifications/unsubscribe?token={token}`.
 */
export async function buildUnsubscribeUrl(token: string): Promise<string> {
  const base = await getAppUrl();
  return `${base}/api/notifications/unsubscribe?token=${token}`;
}
