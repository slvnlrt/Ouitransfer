import { getConfigValue } from "../config/service.js";

// ─── App URL ──────────────────────────────────────────────────────────────────

/**
 * Returns the configured application base URL (e.g. "https://transfer.example.com").
 *
 * Reads from the config store on every call. Callers that need the URL multiple
 * times in one request should read it once and pass it as a parameter (e.g.
 * `buildUnsubscribeUrl(token, appUrl)`) to avoid redundant DB round-trips.
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
 *
 * Pass a pre-fetched `appUrl` to avoid a redundant DB round-trip when the
 * caller has already resolved it.
 */
export async function buildShareManageUrl(shareId: string, appUrl?: string): Promise<string> {
  const base = appUrl ?? (await getAppUrl());
  return `${base}/shares?open=${shareId}`;
}

/**
 * Build the reverse-share management URL (owner dashboard).
 * Format: `{appUrl}/reverse-shares` — lands the owner on their reverse-share
 * management list. Unlike {@link buildShareManageUrl}, no `?open=` deep-link is
 * appended because the reverse-shares page does not yet consume that param; a
 * dead anchor would be misleading, so we link to the list page instead.
 *
 * Pass a pre-fetched `appUrl` to avoid a redundant DB round-trip when the
 * caller has already resolved it.
 */
export async function buildReverseShareManageUrl(
  _reverseShareId: string,
  appUrl?: string,
): Promise<string> {
  const base = appUrl ?? (await getAppUrl());
  return `${base}/reverse-shares`;
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
 *
 * Pass a pre-fetched `appUrl` to avoid a redundant DB round-trip when the
 * caller has already resolved it.
 */
export async function buildUnsubscribeUrl(token: string, appUrl?: string): Promise<string> {
  const base = appUrl ?? (await getAppUrl());
  return `${base}/api/notifications/unsubscribe?token=${token}`;
}
