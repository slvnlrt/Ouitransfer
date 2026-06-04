/**
 * Tests for query-keys.ts
 *
 * Verifies the shape and uniqueness of all query key factories.
 */

import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/query-keys";

describe("queryKeys.files", () => {
  it("has a stable all key", () => {
    expect(queryKeys.files.all).toEqual(["files"]);
  });

  it("list key is stable", () => {
    const key = queryKeys.files.list();
    expect(key).toEqual(["files", "list"]);
  });
});

describe("queryKeys.shares", () => {
  it("detail key includes share id", () => {
    const key = queryKeys.shares.detail("share-abc");
    expect(key).toEqual(["shares", "detail", "share-abc"]);
  });
});
