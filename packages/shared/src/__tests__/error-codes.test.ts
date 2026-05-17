import { describe, expect, it } from "vitest";
import { ErrorCodes } from "../error-codes.js";

describe("ErrorCodes", () => {
  it("exports all expected error codes", () => {
    expect(ErrorCodes.UNAUTHORIZED).toBe("UNAUTHORIZED");
    expect(ErrorCodes.STORAGE_UNREACHABLE).toBe("STORAGE_UNREACHABLE");
    expect(ErrorCodes.PASSWORD_REQUIRED).toBe("PASSWORD_REQUIRED");
    expect(ErrorCodes.FILE_SIZE_EXCEEDED).toBe("FILE_SIZE_EXCEEDED");
    expect(ErrorCodes.INSUFFICIENT_STORAGE).toBe("INSUFFICIENT_STORAGE");
  });

  it("all codes are SCREAMING_SNAKE_CASE strings", () => {
    for (const [key, value] of Object.entries(ErrorCodes)) {
      expect(key).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(value).toBe(key);
    }
  });

  it("has no duplicate values", () => {
    const values = Object.values(ErrorCodes);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });
});
