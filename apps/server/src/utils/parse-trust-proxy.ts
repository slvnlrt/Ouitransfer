/**
 * Parse TRUST_PROXY env var into the type Fastify expects.
 *
 * Accepts:
 * - "true" / "false" → boolean
 * - "loopback", "linklocal", "uniquelocal" → string (Fastify keywords)
 * - A numeric string like "1" → number (hop count)
 * - A comma-separated list → string[] (CIDR ranges or keywords)
 * - A single CIDR or keyword → string passthrough
 *
 * A8-08 — SECURITY: `TRUST_PROXY=true` makes Fastify trust `X-Forwarded-For` from
 * ANY upstream. That is only safe when the server has NO directly-reachable host
 * port (i.e. a reverse proxy is the sole ingress); otherwise a client connecting
 * directly with a forged `X-Forwarded-For` controls `request.ip` and bypasses the
 * per-route rate limits (and poisons audit IPs). Prefer a specific proxy CIDR
 * (e.g. "172.18.0.0/16") over "true". The default (`loopback`) is the safe choice
 * for the direct-port compose, which publishes 3333 to the host.
 */
export function parseTrustProxy(value: string): boolean | number | string | string[] {
  if (value === "true") return true;
  if (value === "false") return false;
  // Numeric hop count (e.g. "1" = trust 1 proxy hop)
  if (/^\d+$/.test(value)) return Number(value);
  if (value.includes(",")) return value.split(",").map((s) => s.trim());
  return value; // "loopback", "linklocal", "uniquelocal", or single CIDR
}
