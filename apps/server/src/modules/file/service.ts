import { S3StorageProvider } from "../../providers/s3-storage.provider.js";
import type { StorageProvider } from "../../types/storage.js";
import { getLogger } from "../../utils/logger.js";

export class FileService {
  private storageProvider: StorageProvider;

  constructor() {
    // Always use S3 (internal RustFS or external S3 provider)
    this.storageProvider = new S3StorageProvider();
  }

  async getPresignedPutUrl(objectName: string, expires: number = 3600): Promise<string> {
    return await this.storageProvider.getPresignedPutUrl(objectName, expires);
  }

  async getPresignedGetUrl(
    objectName: string,
    expires: number = 3600,
    fileName?: string,
  ): Promise<string> {
    return await this.storageProvider.getPresignedGetUrl(objectName, expires, fileName);
  }

  async deleteObject(objectName: string): Promise<void> {
    try {
      await this.storageProvider.deleteObject(objectName);
    } catch (err) {
      getLogger().error({ err }, "Erro no removeObject");
      throw err;
    }
  }

  async getObjectStream(objectName: string): Promise<NodeJS.ReadableStream> {
    try {
      return await this.storageProvider.getObjectStream(objectName);
    } catch (err) {
      getLogger().error({ err }, "Error getting object stream");
      throw err;
    }
  }

  async getObjectHead(objectName: string, bytes = 4096): Promise<Buffer> {
    return await this.storageProvider.getObjectHead(objectName, bytes);
  }

  // Multipart upload methods
  async createMultipartUpload(objectName: string): Promise<string> {
    return await this.storageProvider.createMultipartUpload(objectName);
  }

  async getPresignedPartUrl(
    objectName: string,
    uploadId: string,
    partNumber: number,
    expires: number = 3600,
  ): Promise<string> {
    return await this.storageProvider.getPresignedPartUrl(
      objectName,
      uploadId,
      partNumber,
      expires,
    );
  }

  async completeMultipartUpload(
    objectName: string,
    uploadId: string,
    parts: Array<{ PartNumber: number; ETag: string }>,
  ): Promise<void> {
    await this.storageProvider.completeMultipartUpload(objectName, uploadId, parts);
  }

  async abortMultipartUpload(objectName: string, uploadId: string): Promise<void> {
    await this.storageProvider.abortMultipartUpload(objectName, uploadId);
  }
}
