/**
 * sanitize-directory.test.ts — ingest-time sanitization of directory-sourced
 * attribute values (A5-08).
 */

import { describe, expect, it } from "vitest";
import { sanitizeDirectoryEmail, sanitizeDirectoryName } from "../sanitize-directory.js";

describe("sanitizeDirectoryName", () => {
  it("leaves an ordinary name unchanged", () => {
    expect(sanitizeDirectoryName("John Doe")).toBe("John Doe");
  });

  it("strips C0 control characters", () => {
    expect(sanitizeDirectoryName("John\u0007Doe")).toBe("JohnDoe");
    expect(sanitizeDirectoryName("a\tb")).toBe("ab"); // tab is U+0009
    expect(sanitizeDirectoryName("a\nb")).toBe("ab"); // newline is U+000A
  });

  it("strips C1 control characters", () => {
    expect(sanitizeDirectoryName("a\u0085b")).toBe("ab"); // NEL U+0085
  });

  it("strips bidi-override and zero-width characters", () => {
    // U+202E RLO is the classic spoofing character.
    expect(sanitizeDirectoryName("photo\u202Egpj.exe")).toBe("photogpj.exe");
    expect(sanitizeDirectoryName("a\u200Bb\u200Fc\u2066d\uFEFF")).toBe("abcd");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeDirectoryName("  Jane  ")).toBe("Jane");
  });

  it("caps length at 256 characters", () => {
    const long = "x".repeat(5000);
    expect(sanitizeDirectoryName(long).length).toBe(256);
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeDirectoryName("")).toBe("");
  });

  it("preserves an XSS-looking payload as literal text (no HTML encoding) but cleaned of control chars", () => {
    // The value is stored literally (the frontend escapes on output); we only
    // strip control/bidi noise. The angle brackets survive as plain characters.
    expect(sanitizeDirectoryName("<img src=x onerror=alert(1)>\u0009")).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });
});

describe("sanitizeDirectoryEmail", () => {
  it("normalizes a valid email and lowercases it", () => {
    expect(sanitizeDirectoryEmail("John.Doe@Corp.Local")).toBe("john.doe@corp.local");
  });

  it("strips control and bidi characters", () => {
    expect(sanitizeDirectoryEmail("john\u0000@corp.local")).toBe("john@corp.local");
    expect(sanitizeDirectoryEmail("jo\u202Ehn@corp.local")).toBe("john@corp.local");
  });

  it("rejects an email with internal whitespace", () => {
    expect(sanitizeDirectoryEmail("john doe@corp.local")).toBeNull();
  });

  it("rejects an email without a single @", () => {
    expect(sanitizeDirectoryEmail("johncorp.local")).toBeNull();
    expect(sanitizeDirectoryEmail("john@@corp.local")).toBeNull();
    expect(sanitizeDirectoryEmail("@corp.local")).toBeNull();
  });

  it("rejects an email with a domain that has no dot", () => {
    expect(sanitizeDirectoryEmail("john@localhost")).toBeNull();
  });

  it("rejects an over-length email", () => {
    expect(sanitizeDirectoryEmail(`${"a".repeat(400)}@corp.local`)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(sanitizeDirectoryEmail("")).toBeNull();
  });
});
