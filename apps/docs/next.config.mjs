import path from "node:path";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

// Mount the whole site under a base path so it can be served behind a reverse
// proxy at a sub-path (e.g. https://host/docs). Baked at build time via the
// NEXT_PUBLIC_DOCS_BASE_PATH build arg (Dockerfile default: "/docs").
// Unset (local `pnpm dev`/`pnpm build`) or empty (sub-domain deployments) → no
// prefix. basePath must be a non-empty path without a trailing slash, so an
// empty value collapses to `undefined`.
const basePath = process.env.NEXT_PUBLIC_DOCS_BASE_PATH || undefined;

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  basePath,
  // Self-contained server bundle for the Docker runtime image.
  output: "standalone",
  // pnpm monorepo: trace from the repo root so symlinked workspace deps are
  // resolved to real files in the standalone output.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  images: {
    qualities: [100],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
  },
};

export default withMDX(config);
