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
      expect(() => validateConfigValue("smtpPort", "not-a-number")).not.toThrow();
      expect(() => validateConfigValue("unknownKey", "")).not.toThrow();
    });
  });

  // ── A6-07: email/branding config validators ──────────────────────────────────

  describe("appUrl (A6-07)", () => {
    const validate = (value: string) => () => validateConfigValue("appUrl", value);

    it("accepts a canonical https origin", () => {
      expect(validate("https://transfer.example.com")).not.toThrow();
      expect(validate("http://localhost:3000")).not.toThrow();
      // A single trailing slash is the parser-normalized origin form.
      expect(validate("https://transfer.example.com/")).not.toThrow();
    });

    it("rejects non-http(s) schemes", () => {
      expect(validate("javascript:alert(1)")).toThrow(/valid http/i);
      expect(validate("ftp://example.com")).toThrow(/valid http/i);
      expect(validate("data:text/html,x")).toThrow(/valid http/i);
    });

    it("rejects a URL with a path, query, or fragment", () => {
      expect(validate("https://example.com/sub/path")).toThrow(/valid http/i);
      expect(validate("https://example.com/?x=1")).toThrow(/valid http/i);
      expect(validate("https://example.com/#frag")).toThrow(/valid http/i);
    });

    it("rejects embedded userinfo (host-masking)", () => {
      expect(validate("https://evil.example@transfer.example.com")).toThrow(/valid http/i);
    });

    it("rejects CR/LF (link/header poisoning) and malformed input", () => {
      expect(validate("https://example.com\r\nSet-Cookie: x=1")).toThrow(/valid http/i);
      expect(validate("not a url")).toThrow(/valid http/i);
      expect(validate("")).toThrow(/valid http/i);
    });
  });

  describe("footerUrl (A7-01)", () => {
    const validate = (value: string) => () => validateConfigValue("footerUrl", value);

    it("accepts http(s) URLs (incl. path/query/fragment — footer may deep-link)", () => {
      expect(validate("https://example.com")).not.toThrow();
      expect(validate("http://example.com/about?ref=footer#team")).not.toThrow();
      expect(validate("https://sub.example.com:8443/path")).not.toThrow();
    });

    it("accepts an empty value (disables the footer link)", () => {
      expect(validate("")).not.toThrow();
    });

    it("rejects javascript: / data: / vbscript: schemes (DOM-XSS)", () => {
      expect(validate("javascript:alert(1)")).toThrow(/valid http/i);
      expect(validate("JavaScript:alert(1)")).toThrow(/valid http/i);
      expect(validate("data:text/html,<script>alert(1)</script>")).toThrow(/valid http/i);
      expect(validate("vbscript:msgbox(1)")).toThrow(/valid http/i);
    });

    it("rejects non-http(s) schemes and protocol-relative URLs", () => {
      expect(validate("ftp://example.com")).toThrow(/valid http/i);
      expect(validate("file:///etc/passwd")).toThrow(/valid http/i);
      expect(validate("//evil.com")).toThrow(/valid http/i);
    });

    it("rejects CR/LF and malformed input", () => {
      expect(validate("https://example.com\r\nSet-Cookie: x=1")).toThrow(/valid http/i);
      expect(validate("not a url")).toThrow(/valid http/i);
    });
  });

  describe("smtpFromEmail (A6-07)", () => {
    const validate = (value: string) => () => validateConfigValue("smtpFromEmail", value);

    it("accepts a valid email", () => {
      expect(validate("noreply@example.com")).not.toThrow();
    });

    it("rejects an invalid email", () => {
      expect(validate("not-an-email")).toThrow(/valid email/i);
      expect(validate("")).toThrow(/valid email/i);
    });
  });

  describe("branding strings — appName / smtpFromName (A6-07)", () => {
    it("accepts ordinary single-line values", () => {
      expect(() => validateConfigValue("appName", "Acme Transfer")).not.toThrow();
      expect(() => validateConfigValue("smtpFromName", "Acme Transfer Bot")).not.toThrow();
    });

    it("rejects CR/LF (SMTP header injection)", () => {
      expect(() => validateConfigValue("appName", "Acme\r\nBcc: evil@x")).toThrow(/line breaks/i);
      expect(() => validateConfigValue("smtpFromName", "Acme\nX-Spam: yes")).toThrow(
        /line breaks/i,
      );
    });

    it("rejects an over-length value", () => {
      expect(() => validateConfigValue("appName", "x".repeat(201))).toThrow(/at most/i);
    });
  });
});
