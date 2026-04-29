/**
 * Tests for query-keys.ts
 *
 * Verifies the shape and uniqueness of all query key factories,
 * including the new embedToken key added as part of Phase 4 TanStack Query migration.
 */

import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/query-keys";

describe("queryKeys.files", () => {
  it("has a stable all key", () => {
    expect(queryKeys.files.all).toEqual(["files"]);
  });

  it("list key includes folderId", () => {
    const key = queryKeys.files.list("folder-1");
    expect(key).toEqual(["files", "list", { folderId: "folder-1" }]);
  });

  it("list key works without folderId", () => {
    const key = queryKeys.files.list();
    expect(key).toEqual(["files", "list", { folderId: undefined }]);
  });

  it("embedToken key includes fileId and shareId", () => {
    const key = queryKeys.files.embedToken("file-1", "share-1");
    expect(key).toEqual(["files", "embedToken", "file-1", "share-1"]);
  });

  it("embedToken key starts with files.all prefix for broad invalidation", () => {
    const key = queryKeys.files.embedToken("file-1", "share-1");
    expect(key[0]).toBe("files");
  });

  it("embedToken keys for different files are distinct", () => {
    const key1 = queryKeys.files.embedToken("file-1", "share-1");
    const key2 = queryKeys.files.embedToken("file-2", "share-1");
    expect(key1).not.toEqual(key2);
  });

  it("embedToken keys for different shares are distinct", () => {
    const key1 = queryKeys.files.embedToken("file-1", "share-1");
    const key2 = queryKeys.files.embedToken("file-1", "share-2");
    expect(key1).not.toEqual(key2);
  });
});

describe("queryKeys.shares", () => {
  it("detail key includes share id", () => {
    const key = queryKeys.shares.detail("share-abc");
    expect(key).toEqual(["shares", "detail", "share-abc"]);
  });
});
