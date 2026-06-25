/**
 * Browser-bound, single-use OAuth flow state (A5-03 / A5-09).
 *
 * The OAuth `state`, `nonce`, PKCE `code_verifier`, and post-login return path are
 * all generated server-side and sealed into a short-lived, signed httpOnly cookie
 * that is set on the `/authorize` redirect. On callback the cookie is read,
 * verified, and IMMEDIATELY cleared (single-use), and its embedded `state` is
 * compared against the `state` echoed back by the IdP.
 *
 * Why a signed cookie instead of an in-memory map:
 *   - binds the flow to the originating browser (the map keyed by `state` alone
 *     was vulnerable to login-CSRF — a victim could be forced into the attacker's
 *     flow), and
 *   - is stateless, so it survives across instances behind a load balancer
 *     (fixes A5-09) and cannot be pre-seeded to grow unbounded.
 *
 * The signing key is derived from `JWT_SECRET` via HKDF with a distinct purpose
 * label, so it is stable across restarts/instances and cryptographically
 * independent of the main JWT key (same pattern as the 2FA challenge token).
 */

import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import * as jose from "jose";

import { env } from "../../env.js";
import { UnauthorizedError } from "../../utils/app-error.js";

export const OAUTH_STATE_COOKIE_NAME = "oauth_flow";
/** 10-minute flow lifetime — matches the previous in-memory TTL. */
const OAUTH_STATE_TTL_SECONDS = 600;

const OAUTH_STATE_SECRET = new Uint8Array(
  crypto.hkdfSync(
    "sha256",
    Buffer.from(env.JWT_SECRET, "utf8"),
    Buffer.alloc(0),
    Buffer.from("oauth-flow-state", "utf8"),
    32,
  ),
);

export interface OAuthFlowState {
  /** Provider name this flow was initiated for — must match the callback provider. */
  providerName: string;
  /** Server-generated `state` echoed back by the IdP. */
  state: string;
  /** Server-generated `nonce` the OIDC id_token must carry. */
  nonce: string;
  /** PKCE code verifier. */
  codeVerifier: string;
  /** Relative-only post-login return path (e.g. "/dashboard"). Never absolute. */
  returnPath: string;
}

/**
 * Sign the flow state into a JWT and set it as a signed httpOnly cookie.
 * `sameSite` mirrors the access-token cookie so the cookie survives the top-level
 * navigation back from the IdP (lax under https; strict otherwise).
 */
export async function setOAuthFlowCookie(
  reply: FastifyReply,
  state: OAuthFlowState,
): Promise<void> {
  const token = await new jose.SignJWT({
    providerName: state.providerName,
    state: state.state,
    nonce: state.nonce,
    codeVerifier: state.codeVerifier,
    returnPath: state.returnPath,
    purpose: "oauth-flow",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_STATE_TTL_SECONDS}s`)
    .sign(OAUTH_STATE_SECRET);

  const isSecure = env.SECURE_SITE === "true";
  reply.setCookie(OAUTH_STATE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? "lax" : "strict",
    path: "/api/auth/providers",
    maxAge: OAUTH_STATE_TTL_SECONDS,
    signed: false, // integrity comes from the HMAC-signed JWT itself
  });
}

/** Clear the flow cookie (single-use enforcement and on terminal errors). */
export function clearOAuthFlowCookie(reply: FastifyReply): void {
  reply.clearCookie(OAUTH_STATE_COOKIE_NAME, { path: "/api/auth/providers" });
}

/**
 * Read, verify, and CONSUME the flow cookie. The cookie is cleared on `reply`
 * before any validation result is returned, guaranteeing single-use. Throws
 * {@link UnauthorizedError} when the cookie is missing, tampered, expired, for a
 * different provider, or when the embedded `state` does not match the callback
 * `state`.
 *
 * `jose.jwtVerify` enforces `exp`, so an expired flow is rejected at validation
 * time (closing the A5-03 "expiry only enforced by sweep" gap).
 */
export async function consumeOAuthFlowCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  expected: { providerName: string; state: string },
): Promise<OAuthFlowState> {
  // Single-use: clear first, so even a failed/replayed callback burns the cookie.
  clearOAuthFlowCookie(reply);

  const cookies = request.cookies as Record<string, string | undefined>;
  const token = cookies[OAUTH_STATE_COOKIE_NAME];
  if (!token) {
    throw new UnauthorizedError("Invalid or expired state");
  }

  let payload: jose.JWTPayload;
  try {
    const result = await jose.jwtVerify(token, OAUTH_STATE_SECRET);
    payload = result.payload;
  } catch {
    throw new UnauthorizedError("Invalid or expired state");
  }

  if (payload.purpose !== "oauth-flow") {
    throw new UnauthorizedError("Invalid or expired state");
  }
  if (typeof payload.state !== "string" || typeof payload.nonce !== "string") {
    throw new UnauthorizedError("Invalid or expired state");
  }
  if (
    typeof payload.codeVerifier !== "string" ||
    typeof payload.returnPath !== "string" ||
    typeof payload.providerName !== "string"
  ) {
    throw new UnauthorizedError("Invalid or expired state");
  }

  // Provider binding: the cookie must have been issued for this provider.
  if (payload.providerName !== expected.providerName) {
    throw new UnauthorizedError("Invalid or expired state");
  }

  // Constant-time comparison of the callback `state` against the cookie value.
  const a = Buffer.from(payload.state);
  const b = Buffer.from(expected.state);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new UnauthorizedError("Invalid or expired state");
  }

  return {
    providerName: payload.providerName,
    state: payload.state,
    nonce: payload.nonce,
    codeVerifier: payload.codeVerifier,
    returnPath: payload.returnPath,
  };
}
