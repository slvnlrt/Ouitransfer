import { describe, expect, it } from "vitest";
import { CreateShareSchema } from "../dto.js";

/**
 * Empty shares are intentionally allowed: a share can be created up front (e.g. to reserve a
 * link) and have files/folders added later via "manage files". This pins the removal of the
 * former "at least one file or folder" guard (DTO `.refine()` + service-layer check).
 */
describe("CreateShareSchema — empty shares allowed", () => {
  it("accepts a share with neither files nor folders", () => {
    expect(CreateShareSchema.safeParse({ name: "Empty share" }).success).toBe(true);
  });

  it("accepts explicitly empty files/folders arrays", () => {
    expect(CreateShareSchema.safeParse({ name: "Empty", files: [], folders: [] }).success).toBe(
      true,
    );
  });

  it("still accepts a share that has files or folders", () => {
    expect(CreateShareSchema.safeParse({ name: "With files", files: ["file-1"] }).success).toBe(
      true,
    );
    expect(
      CreateShareSchema.safeParse({ name: "With folders", folders: ["folder-1"] }).success,
    ).toBe(true);
  });
});
