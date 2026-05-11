import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getContentType } from "@ouitransfer/shared/mime-types";

import { bucketName, createPublicS3Client, s3Client } from "../config/storage.config.js";
import type { StorageProvider } from "../types/storage.js";

export class S3StorageProvider implements StorageProvider {
  private ensureClient() {
    if (!s3Client) {
      throw new Error("S3 client is not configured. Storage is initializing, please wait...");
    }
    return s3Client;
  }

  /**
   * Check if a character is valid in an HTTP token (RFC 2616)
   * Tokens can contain: alphanumeric and !#$%&'*+-.^_`|~
   * Must exclude separators: ()<>@,;:\"/[]?={} and space/tab
   */
  private isTokenChar(char: string): boolean {
    const code = char.charCodeAt(0);
    // Basic ASCII range check
    if (code < 33 || code > 126) return false;
    // Exclude separator characters per RFC 2616
    const separators = '()<>@,;:\\"/[]?={} \t';
    return !separators.includes(char);
  }

  /**
   * Safely encode filename for Content-Disposition header
   */
  private encodeFilenameForHeader(filename: string): string {
    if (!filename || filename.trim() === "") {
      return 'attachment; filename="download"';
    }

    let sanitized = filename
      .replace(/"/g, "'")
      .replace(/[\r\n\t\v\f]/g, "")
      .replace(/[\\|/]/g, "-")
      .replace(/[<>:|*?]/g, "");

    sanitized = sanitized
      .split("")
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code >= 32 && !(code >= 127 && code <= 159);
      })
      .join("")
      .trim();

    if (!sanitized) {
      return 'attachment; filename="download"';
    }

    // Create ASCII-safe version with only valid token characters
    const asciiSafe = sanitized
      .split("")
      .filter((char) => this.isTokenChar(char))
      .join("");

    if (asciiSafe?.trim()) {
      const encoded = encodeURIComponent(sanitized);
      return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encoded}`;
    } else {
      const encoded = encodeURIComponent(sanitized);
      return `attachment; filename*=UTF-8''${encoded}`;
    }
  }

  async getPresignedPutUrl(objectName: string, expires: number): Promise<string> {
    // Always use public S3 client for presigned URLs (uses SERVER_IP)
    const client = createPublicS3Client();
    if (!client) {
      throw new Error("S3 client could not be created");
    }

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectName,
    });

    return await getSignedUrl(client, command, {
      expiresIn: expires,
      unsignableHeaders: new Set(["x-amz-checksum-crc32"]),
    });
  }

  async getPresignedGetUrl(
    objectName: string,
    expires: number,
    fileName?: string,
  ): Promise<string> {
    // Always use public S3 client for presigned URLs (uses SERVER_IP)
    const client = createPublicS3Client();
    if (!client) {
      throw new Error("S3 client could not be created");
    }

    let rcdFileName: string;

    if (fileName && fileName.trim() !== "") {
      rcdFileName = fileName;
    } else {
      const lastSlashIndex = objectName.lastIndexOf("/");
      rcdFileName = lastSlashIndex !== -1 ? objectName.substring(lastSlashIndex + 1) : objectName;
      if (!rcdFileName) {
        rcdFileName = "downloaded_file";
      }
    }

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: objectName,
      ResponseContentDisposition: this.encodeFilenameForHeader(rcdFileName),
      ResponseContentType: getContentType(rcdFileName),
    });

    return await getSignedUrl(client, command, { expiresIn: expires });
  }

  async deleteObject(objectName: string): Promise<void> {
    const client = this.ensureClient();

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: objectName,
    });

    await client.send(command);
  }

  async fileExists(objectName: string): Promise<boolean> {
    const client = this.ensureClient();

    try {
      const command = new HeadObjectCommand({
        Bucket: bucketName,
        Key: objectName,
      });

      await client.send(command);
      return true;
    } catch (error: unknown) {
      const isNotFound =
        error instanceof Error &&
        (error.name === "NotFound" ||
          ("$metadata" in error &&
            (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ===
              404));
      if (isNotFound) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get a readable stream for downloading an object
   * Used for proxying downloads through the backend
   */
  async getObjectStream(objectName: string): Promise<NodeJS.ReadableStream> {
    const client = this.ensureClient();

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: objectName,
    });

    const response = await client.send(command);

    if (!response.Body) {
      throw new Error("No body in S3 response");
    }

    // AWS SDK v3 returns a readable stream
    return response.Body as NodeJS.ReadableStream;
  }

  /**
   * Initialize a multipart upload
   * Returns uploadId for subsequent part uploads
   */
  async createMultipartUpload(objectName: string): Promise<string> {
    const client = this.ensureClient();

    const command = new CreateMultipartUploadCommand({
      Bucket: bucketName,
      Key: objectName,
    });

    const response = await client.send(command);

    if (!response.UploadId) {
      throw new Error("Failed to create multipart upload - no UploadId returned");
    }

    return response.UploadId;
  }

  /**
   * Get presigned URL for uploading a specific part
   */
  async getPresignedPartUrl(
    objectName: string,
    uploadId: string,
    partNumber: number,
    expires: number,
  ): Promise<string> {
    const client = createPublicS3Client();
    if (!client) {
      throw new Error("S3 client could not be created");
    }

    const command = new UploadPartCommand({
      Bucket: bucketName,
      Key: objectName,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    const url = await getSignedUrl(client, command, {
      expiresIn: expires,
      unsignableHeaders: new Set(["x-amz-checksum-crc32"]),
    });
    return url;
  }

  /**
   * Complete a multipart upload
   */
  async completeMultipartUpload(
    objectName: string,
    uploadId: string,
    parts: Array<{ PartNumber: number; ETag: string }>,
  ): Promise<void> {
    const client = this.ensureClient();

    const command = new CompleteMultipartUploadCommand({
      Bucket: bucketName,
      Key: objectName,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((part) => ({
          PartNumber: part.PartNumber,
          ETag: part.ETag,
        })),
      },
    });

    await client.send(command);
  }

  /**
   * Read the first N bytes of an S3 object (for magic-byte verification).
   */
  async getObjectHead(objectName: string, bytes = 4096): Promise<Buffer> {
    const client = this.ensureClient();

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: objectName,
      Range: `bytes=0-${bytes - 1}`,
    });
    const response = await client.send(command);
    const stream = response.Body;
    if (!stream) throw new Error("Empty response body from S3");
    // Collect the stream into a buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Abort a multipart upload
   */
  async abortMultipartUpload(objectName: string, uploadId: string): Promise<void> {
    const client = this.ensureClient();

    const command = new AbortMultipartUploadCommand({
      Bucket: bucketName,
      Key: objectName,
      UploadId: uploadId,
    });

    await client.send(command);
  }
}
