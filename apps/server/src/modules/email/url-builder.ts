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
 * Format: `{appUrl}/shares?open={shareId}` — deep-links into the share list
 * and auto-opens the detail modal for that share.
 */
export async function buildShareManageUrl(shareId: string): Promise<string> {
  const base = await getAppUrl();
  return `${base}/shares?open=${shareId}`;
}

/**
 * Build the password reset URL.
 * Format: `{appUrl}/reset-password?token={token}`.
 */
export async function buildResetPasswordUrl(token: string): Promise<string> {
  const base = await getAppUrl();
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Build the one-click unsubscribe URL.
 * Format: `{appUrl}/api/notifications/unsubscribe?token={token}`.
 */
export async function buildUnsubscribeUrl(token: string): Promise<string> {
  const base = await getAppUrl();
  return `${base}/api/notifications/unsubscribe?token=${token}`;
}
