import { describe, expect, it } from "vitest";

import { ValidationError } from "../app-error.js";
import { validateObjectName } from "../validate-object-name.js";

describe("validateObjectName", () => {
  it("accepts a valid objectName with the expected prefix", () => {
    expect(() =>
      validateObjectName("user123/550e8400-e29b-41d4-a716-446655440000-photo.jpg", "user123"),
    ).not.toThrow();
  });

  it("accepts a nested path under the expected prefix", () => {
    expect(() =>
      validateObjectName("reverse-shares/abc/uuid-file.txt", "reverse-shares/abc"),
    ).not.toThrow();
  });

  it("throws ValidationError when objectName contains a null byte", () => {
    expect(() => validateObjectName("user123/file\0name.txt", "user123")).toThrow(ValidationError);
    expect(() => validateObjectName("user123/file\0name.txt", "user123")).toThrow(
      "Invalid object name: contains null bytes",
    );
  });

  it("throws ValidationError when objectName contains path traversal sequences", () => {
    expect(() => validateObjectName("user123/../other-user/secret.txt", "user123")).toThrow(
      ValidationError,
    );
    expect(() => validateObjectName("user123/../other-user/secret.txt", "user123")).toThrow(
      "Invalid object name: contains path traversal sequences",
    );
  });

  it("throws ValidationError when objectName does not start with expected prefix", () => {
    expect(() => validateObjectName("other-user/uuid-file.txt", "user123")).toThrow(
      ValidationError,
    );
    expect(() => validateObjectName("other-user/uuid-file.txt", "user123")).toThrow(
      "Invalid object name: does not belong to this namespace",
    );
  });

  it("throws ValidationError when objectName matches prefix but lacks trailing slash separator", () => {
    // "user123extra/file.txt" should not match prefix "user123"
    expect(() => validateObjectName("user123extra/file.txt", "user123")).toThrow(ValidationError);
    expect(() => validateObjectName("user123extra/file.txt", "user123")).toThrow(
      "Invalid object name: does not belong to this namespace",
    );
  });

  it("throws ValidationError when objectName is just the prefix without a path component", () => {
    // "user123/" is technically valid (prefix + slash) — but "user123" without slash is not
    expect(() => validateObjectName("user123", "user123")).toThrow(ValidationError);
    expect(() => validateObjectName("user123", "user123")).toThrow(
      "Invalid object name: does not belong to this namespace",
    );
  });
});
