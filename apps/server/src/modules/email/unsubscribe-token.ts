import crypto from "node:crypto";

import { env } from "../../env.js";
import { ValidationError } from "../../utils/app-error.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** HMAC sub-key derivation label for unsubscribe tokens. */
export const UNSUBSCRIBE_KEY_LABEL = "unsubscribe";

/** Unsubscribe token expiry in seconds: 90 days. */
const UNSUBSCRIBE_TOKEN_EXPIRY_SECONDS = 90 * 24 * 60 * 60;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Derives a purpose-specific HMAC key from the global JWT_SECRET.
 * This prevents cross-purpose token reuse (e.g. an auth JWT being
 * accepted as an unsubscribe token).
 */
function deriveKey(label: string): Buffer {
  return crypto.createHmac("sha256", env.JWT_SECRET).update(label).digest();
}

/** Base64url encode (no padding). */
function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a compact HS256 JWT token for unsubscribe links.
 * Uses Node's native crypto — the token format is standard JWT.
 *
 * The token includes both `iat` (issued-at) and `exp` (expiry) claims.
 * `iat` is informational only — useful for debugging and audit trails but NOT
 * enforced during verification. Only `exp` is checked for token validity.
 * Since the token is HMAC-signed, `iat` cannot be forged without the key.
 *
 * // TECH DEBT: Hand-rolled HMAC JWT. Migrate to 'jose' library if key rotation, RS256,
 * // audience checks, or token revocation are needed.
 */
export function signUnsubscribeToken(payload: { userId: string; type: string }): string {
  const key = deriveKey(UNSUBSCRIBE_KEY_LABEL);
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(
    JSON.stringify({
      ...payload,
      iat: now, // Informational only — not enforced during verification (see verifyUnsubscribeToken)
      exp: now + UNSUBSCRIBE_TOKEN_EXPIRY_SECONDS,
    }),
  );

  const signature = base64url(
    crypto.createHmac("sha256", key).update(`${header}.${body}`).digest(),
  );

  return `${header}.${body}.${signature}`;
}

/**
 * Verifies a stateless unsubscribe JWT token.
 * Validates the HS256 algorithm header to prevent algorithm confusion attacks.
 *
 * @returns Decoded payload { userId, type }
 * @throws ValidationError if token is invalid, malformed, or expired
 */
export function verifyUnsubscribeToken(token: string): { userId: string; type: string } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new ValidationError("Invalid unsubscribe token");
  }

  const [headerB64, body, signature] = parts;

  // Validate algorithm header to prevent algorithm confusion attacks
  let headerObj: Record<string, unknown>;
  try {
    headerObj = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Invalid unsubscribe token");
  }
  if (headerObj.alg !== "HS256") {
    throw new ValidationError("Invalid unsubscribe token");
  }

  // Verify signature
  const key = deriveKey(UNSUBSCRIBE_KEY_LABEL);
  const expectedSig = crypto
    .createHmac("sha256", key)
    .update(`${headerB64}.${body}`)
    .digest("base64url");

  // Constant-time comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expectedSig, "base64url");

  if (sigBuffer.length !== expectedBuffer.length) {
    throw new ValidationError("Invalid unsubscribe token");
  }

  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    throw new ValidationError("Invalid unsubscribe token");
  }

  // Decode payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Invalid unsubscribe token");
  }

  // Check expiry
  // iat is informational. Since the token is HMAC-signed, iat cannot be forged without the key.
  // We only validate exp for token expiry.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) {
    throw new ValidationError("Unsubscribe token has expired");
  }

  // Validate required fields
  if (typeof payload.userId !== "string" || typeof payload.type !== "string") {
    throw new ValidationError("Invalid unsubscribe token");
  }

  return { userId: payload.userId, type: payload.type };
}
