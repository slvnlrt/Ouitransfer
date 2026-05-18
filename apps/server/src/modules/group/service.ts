import { prisma } from "../../shared/prisma.js";
import { ConflictError, NotFoundError } from "../../utils/app-error.js";
import { GroupRepository } from "./repository.js";

export class GroupService {
  private repository = new GroupRepository();

  async createGroup(input: {
    name: string;
    description?: string;
    maxFileSizeOverride?: bigint | null;
    maxTotalStorageOverride?: bigint | null;
  }) {
    const existing = await this.repository.findByName(input.name);
    if (existing) {
      throw new ConflictError("A group with this name already exists");
    }
    return this.repository.create(input);
  }

  async getGroupById(id: string) {
    const group = await this.repository.findById(id);
    if (!group) {
      throw new NotFoundError("Group not found");
    }
    return group;
  }

  async listGroups() {
    const groups = await this.repository.listAll();
    // Enrich each group with storageUsed
    const enriched = await Promise.all(
      groups.map(async (group) => {
        const storageUsed = await this.repository.calculateGroupStorageUsed(group.id);
        return {
          ...group,
          memberCount: group._count.members,
          storageUsed,
        };
      }),
    );
    return enriched;
  }

  async updateGroup(
    id: string,
    input: {
      name?: string;
      description?: string | null;
      maxFileSizeOverride?: bigint | null;
      maxTotalStorageOverride?: bigint | null;
    },
  ) {
    const group = await this.repository.findById(id);
    if (!group) {
      throw new NotFoundError("Group not found");
    }

    // Check name uniqueness if name is being changed
    if (input.name !== undefined && input.name !== group.name) {
      const existing = await this.repository.findByName(input.name);
      if (existing) {
        throw new ConflictError("A group with this name already exists");
      }
    }

    return this.repository.update(id, input);
  }

  async deleteGroup(id: string) {
    const group = await this.repository.findById(id);
    if (!group) {
      throw new NotFoundError("Group not found");
    }

    const memberCount = await this.repository.getMemberCount(id);
    await this.repository.delete(id);

    return { unassignedCount: memberCount };
  }

  async addMember(groupId: string, userId: string) {
    // Verify group exists
    const group = await this.repository.findById(groupId);
    if (!group) {
      throw new NotFoundError("Group not found");
    }

    // Check if user exists and get their current group
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, groupId: true },
    });
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const previousGroupId = user.groupId;

    // Move user to this group (handles already-in-same-group and already-in-different-group)
    await this.repository.addMember(groupId, userId);

    return { previousGroupId: previousGroupId !== groupId ? previousGroupId : undefined };
  }

  async removeMember(groupId: string, userId: string) {
    // Verify group exists
    const group = await this.repository.findById(groupId);
    if (!group) {
      throw new NotFoundError("Group not found");
    }

    // Verify user is actually in this group
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, groupId: true },
    });
    if (!user) {
      throw new NotFoundError("User not found");
    }
    if (user.groupId !== groupId) {
      throw new NotFoundError("User is not a member of this group");
    }

    await this.repository.removeMember(userId);
  }

  async getGroupDetail(id: string) {
    const group = await this.getGroupById(id);

    // Enrich members with storageUsed
    const membersWithStorage = await Promise.all(
      group.members.map(async (member) => {
        const storageUsed = await this.repository.calculateMemberStorageUsed(member.id);
        return { ...member, storageUsed };
      }),
    );

    return {
      ...group,
      members: membersWithStorage,
    };
  }
}
