/**
 * SSRF + transport-confidentiality guard for the LDAP/AD client (A5-05, A5-07,
 * A5-11).
 *
 * The LDAP `serverUrl` is admin-configured (PUT /admin/ldap/config) or supplied
 * directly to the connection test (POST /admin/ldap/test). Both are reachable by
 * anyone past the admin pre-validation, so the URL is attacker-influençable and
 * must be treated as untrusted before the server opens a socket to it.
 *
 * Two policies are enforced here, in one place, because both depend on whether
 * the target host is private/loopback:
 *
 *  1. Egress (A5-05/A5-11) — reject cloud-metadata, loopback, link-local, and
 *     private-range hosts unless `LDAP_ALLOW_PRIVATE_HOST=true` (the common
 *     self-hosted case: an internal domain controller on a trusted LAN) or the
 *     exact host is in `LDAP_ALLOWED_HOSTS`. Metadata hosts are NEVER allowed.
 *
 *  2. Transport confidentiality (A5-07) — the LDAP simple-bind sends the bind DN
 *     and bind password on the wire. For any *remote* (non-private, non-loopback)
 *     host we require an encrypted channel: either `ldaps://` (implicit TLS) or
 *     `ldap://` upgraded via StartTLS (`useTls: true`). Cleartext `ldap://`
 *     without StartTLS to a remote host is rejected, and `tlsSkipVerify` is
 *     forbidden for remote hosts (it disables certificate verification, which
 *     re-opens the MITM that TLS is meant to close). `tlsSkipVerify` remains a
 *     dev-only convenience for private/loopback targets and is warned about.
 *
 * Note: this validates the *literal* host. The DC host is operator-configured,
 * so DNS-rebinding is out of scope here (consistent with the OAuth egress guard).
 */

import { env } from "../../env.js";
import { AppError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import {
  assertHostAllowed,
  type SsrfGuardOptions,
  SsrfValidationError,
} from "../../utils/ssrf-guard.js";

const LDAP_SCHEMES = new Set(["ldap:", "ldaps:"]);

export interface LdapTransportInput {
  serverUrl: string;
  useTls: boolean;
  tlsSkipVerify?: boolean;
}

/** Build the SSRF guard options for LDAP egress from the environment. */
export function getLdapSsrfOptions(): SsrfGuardOptions {
  const allowPrivate = env.LDAP_ALLOW_PRIVATE_HOST === "true";
  const allowlist = (env.LDAP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return { allowPrivate, allowlist };
}

/**
 * Whether a literal host is private/loopback/link-local. Mirrors the predicates
 * in {@link assertHostAllowed} but returns a boolean instead of throwing, so the
 * transport policy can decide whether TLS is mandatory.
 *
 * Implemented by re-using {@link assertHostAllowed} with `allowPrivate: false`
 * (and no allowlist/metadata exemptions): if it throws, the host is private (or
 * metadata) and TLS is not mandated for confidentiality on a trusted LAN.
 */
function isPrivateOrLoopbackHost(host: string): boolean {
  try {
    assertHostAllowed(host, { allowPrivate: false });
    return false; // reachable as a public host → remote
  } catch (err) {
    if (err instanceof SsrfValidationError) return true;
    throw err;
  }
}

/**
 * Parse and validate an LDAP `serverUrl`, enforcing both the egress (SSRF) and
 * transport-confidentiality policies. Throws {@link AppError} (400) on any
 * violation. Returns the parsed URL and whether the host is remote.
 */
export function assertLdapTargetAllowed(input: LdapTransportInput): {
  url: URL;
  isRemote: boolean;
} {
  let url: URL;
  try {
    url = new URL(input.serverUrl);
  } catch {
    throw new AppError(400, "Invalid LDAP server URL", "LDAP_INVALID_SERVER_URL");
  }

  if (!LDAP_SCHEMES.has(url.protocol)) {
    throw new AppError(
      400,
      "LDAP server URL must use the ldap:// or ldaps:// scheme",
      "LDAP_INVALID_SCHEME",
    );
  }

  // ── Egress / SSRF (A5-05 / A5-11) ──────────────────────────────────────────
  try {
    assertHostAllowed(url.hostname, getLdapSsrfOptions());
  } catch (err) {
    if (err instanceof SsrfValidationError) {
      getLogger().warn(
        { host: url.hostname },
        "Rejected LDAP target as private/metadata host (set LDAP_ALLOW_PRIVATE_HOST=true to opt in)",
      );
      throw new AppError(
        400,
        "LDAP server host is not permitted (private, loopback, link-local, or metadata address). Set LDAP_ALLOW_PRIVATE_HOST=true to connect to an internal directory server.",
        "LDAP_HOST_NOT_ALLOWED",
      );
    }
    throw err;
  }

  // After the egress check passes, classify the host for the transport policy.
  // (A host inside a private range only reaches here when explicitly opted in.)
  const isRemote = !isPrivateOrLoopbackHost(url.hostname);

  // ── Transport confidentiality (A5-07) ──────────────────────────────────────
  const isLdaps = url.protocol === "ldaps:";
  const hasEncryptedChannel = isLdaps || input.useTls; // ldaps:// or StartTLS

  if (isRemote) {
    if (!hasEncryptedChannel) {
      throw new AppError(
        400,
        "Cleartext ldap:// to a remote host is not allowed — the bind credentials would be exposed on the wire. Use ldaps:// or enable StartTLS (useTls).",
        "LDAP_CLEARTEXT_REMOTE",
      );
    }
    if (input.tlsSkipVerify) {
      throw new AppError(
        400,
        "tlsSkipVerify disables certificate verification and is only permitted for private/loopback hosts. It must not be used with a remote directory server.",
        "LDAP_SKIP_VERIFY_REMOTE",
      );
    }
  } else if (input.tlsSkipVerify) {
    // Permitted for private/loopback (self-signed internal CA), but warn loudly.
    getLogger().warn(
      { host: url.hostname },
      "LDAP tlsSkipVerify is enabled — certificate verification is OFF. This is acceptable only for a private/internal directory server with a self-signed certificate.",
    );
  }

  return { url, isRemote };
}
