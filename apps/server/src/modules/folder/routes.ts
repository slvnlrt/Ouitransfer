import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { UnauthorizedError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { FolderController } from "./controller.js";
import {
  CheckFolderSchema,
  ListFoldersSchema,
  MoveFolderSchema,
  RegisterFolderSchema,
  UpdateFolderSchema,
} from "./dto.js";

export async function folderRoutes(app: FastifyInstance) {
  const folderController = new FolderController();

  const preValidation = async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      request.log.error({ err }, "JWT verification failed");
      throw new UnauthorizedError("Invalid or missing token");
    }
  };

  app.post(
    "/folders",
    {
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
    },
    folderController.registerFolder.bind(folderController),
  );

  app.post(
    "/folders/check",
    {
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
    },
    folderController.checkFolder.bind(folderController),
  );

  app.get(
    "/folders",
    {
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
    },
    folderController.listFolders.bind(folderController),
  );

  app.patch(
    "/folders/:id",
    {
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
    },
    folderController.updateFolder.bind(folderController),
  );

  app.put(
    "/folders/:id/move",
    {
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
    },
    folderController.moveFolder.bind(folderController),
  );

  app.delete(
    "/folders/:id",
    {
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
    },
    folderController.deleteFolder.bind(folderController),
  );
}
