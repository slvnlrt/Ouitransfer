import { describe, expect, it } from "vitest";
import { quotaOverrideField } from "../quota-schema.js";

describe("quotaOverrideField", () => {
  describe("accepts valid inputs", () => {
    it("accepts null and returns null (inherit)", () => {
      const result = quotaOverrideField.safeParse(null);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it("accepts 0 (number) and returns 0n (unlimited)", () => {
      const result = quotaOverrideField.safeParse(0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(0n);
      }
    });

    it('accepts "0" (string) and returns 0n', () => {
      const result = quotaOverrideField.safeParse("0");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(0n);
      }
    });

    it("accepts 1024 (number) and returns 1024n", () => {
      const result = quotaOverrideField.safeParse(1024);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(1024n);
      }
    });

    it('accepts "1073741824" (string, 1 GB) and returns 1073741824n', () => {
      const result = quotaOverrideField.safeParse("1073741824");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(1073741824n);
      }
    });

    it("accepts 1125899906842624 (exactly 1 PB as number) and returns 1125899906842624n", () => {
      const result = quotaOverrideField.safeParse(1125899906842624);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(1125899906842624n);
      }
    });

    it('accepts "1125899906842624" (exactly 1 PB as string) and returns 1125899906842624n', () => {
      const result = quotaOverrideField.safeParse("1125899906842624");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(1125899906842624n);
      }
    });
  });

  describe("rejects invalid inputs", () => {
    it('rejects "1125899906842625" (1 PB + 1 byte) with "must not exceed 1 PB"', () => {
      const result = quotaOverrideField.safeParse("1125899906842625");
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(" ");
        expect(messages).toContain("must not exceed 1 PB");
      }
    });

    it('rejects "99999999999999999999" (huge number) with "must not exceed 1 PB"', () => {
      const result = quotaOverrideField.safeParse("99999999999999999999");
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(" ");
        expect(messages).toContain("must not exceed 1 PB");
      }
    });

    it('rejects "-1" (negative) with "must be a non-negative integer"', () => {
      const result = quotaOverrideField.safeParse("-1");
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(" ");
        expect(messages).toContain("must be a non-negative integer");
      }
    });

    it('rejects "1.5" (decimal) with "must be a non-negative integer"', () => {
      const result = quotaOverrideField.safeParse("1.5");
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(" ");
        expect(messages).toContain("must be a non-negative integer");
      }
    });

    it('rejects "abc" (non-numeric) with "must be a non-negative integer"', () => {
      const result = quotaOverrideField.safeParse("abc");
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(" ");
        expect(messages).toContain("must be a non-negative integer");
      }
    });

    it('rejects "" (empty string) with "must be a non-negative integer"', () => {
      const result = quotaOverrideField.safeParse("");
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(" ");
        expect(messages).toContain("must be a non-negative integer");
      }
    });
  });
});
