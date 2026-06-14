/**
 * SSRF / host-allowlist guard.
 *
 * A small, reusable helper for validating that a URL (or bare host) does not
 * point at an internal, loopback, link-local, or cloud-metadata address before
 * the server connects to it. Used to harden every server-side egress that is
 * influenced by configuration or — in later batches — by federated-identity
 * discovery/token/userinfo endpoints and LDAP host strings (R4 reuses this).
 *
 * Design goals:
 * - General and exportable: callers pass the URL/host plus options.
 * - Conservative by default: private/loopback/link-local/metadata ranges are
 *   rejected unless an explicit allowlist entry (or an escape-hatch flag) opts
 *   them back in.
 * - No DNS resolution here. This validates the *literal* host. For hostnames the
 *   guard checks the literal value; callers that need DNS-rebinding protection
 *   should resolve and re-check the resolved IPs (out of scope for config-time
 *   validation, where the host is operator-controlled).
 */

/**
 * Cloud metadata service addresses that must never be reachable from
 * config-influenced server-side requests.
 */
const METADATA_HOSTS = new Set<string>([
  "169.254.169.254", // AWS / GCP / Azure / DigitalOcean IMDS
  "fd00:ec2::254", // AWS IMDSv2 over IPv6
  "metadata.google.internal", // GCP metadata DNS name
  "metadata", // common short alias
]);

export interface SsrfGuardOptions {
  /**
   * Explicit host allowlist. A host that matches an entry here is permitted even
   * if it would otherwise be rejected as private/loopback/link-local. Matching is
   * case-insensitive and exact on the hostname (no wildcard/suffix matching) —
   * keep it tight. Metadata hosts are NEVER allowlisted.
   */
  allowlist?: readonly string[];
  /**
   * Escape hatch: when true, allow private/loopback/link-local hosts wholesale.
   * Intended for self-hosted deployments where the storage/IdP lives on a private
   * network. Metadata hosts remain blocked regardless. Defaults to false.
   */
  allowPrivate?: boolean;
  /**
   * Require the URL scheme to be https. Used to enforce TLS in production.
   * Ignored when validating a bare host (no scheme). Defaults to false.
   */
  requireHttps?: boolean;
  /**
   * Allowed URL schemes (lowercased, without the trailing ":"). Defaults to
   * `["http", "https"]`. When `requireHttps` is set this is narrowed to https.
   */
  allowedSchemes?: readonly string[];
}

export class SsrfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfValidationError";
  }
}

/** Strip IPv6 brackets and zone id, lowercase. */
function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) {
    h = h.slice(1, -1);
  }
  // Strip IPv6 zone id (e.g. fe80::1%eth0)
  const zone = h.indexOf("%");
  if (zone !== -1) h = h.slice(0, zone);
  return h;
}

function isIpv4(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1, 5).map((o) => Number(o));
  if (octets.some((o) => o > 255)) return null;
  return octets;
}

/**
 * Whether an IPv4 address is in a private/loopback/link-local/reserved range
 * that must not be reachable from config-influenced server-side requests.
 */
function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16 (incl. metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast / reserved 224.0.0.0/4 + 240.0.0.0/4
  return false;
}

/**
 * Whether an IPv6 host string is loopback/link-local/unique-local/unspecified,
 * or an IPv4-mapped address that is itself private. Operates on the normalized
 * (bracket-stripped, lowercased) host.
 */
function isPrivateIpv6(host: string): boolean {
  if (!host.includes(":")) return false;
  if (host === "::1") return true; // loopback
  if (host === "::") return true; // unspecified
  if (host.startsWith("fe80")) return true; // link-local fe80::/10
  if (host.startsWith("fc") || host.startsWith("fd")) return true; // unique-local fc00::/7
  if (host.startsWith("ff")) return true; // multicast ff00::/8
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded IPv4.
  const mapped = host.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) {
    const octets = isIpv4(mapped[1]);
    if (octets && isPrivateIpv4(octets)) return true;
  }
  return false;
}

/**
 * Validate a bare host (no scheme). Throws {@link SsrfValidationError} when the
 * host is a metadata address, or a private/loopback/link-local address not
 * explicitly allowed.
 */
export function assertHostAllowed(rawHost: string, options: SsrfGuardOptions = {}): void {
  const host = normalizeHost(rawHost);
  if (!host) {
    throw new SsrfValidationError("Host is empty");
  }

  // Metadata endpoints are NEVER allowed, regardless of allowlist/allowPrivate.
  if (METADATA_HOSTS.has(host)) {
    throw new SsrfValidationError(
      `Host "${rawHost}" is a cloud metadata endpoint and is not permitted`,
    );
  }

  const allowlist = (options.allowlist ?? []).map((h) => normalizeHost(h));
  if (allowlist.includes(host)) {
    return; // explicitly allowed
  }

  if (options.allowPrivate) {
    return; // escape hatch (metadata already excluded above)
  }

  const ipv4 = isIpv4(host);
  if (ipv4) {
    if (isPrivateIpv4(ipv4)) {
      throw new SsrfValidationError(
        `Host "${rawHost}" resolves to a private/loopback/link-local address and is not permitted`,
      );
    }
    return;
  }

  if (isPrivateIpv6(host)) {
    throw new SsrfValidationError(
      `Host "${rawHost}" is a private/loopback/link-local IPv6 address and is not permitted`,
    );
  }

  // Hostnames that resolve to loopback by convention.
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new SsrfValidationError(`Host "${rawHost}" is a loopback hostname and is not permitted`);
  }
}

/**
 * Validate a full URL string. Parses the URL, enforces the scheme policy, then
 * runs {@link assertHostAllowed} on the hostname.
 *
 * @throws {SsrfValidationError} on a malformed URL, disallowed scheme, or
 *   private/loopback/link-local/metadata host.
 */
export function assertUrlAllowed(rawUrl: string, options: SsrfGuardOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfValidationError(`Invalid URL: "${rawUrl}"`);
  }

  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  const allowedSchemes = options.requireHttps
    ? ["https"]
    : (options.allowedSchemes ?? ["http", "https"]).map((s) => s.toLowerCase());

  if (!allowedSchemes.includes(scheme)) {
    throw new SsrfValidationError(
      options.requireHttps
        ? `URL "${rawUrl}" must use https`
        : `URL "${rawUrl}" uses an unsupported scheme "${scheme}"`,
    );
  }

  assertHostAllowed(url.hostname, options);
  return url;
}
