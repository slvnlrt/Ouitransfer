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

  describe("quota Phase B boolean keys", () => {
    const booleanKeys = ["quotaSmartDeletionEnabled", "reverseShareQuotaSoftEnforcement"] as const;

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

  describe("quota Phase B integer keys", () => {
    // [key, minimum]
    const integerKeys = [
      ["quotaGracePeriodDays", 0],
      ["quotaInactiveShareDays", 1],
      ["reverseShareMaxOverageFactor", 1],
    ] as const;

    it.each(integerKeys)("%s accepts the documented minimum and larger values", (key, min) => {
      expect(() => validateConfigValue(key, String(min))).not.toThrow();
      expect(() => validateConfigValue(key, String(min + 5))).not.toThrow();
      expect(() => validateConfigValue(key, "999")).not.toThrow();
    });

    it.each(integerKeys)("%s rejects values below the minimum", (key, min) => {
      expect(() => validateConfigValue(key, String(min - 1))).toThrow(/at least/);
    });

    it("reverseShareMaxOverageFactor rejects a factor below 1", () => {
      expect(() => validateConfigValue("reverseShareMaxOverageFactor", "0")).toThrow(/at least 1/);
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

  describe("reverseShareAbsoluteMaxBytes (bigint)", () => {
    const key = "reverseShareAbsoluteMaxBytes";
    const validate = (value: string) => () => validateConfigValue(key, value);

    it("accepts 0 (no absolute cap)", () => {
      expect(validate("0")).not.toThrow();
    });

    it("accepts a typical byte cap", () => {
      expect(validate("80530636800")).not.toThrow(); // 75 GiB
    });

    it("accepts values beyond Number.MAX_SAFE_INTEGER", () => {
      expect(validate("9007199254740993")).not.toThrow();
    });

    it("trims surrounding whitespace", () => {
      expect(validate("  1024  ")).not.toThrow();
    });

    it("rejects negative values", () => {
      expect(validate("-1")).toThrow(/at least 0/);
    });

    it("rejects fractional / non-integer input", () => {
      expect(validate("3.5")).toThrow(/whole number of bytes/);
    });

    it("rejects non-numeric input", () => {
      expect(validate("abc")).toThrow(/whole number of bytes/);
    });

    it("rejects empty / whitespace input", () => {
      expect(validate("")).toThrow(/whole number of bytes/);
      expect(validate("   ")).toThrow(/whole number of bytes/);
    });

    it("throws a 400 ValidationError carrying the key", () => {
      try {
        validateConfigValue(key, "-1");
        throw new Error("expected validateConfigValue to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.statusCode).toBe(400);
        expect(appError.details).toEqual({ key });
      }
    });
  });

  describe("quotaWarningThresholds (CSV)", () => {
    const key = "quotaWarningThresholds";
    const validate = (value: string) => () => validateConfigValue(key, value);

    it("accepts a typical CSV", () => {
      expect(validate("80,90")).not.toThrow();
    });

    it("accepts a single threshold", () => {
      expect(validate("95")).not.toThrow();
    });

    it("accepts the inclusive bounds 1 and 99", () => {
      expect(validate("1,99")).not.toThrow();
    });

    it("accepts unsorted and duplicate entries (normalized at parse time)", () => {
      expect(validate("90,80,80")).not.toThrow();
    });

    it("tolerates surrounding whitespace per entry", () => {
      expect(validate(" 80 , 90 ")).not.toThrow();
    });

    it("rejects values below 1 (0 or negative)", () => {
      expect(validate("0,90")).toThrow(/between 1 and 99/);
      expect(validate("-5")).toThrow(/between 1 and 99/);
    });

    it("rejects 100 and above (100% is the implicit exceeded boundary)", () => {
      expect(validate("80,100")).toThrow(/between 1 and 99/);
      expect(validate("120")).toThrow(/between 1 and 99/);
    });

    it("rejects non-integer entries", () => {
      expect(validate("80.5")).toThrow(/between 1 and 99/);
    });

    it("rejects non-numeric entries", () => {
      expect(validate("80,abc")).toThrow(/between 1 and 99/);
    });

    it("rejects empty segments", () => {
      expect(validate("80,,90")).toThrow(/between 1 and 99/);
      expect(validate("80,")).toThrow(/between 1 and 99/);
    });

    it("rejects an entirely empty value", () => {
      expect(validate("")).toThrow(/between 1 and 99/);
      expect(validate("   ")).toThrow(/between 1 and 99/);
    });

    it("throws a 400 ValidationError carrying the key", () => {
      try {
        validateConfigValue(key, "100");
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
