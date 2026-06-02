import { describe, expect, it } from "vitest";

import { AppError } from "../../../utils/app-error.js";
import { validateConfigValue } from "../config-validation.js";

describe("validateConfigValue", () => {
  describe("auditRetentionDays", () => {
    const validate = (value: string) => () => validateConfigValue("auditRetentionDays", value);

    it("accepts 0 (keep forever)", () => {
      expect(validate("0")).not.toThrow();
    });

    it("accepts the documented minimum of 7 days", () => {
      expect(validate("7")).not.toThrow();
    });

    it("accepts larger values", () => {
      expect(validate("365")).not.toThrow();
    });

    it("trims surrounding whitespace", () => {
      expect(validate("  30  ")).not.toThrow();
    });

    it.each(["1", "2", "3", "4", "5", "6"])("rejects %s (below the 7-day floor)", (value) => {
      expect(validate(value)).toThrow(/at least 7 days/);
    });

    it("rejects negative values", () => {
      expect(validate("-3")).toThrow(/negative/);
    });

    it("rejects non-integers", () => {
      expect(validate("3.5")).toThrow(/whole number/);
    });

    it("rejects non-numeric input", () => {
      expect(validate("abc")).toThrow(/whole number/);
    });

    it("rejects an empty value", () => {
      expect(validate("")).toThrow(/whole number/);
      expect(validate("   ")).toThrow(/whole number/);
    });

    it("throws a 400 ValidationError carrying the offending key", () => {
      try {
        validateConfigValue("auditRetentionDays", "3");
        throw new Error("expected validateConfigValue to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.statusCode).toBe(400);
        expect(appError.details).toEqual({ key: "auditRetentionDays" });
      }
    });
  });

  describe("keys without a registered validator", () => {
    it("accepts any value", () => {
      expect(() => validateConfigValue("appName", "anything")).not.toThrow();
      expect(() => validateConfigValue("smtpPort", "not-a-number")).not.toThrow();
      expect(() => validateConfigValue("unknownKey", "")).not.toThrow();
    });
  });
});
