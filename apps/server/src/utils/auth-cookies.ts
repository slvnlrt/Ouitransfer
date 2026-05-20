/**
 * Shared auth cookie utilities.
 *
 * Centralises the logic for setting and clearing the two httpOnly cookies
 * used by every authentication flow (password login, 2FA, OIDC callback,
 * token refresh, and first-user auto-login).
 *
 * Cookie design recap:
 *   - `token`         — short-lived JWT access token; SIGNED by @fastify/cookie
 *                       so @fastify/jwt can verify integrity via unsignCookie().
 *                       No maxAge — it is a session cookie that expires when the
 *                       JWT `exp` claim elapses (15 min).
 *   - `refresh_token` — opaque DB-backed refresh token; NOT signed (integrity
 *                       is guaranteed by the DB record lookup, not cookie HMAC).
 *                       Has a 7-day maxAge and is scoped to /api/auth/refresh.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import {
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_PATH,
  REFRESH_TOKEN_MAX_AGE,
} from "../config/auth.config.js";
import { env } from "../env.js";
import { createRefreshToken } from "../modules/auth/refresh-token.service.js";

/** Tokens needed to issue a full auth cookie pair. */
export interface AuthTokens {
  /** Signed JWT access token string. */
  accessToken: string;
  /** Opaque refresh token string (as stored in the DB). */
  refreshToken: string;
}

/**
 * Set the two httpOnly auth cookies on `reply`.
 *
 * This is the single source of truth for cookie options. Any change to
 * cookie names, paths, security flags, or maxAge should be made here.
 */
export function setAuthCookies(reply: FastifyReply, tokens: AuthTokens): void {
  const isSecure = env.SECURE_SITE === "true";

  // Access-token cookie — session-scoped (no maxAge), signed.
  // sameSite is "strict" in non-HTTPS environments to compensate for the
  // lack of the Secure flag; in HTTPS environments "lax" is sufficient and
  // allows top-level navigation redirects (e.g. OIDC callback) to carry it.
  reply.setCookie("token", tokens.accessToken, {
    httpOnly: true,
    path: "/",
    secure: isSecure,
    sameSite: isSecure ? "lax" : "strict",
    signed: true,
  });

  // Refresh-token cookie — 7-day maxAge, NOT signed, scoped to the refresh endpoint.
  reply.setCookie(REFRESH_TOKEN_COOKIE_NAME, tokens.refreshToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: REFRESH_TOKEN_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_MAX_AGE,
    signed: false,
  });
}

/**
 * Clear both auth cookies (used on logout).
 *
 * Paths must match those used when the cookies were set, otherwise the
 * browser will not remove them.
 */
export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie("token", { path: "/" });
  reply.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: REFRESH_TOKEN_COOKIE_PATH });
}

/**
 * Extract client IP address and user-agent from a Fastify request.
 *
 * Respects `x-real-ip` and `x-user-agent` proxy headers (set by Nginx /
 * Caddy reverse proxies) so that audit logs record the actual client rather
 * than the proxy address.
 */
export function getClientInfo(request: FastifyRequest): {
  ipAddress: string;
  userAgent: string;
} {
  const realIP = request.headers["x-real-ip"] as string | undefined;
  const realUserAgent = request.headers["x-user-agent"] as string | undefined;

  const userAgent = realUserAgent || (request.headers["user-agent"] as string | undefined) || "";
  const ipAddress = realIP || request.ip || request.socket.remoteAddress || "";

  return { userAgent, ipAddress };
}

/**
 * Sign a JWT and issue auth cookies (access token + refresh token).
 *
 * Shared by the login, 2FA-login, OIDC callback, and first-user auto-login flows.
 */
export async function signAndSetCookies(
  reply: FastifyReply,
  user: { id: string; isAdmin: boolean; tokenVersion: number },
  userAgent: string,
  ipAddress: string,
): Promise<void> {
  const accessToken = await reply.jwtSign({
    userId: user.id,
    isAdmin: user.isAdmin,
    tokenVersion: user.tokenVersion,
  });
  const refreshToken = await createRefreshToken(user.id, userAgent, ipAddress);
  setAuthCookies(reply, { accessToken, refreshToken });
}
