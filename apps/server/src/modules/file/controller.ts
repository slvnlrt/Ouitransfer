import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../../env.js";
import { prisma } from "../../shared/prisma.js";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/app-error.js";
import {
  generateUniqueFileName,
  generateUniqueFileNameForRename,
  parseFileName,
} from "../../utils/file-name-generator.js";
import { sanitizeFilename } from "../../utils/sanitize-filename.js";
import { isMimeTypeConsistent, verifyMagicBytes } from "../../utils/validate-file-content.js";
import { validateObjectName } from "../../utils/validate-object-name.js";
import { ConfigService } from "../config/service.js";
import {
  type CheckFileInput,
  CheckFileSchema,
  type ListFilesInput,
  ListFilesSchema,
  type MoveFileInput,
  MoveFileSchema,
  type RegisterFileInput,
  RegisterFileSchema,
  UpdateFileSchema,
} from "./dto.js";
import { FileService } from "./service.js";

export class FileController {
  private fileService = new FileService();
  private configService = new ConfigService();

  async getPresignedUrl(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { filename, extension } = request.query as { filename: string; extension: string };

    if (!filename || !extension) {
      throw new ValidationError("filename and extension are required");
    }

    // JWT already verified by preValidation in routes.ts
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError();
    }

    // Generate unique object name
    const safeFilename = sanitizeFilename(`${filename}.${extension}`);
    const objectName = `${userId}/${crypto.randomUUID()}-${safeFilename}`;
    const expires = env.PRESIGNED_URL_EXPIRATION;

    const url = await this.fileService.getPresignedPutUrl(objectName, expires);

    const maxFileSize = Number(await this.configService.getValue("maxFileSize"));

    return reply.status(200).send({ url, objectName, maxFileSize });
  }

  async registerFile(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const input: RegisterFileInput = RegisterFileSchema.parse(request.body);

    // Validate objectName ownership: must be under the user's namespace
    validateObjectName(input.objectName, userId);

    // Layer 1: MIME/extension consistency check
    if (!isMimeTypeConsistent(input.mimeType, input.extension)) {
      throw new ValidationError("File type does not match the declared extension");
    }

    // Layer 2: Magic-byte verification (read first 4 KB from S3)
    try {
      const headBuffer = await this.fileService.getObjectHead(input.objectName);
      const magicResult = await verifyMagicBytes(headBuffer, input.mimeType);
      if (!magicResult.valid) {
        request.log.warn(
          {
            declared: magicResult.declared,
            detected: magicResult.detected,
            objectName: input.objectName,
          },
          "Magic-byte mismatch detected",
        );
        throw new ValidationError("File content does not match the declared file type");
      }
    } catch (err) {
      // Re-throw any AppError (e.g. ValidationError from magic-byte mismatch)
      if (err instanceof AppError) throw err;
      // If S3 read fails, log but don't block — the consistency check above still passed
      request.log.warn(
        { err, objectName: input.objectName },
        "Magic-byte verification skipped (S3 read failed)",
      );
    }

    const maxFileSize = BigInt(await this.configService.getValue("maxFileSize"));
    if (BigInt(input.size) > maxFileSize) {
      const maxSizeMB = Number(maxFileSize) / (1024 * 1024);
      throw new ValidationError(`File size exceeds the maximum allowed size of ${maxSizeMB}MB`);
    }

    const maxTotalStorage = BigInt(await this.configService.getValue("maxTotalStoragePerUser"));

    const userFiles = await prisma.file.findMany({
      where: { userId },
      select: { size: true },
    });

    const currentStorage = userFiles.reduce((acc, file) => acc + file.size, BigInt(0));

    if (currentStorage + BigInt(input.size) > maxTotalStorage) {
      const availableSpace = Number(maxTotalStorage - currentStorage) / (1024 * 1024);
      throw new ValidationError(
        `Insufficient storage space. You have ${availableSpace.toFixed(2)}MB available`,
      );
    }

    if (input.folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: input.folderId, userId },
      });
      if (!folder) {
        throw new ValidationError("Folder not found or access denied.");
      }
    }

    // Parse the filename and generate a unique name if there's a duplicate
    const { baseName, extension } = parseFileName(input.name);
    const uniqueName = await generateUniqueFileName(baseName, extension, userId, input.folderId);

    const fileRecord = await prisma.file.create({
      data: {
        name: uniqueName,
        description: input.description,
        extension: input.extension,
        size: BigInt(input.size),
        objectName: input.objectName,
        userId,
        folderId: input.folderId,
      },
    });

    const fileResponse = {
      id: fileRecord.id,
      name: fileRecord.name,
      description: fileRecord.description,
      extension: fileRecord.extension,
      size: fileRecord.size.toString(),
      objectName: fileRecord.objectName,
      userId: fileRecord.userId,
      folderId: fileRecord.folderId,
      createdAt: fileRecord.createdAt,
      updatedAt: fileRecord.updatedAt,
    };

    return reply.status(201).send({
      file: fileResponse,
      message: "File registered successfully.",
    });
  }

  async checkFile(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const input: CheckFileInput = CheckFileSchema.parse(request.body);

    const maxFileSize = BigInt(await this.configService.getValue("maxFileSize"));
    if (BigInt(input.size) > maxFileSize) {
      const maxSizeMB = Number(maxFileSize) / (1024 * 1024);
      throw new ValidationError(`File size exceeds the maximum allowed size of ${maxSizeMB}MB`);
    }

    const maxTotalStorage = BigInt(await this.configService.getValue("maxTotalStoragePerUser"));

    const userFiles = await prisma.file.findMany({
      where: { userId },
      select: { size: true },
    });

    const currentStorage = userFiles.reduce((acc, file) => acc + file.size, BigInt(0));

    if (currentStorage + BigInt(input.size) > maxTotalStorage) {
      const availableSpace = Number(maxTotalStorage - currentStorage) / (1024 * 1024);
      throw new ValidationError(
        `Insufficient storage space. You have ${availableSpace.toFixed(2)}MB available`,
      );
    }

    // Check for duplicate filename and provide the suggested unique name
    const { baseName, extension } = parseFileName(input.name);
    const uniqueName = await generateUniqueFileName(baseName, extension, userId, input.folderId);

    // Include suggestedName in response if the name was changed
    const response: { message: string; suggestedName?: string } = {
      message: "File checks succeeded.",
    };

    if (uniqueName !== input.name) {
      response.suggestedName = uniqueName;
    }

    return reply.status(201).send(response);
  }

  async listFiles(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const input: ListFilesInput = ListFilesSchema.parse(request.query);
    const { folderId, recursive: recursiveStr } = input;
    const recursive = recursiveStr !== "false";

    // File type comes from prisma.file (direct or with relativePath added by FolderService)
    let files: Array<{
      id: string;
      name: string;
      description: string | null;
      extension: string;
      size: bigint;
      objectName: string;
      userId: string;
      folderId: string | null;
      relativePath?: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;

    let targetFolderId: string | null;
    if (folderId === "null" || folderId === "" || !folderId) {
      targetFolderId = null; // Root folder
    } else {
      targetFolderId = folderId;
    }

    if (recursive) {
      if (targetFolderId === null) {
        files = await this.getAllUserFilesRecursively(userId);
      } else {
        const { FolderService } = await import("../folder/service.js");
        const folderService = new FolderService();
        files = await folderService.getAllFilesInFolder(targetFolderId, userId);
      }
    } else {
      files = await prisma.file.findMany({
        where: { userId, folderId: targetFolderId },
      });
    }

    const filesResponse = files.map((file) => ({
      id: file.id,
      name: file.name,
      description: file.description,
      extension: file.extension,
      size: typeof file.size === "bigint" ? file.size.toString() : file.size,
      objectName: file.objectName,
      userId: file.userId,
      folderId: file.folderId,
      relativePath: file.relativePath || null,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }));

    return reply.send({ files: filesResponse });
  }

  async deleteFile(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const { id } = request.params as { id: string };
    if (!id) {
      throw new ValidationError("The 'id' parameter is required.");
    }

    const fileRecord = await prisma.file.findUnique({ where: { id } });
    if (!fileRecord) {
      throw new NotFoundError("File not found.");
    }

    const userId = request.user?.userId;
    if (fileRecord.userId !== userId) {
      throw new ForbiddenError("Access denied.");
    }

    await this.fileService.deleteObject(fileRecord.objectName);

    await prisma.file.delete({ where: { id } });

    return reply.send({ message: "File deleted successfully." });
  }

  async updateFile(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const { id } = request.params as { id: string };
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const updateData = UpdateFileSchema.parse(request.body);

    const fileRecord = await prisma.file.findUnique({ where: { id } });

    if (!fileRecord) {
      throw new NotFoundError("File not found.");
    }

    if (fileRecord.userId !== userId) {
      throw new ForbiddenError("Access denied.");
    }

    // If renaming the file, check for duplicates and auto-rename if necessary
    if (updateData.name && updateData.name !== fileRecord.name) {
      const { baseName, extension } = parseFileName(updateData.name);
      const uniqueName = await generateUniqueFileNameForRename(
        baseName,
        extension,
        userId,
        fileRecord.folderId,
        id,
      );
      updateData.name = uniqueName;
    }

    const updatedFile = await prisma.file.update({
      where: { id },
      data: updateData,
    });

    const fileResponse = {
      id: updatedFile.id,
      name: updatedFile.name,
      description: updatedFile.description,
      extension: updatedFile.extension,
      size: updatedFile.size.toString(),
      objectName: updatedFile.objectName,
      userId: updatedFile.userId,
      folderId: updatedFile.folderId,
      createdAt: updatedFile.createdAt,
      updatedAt: updatedFile.updatedAt,
    };

    return reply.send({
      file: fileResponse,
      message: "File updated successfully.",
    });
  }

  async moveFile(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { id } = request.params as { id: string };
    const input: MoveFileInput = MoveFileSchema.parse(request.body);

    const existingFile = await prisma.file.findFirst({
      where: { id, userId },
    });

    if (!existingFile) {
      throw new NotFoundError("File not found.");
    }

    if (input.folderId) {
      const targetFolder = await prisma.folder.findFirst({
        where: { id: input.folderId, userId },
      });
      if (!targetFolder) {
        throw new ValidationError("Target folder not found.");
      }
    }

    const updatedFile = await prisma.file.update({
      where: { id },
      data: { folderId: input.folderId },
    });

    const fileResponse = {
      id: updatedFile.id,
      name: updatedFile.name,
      description: updatedFile.description,
      extension: updatedFile.extension,
      size: updatedFile.size.toString(),
      objectName: updatedFile.objectName,
      userId: updatedFile.userId,
      folderId: updatedFile.folderId,
      createdAt: updatedFile.createdAt,
      updatedAt: updatedFile.updatedAt,
    };

    return reply.send({
      file: fileResponse,
      message: "File moved successfully.",
    });
  }

  private async getAllUserFilesRecursively(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      description: string | null;
      extension: string;
      size: bigint;
      objectName: string;
      userId: string;
      folderId: string | null;
      relativePath?: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    const rootFiles = await prisma.file.findMany({
      where: { userId, folderId: null },
    });

    const rootFolders = await prisma.folder.findMany({
      where: { userId, parentId: null },
      select: { id: true },
    });

    let allFiles = [...rootFiles];

    if (rootFolders.length > 0) {
      const { FolderService } = await import("../folder/service.js");
      const folderService = new FolderService();

      for (const folder of rootFolders) {
        const folderFiles = await folderService.getAllFilesInFolder(folder.id, userId);
        allFiles = [...allFiles, ...folderFiles];
      }
    }

    return allFiles;
  }
}
