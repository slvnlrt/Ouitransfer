/**
 * Parse TRUST_PROXY env var into the type Fastify expects.
 *
 * Accepts:
 * - "true" / "false" → boolean
 * - "loopback", "linklocal", "uniquelocal" → string (Fastify keywords)
 * - A numeric string like "1" → number (hop count)
 * - A comma-separated list → string[] (CIDR ranges or keywords)
 * - A single CIDR or keyword → string passthrough
 */
export function parseTrustProxy(value: string): boolean | number | string | string[] {
  if (value === "true") return true;
  if (value === "false") return false;
  // Numeric hop count (e.g. "1" = trust 1 proxy hop)
  if (/^\d+$/.test(value)) return Number(value);
  if (value.includes(",")) return value.split(",").map((s) => s.trim());
  return value; // "loopback", "linklocal", "uniquelocal", or single CIDR
}
