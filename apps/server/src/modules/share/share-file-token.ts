import crypto from "node:crypto";
import { env } from "../../env.js";

/**
 * Opaque per-share file download token (R2 — A4-08 / A4-02 / A2-04).
 *
 * The non-owner share response never exposes a file's raw S3 `objectName` (which embeds the
 * owner's `userId` and is the exact key the old `/files/download` bypass abused). Instead each
 * file carries a stateless, signed token that resolves *server-side* to a specific
 * `{ shareId, fileId }` pair. The download endpoints accept this token in place of the raw key
 * and re-evaluate access against THAT specific share's live lifecycle — closing the
 * "any password-less share containing the file" hole at the root.
 *
 * Design:
 *  - Stateless (no DB row / migration): the token is `base64url(payload).base64url(hmac)` where
 *    `payload = "${shareId}:${fileId}"` and the HMAC is keyed by a value derived from
 *    `JWT_SECRET` via HKDF (so the key is distinct from the JWT signing key and stable across
 *    instances / restarts — no shared mutable state needed).
 *  - The token is share-scoped: it only ever grants access through the share it was minted for,
 *    and the download path still applies the full lifecycle gate + password to that share. The
 *    token is therefore a *binding* (which file, via which share), not a bearer grant.
 *  - Opaque to the client: the web client treats it as the file's download handle and passes it
 *    back verbatim; it never sees the raw `objectName` or the owner's `userId`.
 */

const TOKEN_PREFIX = "st1_";

let cachedKey: Buffer | null = null;

/** Derive a dedicated signing key from JWT_SECRET (HKDF-SHA256), distinct from the JWT key. */
function getSigningKey(): Buffer {
  if (cachedKey) return cachedKey;
  cachedKey = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(env.JWT_SECRET, "utf-8"),
      Buffer.alloc(0),
      Buffer.from("ouitransfer:share-file-token:v1", "utf-8"),
      32,
    ),
  );
  return cachedKey;
}

function sign(payload: string): Buffer {
  return crypto.createHmac("sha256", getSigningKey()).update(payload).digest();
}

/** Mint an opaque download token binding a file to the share it is exposed through. */
export function mintShareFileToken(shareId: string, fileId: string): string {
  const payload = `${shareId}:${fileId}`;
  const sig = sign(payload);
  return (
    TOKEN_PREFIX +
    Buffer.from(payload, "utf-8").toString("base64url") +
    "." +
    sig.toString("base64url")
  );
}

/** Resolve a token back to its `{ shareId, fileId }`, or `null` if it is not a valid token. */
export function verifyShareFileToken(token: string): { shareId: string; fileId: string } | null {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) return null;
  const body = token.slice(TOKEN_PREFIX.length);
  const dot = body.indexOf(".");
  if (dot < 0) return null;

  const payloadB64 = body.slice(0, dot);
  const sigB64 = body.slice(dot + 1);

  let payload: string;
  let providedSig: Buffer;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf-8");
    providedSig = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }

  const expectedSig = sign(payload);
  if (providedSig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(providedSig, expectedSig)) return null;

  const sep = payload.indexOf(":");
  if (sep <= 0 || sep >= payload.length - 1) return null;
  return { shareId: payload.slice(0, sep), fileId: payload.slice(sep + 1) };
}
