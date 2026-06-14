import crypto from "node:crypto";
import * as jose from "jose";

import { env } from "../../env.js";
import { UnauthorizedError } from "../../utils/app-error.js";

/**
 * Challenge-token signing key.
 *
 * Derived from `JWT_SECRET` via HKDF-SHA256 with a distinct `info` label, so it
 * is:
 *   - stable across process restarts and across instances behind a load balancer
 *     (a challenge minted by one instance verifies on any other), and
 *   - cryptographically independent of the main JWT signing key (domain
 *     separation — leaking one does not reveal the other).
 */
const CHALLENGE_SECRET = new Uint8Array(
  crypto.hkdfSync(
    "sha256",
    Buffer.from(env.JWT_SECRET, "utf8"),
    Buffer.alloc(0),
    Buffer.from("2fa-challenge-token", "utf8"),
    32,
  ),
);

/**
 * Fingerprint that binds a challenge to the client that initiated the password
 * step (defense-in-depth: a leaked challenge token is not usable from a
 * different IP/UA). Hashed so the raw values are not embedded in the token.
 */
function clientFingerprint(ipAddress: string, userAgent: string): string {
  return crypto.createHash("sha256").update(`${ipAddress}\n${userAgent}`).digest("hex");
}

/**
 * Create a short-lived challenge token after password verification.
 * Bound to the userId and (optionally) the initiating client's IP + UA.
 * TTL: 5 minutes.
 */
export async function createChallengeToken(
  userId: string,
  client?: { ipAddress: string; userAgent: string },
): Promise<string> {
  const builder = new jose.SignJWT({
    userId,
    purpose: "2fa-challenge",
    ...(client ? { fp: clientFingerprint(client.ipAddress, client.userAgent) } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m");

  return builder.sign(CHALLENGE_SECRET);
}

/**
 * Verify a challenge token and extract the userId.
 * Throws if expired, tampered, wrong purpose, or — when a fingerprint was bound
 * at creation — if the presenting client's IP/UA does not match.
 */
export async function verifyChallengeToken(
  token: string,
  client?: { ipAddress: string; userAgent: string },
): Promise<string> {
  const { payload } = await jose.jwtVerify(token, CHALLENGE_SECRET);
  if (payload.purpose !== "2fa-challenge") {
    throw new UnauthorizedError("Invalid challenge token");
  }
  if (typeof payload.userId !== "string") {
    throw new UnauthorizedError("Invalid challenge token");
  }
  // If the token carries a client fingerprint, it must match the presenting client.
  if (typeof payload.fp === "string") {
    if (!client) {
      throw new UnauthorizedError("Invalid challenge token");
    }
    const expected = clientFingerprint(client.ipAddress, client.userAgent);
    const a = Buffer.from(payload.fp);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new UnauthorizedError("Invalid challenge token");
    }
  }
  return payload.userId;
}
