/**
 * service.test.ts
 *
 * Unit tests for notification service functions.
 *
 * Tests:
 * - unsubscribeUser rejects critical types (I-3)
 * - unsubscribeUser rejects non-configurable types (I-3)
 * - unsubscribeUser rejects unknown types (I-3)
 * - unsubscribeUser works for configurable, non-critical types
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mock state ──────────────────────────────────────────────────────

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    notificationPreference: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../../shared/prisma.js", () => ({
  prisma: mockPrisma,
}));

// Mock env module (needed by unsubscribe-token.ts re-exported from service.ts)
vi.mock("../../../env.js", () => ({
  env: {
    JWT_SECRET: "test-secret-key-that-is-at-least-32-characters-long",
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { unsubscribeUser } from "../service.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("unsubscribeUser()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("silently returns for critical type 'welcome' — no preference row created (I-3)", async () => {
    await unsubscribeUser("user-1", "welcome");

    // welcome is isCritical=true → should NOT create a preference row
    expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("silently returns for critical type 'password_reset' (I-3)", async () => {
    await unsubscribeUser("user-1", "password_reset");

    expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("silently returns for non-configurable type 'share_invitation' (I-3)", async () => {
    // share_invitation is configurable=false, isCritical=false
    await unsubscribeUser("user-1", "share_invitation");

    expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("silently returns for unknown type (I-3)", async () => {
    await unsubscribeUser("user-1", "nonexistent_type");

    expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("creates preference row for configurable, non-critical type 'share_expiring'", async () => {
    await unsubscribeUser("user-1", "share_expiring");

    expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledOnce();
    const upsertCall = mockPrisma.notificationPreference.upsert.mock.calls[0][0];
    expect(upsertCall.where).toEqual({
      userId_type: { userId: "user-1", type: "share_expiring" },
    });
    expect(upsertCall.create.frequency).toBe("disabled");
    expect(upsertCall.update.frequency).toBe("disabled");
  });

  it("creates preference row for configurable, non-critical type 'share_accessed'", async () => {
    await unsubscribeUser("user-1", "share_accessed");

    expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledOnce();
  });
});
