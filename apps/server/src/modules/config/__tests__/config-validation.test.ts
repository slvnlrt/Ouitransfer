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

  describe("cleanup boolean keys", () => {
    const booleanKeys = [
      "autoCleanupEnabled",
      "accountDeactivationCleanupEnabled",
      "autoCleanupOrphansEnabled",
    ] as const;

    it.each(booleanKeys)('%s accepts "true" and "false"', (key) => {
      expect(() => validateConfigValue(key, "true")).not.toThrow();
      expect(() => validateConfigValue(key, "false")).not.toThrow();
    });

    it.each(booleanKeys)("%s rejects non-boolean strings", (key) => {
      for (const value of ["1", "0", "yes", "TRUE", "", "  "]) {
        expect(() => validateConfigValue(key, value)).toThrow(/"true" or "false"/);
      }
    });

    it.each(booleanKeys)("%s throws a 400 ValidationError carrying the key", (key) => {
      try {
        validateConfigValue(key, "nope");
        throw new Error("expected validateConfigValue to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.statusCode).toBe(400);
        expect(appError.details).toEqual({ key });
      }
    });
  });

  describe("cleanup integer keys", () => {
    // [key, minimum]
    const integerKeys = [
      ["autoCleanupIntervalHours", 1],
      ["autoCleanupGracePeriodDays", 0],
      ["autoCleanupNotifyDaysBefore", 0],
      ["maxViewsCleanupDays", 1],
      ["accountDeactivationCleanupDays", 1],
      ["autoCleanupOrphanMinAgeHours", 1],
    ] as const;

    it.each(integerKeys)("%s accepts the documented minimum and larger values", (key, min) => {
      expect(() => validateConfigValue(key, String(min))).not.toThrow();
      expect(() => validateConfigValue(key, String(min + 5))).not.toThrow();
      expect(() => validateConfigValue(key, "999")).not.toThrow();
    });

    it.each(integerKeys)("%s rejects values below the minimum", (key, min) => {
      expect(() => validateConfigValue(key, String(min - 1))).toThrow(/at least/);
    });

    it.each(integerKeys)("%s rejects negative values", (key) => {
      // min-1 already covers the 1-min keys; assert a clearly-negative value too.
      expect(() => validateConfigValue(key, "-5")).toThrow(/at least/);
    });

    it.each(integerKeys)("%s rejects non-integers", (key) => {
      expect(() => validateConfigValue(key, "3.5")).toThrow(/whole number/);
    });

    it.each(integerKeys)("%s rejects non-numeric input", (key) => {
      expect(() => validateConfigValue(key, "abc")).toThrow(/whole number/);
    });

    it.each(integerKeys)("%s rejects empty / whitespace input", (key) => {
      expect(() => validateConfigValue(key, "")).toThrow(/whole number/);
      expect(() => validateConfigValue(key, "   ")).toThrow(/whole number/);
    });

    it.each(integerKeys)("%s throws a 400 ValidationError carrying the key", (key) => {
      try {
        validateConfigValue(key, "not-a-number");
        throw new Error("expected validateConfigValue to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.statusCode).toBe(400);
        expect(appError.details).toEqual({ key });
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
