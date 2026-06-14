import { describe, expect, it } from "vitest";

import { ALIAS_MAX_LENGTH, aliasSchema } from "../alias-schema.js";

describe("aliasSchema", () => {
  describe("valid aliases", () => {
    it.each([
      "abcdefgh", // exactly the 8-char minimum
      "my-share", // single internal hyphen
      "a1-b2-c3", // multiple internal hyphens
      "AbCdE12345", // mixed case + digits (auto-generated shape)
      "a".repeat(ALIAS_MAX_LENGTH), // exactly the max length
    ])("accepts %j", (value) => {
      expect(aliasSchema.safeParse(value).success).toBe(true);
    });

    it("accepts a 10-char alphanumeric auto-generated alias", () => {
      expect(aliasSchema.safeParse("Xy7Kp2Qr9Z").success).toBe(true);
    });
  });

  describe("length bounds", () => {
    it("rejects values shorter than 8 characters", () => {
      const result = aliasSchema.safeParse("abcdefg");
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toMatch(/at least 8/);
    });

    it("rejects values longer than 30 characters", () => {
      const result = aliasSchema.safeParse("a".repeat(ALIAS_MAX_LENGTH + 1));
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toMatch(/exceed 30/);
    });
  });

  describe("charset and hyphen placement", () => {
    it.each([
      "-abcde", // leading hyphen
      "abcde-", // trailing hyphen
      "ab--cde", // consecutive hyphens
      "ab_cde", // underscore
      "ab cde", // space
      "ab.cde", // dot
      "abcdé", // non-ASCII
      "ab/cd", // slash
    ])("rejects %j", (value) => {
      expect(aliasSchema.safeParse(value).success).toBe(false);
    });
  });
});
