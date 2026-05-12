import { describe, expect, it } from "vitest";
import { formatDateTime } from "./format-date-time";

describe("formatDateTime", () => {
  // Fixed test date — use a local-time-based string to avoid timezone drift in assertions.
  // Intl.DateTimeFormat renders in the runtime's local timezone, so we use a date
  // whose components are known regardless of TZ offset.
  const testDate = "2025-06-15T14:30:00Z";

  describe("table format", () => {
    it("produces a string containing the year, month, and day", () => {
      const result = formatDateTime(testDate, "table");
      expect(result).toContain("06");
      expect(result).toContain("15");
      expect(result).toContain("2025");
    });

    it("includes a time component with colon separator", () => {
      const result = formatDateTime(testDate, "table");
      // Table format always includes HH:MM
      expect(result).toMatch(/\d{2}:\d{2}/);
    });

    it("formats with fr-FR locale (day before month)", () => {
      const result = formatDateTime(testDate, "table", "fr-FR");
      // fr-FR: DD/MM/YYYY — the string starts with day
      expect(result).toContain("2025");
      expect(result).toMatch(/\d{2}:\d{2}/);
      // fr-FR uses DD/MM order — verify "15/06" appears (not "06/15")
      expect(result).toMatch(/15\/06/);
    });

    it("formats with pt-BR locale", () => {
      const result = formatDateTime(testDate, "table", "pt-BR");
      expect(result).toContain("2025");
      expect(result).toMatch(/\d{2}:\d{2}/);
    });

    it("formats with ar-SA locale without throwing", () => {
      const result = formatDateTime(testDate, "table", "ar-SA");
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("formats with ja-JP locale (year first)", () => {
      const result = formatDateTime(testDate, "table", "ja-JP");
      expect(result).toContain("2025");
      expect(result).toMatch(/\d{2}:\d{2}/);
    });
  });

  describe("compact format", () => {
    it("formats with default locale (en-US) using short month", () => {
      const result = formatDateTime(testDate, "compact");
      // en-US compact: "Jun 15, 2025"
      expect(result).toContain("Jun");
      expect(result).toContain("15");
      expect(result).toContain("2025");
    });

    it("does not include a time component", () => {
      const result = formatDateTime(testDate, "compact");
      // Compact format should NOT contain HH:MM time
      expect(result).not.toMatch(/\d{2}:\d{2}/);
    });

    it("formats with fr-FR locale", () => {
      const result = formatDateTime(testDate, "compact", "fr-FR");
      // fr-FR compact: "15 juin 2025"
      expect(result).toContain("15");
      expect(result).toContain("2025");
    });
  });

  describe("defaults", () => {
    it("defaults to table format when format is omitted (includes time)", () => {
      const result = formatDateTime(testDate);
      // Table format includes time
      expect(result).toMatch(/\d{2}:\d{2}/);
    });

    it("defaults to en-US when locale is omitted", () => {
      const result = formatDateTime(testDate, "table");
      const explicitEnUS = formatDateTime(testDate, "table", "en-US");
      expect(result).toBe(explicitEnUS);
    });
  });

  describe("locale differentiation", () => {
    it("produces different output for en-US vs fr-FR", () => {
      const enUS = formatDateTime(testDate, "table", "en-US");
      const frFR = formatDateTime(testDate, "table", "fr-FR");
      // en-US: MM/DD, fr-FR: DD/MM — different order
      expect(enUS).not.toBe(frFR);
    });

    it("produces different compact format for en-US vs fr-FR", () => {
      const enUS = formatDateTime(testDate, "compact", "en-US");
      const frFR = formatDateTime(testDate, "compact", "fr-FR");
      // en-US: "Jun", fr-FR: "juin" — different month names
      expect(enUS).not.toBe(frFR);
    });
  });
});
