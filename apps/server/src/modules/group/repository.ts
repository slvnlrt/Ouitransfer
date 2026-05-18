import { prisma } from "../../shared/prisma.js";

export class GroupRepository {
  async create(data: {
    name: string;
    description?: string;
    maxFileSizeOverride?: bigint | null;
    maxTotalStorageOverride?: bigint | null;
  }) {
    return prisma.group.create({ data });
  }

  async findById(id: string) {
    return prisma.group.findUnique({
      where: { id },
      include: {
        members: {
          select: {
            id: true,
            username: true,
            email: true,
            firstName: true,
            lastName: true,
            image: true,
          },
        },
      },
    });
  }

  async findByName(name: string) {
    return prisma.group.findUnique({ where: { name } });
  }

  async listAll() {
    return prisma.group.findMany({
      include: {
        _count: { select: { members: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      description?: string | null;
      maxFileSizeOverride?: bigint | null;
      maxTotalStorageOverride?: bigint | null;
    },
  ) {
    return prisma.group.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    // Prisma handles SET NULL for members via onDelete: SetNull
    return prisma.group.delete({ where: { id } });
  }

  async getMemberCount(groupId: string): Promise<number> {
    return prisma.user.count({ where: { groupId } });
  }

  async addMember(groupId: string, userId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { groupId },
    });
  }

  async removeMember(userId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { groupId: null },
    });
  }

  /**
   * Calculate total storage used by all members of a group.
   * Sums File.size + ReverseShareFile.size for all group members.
   */
  async calculateGroupStorageUsed(groupId: string): Promise<bigint> {
    const fileAgg = await prisma.file.aggregate({
      where: { user: { groupId } },
      _sum: { size: true },
    });
    const reverseShareAgg = await prisma.reverseShareFile.aggregate({
      where: { reverseShare: { creator: { groupId } } },
      _sum: { size: true },
    });
    return (fileAgg._sum.size ?? 0n) + (reverseShareAgg._sum.size ?? 0n);
  }

  /**
   * Calculate storage used by a single user (for member detail in group view).
   */
  async calculateMemberStorageUsed(userId: string): Promise<bigint> {
    const fileAgg = await prisma.file.aggregate({
      where: { userId },
      _sum: { size: true },
    });
    const reverseShareAgg = await prisma.reverseShareFile.aggregate({
      where: { reverseShare: { creatorId: userId } },
      _sum: { size: true },
    });
    return (fileAgg._sum.size ?? 0n) + (reverseShareAgg._sum.size ?? 0n);
  }
}
