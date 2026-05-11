import crypto from "node:crypto";
import * as jose from "jose";

import { UnauthorizedError } from "../../utils/app-error.js";

// Separate secret for challenge tokens (not the main JWT secret).
// Generated once at module load — survives process lifetime.
// Regenerated on restart, which is acceptable for short-lived tokens.
const CHALLENGE_SECRET = new TextEncoder().encode(crypto.randomBytes(32).toString("hex"));

/**
 * Create a short-lived challenge token after password verification.
 * Contains userId, bound to the password step.
 * TTL: 5 minutes.
 */
export async function createChallengeToken(userId: string): Promise<string> {
  return new jose.SignJWT({ userId, purpose: "2fa-challenge" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(CHALLENGE_SECRET);
}

/**
 * Verify a challenge token and extract the userId.
 * Throws if expired, tampered, or wrong purpose.
 */
export async function verifyChallengeToken(token: string): Promise<string> {
  const { payload } = await jose.jwtVerify(token, CHALLENGE_SECRET);
  if (payload.purpose !== "2fa-challenge") {
    throw new UnauthorizedError("Invalid challenge token");
  }
  return payload.userId as string;
}
