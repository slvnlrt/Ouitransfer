import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
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

  /** Maximum bytes to read via getObjectHead (prevents runaway range requests). */
  private static readonly MAX_HEAD_BYTES = 4096;

  /**
   * Read the first N bytes of an S3 object (for magic-byte verification).
   * The `bytes` parameter is capped at MAX_HEAD_BYTES to prevent excessive data transfer.
   */
  async getObjectHead(objectName: string, bytes = 4096): Promise<Buffer> {
    const client = this.ensureClient();
    const safeBytes = Math.min(bytes, S3StorageProvider.MAX_HEAD_BYTES);

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: objectName,
      Range: `bytes=0-${safeBytes - 1}`,
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

  /**
   * List uploaded parts for a multipart upload (for upload resume).
   * S3 ListParts is paginated (max 1000 parts per call), so we loop until exhausted.
   */
  async listParts(
    objectName: string,
    uploadId: string,
  ): Promise<Array<{ PartNumber: number; Size: number; ETag: string }>> {
    const client = this.ensureClient();
    const allParts: Array<{ PartNumber: number; Size: number; ETag: string }> = [];
    let partNumberMarker: string | undefined;

    do {
      const command = new ListPartsCommand({
        Bucket: bucketName,
        Key: objectName,
        UploadId: uploadId,
        ...(partNumberMarker !== undefined && {
          PartNumberMarker: partNumberMarker,
        }),
      });

      const response = await client.send(command);

      if (response.Parts) {
        for (const part of response.Parts) {
          if (part.PartNumber != null && part.Size != null && part.ETag != null) {
            allParts.push({
              PartNumber: part.PartNumber,
              Size: part.Size,
              ETag: part.ETag,
            });
          }
        }
      }

      partNumberMarker = response.IsTruncated ? response.NextPartNumberMarker : undefined;
    } while (partNumberMarker !== undefined);

    return allParts;
  }

  /**
   * List every object in the bucket (optionally under `prefix`).
   *
   * S3 `ListObjectsV2` returns at most 1000 keys per call, so we loop on the
   * `ContinuationToken` until `IsTruncated` is false, concatenating each page's
   * `Contents`. An empty bucket yields an empty array. Each entry exposes the
   * key, byte size, and last-modified timestamp — enough for the orphan sweep
   * to reconcile S3 against the database and apply its min-age guard.
   */
  async listObjects(
    prefix?: string,
  ): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
    const client = this.ensureClient();
    const objects: Array<{ key: string; size: number; lastModified: Date }> = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        ...(prefix !== undefined && { Prefix: prefix }),
        ...(continuationToken !== undefined && { ContinuationToken: continuationToken }),
      });

      const response = await client.send(command);

      for (const object of response.Contents ?? []) {
        if (object.Key != null) {
          objects.push({
            key: object.Key,
            size: object.Size ?? 0,
            lastModified: object.LastModified ?? new Date(0),
          });
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);

    return objects;
  }

  /**
   * List every **incomplete** multipart upload in the bucket (optionally under
   * `prefix`).
   *
   * These are uploads that were initiated (`CreateMultipartUpload`) but never
   * completed or aborted — e.g. a large reverse-share upload where the browser
   * was closed or the client crashed. Their parts linger in S3 consuming storage
   * and are **invisible to `listObjects` / `ListObjectsV2`** (which only sees
   * finalized objects), so the orphan sweep needs this separate enumeration to
   * reclaim them.
   *
   * `ListMultipartUploads` is paginated: each page returns at most 1000 entries,
   * and a truncated page carries `NextKeyMarker` / `NextUploadIdMarker` that must
   * be fed back as `KeyMarker` / `UploadIdMarker` on the next call. We loop while
   * `IsTruncated` is true, concatenating each page's `Uploads`.
   *
   * Each entry exposes the object key, the upload id (both required to abort it),
   * and the initiation timestamp. Entries missing a key or upload id are skipped
   * (they cannot be acted on); a missing `Initiated` defaults to the epoch so a
   * malformed entry is treated as old rather than wrongly protected as "young" by
   * the sweep's min-age guard.
   */
  async listMultipartUploads(
    prefix?: string,
  ): Promise<Array<{ key: string; uploadId: string; initiated: Date }>> {
    const client = this.ensureClient();
    const uploads: Array<{ key: string; uploadId: string; initiated: Date }> = [];
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;

    do {
      const command = new ListMultipartUploadsCommand({
        Bucket: bucketName,
        ...(prefix !== undefined && { Prefix: prefix }),
        ...(keyMarker !== undefined && { KeyMarker: keyMarker }),
        ...(uploadIdMarker !== undefined && { UploadIdMarker: uploadIdMarker }),
      });

      const response = await client.send(command);

      for (const upload of response.Uploads ?? []) {
        if (upload.Key == null || upload.UploadId == null) continue;
        uploads.push({
          key: upload.Key,
          uploadId: upload.UploadId,
          initiated: upload.Initiated ?? new Date(0),
        });
      }

      if (response.IsTruncated) {
        keyMarker = response.NextKeyMarker;
        uploadIdMarker = response.NextUploadIdMarker;
      } else {
        keyMarker = undefined;
        uploadIdMarker = undefined;
      }
    } while (keyMarker !== undefined || uploadIdMarker !== undefined);

    return uploads;
  }
}
