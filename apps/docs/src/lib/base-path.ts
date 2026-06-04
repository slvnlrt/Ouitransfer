/**
 * Base path the docs site is mounted under (see `next.config.mjs`).
 *
 * Next.js prepends `basePath` to `next/link`, `next/image`, and server routes
 * automatically — but NOT to client-side `fetch()` calls. Use {@link withBasePath}
 * for any absolute path passed to `fetch` (or to a library that calls `fetch`),
 * so it keeps working when the site is served under a sub-path (e.g. `/docs`).
 *
 * Empty in local dev (env unset) → `withBasePath` is a no-op.
 */
export const DOCS_BASE_PATH = process.env.NEXT_PUBLIC_DOCS_BASE_PATH ?? "";

/** Prefix an absolute app path with the configured base path. */
export function withBasePath(path: string): string {
  return `${DOCS_BASE_PATH}${path}`;
}
