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
 * Parse a single server-configured origin string into its bare origin
 * (scheme + host[:port], path/query stripped), or `null` if it is empty or not
 * a valid http(s) URL.
 */
function parseTrustedOrigin(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Normalize to the bare origin (scheme + host[:port]); strip any path.
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Read the configured canonical base URL (origin) for this deployment.
 *
 * Resolution order — every source is SERVER-configured (never a client-supplied
 * header), so none reintroduce the `X-Forwarded-Host` poisoning vector (A7-05):
 *   1. `APP_URL` — explicit canonical override.
 *   2. The FIRST entry of `FRONTEND_ORIGIN` — the primary public origin. It is
 *      already required (for CORS), so this yields a correct OpenGraph/canonical
 *      base out of the box without a second variable. `FRONTEND_ORIGIN` may be a
 *      comma-separated list (several hostnames behind one proxy); the first is
 *      treated as the canonical/primary one.
 *
 * Returns `null` only when neither is configured (e.g. local dev), in which case
 * the caller falls back to the trusted connection `host` header.
 */
function getConfiguredCanonicalOrigin(): string | null {
  return (
    parseTrustedOrigin(process.env.APP_URL) ??
    parseTrustedOrigin(process.env.FRONTEND_ORIGIN?.split(",")[0])
  );
}

/**
 * Derive the public base URL for server-rendered metadata (OpenGraph / canonical
 * URLs on public share pages).
 *
 * Security (A7-05): `X-Forwarded-Host` / `X-Forwarded-Proto` are
 * **client-controllable** unless the edge proxy overwrites them, so they are NOT
 * trusted blindly. Resolution order:
 *
 *   1. If a canonical origin is configured (`APP_URL`, else the first
 *      `FRONTEND_ORIGIN` entry — see getConfiguredCanonicalOrigin), return it
 *      verbatim. Host headers are ignored entirely (no poisoning possible). This
 *      is the normal production path since `FRONTEND_ORIGIN` is always set.
 *   2. With no canonical configured (e.g. local dev), `X-Forwarded-Host` is NOT
 *      trusted; we fall back to the connection `host` header (set by the
 *      immediate server, not the remote client).
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
