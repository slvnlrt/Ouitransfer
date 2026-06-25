import { S3StorageProvider } from "../../providers/s3-storage.provider.js";
import { prisma } from "../../shared/prisma.js";
import type { StorageProvider } from "../../types/storage.js";
import { getLogger } from "../../utils/logger.js";
import { validateObjectName } from "../../utils/validate-object-name.js";

export class FolderService {
  private storageProvider: StorageProvider;

  constructor() {
    // Always use S3 (internal RustFS or external S3 provider)
    this.storageProvider = new S3StorageProvider();
  }

  async getPresignedPutUrl(objectName: string, expires: number): Promise<string> {
    try {
      return await this.storageProvider.getPresignedPutUrl(objectName, expires);
    } catch (err) {
      getLogger().error({ err }, "Error getting presigned PUT URL from storage");
      throw err;
    }
  }

  async getPresignedGetUrl(
    objectName: string,
    expires: number,
    folderName?: string,
  ): Promise<string> {
    try {
      return await this.storageProvider.getPresignedGetUrl(objectName, expires, folderName);
    } catch (err) {
      getLogger().error({ err }, "Error getting presigned GET URL from storage");
      throw err;
    }
  }

  /**
   * Delete a folder's backing storage object.
   *
   * A2-06 / A3-06 defense-in-depth: the caller must pass the owning `userId` and
   * the objectName MUST live under that user's namespace. Even though register
   * now validates the namespace, this guard ensures a stored value that somehow
   * escaped validation (or a future caller) can never drive a cross-tenant
   * DeleteObject. Throws before any S3 call when the namespace does not match.
   */
  async deleteObject(objectName: string, userId: string): Promise<void> {
    validateObjectName(objectName, userId);
    try {
      await this.storageProvider.deleteObject(objectName);
    } catch (err) {
      getLogger().error({ err }, "Error removing object from storage");
      throw err;
    }
  }

  async getAllFilesInFolder(
    folderId: string,
    userId: string,
    basePath: string = "",
  ): Promise<
    Array<{
      id: string;
      name: string;
      description: string | null;
      extension: string;
      size: bigint;
      objectName: string;
      userId: string;
      folderId: string | null;
      relativePath: string;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    const files = await prisma.file.findMany({
      where: { folderId, userId },
    });

    const subfolders = await prisma.folder.findMany({
      where: { parentId: folderId, userId },
      select: { id: true, name: true },
    });

    let allFiles = files.map((file) => ({
      ...file,
      relativePath: basePath + file.name,
    }));

    for (const subfolder of subfolders) {
      const subfolderPath = `${basePath + subfolder.name}/`;
      const subfolderFiles = await this.getAllFilesInFolder(subfolder.id, userId, subfolderPath);
      allFiles = [...allFiles, ...subfolderFiles];
    }

    return allFiles;
  }

  async calculateFolderSize(folderId: string, userId: string): Promise<bigint> {
    const files = await prisma.file.findMany({
      where: { folderId, userId },
      select: { size: true },
    });

    const subfolders = await prisma.folder.findMany({
      where: { parentId: folderId, userId },
      select: { id: true },
    });

    let totalSize = files.reduce((sum, file) => sum + file.size, BigInt(0));

    for (const subfolder of subfolders) {
      const subfolderSize = await this.calculateFolderSize(subfolder.id, userId);
      totalSize += subfolderSize;
    }

    return totalSize;
  }
}
