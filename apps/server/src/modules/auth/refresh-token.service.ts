import crypto from "node:crypto";

import { prisma } from "../../shared/prisma.js";
import { UnauthorizedError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";

/** Refresh token expiry: 7 days */
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Create a new refresh token for a user.
 * The token is a cryptographically random base64url string (not a JWT).
 */
export async function createRefreshToken(
  userId: string,
  userAgent?: string,
  ipAddress?: string,
): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");

  await prisma.refreshToken.create({
    data: {
      token,
      userId,
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    },
  });

  return token;
}

/**
 * Rotate a refresh token: validate the old one, revoke it, and issue a new one.
 *
 * If the old token was already revoked, this is a replay attack — revoke the
 * entire token chain for this user and throw.
 *
 * Returns the new refresh token string and the userId (for issuing a new access token).
 */
export async function rotateRefreshToken(oldTokenValue: string): Promise<{
  refreshToken: string;
  userId: string;
  tokenVersion: number;
  isAdmin: boolean;
}> {
  const oldToken = await prisma.refreshToken.findUnique({
    where: { token: oldTokenValue },
    include: { user: { select: { id: true, tokenVersion: true, isAdmin: true, isActive: true } } },
  });

  if (!oldToken) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  // Replay detection: if this token was already revoked, revoke ALL tokens for this user.
  if (oldToken.revokedAt) {
    getLogger().warn(
      { userId: oldToken.userId, tokenId: oldToken.id },
      "Refresh token replay detected — revoking all tokens for user",
    );
    await revokeAllUserTokens(oldToken.userId);
    throw new UnauthorizedError("Refresh token reuse detected");
  }

  // Check expiration
  if (oldToken.expiresAt < new Date()) {
    throw new UnauthorizedError("Refresh token expired");
  }

  // Check user is still active
  if (!oldToken.user.isActive) {
    await revokeAllUserTokens(oldToken.userId);
    throw new UnauthorizedError("Account is inactive");
  }

  // Generate new token
  const newTokenValue = crypto.randomBytes(32).toString("base64url");

  // Atomically revoke the old token (only if still active) and create the new one.
  // The conditional updateMany prevents a TOCTOU race: two concurrent requests
  // with the same valid token both passing the revokedAt check above.
  const revoked = await prisma.refreshToken.updateMany({
    where: { id: oldToken.id, revokedAt: null },
    data: { revokedAt: new Date(), replacedBy: newTokenValue },
  });

  if (revoked.count === 0) {
    // Another request rotated this token first — treat as replay
    getLogger().warn(
      { userId: oldToken.userId, tokenId: oldToken.id },
      "Refresh token rotation race detected — revoking all tokens for user",
    );
    await revokeAllUserTokens(oldToken.userId);
    throw new UnauthorizedError("Refresh token reuse detected");
  }

  // Create the new token
  const newToken = await prisma.refreshToken.create({
    data: {
      token: newTokenValue,
      userId: oldToken.userId,
      userAgent: oldToken.userAgent,
      ipAddress: oldToken.ipAddress,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    },
  });

  return {
    refreshToken: newToken.token,
    userId: oldToken.user.id,
    tokenVersion: oldToken.user.tokenVersion,
    isAdmin: oldToken.user.isAdmin,
  };
}

/**
 * Revoke all refresh tokens for a user.
 * Called on password change, account lock, or replay detection.
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Cleanup expired refresh tokens.
 * Deletes tokens that expired more than 24 hours ago.
 * Revoked tokens within the 24h window are kept for replay detection.
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}
