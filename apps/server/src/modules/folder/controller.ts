import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../shared/prisma.js";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/app-error.js";
import {
  CheckFolderSchema,
  ListFoldersSchema,
  MoveFolderSchema,
  RegisterFolderSchema,
  UpdateFolderSchema,
} from "./dto.js";
import { FolderService } from "./service.js";

export class FolderController {
  private folderService = new FolderService();

  async registerFolder(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const input = RegisterFolderSchema.parse(request.body);

    if (input.parentId) {
      const parentFolder = await prisma.folder.findFirst({
        where: { id: input.parentId, userId },
      });
      if (!parentFolder) {
        throw new ValidationError("Parent folder not found or access denied");
      }
    }

    // Check for duplicates and auto-rename if necessary
    const { generateUniqueFolderName } = await import("../../utils/file-name-generator.js");
    const uniqueName = await generateUniqueFolderName(input.name, userId, input.parentId);

    const folderRecord = await prisma.folder.create({
      data: {
        name: uniqueName,
        description: input.description,
        objectName: input.objectName,
        parentId: input.parentId,
        userId,
      },
      include: {
        _count: {
          select: {
            files: true,
            children: true,
          },
        },
      },
    });

    const totalSize = await this.folderService.calculateFolderSize(folderRecord.id, userId);

    const folderResponse = {
      id: folderRecord.id,
      name: folderRecord.name,
      description: folderRecord.description,
      objectName: folderRecord.objectName,
      parentId: folderRecord.parentId,
      userId: folderRecord.userId,
      createdAt: folderRecord.createdAt,
      updatedAt: folderRecord.updatedAt,
      totalSize: totalSize.toString(),
      _count: folderRecord._count,
    };

    return reply.status(201).send({
      folder: folderResponse,
      message: "Folder registered successfully.",
    });
  }

  async checkFolder(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const input = CheckFolderSchema.parse(request.body);

    if (input.name.length > 100) {
      throw new ValidationError("Folder name exceeds maximum length of 100 characters");
    }

    const existingFolder = await prisma.folder.findFirst({
      where: {
        name: input.name,
        parentId: input.parentId || null,
        userId,
      },
    });

    if (existingFolder) {
      throw new ValidationError("A folder with this name already exists in this location");
    }

    return reply.status(201).send({
      message: "Folder checks succeeded.",
    });
  }

  async listFolders(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const input = ListFoldersSchema.parse(request.query);
    const { parentId, recursive: recursiveStr } = input;
    const recursive = recursiveStr !== "false";

    let folders: Array<{
      id: string;
      name: string;
      description: string | null;
      objectName: string;
      parentId: string | null;
      userId: string;
      createdAt: Date;
      updatedAt: Date;
      _count: { files: number; children: number };
    }>;

    if (recursive) {
      folders = await prisma.folder.findMany({
        where: { userId },
        include: {
          _count: {
            select: {
              files: true,
              children: true,
            },
          },
        },
        orderBy: [{ name: "asc" }],
      });
    } else {
      // Get only direct children of specified parent
      const targetParentId = parentId === "null" || parentId === "" || !parentId ? null : parentId;
      folders = await prisma.folder.findMany({
        where: {
          userId,
          parentId: targetParentId,
        },
        include: {
          _count: {
            select: {
              files: true,
              children: true,
            },
          },
        },
        orderBy: [{ name: "asc" }],
      });
    }

    const foldersResponse = await Promise.all(
      folders.map(async (folder) => {
        const totalSize = await this.folderService.calculateFolderSize(folder.id, userId);
        return {
          id: folder.id,
          name: folder.name,
          description: folder.description,
          objectName: folder.objectName,
          parentId: folder.parentId,
          userId: folder.userId,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          totalSize: totalSize.toString(),
          _count: folder._count,
        };
      }),
    );

    return reply.send({ folders: foldersResponse });
  }

  async updateFolder(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const { id } = request.params as { id: string };
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const updateData = UpdateFolderSchema.parse(request.body);

    const folderRecord = await prisma.folder.findUnique({ where: { id } });

    if (!folderRecord) {
      throw new NotFoundError("Folder not found.");
    }

    if (folderRecord.userId !== userId) {
      throw new ForbiddenError("Access denied.");
    }

    // If renaming the folder, check for duplicates and auto-rename if necessary
    if (updateData.name && updateData.name !== folderRecord.name) {
      const { generateUniqueFolderName } = await import("../../utils/file-name-generator.js");
      const uniqueName = await generateUniqueFolderName(
        updateData.name,
        userId,
        folderRecord.parentId,
        id,
      );
      updateData.name = uniqueName;
    }

    const updatedFolder = await prisma.folder.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: {
            files: true,
            children: true,
          },
        },
      },
    });

    const totalSize = await this.folderService.calculateFolderSize(updatedFolder.id, userId);

    const folderResponse = {
      id: updatedFolder.id,
      name: updatedFolder.name,
      description: updatedFolder.description,
      objectName: updatedFolder.objectName,
      parentId: updatedFolder.parentId,
      userId: updatedFolder.userId,
      createdAt: updatedFolder.createdAt,
      updatedAt: updatedFolder.updatedAt,
      totalSize: totalSize.toString(),
      _count: updatedFolder._count,
    };

    return reply.send({
      folder: folderResponse,
      message: "Folder updated successfully.",
    });
  }

  async moveFolder(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { id } = request.params as { id: string };
    const body = request.body as { parentId?: string | null };

    const input = {
      parentId: body.parentId === undefined ? null : body.parentId,
    };

    const validatedInput = MoveFolderSchema.parse(input);

    const existingFolder = await prisma.folder.findFirst({
      where: { id, userId },
    });

    if (!existingFolder) {
      throw new NotFoundError("Folder not found.");
    }

    if (validatedInput.parentId) {
      const parentFolder = await prisma.folder.findFirst({
        where: { id: validatedInput.parentId, userId },
      });
      if (!parentFolder) {
        throw new ValidationError("Parent folder not found or access denied");
      }

      if (await this.isDescendantOf(validatedInput.parentId, id, userId)) {
        throw new ValidationError("Cannot move a folder into itself or its subfolders");
      }
    }

    const updatedFolder = await prisma.folder.update({
      where: { id },
      data: { parentId: validatedInput.parentId },
      include: {
        _count: {
          select: {
            files: true,
            children: true,
          },
        },
      },
    });

    const totalSize = await this.folderService.calculateFolderSize(updatedFolder.id, userId);

    const folderResponse = {
      id: updatedFolder.id,
      name: updatedFolder.name,
      description: updatedFolder.description,
      objectName: updatedFolder.objectName,
      parentId: updatedFolder.parentId,
      userId: updatedFolder.userId,
      createdAt: updatedFolder.createdAt,
      updatedAt: updatedFolder.updatedAt,
      totalSize: totalSize.toString(),
      _count: updatedFolder._count,
    };

    return reply.send({
      folder: folderResponse,
      message: "Folder moved successfully.",
    });
  }

  async deleteFolder(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const { id } = request.params as { id: string };
    if (!id) {
      throw new ValidationError("The 'id' parameter is required.");
    }

    const folderRecord = await prisma.folder.findUnique({ where: { id } });
    if (!folderRecord) {
      throw new NotFoundError("Folder not found.");
    }

    const userId = request.user?.userId;
    if (folderRecord.userId !== userId) {
      throw new ForbiddenError("Access denied.");
    }

    await this.folderService.deleteObject(folderRecord.objectName);

    await prisma.folder.delete({ where: { id } });

    return reply.send({ message: "Folder deleted successfully." });
  }

  private async isDescendantOf(
    potentialDescendantId: string,
    ancestorId: string,
    userId: string,
  ): Promise<boolean> {
    let currentId: string | null = potentialDescendantId;

    while (currentId) {
      if (currentId === ancestorId) {
        return true;
      }

      const folder: { parentId: string | null } | null = await prisma.folder.findFirst({
        where: { id: currentId, userId },
      });

      if (!folder) break;
      currentId = folder.parentId;
    }

    return false;
  }
}
