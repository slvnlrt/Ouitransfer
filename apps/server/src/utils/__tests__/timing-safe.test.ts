import { describe, expect, it } from "vitest";

import { timingSafeEqual } from "../timing-safe.js";

describe("timingSafeEqual (5.22)", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false for strings of different length", () => {
    expect(timingSafeEqual("short", "much-longer-string")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("handles unicode characters correctly", () => {
    expect(timingSafeEqual("héllo", "héllo")).toBe(true);
    expect(timingSafeEqual("héllo", "hëllo")).toBe(false);
  });

  it("handles backup-code formatted strings", () => {
    const code = "A1B2-C3D4";
    expect(timingSafeEqual(code, "A1B2-C3D4")).toBe(true);
    expect(timingSafeEqual(code, "A1B2-C3D5")).toBe(false);
  });
});
