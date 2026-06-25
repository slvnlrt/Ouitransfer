/**
 * Tests for the share lifecycle display-state helper (Phase A.1).
 *
 * Verifies the precedence the owner UI uses to label a share:
 *   - persisted deactivation (isActive=false) with its stored reason
 *   - defensive expiry / maxViews detection for shares still active in the DB
 *     but lapsed between scheduler sweeps
 */

import { describe, expect, it } from "vitest";
import { getShareLifecycleState, isShareExpired, isShareMaxedOut } from "@/lib/share-lifecycle";

type LifecycleInput = Parameters<typeof getShareLifecycleState>[0];

const PAST = "2000-01-01T00:00:00Z";
const FUTURE = "2999-01-01T00:00:00Z";

function share(overrides: Partial<LifecycleInput> = {}): LifecycleInput {
  return {
    isActive: true,
    deactivationReason: null,
    expiration: null,
    maxViews: null,
    views: 0,
    ...overrides,
  };
}

describe("getShareLifecycleState", () => {
  it("returns active for an active, non-expired, non-maxed share", () => {
    expect(getShareLifecycleState(share())).toEqual({ kind: "active" });
  });

  it("returns active for an active share with a future expiration", () => {
    expect(getShareLifecycleState(share({ expiration: FUTURE }))).toEqual({ kind: "active" });
  });

  it("reports a persisted manual pause", () => {
    expect(
      getShareLifecycleState(share({ isActive: false, deactivationReason: "manual" })),
    ).toEqual({ kind: "deactivated", reason: "manual" });
  });

  it("reports a persisted expired deactivation", () => {
    expect(
      getShareLifecycleState(
        share({ isActive: false, deactivationReason: "expired", expiration: PAST }),
      ),
    ).toEqual({ kind: "deactivated", reason: "expired" });
  });

  it("reports a persisted max_views deactivation", () => {
    expect(
      getShareLifecycleState(
        share({ isActive: false, deactivationReason: "max_views", maxViews: 3, views: 3 }),
      ),
    ).toEqual({ kind: "deactivated", reason: "max_views" });
  });

  it("detects a share that expired between sweeps (still isActive=true)", () => {
    expect(getShareLifecycleState(share({ expiration: PAST }))).toEqual({
      kind: "deactivated",
      reason: "expired",
    });
  });

  it("detects a share that hit its view limit between sweeps", () => {
    expect(getShareLifecycleState(share({ maxViews: 5, views: 5 }))).toEqual({
      kind: "deactivated",
      reason: "max_views",
    });
  });

  it("prefers expired over max_views when both lapsed", () => {
    expect(getShareLifecycleState(share({ expiration: PAST, maxViews: 1, views: 1 }))).toEqual({
      kind: "deactivated",
      reason: "expired",
    });
  });

  it("falls back to manual when inactive without a stored reason and not lapsed", () => {
    expect(getShareLifecycleState(share({ isActive: false }))).toEqual({
      kind: "deactivated",
      reason: "manual",
    });
  });
});

describe("isShareExpired / isShareMaxedOut", () => {
  it("isShareExpired is false with no expiration", () => {
    expect(isShareExpired({ expiration: null })).toBe(false);
  });

  it("isShareExpired is true for a past expiration", () => {
    expect(isShareExpired({ expiration: PAST })).toBe(true);
  });

  it("isShareMaxedOut is false with no maxViews", () => {
    expect(isShareMaxedOut({ maxViews: null, views: 99 })).toBe(false);
  });

  it("isShareMaxedOut is true when views reach maxViews", () => {
    expect(isShareMaxedOut({ maxViews: 2, views: 2 })).toBe(true);
  });
});
