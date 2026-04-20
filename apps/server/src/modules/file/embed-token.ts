import crypto from "node:crypto";
import * as jose from "jose";

// Separate secret for embed tokens (not the main JWT secret).
// Generated once at module load — survives process lifetime.
// Regenerated on restart, which invalidates existing embed tokens (24h TTL).
const EMBED_SECRET = new TextEncoder().encode(
  crypto.randomBytes(32).toString("hex")
);

/**
 * Create a signed embed token for a specific file within a share.
 * Contains fileId + shareId, bound to embed purpose.
 * TTL: 24 hours.
 */
export async function createEmbedToken(fileId: string, shareId: string): Promise<string> {
  return new jose.SignJWT({ fileId, shareId, purpose: "embed" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(EMBED_SECRET);
}

/**
 * Verify an embed token and extract the fileId + shareId.
 * Throws if expired, tampered, or wrong purpose.
 */
export async function verifyEmbedToken(token: string): Promise<{ fileId: string; shareId: string }> {
  const { payload } = await jose.jwtVerify(token, EMBED_SECRET);
  if (payload.purpose !== "embed") {
    throw new Error("Invalid embed token");
  }
  return { fileId: payload.fileId as string, shareId: payload.shareId as string };
}
