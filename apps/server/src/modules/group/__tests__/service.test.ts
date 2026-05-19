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
import { ConflictError, NotFoundError } from "../../../utils/app-error.js";
import { GroupService } from "../service.js";

function makeAgg(size: bigint) {
  return { _sum: { size }, _count: 0, _avg: {}, _min: {}, _max: {} } as never;
}

describe("GroupService", () => {
  let service: GroupService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GroupService();
  });

  // ── Create ──────────────────────────────────────────────────────────

  describe("createGroup", () => {
    it("creates a group successfully", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.group.create).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        description: null,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
        ldapDn: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createGroup({ name: "Engineering" });
      expect(result.name).toBe("Engineering");
      expect(prisma.group.create).toHaveBeenCalledWith({
        data: { name: "Engineering" },
      });
    });

    it("throws ConflictError on duplicate name", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({
        id: "grp-existing",
        name: "Engineering",
      } as never);

      await expect(service.createGroup({ name: "Engineering" })).rejects.toThrow(ConflictError);
    });
  });

  // ── Update ──────────────────────────────────────────────────────────

  describe("updateGroup", () => {
    it("updates group quotas", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        description: null,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
        ldapDn: null,
        members: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      vi.mocked(prisma.group.update).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        description: null,
        maxFileSizeOverride: 1073741824n,
        maxTotalStorageOverride: null,
        ldapDn: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.updateGroup("grp-1", { maxFileSizeOverride: 1073741824n });
      expect(result.maxFileSizeOverride).toBe(1073741824n);
    });

    it("throws NotFoundError for non-existent group", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue(null);
      await expect(service.updateGroup("grp-nope", { name: "Nope" })).rejects.toThrow(
        NotFoundError,
      );
    });

    it("throws ConflictError when renaming to existing name", async () => {
      vi.mocked(prisma.group.findUnique)
        .mockResolvedValueOnce({
          id: "grp-1",
          name: "Engineering",
          members: [],
        } as never)
        .mockResolvedValueOnce({ id: "grp-2", name: "Sales" } as never);

      await expect(service.updateGroup("grp-1", { name: "Sales" })).rejects.toThrow(ConflictError);
    });
  });

  // ── Delete ──────────────────────────────────────────────────────────

  describe("deleteGroup", () => {
    it("deletes a group and returns unassigned member count", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        members: [],
      } as never);
      vi.mocked(prisma.user.count).mockResolvedValue(5);
      vi.mocked(prisma.group.delete).mockResolvedValue({} as never);

      const result = await service.deleteGroup("grp-1");
      expect(result.unassignedCount).toBe(5);
    });

    it("throws NotFoundError for non-existent group", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue(null);
      await expect(service.deleteGroup("grp-nope")).rejects.toThrow(NotFoundError);
    });
  });

  // ── Members ─────────────────────────────────────────────────────────

  describe("addMember", () => {
    it("adds a user to a group", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        members: [],
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        groupId: null,
      } as never);
      vi.mocked(prisma.user.update).mockResolvedValue({} as never);

      const result = await service.addMember("grp-1", "user-1");
      expect(result.previousGroupId).toBeUndefined();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { groupId: "grp-1" },
      });
    });

    it("moves a user from another group and returns previousGroupId", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({
        id: "grp-2",
        name: "Sales",
        members: [],
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        groupId: "grp-1",
      } as never);
      vi.mocked(prisma.user.update).mockResolvedValue({} as never);

      const result = await service.addMember("grp-2", "user-1");
      expect(result.previousGroupId).toBe("grp-1");
    });

    it("short-circuits when user is already in the same group", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        members: [],
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        groupId: "grp-1",
      } as never);

      const result = await service.addMember("grp-1", "user-1");
      expect(result.previousGroupId).toBeUndefined();
      expect(prisma.user.update).not.toHaveBeenCalled(); // No DB write
    });

    it("throws NotFoundError for non-existent user", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        members: [],
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(service.addMember("grp-1", "user-nope")).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError for non-existent group", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue(null);

      await expect(service.addMember("grp-nope", "user-1")).rejects.toThrow(NotFoundError);
    });
  });

  describe("removeMember", () => {
    it("removes a user from a group", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        members: [],
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        groupId: "grp-1",
      } as never);
      vi.mocked(prisma.user.update).mockResolvedValue({} as never);

      await service.removeMember("grp-1", "user-1");
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { groupId: null },
      });
    });

    it("throws NotFoundError if user is not in this group", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        members: [],
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        groupId: "grp-other",
      } as never);

      await expect(service.removeMember("grp-1", "user-1")).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError for non-existent group", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue(null);

      await expect(service.removeMember("grp-nope", "user-1")).rejects.toThrow(NotFoundError);
    });
  });

  // ── List ────────────────────────────────────────────────────────────

  describe("listGroups", () => {
    it("returns groups with memberCount and storageUsed", async () => {
      vi.mocked(prisma.group.findMany).mockResolvedValue([
        {
          id: "grp-1",
          name: "Engineering",
          description: null,
          maxFileSizeOverride: null,
          maxTotalStorageOverride: null,
          ldapDn: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { members: 3 },
        },
      ] as never);
      vi.mocked(prisma.file.aggregate).mockResolvedValue(makeAgg(1000n));
      vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue(makeAgg(500n));

      const result = await service.listGroups();
      expect(result).toHaveLength(1);
      expect(result[0].memberCount).toBe(3);
      expect(result[0].storageUsed).toBe(1500n);
    });
  });

  // ── Detail ──────────────────────────────────────────────────────────

  describe("getGroupDetail", () => {
    it("returns group detail with members enriched with storageUsed", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        description: "Engineering team",
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
        ldapDn: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        members: [
          {
            id: "user-1",
            username: "alice",
            email: "alice@test.com",
            firstName: "Alice",
            lastName: "Smith",
            image: null,
          },
          {
            id: "user-2",
            username: "bob",
            email: "bob@test.com",
            firstName: "Bob",
            lastName: "Jones",
            image: null,
          },
        ],
      } as never);

      // Mock storage for each member
      vi.mocked(prisma.file.aggregate)
        .mockResolvedValueOnce(makeAgg(1000n)) // alice files
        .mockResolvedValueOnce(makeAgg(2000n)); // bob files
      vi.mocked(prisma.reverseShareFile.aggregate)
        .mockResolvedValueOnce(makeAgg(100n)) // alice reverse
        .mockResolvedValueOnce(makeAgg(200n)); // bob reverse

      const result = await service.getGroupDetail("grp-1");
      expect(result.name).toBe("Engineering");
      expect(result.members).toHaveLength(2);
      expect(result.members[0].storageUsed).toBe(1100n); // 1000+100
      expect(result.members[1].storageUsed).toBe(2200n); // 2000+200
    });

    it("throws NotFoundError for non-existent group", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue(null);
      await expect(service.getGroupDetail("grp-nope")).rejects.toThrow(NotFoundError);
    });
  });
});
