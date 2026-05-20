import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { prisma } from "../../shared/prisma.js";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import {
  CheckFolderSchema,
  ListFoldersSchema,
  MoveFolderSchema,
  RegisterFolderSchema,
  UpdateFolderSchema,
} from "./dto.js";
import { FolderService } from "./service.js";

const folderService = new FolderService();

// ── Module-level helpers ─────────────────────────────────────

/**
 * Check if `potentialDescendantId` is a descendant of `ancestorId`
 * in the folder tree for a given user. Used to prevent circular moves.
 */
async function isDescendantOf(
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

// ── Pre-validation hook ──────────────────────────────────────

const preValidation = async (request: FastifyRequest) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    request.log.warn({ err }, "JWT verification failed");
    throw new UnauthorizedError("Invalid or missing token");
  }
};

// ── Routes ───────────────────────────────────────────────────

export const folderRoutes: FastifyPluginAsyncZod = async (app) => {
  // POST /folders — register folder
  app.route({
    method: "POST",
    url: "/folders",
    preValidation,
    schema: {
      tags: ["Folder"],
      operationId: "registerFolder",
      summary: "Register Folder Metadata",
      description: "Registers folder metadata in the database",
      body: RegisterFolderSchema,
      response: {
        201: z.object({
          folder: z.object({
            id: z.string().describe("The folder ID"),
            name: z.string().describe("The folder name"),
            description: z.string().nullable().describe("The folder description"),
            parentId: z.string().nullable().describe("The parent folder ID"),
            userId: z.string().describe("The user ID"),
            createdAt: z.date().describe("The folder creation date"),
            updatedAt: z.date().describe("The folder last update date"),
            totalSize: z.string().optional().describe("The total size of the folder"),
            _count: z
              .object({
                files: z.number().describe("Number of files in folder"),
                children: z.number().describe("Number of subfolders"),
              })
              .optional()
              .describe("Count statistics"),
          }),
          message: z.string().describe("The folder registration message"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }

      const input = request.body;

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

      const totalSize = await folderService.calculateFolderSize(folderRecord.id, userId);

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
    },
  });

  // POST /folders/check — check folder validity
  app.route({
    method: "POST",
    url: "/folders/check",
    preValidation,
    schema: {
      tags: ["Folder"],
      operationId: "checkFolder",
      summary: "Check Folder validity",
      description: "Checks if the folder meets all requirements",
      body: CheckFolderSchema,
      response: {
        201: z.object({
          message: z.string().describe("The folder check success message"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }

      const input = request.body;

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
    },
  });

  // GET /folders — list folders
  app.route({
    method: "GET",
    url: "/folders",
    preValidation,
    schema: {
      tags: ["Folder"],
      operationId: "listFolders",
      summary: "List Folders",
      description: "Lists user folders recursively by default, optionally filtered by folder",
      querystring: ListFoldersSchema,
      response: {
        200: z.object({
          folders: z.array(
            z.object({
              id: z.string().describe("The folder ID"),
              name: z.string().describe("The folder name"),
              description: z.string().nullable().describe("The folder description"),
              parentId: z.string().nullable().describe("The parent folder ID"),
              userId: z.string().describe("The user ID"),
              createdAt: z.date().describe("The folder creation date"),
              updatedAt: z.date().describe("The folder last update date"),
              totalSize: z.string().optional().describe("The total size of the folder"),
              _count: z
                .object({
                  files: z.number().describe("Number of files in folder"),
                  children: z.number().describe("Number of subfolders"),
                })
                .optional()
                .describe("Count statistics"),
            }),
          ),
        }),
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }

      const { parentId, recursive: recursiveStr } = request.query;
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
        const targetParentId =
          parentId === "null" || parentId === "" || !parentId ? null : parentId;
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
          const totalSize = await folderService.calculateFolderSize(folder.id, userId);
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
    },
  });

  // PATCH /folders/:id — update folder
  app.route({
    method: "PATCH",
    url: "/folders/:id",
    preValidation,
    schema: {
      tags: ["Folder"],
      operationId: "updateFolder",
      summary: "Update Folder Metadata",
      description: "Updates folder metadata in the database",
      params: z.object({
        id: z.string().min(1, "The folder id is required").describe("The folder ID"),
      }),
      body: UpdateFolderSchema,
      response: {
        200: z.object({
          folder: z.object({
            id: z.string().describe("The folder ID"),
            name: z.string().describe("The folder name"),
            description: z.string().nullable().describe("The folder description"),
            parentId: z.string().nullable().describe("The parent folder ID"),
            userId: z.string().describe("The user ID"),
            createdAt: z.date().describe("The folder creation date"),
            updatedAt: z.date().describe("The folder last update date"),
            totalSize: z.string().optional().describe("The total size of the folder"),
            _count: z
              .object({
                files: z.number().describe("Number of files in folder"),
                children: z.number().describe("Number of subfolders"),
              })
              .optional()
              .describe("Count statistics"),
          }),
          message: z.string().describe("Success message"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const userId = request.user?.userId;

      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }

      const updateData = request.body;

      const folderRecord = await prisma.folder.findUnique({ where: { id } });

      if (!folderRecord) {
        throw new NotFoundError("Folder not found.");
      }

      if (folderRecord.userId !== userId) {
        throw new ForbiddenError("Access denied.");
      }

      // If renaming the folder, check for duplicates and auto-rename if necessary
      const mutableData = { ...updateData };
      if (mutableData.name && mutableData.name !== folderRecord.name) {
        const { generateUniqueFolderName } = await import("../../utils/file-name-generator.js");
        const uniqueName = await generateUniqueFolderName(
          mutableData.name,
          userId,
          folderRecord.parentId,
          id,
        );
        mutableData.name = uniqueName;
      }

      const updatedFolder = await prisma.folder.update({
        where: { id },
        data: mutableData,
        include: {
          _count: {
            select: {
              files: true,
              children: true,
            },
          },
        },
      });

      const totalSize = await folderService.calculateFolderSize(updatedFolder.id, userId);

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
    },
  });

  // PUT /folders/:id/move — move folder
  app.route({
    method: "PUT",
    url: "/folders/:id/move",
    preValidation,
    schema: {
      tags: ["Folder"],
      operationId: "moveFolder",
      summary: "Move Folder",
      description: "Moves a folder to a different parent folder",
      params: z.object({
        id: z.string().min(1, "The folder id is required").describe("The folder ID"),
      }),
      body: MoveFolderSchema,
      response: {
        200: z.object({
          folder: z.object({
            id: z.string().describe("The folder ID"),
            name: z.string().describe("The folder name"),
            description: z.string().nullable().describe("The folder description"),
            parentId: z.string().nullable().describe("The parent folder ID"),
            userId: z.string().describe("The user ID"),
            createdAt: z.date().describe("The folder creation date"),
            updatedAt: z.date().describe("The folder last update date"),
            totalSize: z.string().optional().describe("The total size of the folder"),
            _count: z
              .object({
                files: z.number().describe("Number of files in folder"),
                children: z.number().describe("Number of subfolders"),
              })
              .optional()
              .describe("Count statistics"),
          }),
          message: z.string().describe("Success message"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;

      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }

      const { id } = request.params;
      const input = request.body;

      const existingFolder = await prisma.folder.findFirst({
        where: { id, userId },
      });

      if (!existingFolder) {
        throw new NotFoundError("Folder not found.");
      }

      if (input.parentId) {
        const parentFolder = await prisma.folder.findFirst({
          where: { id: input.parentId, userId },
        });
        if (!parentFolder) {
          throw new ValidationError("Parent folder not found or access denied");
        }

        if (await isDescendantOf(input.parentId, id, userId)) {
          throw new ValidationError("Cannot move a folder into itself or its subfolders");
        }
      }

      const updatedFolder = await prisma.folder.update({
        where: { id },
        data: { parentId: input.parentId },
        include: {
          _count: {
            select: {
              files: true,
              children: true,
            },
          },
        },
      });

      const totalSize = await folderService.calculateFolderSize(updatedFolder.id, userId);

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
    },
  });

  // DELETE /folders/:id — delete folder
  app.route({
    method: "DELETE",
    url: "/folders/:id",
    preValidation,
    schema: {
      tags: ["Folder"],
      operationId: "deleteFolder",
      summary: "Delete Folder",
      description: "Deletes a folder and all its contents",
      params: z.object({
        id: z.string().min(1, "The folder id is required").describe("The folder ID"),
      }),
      response: {
        200: z.object({
          message: z.string().describe("The folder deletion message"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const folderRecord = await prisma.folder.findUnique({ where: { id } });
      if (!folderRecord) {
        throw new NotFoundError("Folder not found.");
      }

      const userId = request.user?.userId;
      if (folderRecord.userId !== userId) {
        throw new ForbiddenError("Access denied.");
      }

      await folderService.deleteObject(folderRecord.objectName);

      await prisma.folder.delete({ where: { id } });

      return reply.send({ message: "Folder deleted successfully." });
    },
  });
};
