import { headers } from "next/headers";

import { logger } from "@/lib/logger";

interface AppInfo {
  appName: string;
  appDescription: string;
  appLogo: string | null;
}

const DEFAULT_APP_INFO: AppInfo = {
  appName: "OUITRANSFER",
  appDescription: "Self-hosted file transfer platform",
  appLogo: null,
};

/**
 * Fetch application info (name, description, logo) from the backend API.
 * Falls back to defaults on error. Server-side only.
 */
export async function getAppInfo(): Promise<AppInfo> {
  try {
    // Development fallback only — in production, API_BASE_URL env var must be set.
    // Docker containers use http://server:3333 via the env var.
    const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3333";
    const response = await fetch(`${API_BASE_URL}/app/info`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return DEFAULT_APP_INFO;
    }

    return await response.json();
  } catch (error) {
    logger.error("Error fetching app info:", {
      err: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_APP_INFO;
  }
}

/**
 * Read the configured canonical base URL (origin) for this deployment.
 *
 * `APP_URL` (server-side) is the authoritative public origin; it is the single
 * source of truth for OpenGraph/canonical metadata on public share pages. When
 * set it is used verbatim and host headers are ignored entirely — this closes
 * the `X-Forwarded-Host` poisoning vector (A7-05).
 *
 * Returns `null` when no canonical is configured (e.g. local dev), in which case
 * the caller falls back to the (trusted) `host` header.
 */
function getConfiguredCanonicalOrigin(): string | null {
  const raw = process.env.APP_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Normalize to the bare origin (scheme + host[:port]); strip any path.
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Derive the public base URL for server-rendered metadata (OpenGraph / canonical
 * URLs on public share pages).
 *
 * Security (A7-05): `X-Forwarded-Host` / `X-Forwarded-Proto` are
 * **client-controllable** unless the edge proxy overwrites them, so they are NOT
 * trusted blindly. Resolution order:
 *
 *   1. If `APP_URL` is configured, return it verbatim — host headers are ignored
 *      (no poisoning possible). This is the recommended production setup.
 *   2. Otherwise honor `X-Forwarded-*` **only** when the forwarded host matches
 *      the configured canonical host allow-list (here: `APP_URL`'s host). With
 *      no canonical configured there is nothing to match, so forwarded headers
 *      are ignored and we fall back to the connection `host` header.
 *
 * Server-side only.
 */
export async function getBaseUrl(): Promise<string> {
  const canonical = getConfiguredCanonicalOrigin();
  if (canonical) {
    return canonical;
  }

  // No canonical configured: ignore client-supplied X-Forwarded-* and use the
  // connection host (set by the immediate server, not the remote client).
  const headersList = await headers();
  const host = headersList.get("host") || "localhost:3000";
  const protocol =
    headersList.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}
