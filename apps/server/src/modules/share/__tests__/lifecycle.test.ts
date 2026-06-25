import { describe, expect, it } from "vitest";
import { DEACTIVATION_REASONS, type DeactivationReason } from "../lifecycle.js";

describe("share lifecycle constants", () => {
  it("exposes the three deactivation reasons", () => {
    expect(DEACTIVATION_REASONS).toEqual(["expired", "max_views", "manual"]);
  });

  it("derives the DeactivationReason union from the const array", () => {
    const reasons: DeactivationReason[] = [...DEACTIVATION_REASONS];
    expect(reasons).toHaveLength(3);
  });
});
