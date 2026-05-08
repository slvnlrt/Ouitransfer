import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * A single entry in images.remotePatterns.
 * Derived from NextConfig so it stays in sync with whatever Next.js version
 * is installed — avoids a direct import from internal Next.js paths.
 * We exclude the `URL` variant (also accepted by Next.js) to get the plain
 * object form with explicit protocol/hostname fields.
 */
type RemotePattern = Exclude<
  NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number],
  URL
>;

/**
 * Parse a comma-separated list of image hosts into Next.js remotePatterns.
 *
 * Each entry supports:
 *   - `example.com`          → HTTPS (default)
 *   - `https://example.com`  → HTTPS
 *   - `http://example.com`   → HTTP
 *   - `*.example.com`        → HTTPS with wildcard hostname
 *   - `http://*.example.com` → HTTP with wildcard hostname
 *
 * Next.js natively supports `*` (single-level) and `**` (multi-level) in
 * the hostname field, so wildcard entries are passed through as-is.
 */
function parseImageHosts(hostsStr: string): RemotePattern[] {
  return hostsStr
    .split(",")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((entry) => {
      let protocol: "http" | "https" = "https";
      if (entry.startsWith("http://")) {
        protocol = "http";
        entry = entry.slice(7);
      } else if (entry.startsWith("https://")) {
        protocol = "https";
        entry = entry.slice(8);
      }
      return { protocol, hostname: entry };
    });
}

/** Fallback patterns used when ALLOWED_IMAGE_HOSTS is not set. */
const DEFAULT_IMAGE_PATTERNS: RemotePattern[] = [
  { protocol: "http", hostname: "localhost" },
  { protocol: "https", hostname: "localhost" },
  { protocol: "http", hostname: "127.0.0.1" },
  { protocol: "https", hostname: "127.0.0.1" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: process.env.ALLOWED_IMAGE_HOSTS
      ? parseImageHosts(process.env.ALLOWED_IMAGE_HOSTS)
      : DEFAULT_IMAGE_PATTERNS,
  },
  serverExternalPackages: [],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
