import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("LDAP Encryption", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_SECRET", "test-encryption-secret-that-is-32-chars-long!");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should encrypt and decrypt a string round-trip", async () => {
    const { encrypt, decrypt } = await import("../encryption.js");
    const plaintext = "cn=admin,dc=corp,dc=local";
    const encrypted = encrypt(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(":"); // format: iv:tag:ciphertext

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("should produce different ciphertexts for the same plaintext (random IV)", async () => {
    const { encrypt } = await import("../encryption.js");
    const plaintext = "my-secret-password";
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);

    expect(encrypted1).not.toBe(encrypted2);
  });

  it("should handle empty strings", async () => {
    const { encrypt, decrypt } = await import("../encryption.js");
    const encrypted = encrypt("");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  it("should handle unicode characters", async () => {
    const { encrypt, decrypt } = await import("../encryption.js");
    const plaintext = "mot-de-passe-très-sécurisé-日本語";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("should throw on invalid encrypted data format", async () => {
    const { decrypt } = await import("../encryption.js");
    expect(() => decrypt("not-valid-format")).toThrow("Invalid encrypted data format");
  });

  it("should throw on tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("../encryption.js");
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    // Tamper with the ciphertext
    parts[2] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("should throw when ENCRYPTION_SECRET is not set", async () => {
    vi.stubEnv("ENCRYPTION_SECRET", "");
    // Need fresh import to pick up env change
    vi.resetModules();
    const { encrypt } = await import("../encryption.js");
    expect(() => encrypt("test")).toThrow("ENCRYPTION_SECRET");
  });
});
