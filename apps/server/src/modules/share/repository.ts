import crypto from "node:crypto";
import type {
  File,
  Folder,
  Share,
  ShareAlias,
  ShareRecipient,
  ShareSecurity,
  User,
} from "../../generated/prisma/client.js";

import { prisma } from "../../shared/prisma.js";
import type { CreateShareInput } from "./dto.js";

type FolderWithCount = Folder & {
  _count: { files: number; children: number };
};

type CreatorInfo = Pick<User, "email" | "locale" | "isActive"> | null;

export interface IShareRepository {
  createShare(
    data: Omit<CreateShareInput, "password"> & {
      securityId: string;
      creatorId: string;
      maxViews?: number | null;
    },
  ): Promise<Share>;
  incrementViewsAtomic(
    shareId: string,
    maxViews: number | null,
  ): Promise<{ incremented: boolean; newViews: number }>;
  findShareById(id: string): Promise<
    | (Share & {
        security: ShareSecurity;
        files: File[];
        folders: FolderWithCount[];
        recipients: ShareRecipient[];
        alias: ShareAlias | null;
        creator: CreatorInfo;
      })
    | null
  >;
  findShareBySecurityId(
    securityId: string,
  ): Promise<
    (Share & { security: ShareSecurity; files: File[]; folders: FolderWithCount[] }) | null
  >;
  findShareByAlias(alias: string): Promise<
    | (Share & {
        security: ShareSecurity;
        files: File[];
        folders: FolderWithCount[];
        recipients: ShareRecipient[];
        alias: ShareAlias | null;
        creator: CreatorInfo;
      })
    | null
  >;
  updateShare(id: string, data: Partial<Share>): Promise<Share>;
  updateShareSecurity(id: string, data: Partial<ShareSecurity>): Promise<ShareSecurity>;
  deleteShare(id: string): Promise<Share>;
  incrementViews(id: string): Promise<Share>;
  addFilesToShare(shareId: string, fileIds: string[]): Promise<void>;
  removeFilesFromShare(shareId: string, fileIds: string[]): Promise<void>;
  addFoldersToShare(shareId: string, folderIds: string[]): Promise<void>;
  removeFoldersFromShare(shareId: string, folderIds: string[]): Promise<void>;
  findFilesByIds(fileIds: string[]): Promise<File[]>;
  findFoldersByIds(folderIds: string[]): Promise<Folder[]>;
  addRecipients(
    shareId: string,
    recipients: Array<{ email: string; name?: string | null }>,
  ): Promise<void>;
  removeRecipients(shareId: string, emails: string[]): Promise<void>;
  findSharesByUserId(userId: string): Promise<
    (Share & {
      security: ShareSecurity;
      files: File[];
      folders: FolderWithCount[];
      recipients: ShareRecipient[];
      alias: ShareAlias | null;
      creator: CreatorInfo;
    })[]
  >;
}

export class PrismaShareRepository implements IShareRepository {
  async createShare(
    data: Omit<CreateShareInput, "password"> & {
      securityId: string;
      creatorId: string;
      maxViews?: number | null;
    },
  ): Promise<Share> {
    const { files, folders, recipients, expiration, ...shareData } = data;

    const validFiles = (files ?? []).filter((id) => id && id.trim().length > 0);
    const validFolders = (folders ?? []).filter((id) => id && id.trim().length > 0);
    const validRecipients = (recipients ?? []).filter((email) => email && email.trim().length > 0);

    return prisma.share.create({
      data: {
        ...shareData,
        expiration: expiration ? new Date(expiration) : null,
        files:
          validFiles.length > 0
            ? {
                connect: validFiles.map((id) => ({ id })),
              }
            : undefined,
        folders:
          validFolders.length > 0
            ? {
                connect: validFolders.map((id) => ({ id })),
              }
            : undefined,
        recipients:
          validRecipients?.length > 0
            ? {
                create: validRecipients.map((email) => ({
                  email: email.trim().toLowerCase(),
                  trackingToken: crypto.randomBytes(24).toString("base64url"),
                })),
              }
            : undefined,
      },
    });
  }

  async findShareById(id: string) {
    return prisma.share.findUnique({
      where: { id },
      include: {
        alias: true,
        security: true,
        files: true,
        folders: {
          select: {
            id: true,
            name: true,
            description: true,
            objectName: true,
            parentId: true,
            userId: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                files: true,
                children: true,
              },
            },
          },
        },
        recipients: true,
        creator: {
          select: {
            email: true,
            locale: true,
            isActive: true,
          },
        },
      },
    });
  }

  async findShareBySecurityId(securityId: string) {
    return prisma.share.findUnique({
      where: { securityId },
      include: {
        security: true,
        files: true,
        folders: {
          select: {
            id: true,
            name: true,
            description: true,
            objectName: true,
            parentId: true,
            userId: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                files: true,
                children: true,
              },
            },
          },
        },
      },
    });
  }

  async findShareByAlias(alias: string) {
    const shareAlias = await prisma.shareAlias.findUnique({
      where: { alias },
      include: {
        share: {
          include: {
            alias: true,
            security: true,
            files: true,
            folders: {
              select: {
                id: true,
                name: true,
                description: true,
                objectName: true,
                parentId: true,
                userId: true,
                createdAt: true,
                updatedAt: true,
                _count: {
                  select: {
                    files: true,
                    children: true,
                  },
                },
              },
            },
            recipients: true,
            creator: {
              select: {
                email: true,
                locale: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    return shareAlias?.share || null;
  }

  async updateShare(id: string, data: Partial<Share>): Promise<Share> {
    return prisma.share.update({
      where: { id },
      data,
    });
  }

  async updateShareSecurity(id: string, data: Partial<ShareSecurity>): Promise<ShareSecurity> {
    return prisma.shareSecurity.update({
      where: { id },
      data,
    });
  }

  async deleteShare(id: string): Promise<Share> {
    return prisma.share.delete({
      where: { id },
    });
  }

  async incrementViews(id: string): Promise<Share> {
    return prisma.share.update({
      where: { id },
      data: {
        views: {
          increment: 1,
        },
      },
    });
  }

  /**
   * Atomically increment the view count only if the current count is below maxViews.
   * When maxViews is null (unlimited), always increments.
   * Returns { incremented: true/false, newViews: post-increment count }.
   */
  async incrementViewsAtomic(
    shareId: string,
    maxViews: number | null,
  ): Promise<{ incremented: boolean; newViews: number }> {
    if (maxViews === null) {
      const updated = await prisma.share.update({
        where: { id: shareId },
        data: { views: { increment: 1 } },
        select: { views: true },
      });
      return { incremented: true, newViews: updated.views };
    }
    const result = await prisma.share.updateMany({
      where: { id: shareId, views: { lt: maxViews } },
      data: { views: { increment: 1 } },
    });
    if (result.count === 0) {
      // Max views already reached — read current count for the response
      const current = await prisma.share.findUnique({
        where: { id: shareId },
        select: { views: true },
      });
      return { incremented: false, newViews: current?.views ?? 0 };
    }
    // Read the actual post-increment value (avoids pre-increment snapshot race)
    const updated = await prisma.share.findUnique({
      where: { id: shareId },
      select: { views: true },
    });
    return { incremented: true, newViews: updated?.views ?? 0 };
  }

  async addFilesToShare(shareId: string, fileIds: string[]): Promise<void> {
    await prisma.share.update({
      where: { id: shareId },
      data: {
        files: {
          connect: fileIds.map((id) => ({ id })),
        },
      },
    });
  }

  async addFoldersToShare(shareId: string, folderIds: string[]): Promise<void> {
    await prisma.share.update({
      where: { id: shareId },
      data: {
        folders: {
          connect: folderIds.map((id) => ({ id })),
        },
      },
    });
  }

  async removeFilesFromShare(shareId: string, fileIds: string[]): Promise<void> {
    await prisma.share.update({
      where: { id: shareId },
      data: {
        files: {
          disconnect: fileIds.map((id) => ({ id })),
        },
      },
    });
  }

  async removeFoldersFromShare(shareId: string, folderIds: string[]): Promise<void> {
    await prisma.share.update({
      where: { id: shareId },
      data: {
        folders: {
          disconnect: folderIds.map((id) => ({ id })),
        },
      },
    });
  }

  async findFilesByIds(fileIds: string[]): Promise<File[]> {
    return prisma.file.findMany({
      where: {
        id: {
          in: fileIds,
        },
      },
    });
  }

  async findFoldersByIds(folderIds: string[]): Promise<Folder[]> {
    return prisma.folder.findMany({
      where: {
        id: {
          in: folderIds,
        },
      },
    });
  }

  async addRecipients(
    shareId: string,
    recipients: Array<{ email: string; name?: string | null }>,
  ): Promise<void> {
    await prisma.share.update({
      where: { id: shareId },
      data: {
        recipients: {
          create: recipients.map((r) => ({
            email: r.email.trim().toLowerCase(),
            name: r.name || null,
            trackingToken: crypto.randomBytes(24).toString("base64url"),
          })),
        },
      },
    });
  }

  async removeRecipients(shareId: string, emails: string[]): Promise<void> {
    const normalizedEmails = emails.map((e) => e.trim().toLowerCase());
    await prisma.share.update({
      where: { id: shareId },
      data: {
        recipients: {
          deleteMany: {
            email: {
              in: normalizedEmails,
            },
          },
        },
      },
    });
  }

  async findSharesByUserId(userId: string) {
    return prisma.share.findMany({
      where: {
        creatorId: userId,
      },
      include: {
        security: true,
        files: true,
        folders: {
          select: {
            id: true,
            name: true,
            description: true,
            objectName: true,
            parentId: true,
            userId: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                files: true,
                children: true,
              },
            },
          },
        },
        recipients: true,
        alias: true,
        creator: {
          select: {
            email: true,
            locale: true,
            isActive: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }
}
