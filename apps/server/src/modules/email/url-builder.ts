import { getConfigValue } from "../config/service.js";

// ─── App URL cache ────────────────────────────────────────────────────────────

// NOTE: Process-local cache. In a multi-instance deployment, config changes
// on one instance won't propagate to others until restart. Acceptable for
// current single-instance architecture. See also: transport.ts hash cache.
let cachedAppUrl: string | null = null;

/**
 * Returns the configured application base URL (e.g. "https://transfer.example.com").
 * The value is cached after the first successful read.
 */
export async function getAppUrl(): Promise<string> {
  if (cachedAppUrl) return cachedAppUrl;
  const url = await getConfigValue("appUrl");
  if (!url) throw new Error("appUrl is not configured or empty");
  cachedAppUrl = url;
  return url;
}

/**
 * Clears the cached appUrl so the next call to `getAppUrl()` will
 * re-read from the database. Call after an admin changes the setting.
 */
export function invalidateAppUrlCache(): void {
  cachedAppUrl = null;
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
