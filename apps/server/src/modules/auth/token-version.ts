import type { FastifyRequest } from "fastify";

import { prisma } from "../../shared/prisma.js";

/**
 * In-memory cache for tokenVersion lookups.
 * Key: userId, Value: { tokenVersion, cachedAt }.
 * TTL: 30 seconds — balances DB load vs. revocation latency.
 */
const TOKEN_VERSION_CACHE = new Map<string, { tokenVersion: number; cachedAt: number }>();
const CACHE_TTL_MS = 30_000;

/**
 * Trusted callback for @fastify/jwt.
 *
 * Called automatically on every `request.jwtVerify()`. If it returns `false`,
 * the plugin rejects the token with a 401 "Untrusted token" error.
 *
 * Checks the JWT's `tokenVersion` claim against the current value in the DB
 * (with a short TTL cache to avoid per-request queries).
 */
export async function validateTokenVersion(
  _request: FastifyRequest,
  decodedToken: { userId?: string; tokenVersion?: number },
): Promise<boolean> {
  // Tokens without tokenVersion are legacy tokens issued before this feature.
  // Reject them — the user must re-authenticate to get a token with tokenVersion.
  if (typeof decodedToken.tokenVersion !== "number" || typeof decodedToken.userId !== "string") {
    return false;
  }

  const { userId, tokenVersion } = decodedToken;

  // Check cache first
  const cached = TOKEN_VERSION_CACHE.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.tokenVersion === tokenVersion;
  }

  // Cache miss or stale — query DB
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true },
  });

  if (!user) {
    // User deleted — reject token
    TOKEN_VERSION_CACHE.delete(userId);
    return false;
  }

  // Update cache
  TOKEN_VERSION_CACHE.set(userId, {
    tokenVersion: user.tokenVersion,
    cachedAt: Date.now(),
  });

  return user.tokenVersion === tokenVersion;
}

/**
 * Invalidate the cached tokenVersion for a user.
 * Call this after incrementing tokenVersion in the DB so that the next
 * jwtVerify sees the updated value immediately (within the same process).
 */
export function invalidateTokenVersionCache(userId: string): void {
  TOKEN_VERSION_CACHE.delete(userId);
}

/**
 * Increment a user's tokenVersion and invalidate the cache.
 * Use after security-sensitive operations (password change, 2FA toggle, etc.).
 */
export async function incrementTokenVersion(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
  invalidateTokenVersionCache(userId);
}
