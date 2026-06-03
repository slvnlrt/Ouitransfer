import bcrypt from "bcryptjs";

import { prisma } from "../../shared/prisma.js";
import type { CreateReverseShareInput, UpdateReverseShareInput } from "./dto.js";

export class ReverseShareRepository {
  async create(data: CreateReverseShareInput, creatorId: string) {
    const hashedPassword = data.password ? await this.hashPassword(data.password) : null;

    return prisma.reverseShare.create({
      data: {
        ...data,
        password: hashedPassword,
        maxFileSize: data.maxFileSize ? BigInt(data.maxFileSize) : null,
        creatorId,
      },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        files: true,
        alias: true,
      },
    });
  }

  async findById(id: string) {
    return prisma.reverseShare.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            isActive: true,
          },
        },
        files: true,
        alias: true,
      },
    });
  }

  async findByAlias(alias: string) {
    const reverseShareAlias = await prisma.reverseShareAlias.findUnique({
      where: { alias },
      include: {
        reverseShare: {
          include: {
            creator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                isActive: true,
              },
            },
            files: true,
            alias: true,
          },
        },
      },
    });

    return reverseShareAlias?.reverseShare || null;
  }

  async findByCreatorId(creatorId: string) {
    return prisma.reverseShare.findMany({
      where: { creatorId },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        files: true,
        alias: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(id: string, data: Partial<UpdateReverseShareInput>) {
    // We need to transform number values to their DB types (password → hash, maxFileSize → bigint)
    const { password, maxFileSize, ...rest } = data;

    type UpdatePayload = Omit<Partial<UpdateReverseShareInput>, "password" | "maxFileSize"> & {
      password?: string | null;
      maxFileSize?: bigint | null;
    };
    const updateData: UpdatePayload = { ...rest };

    if (password !== undefined) {
      updateData.password = password ? await this.hashPassword(password) : null;
    }

    if (maxFileSize !== undefined) {
      updateData.maxFileSize = maxFileSize ? BigInt(maxFileSize) : null;
    }

    return prisma.reverseShare.update({
      where: { id },
      data: updateData,
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        files: true,
        alias: true,
      },
    });
  }

  async delete(id: string) {
    return prisma.reverseShare.delete({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        files: true,
        alias: true,
      },
    });
  }

  async createFile(
    reverseShareId: string,
    fileData: {
      name: string;
      description?: string;
      extension: string;
      size: bigint;
      objectName: string;
      uploaderEmail?: string;
      uploaderName?: string;
    },
  ) {
    return prisma.reverseShareFile.create({
      data: {
        ...fileData,
        reverseShareId,
      },
    });
  }

  async findFileById(id: string) {
    return prisma.reverseShareFile.findUnique({
      where: { id },
      include: {
        reverseShare: {
          include: {
            creator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
    });
  }

  async deleteFile(id: string) {
    return prisma.reverseShareFile.delete({
      where: { id },
    });
  }

  async getFilesByReverseShareId(reverseShareId: string) {
    return prisma.reverseShareFile.findMany({
      where: { reverseShareId },
      orderBy: { createdAt: "desc" },
    });
  }

  async countFilesByReverseShareId(reverseShareId: string) {
    return prisma.reverseShareFile.count({
      where: { reverseShareId },
    });
  }

  async updateFile(fileId: string, data: { name?: string; description?: string | null }) {
    return prisma.reverseShareFile.update({
      where: { id: fileId },
      data,
      include: {
        reverseShare: {
          include: {
            creator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
    });
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async comparePassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }
}
