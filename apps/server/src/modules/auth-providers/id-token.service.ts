/**
 * OIDC id_token verification (A5-01).
 *
 * For OIDC providers the signed `id_token` — NOT the userinfo HTTP body — is the
 * authoritative source of identity. This module fetches the provider JWKS (from
 * the discovery document's `jwks_uri`) and verifies the id_token with `jose`:
 *
 *   - signature against the provider's published asymmetric keys;
 *   - an asymmetric `alg` allowlist (RS/PS/ES/EdDSA) — `none` and the HS* family
 *     are rejected outright, defeating alg-confusion (an attacker cannot sign with
 *     the public key as an HMAC secret);
 *   - `iss` === the configured issuer;
 *   - `aud` includes the configured client_id;
 *   - `exp` / `iat` (clock-skew-tolerant, enforced by jose);
 *   - `nonce` === the value bound to this flow (replay/binding defence, A5-03).
 *
 * The JWKS is fetched through the SSRF-guarded egress ({@link ssrfSafeFetch}) and
 * built into a local key set with `jose.createLocalJWKSet`. Fetching it ourselves
 * (rather than via jose's `createRemoteJWKSet`, which in the Node runtime uses
 * `http.get` and bypasses our guard) guarantees EVERY JWKS request — initial and
 * on key rotation — passes the SSRF policy.
 */

import * as jose from "jose";

import { UnauthorizedError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { ssrfSafeFetch } from "./oauth-ssrf.js";

/**
 * Asymmetric signature algorithms accepted for an id_token. HS* (symmetric) and
 * `none` are deliberately excluded: an HS-signed token verified against a JWKS
 * public key is the classic alg-confusion attack, and `none` is unsigned.
 */
const ALLOWED_ID_TOKEN_ALGS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
] as const;

type LocalJWKSet = ReturnType<typeof jose.createLocalJWKSet>;

interface CachedJwks {
  keySet: LocalJWKSet;
  fetchedAt: number;
}

/** Per-jwks_uri cache with a short TTL; refreshed on miss or on key-not-found. */
const jwksCache = new Map<string, CachedJwks>();
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchJwks(jwksUri: string): Promise<LocalJWKSet> {
  // ssrfSafeFetch validates the host (metadata/private/loopback rejected) and
  // enforces https in production before connecting.
  const response = await ssrfSafeFetch(jwksUri, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new UnauthorizedError("Failed to fetch provider JWKS");
  }
  const jwks = (await response.json()) as jose.JSONWebKeySet;
  const keySet = jose.createLocalJWKSet(jwks);
  jwksCache.set(jwksUri, { keySet, fetchedAt: Date.now() });
  return keySet;
}

async function getJwks(jwksUri: string, forceRefresh = false): Promise<LocalJWKSet> {
  const cached = jwksCache.get(jwksUri);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.keySet;
  }
  return fetchJwks(jwksUri);
}

export interface VerifiedIdToken {
  /** Immutable subject identifier (`sub`). */
  sub: string;
  /** Asserted email, if present. */
  email?: string;
  /** Whether the IdP marked the email as verified. Defaults to false when absent. */
  emailVerified: boolean;
  /** All verified claims, for downstream field extraction. */
  claims: jose.JWTPayload & Record<string, unknown>;
}

export interface VerifyIdTokenParams {
  idToken: string;
  /** Configured issuer (the provider `issuerUrl`). Compared against the token `iss`. */
  issuer: string;
  /** Configured OAuth client_id. Must appear in the token `aud`. */
  audience: string;
  /** `jwks_uri` from the provider discovery document. */
  jwksUri: string;
  /** The nonce bound to this flow; the token `nonce` must equal it. */
  expectedNonce: string;
}

function normalizeIssuer(issuer: string): string {
  // OIDC issuers are compared exactly per the discovery contract, but providers
  // are inconsistent about a trailing slash. Strip it on both sides so
  // "https://idp.example" and "https://idp.example/" are treated as equal.
  return issuer.replace(/\/+$/, "");
}

function asEmailVerified(value: unknown): boolean {
  // Some IdPs send the claim as a JSON boolean, others as the string "true".
  return value === true || value === "true";
}

/**
 * Verify an OIDC id_token end-to-end. Throws {@link UnauthorizedError} on any
 * failure (bad signature, wrong alg, iss/aud mismatch, expiry, nonce mismatch).
 */
export async function verifyIdToken(params: VerifyIdTokenParams): Promise<VerifiedIdToken> {
  const { idToken, issuer, audience, jwksUri, expectedNonce } = params;

  if (!idToken) {
    throw new UnauthorizedError("Missing id_token from OIDC provider");
  }
  if (!jwksUri) {
    throw new UnauthorizedError("OIDC provider did not publish a jwks_uri");
  }

  const verifyOptions = {
    algorithms: [...ALLOWED_ID_TOKEN_ALGS],
    issuer: normalizeIssuer(issuer),
    audience,
  };

  let payload: jose.JWTPayload;
  try {
    const jwks = await getJwks(jwksUri);
    const result = await jose.jwtVerify(idToken, jwks, verifyOptions);
    payload = result.payload;
  } catch (err) {
    // A signing-key rotation can produce a "no matching key" error against the
    // cached set — refresh the JWKS once and retry before giving up.
    if (err instanceof jose.errors.JWKSNoMatchingKey) {
      try {
        const refreshed = await getJwks(jwksUri, true);
        const result = await jose.jwtVerify(idToken, refreshed, verifyOptions);
        payload = result.payload;
      } catch (retryErr) {
        getLogger().warn(
          { reason: retryErr instanceof Error ? retryErr.name : "unknown" },
          "OIDC id_token verification failed",
        );
        throw new UnauthorizedError("id_token verification failed");
      }
    } else {
      // Never log the raw token; a verification failure is reported generically.
      getLogger().warn(
        { reason: err instanceof Error ? err.name : "unknown" },
        "OIDC id_token verification failed",
      );
      throw new UnauthorizedError("id_token verification failed");
    }
  }

  // Nonce binding (A5-03): the token must carry the nonce we generated server-side
  // for this exact flow.
  if (typeof payload.nonce !== "string" || payload.nonce !== expectedNonce) {
    getLogger().warn("OIDC id_token nonce mismatch");
    throw new UnauthorizedError("id_token nonce mismatch");
  }

  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new UnauthorizedError("id_token missing subject");
  }

  const email = typeof payload.email === "string" ? payload.email : undefined;

  return {
    sub: payload.sub,
    email,
    emailVerified: asEmailVerified((payload as Record<string, unknown>).email_verified),
    claims: payload as jose.JWTPayload & Record<string, unknown>,
  };
}

/** Clear the JWKS cache — test hook only. */
export function __clearJwksCacheForTest(): void {
  jwksCache.clear();
}
