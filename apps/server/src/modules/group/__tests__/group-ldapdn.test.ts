/**
 * group-ldapdn.test.ts
 *
 * Unit tests for B-8: ldapDn handling in GroupService.createGroup and updateGroup.
 * Verifies normalization logic (trim + empty/null → null) and pass-through of valid DNs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    group: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    file: { aggregate: vi.fn() },
    reverseShareFile: { aggregate: vi.fn() },
  },
}));

import { prisma } from "../../../shared/prisma.js";
import { GroupService } from "../service.js";

// ── Shared fixtures ──────────────────────────────────────────────────────────

const BASE_GROUP = {
  id: "grp-1",
  name: "Devs",
  description: null,
  maxFileSizeOverride: null,
  maxTotalStorageOverride: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GroupService — ldapDn handling", () => {
  let service: GroupService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GroupService();
    // Default: no name conflict
    vi.mocked(prisma.group.findUnique).mockResolvedValue(null);
  });

  // ── createGroup ─────────────────────────────────────────────────────────────

  describe("createGroup", () => {
    it("passes a valid ldapDn through to the repository", async () => {
      const dn = "CN=Devs,OU=Groups,DC=corp,DC=local";
      vi.mocked(prisma.group.create).mockResolvedValue({
        ...BASE_GROUP,
        ldapDn: dn,
      });

      await service.createGroup({ name: "Devs", ldapDn: dn });

      expect(prisma.group.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ ldapDn: dn }),
      });
    });

    it("normalizes empty string ldapDn to null", async () => {
      vi.mocked(prisma.group.create).mockResolvedValue({
        ...BASE_GROUP,
        ldapDn: null,
      });

      await service.createGroup({ name: "Devs", ldapDn: "" });

      expect(prisma.group.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ ldapDn: null }),
      });
    });

    it("normalizes whitespace-only ldapDn to null (server trims before null-coalescing)", async () => {
      // The server uses `input.ldapDn?.trim() || null`:
      //   "   ".trim() → "" → "" || null → null.
      // Both client and server trim: the client trims before submitting and the server
      // trims defensively before persisting, so whitespace-only DNs are never stored.
      vi.mocked(prisma.group.create).mockResolvedValue({
        ...BASE_GROUP,
        ldapDn: null,
      });

      await service.createGroup({ name: "Devs", ldapDn: "   " });

      expect(prisma.group.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ ldapDn: null }),
      });
    });

    it("preserves null ldapDn when explicitly passed null", async () => {
      vi.mocked(prisma.group.create).mockResolvedValue({
        ...BASE_GROUP,
        ldapDn: null,
      });

      await service.createGroup({ name: "Devs", ldapDn: null });

      expect(prisma.group.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ ldapDn: null }),
      });
    });

    it("omits ldapDn from repository call when not provided", async () => {
      vi.mocked(prisma.group.create).mockResolvedValue({
        ...BASE_GROUP,
        ldapDn: null,
      });

      await service.createGroup({ name: "Devs" });

      // ldapDn key should be absent from the data payload (not in input → not spread)
      const callArg = vi.mocked(prisma.group.create).mock.calls[0][0];
      expect(callArg.data).not.toHaveProperty("ldapDn");
    });
  });

  // ── updateGroup ─────────────────────────────────────────────────────────────

  describe("updateGroup", () => {
    const EXISTING_GROUP = {
      ...BASE_GROUP,
      ldapDn: "CN=OldGroup,OU=Groups,DC=corp,DC=local",
      members: [],
    };

    beforeEach(() => {
      // updateGroup always fetches the existing group first
      vi.mocked(prisma.group.findUnique).mockResolvedValue(EXISTING_GROUP as never);
    });

    it("updates ldapDn with a new valid DN", async () => {
      const newDn = "CN=NewGroup,OU=Groups,DC=corp,DC=local";
      vi.mocked(prisma.group.update).mockResolvedValue({
        ...BASE_GROUP,
        ldapDn: newDn,
      });

      await service.updateGroup("grp-1", { ldapDn: newDn });

      expect(prisma.group.update).toHaveBeenCalledWith({
        where: { id: "grp-1" },
        data: expect.objectContaining({ ldapDn: newDn }),
      });
    });

    it("normalizes empty string ldapDn to null on update", async () => {
      vi.mocked(prisma.group.update).mockResolvedValue({
        ...BASE_GROUP,
        ldapDn: null,
      });

      await service.updateGroup("grp-1", { ldapDn: "" });

      expect(prisma.group.update).toHaveBeenCalledWith({
        where: { id: "grp-1" },
        data: expect.objectContaining({ ldapDn: null }),
      });
    });

    it("normalizes whitespace-only ldapDn to null on update", async () => {
      vi.mocked(prisma.group.update).mockResolvedValue({
        ...BASE_GROUP,
        ldapDn: null,
      });

      await service.updateGroup("grp-1", { ldapDn: "   " });

      expect(prisma.group.update).toHaveBeenCalledWith({
        where: { id: "grp-1" },
        data: expect.objectContaining({ ldapDn: null }),
      });
    });

    it("does not touch ldapDn when it is not present in the input", async () => {
      vi.mocked(prisma.group.update).mockResolvedValue({
        ...BASE_GROUP,
        ldapDn: EXISTING_GROUP.ldapDn,
      });

      // Only updating description — ldapDn must not appear in the update payload
      await service.updateGroup("grp-1", { description: "New description" });

      const callArg = vi.mocked(prisma.group.update).mock.calls[0][0];
      expect(callArg.data).not.toHaveProperty("ldapDn");
    });

    it("sets ldapDn to null when explicitly passed null", async () => {
      vi.mocked(prisma.group.update).mockResolvedValue({
        ...BASE_GROUP,
        ldapDn: null,
      });

      await service.updateGroup("grp-1", { ldapDn: null });

      // null?.trim() → undefined → undefined || null → null
      expect(prisma.group.update).toHaveBeenCalledWith({
        where: { id: "grp-1" },
        data: expect.objectContaining({ ldapDn: null }),
      });
    });
  });
});
