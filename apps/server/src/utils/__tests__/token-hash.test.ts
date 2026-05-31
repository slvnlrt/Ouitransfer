import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { hashToken } from "../token-hash.js";

describe("hashToken", () => {
  it("returns a 64-char hex SHA-256 digest", () => {
    const token = crypto.randomBytes(32).toString("hex");
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic (same input → same output)", () => {
    const token = "abc123";
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });

  it("matches manual SHA-256 computation", () => {
    const token = "test-token-value";
    const expected = crypto.createHash("sha256").update(token).digest("hex");
    expect(hashToken(token)).toBe(expected);
  });
});
