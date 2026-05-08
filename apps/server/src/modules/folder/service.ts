import { S3StorageProvider } from "../../providers/s3-storage.provider.js";
import { prisma } from "../../shared/prisma.js";
import type { StorageProvider } from "../../types/storage.js";
import { getLogger } from "../../utils/logger.js";

export class FolderService {
  private storageProvider: StorageProvider;

  constructor() {
    // Always use S3 (Garage internal or external S3)
    this.storageProvider = new S3StorageProvider();
  }

  async getPresignedPutUrl(objectName: string, expires: number): Promise<string> {
    try {
      return await this.storageProvider.getPresignedPutUrl(objectName, expires);
    } catch (err) {
      getLogger().error({ err }, "Erro no presignedPutObject");
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
      getLogger().error({ err }, "Erro no presignedGetObject");
      throw err;
    }
  }

  async deleteObject(objectName: string): Promise<void> {
    try {
      await this.storageProvider.deleteObject(objectName);
    } catch (err) {
      getLogger().error({ err }, "Erro no removeObject");
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
