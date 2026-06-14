import crypto from "node:crypto";

/**
 * Generalised authenticated encryption for secrets at rest (AES-256-GCM).
 *
 * Used for any sensitive value that must be stored in the database but be
 * recoverable by the server (e.g. the LDAP bind password, the 2FA TOTP secret).
 *
 * Key derivation (A5-14): the 256-bit AES key is derived from `ENCRYPTION_SECRET`
 * via HKDF-SHA256 with a per-record random salt and a per-purpose `info` label.
 * This means:
 *   - two different purposes ("ldap-bind-password" vs "totp-secret") never share
 *     the same derived key, even though they share the master secret;
 *   - a fresh random salt per encryption means the derived key differs for every
 *     ciphertext, so identical plaintexts under the same purpose never reuse a key.
 *
 * Output format (base64url, colon-separated): `salt:iv:tag:ciphertext`
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 12 bytes is the recommended IV size for AES-256-GCM (NIST SP 800-38D)
const SALT_LENGTH = 16; // 128-bit HKDF salt
const KEY_LENGTH = 32; // 256-bit AES key

function getMasterSecret(): string {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_SECRET environment variable is required for encrypting secrets at rest",
    );
  }
  return secret;
}

/**
 * Derive a 256-bit AES key from the master secret using HKDF-SHA256.
 * The `info` label binds the key to a specific purpose; the random `salt`
 * binds it to a specific ciphertext.
 */
function deriveKey(salt: Buffer, info: string): Buffer {
  const ikm = Buffer.from(getMasterSecret(), "utf8");
  const derived = crypto.hkdfSync("sha256", ikm, salt, Buffer.from(info, "utf8"), KEY_LENGTH);
  return Buffer.from(derived);
}

/**
 * Encrypt a string using AES-256-GCM with an HKDF-derived per-record key.
 *
 * @param plaintext value to encrypt
 * @param purpose   domain-separation label bound into the derived key (must be
 *                  passed identically to `decrypt`)
 * @returns `salt:iv:tag:ciphertext` (each component base64url-encoded)
 */
export function encryptSecret(plaintext: string, purpose: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(salt, purpose);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    salt.toString("base64url"),
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

/**
 * Decrypt a string produced by {@link encryptSecret}.
 *
 * @param encryptedData `salt:iv:tag:ciphertext`
 * @param purpose       the same domain-separation label used at encrypt time
 */
export function decryptSecret(encryptedData: string, purpose: string): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 4) {
    throw new Error("Invalid encrypted data format");
  }

  const salt = Buffer.from(parts[0], "base64url");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  const key = deriveKey(salt, purpose);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
