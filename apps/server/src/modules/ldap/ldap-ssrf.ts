/**
 * SSRF + transport-confidentiality guard for the LDAP/AD client (A5-05, A5-07,
 * A5-11).
 *
 * The LDAP `serverUrl` is admin-configured (PUT /admin/ldap/config) or supplied
 * directly to the connection test (POST /admin/ldap/test). Both are reachable by
 * anyone past the admin pre-validation, so the URL is attacker-influençable and
 * must be validated before the server opens a socket to it.
 *
 * Policy (owner-decided: the admin chooses the directory server and its
 * transport — connecting to an internal domain controller on a private LAN is
 * the normal, expected case). This guard therefore:
 *
 *  1. Egress (A5-05/A5-11) — blocks ONLY cloud-metadata addresses
 *     (169.254.169.254 et al.). Private/loopback/link-local and public hosts are
 *     ALLOWED BY DEFAULT. `LDAP_ALLOWED_HOSTS` is an OPTIONAL lockdown: when set,
 *     the target host must be an exact match in that allowlist (and private hosts
 *     are then re-blocked unless allowlisted). Metadata hosts are NEVER allowed.
 *
 *  2. Transport confidentiality (A5-07) — WARN, never block. The LDAP simple-bind
 *     sends the bind DN and password on the wire. When a remote host is used over
 *     cleartext `ldap://` without StartTLS, or when `tlsSkipVerify` disables
 *     certificate verification, we log a warning recommending ldaps:// / StartTLS
 *     / proper certs. The admin is free to proceed; the LDAP client honors the
 *     configured `useTls`/`tlsSkipVerify`/scheme exactly.
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

/**
 * Build the SSRF guard options for LDAP egress from the environment.
 *
 * Default: only cloud-metadata addresses are blocked (`allowPrivate: true`) —
 * an internal domain controller on a private LAN is the normal case. When
 * `LDAP_ALLOWED_HOSTS` is set it becomes an opt-in lockdown: the target host
 * must match the exact-host allowlist, and private hosts are re-blocked unless
 * explicitly listed.
 */
export function getLdapSsrfOptions(): SsrfGuardOptions {
  const allowlist = (env.LDAP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (allowlist.length > 0) {
    return { allowlist, allowPrivate: false };
  }
  return { allowPrivate: true };
}

/**
 * Whether a literal host is private/loopback/link-local. Mirrors the predicates
 * in {@link assertHostAllowed} but returns a boolean instead of throwing, so the
 * transport policy can decide whether a confidentiality warning is warranted.
 *
 * Implemented by re-using {@link assertHostAllowed} with `allowPrivate: false`
 * (and no allowlist/metadata exemptions): if it throws, the host is private (or
 * metadata) and a cleartext bind to it does not leak credentials off the LAN.
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
 * Parse and validate an LDAP `serverUrl`. Enforces the scheme and the
 * metadata-only egress policy (throws {@link AppError} 400 on violation), then
 * WARNS (never blocks) on weak transport. Returns the parsed URL and whether the
 * host is remote.
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
  // Block only cloud-metadata hosts by default; private/remote hosts are the
  // admin's choice. An optional LDAP_ALLOWED_HOSTS lockdown tightens this.
  try {
    assertHostAllowed(url.hostname, getLdapSsrfOptions());
  } catch (err) {
    if (err instanceof SsrfValidationError) {
      getLogger().warn({ host: url.hostname }, "Rejected LDAP target as a disallowed host");
      throw new AppError(
        400,
        "LDAP server host is not permitted (cloud metadata address, or not in LDAP_ALLOWED_HOSTS).",
        "LDAP_HOST_NOT_ALLOWED",
      );
    }
    throw err;
  }

  const isRemote = !isPrivateOrLoopbackHost(url.hostname);

  // ── Transport confidentiality (A5-07) — WARN, never block ───────────────────
  // The admin decides on transport; we only surface the risk in the logs.
  const isLdaps = url.protocol === "ldaps:";
  const hasEncryptedChannel = isLdaps || input.useTls; // ldaps:// or StartTLS

  if (isRemote && !hasEncryptedChannel) {
    getLogger().warn(
      { host: url.hostname },
      "LDAP is using cleartext ldap:// to a remote host without StartTLS — the bind credentials travel unencrypted. Recommend ldaps:// or enabling StartTLS (useTls).",
    );
  }
  if (input.tlsSkipVerify) {
    getLogger().warn(
      { host: url.hostname },
      "LDAP tlsSkipVerify is enabled — certificate verification is OFF, exposing the connection to MITM. Recommend installing the directory server's CA and disabling tlsSkipVerify.",
    );
  }

  return { url, isRemote };
}
