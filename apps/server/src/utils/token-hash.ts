import crypto from "node:crypto";

/**
 * Hashes a token using SHA-256.
 * Used for password reset tokens: the raw token is sent to the user via email,
 * but only the hash is stored in the database. On verification, the incoming
 * token is hashed and compared against the stored hash.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
