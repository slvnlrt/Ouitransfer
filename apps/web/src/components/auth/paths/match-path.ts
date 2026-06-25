/**
 * Checks whether a pathname matches any entry in a list of path prefixes.
 *
 * Matching rules:
 * - Exact match: `/login` matches `/login`
 * - Prefix with slash boundary: `/login` matches `/login/foo` but NOT `/loginadmin`
 * - Paths already ending in `/` (e.g. `/s/`) match anything starting with that prefix
 */
export function matchesPath(pathname: string, paths: readonly string[]): boolean {
  return paths.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}
