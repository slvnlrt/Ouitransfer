import crypto from "node:crypto";
import * as jose from "jose";
import { prisma } from "../../shared/prisma.js";
import { UnauthorizedError } from "../../utils/app-error.js";

// Module-level cache so the DB is only hit once per process lifetime.
let cachedEmbedSecret: Uint8Array | null = null;

/**
 * Retrieve (or lazily create) the persistent embed secret from AppConfig.
 * On the first call, reads from the DB; subsequent calls return the cached value.
 * If no secret exists yet, generates one, persists it, then caches it.
 */
async function getEmbedSecret(): Promise<Uint8Array> {
  if (cachedEmbedSecret !== null) {
    return cachedEmbedSecret;
  }

  const config = await prisma.appConfig.findUnique({
    where: { key: "embedSecret" },
  });

  if (config) {
    cachedEmbedSecret = new TextEncoder().encode(config.value);
    return cachedEmbedSecret;
  }

  // Not found — generate, persist, then cache.
  const secret = crypto.randomBytes(32).toString("hex");
  await prisma.appConfig.create({
    data: {
      key: "embedSecret",
      value: secret,
      type: "string",
      group: "security",
    },
  });

  cachedEmbedSecret = new TextEncoder().encode(secret);
  return cachedEmbedSecret;
}

/**
 * Create a signed embed token for a specific file within a share.
 * Contains fileId + shareId, bound to embed purpose.
 * TTL: 24 hours.
 */
export async function createEmbedToken(fileId: string, shareId: string): Promise<string> {
  const secret = await getEmbedSecret();
  return new jose.SignJWT({ fileId, shareId, purpose: "embed" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret);
}

/**
 * Verify an embed token and extract the fileId + shareId.
 * Throws if expired, tampered, or wrong purpose.
 */
export async function verifyEmbedToken(
  token: string,
): Promise<{ fileId: string; shareId: string }> {
  const secret = await getEmbedSecret();
  const { payload } = await jose.jwtVerify(token, secret);
  if (payload.purpose !== "embed") {
    throw new UnauthorizedError("Invalid embed token");
  }
  return { fileId: payload.fileId as string, shareId: payload.shareId as string };
}
