import { decryptSecret, encryptSecret } from "../../utils/encryption.js";

/**
 * LDAP bind-password encryption.
 *
 * Thin wrapper over the generalised {@link encryptSecret}/{@link decryptSecret}
 * helpers with a fixed domain-separation purpose so the LDAP bind password is
 * encrypted under a key that is never shared with any other secret class.
 */
const LDAP_PURPOSE = "ldap-bind-password";

/**
 * Encrypt the LDAP bind password.
 * Output format: base64url(salt):base64url(iv):base64url(tag):base64url(ciphertext)
 */
export function encrypt(plaintext: string): string {
  return encryptSecret(plaintext, LDAP_PURPOSE);
}

/**
 * Decrypt a value produced by {@link encrypt}.
 */
export function decrypt(encryptedData: string): string {
  return decryptSecret(encryptedData, LDAP_PURPOSE);
}
