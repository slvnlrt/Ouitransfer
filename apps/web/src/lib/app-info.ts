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
 * Derive the public base URL from incoming request headers.
 * Respects `x-forwarded-proto` and `x-forwarded-host` for reverse-proxy setups.
 * Server-side only.
 */
export async function getBaseUrl(): Promise<string> {
  const headersList = await headers();
  const protocol = headersList.get("x-forwarded-proto") || "http";
  const host = headersList.get("x-forwarded-host") || headersList.get("host") || "localhost:3000";
  return `${protocol}://${host}`;
}
