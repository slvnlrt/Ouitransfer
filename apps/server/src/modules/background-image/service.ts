import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";

import { bucketName, createPublicS3Client, s3Client } from "../../config/storage.config.js";
import { NotFoundError, ValidationError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import type { BackgroundImageResponse } from "./dto.js";
import { BackgroundImageRepository } from "./repository.js";

const FULL_WIDTH = 1920;
const THUMB_WIDTH = 400;
const FULL_QUALITY = 80;
const THUMB_QUALITY = 70;
export const MAX_RAW_SIZE = 10 * 1024 * 1024; // 10 MB
const PRESIGNED_EXPIRY = 3600; // 1 hour

export class BackgroundImageService {
  private repository = new BackgroundImageRepository();

  async listAll(): Promise<BackgroundImageResponse[]> {
    const images = await this.repository.findAll();
    const responses: BackgroundImageResponse[] = [];

    for (const img of images) {
      const [thumbnailUrl, fullUrl] = await Promise.all([
        this.getPresignedUrl(img.thumbnailS3Key),
        this.getPresignedUrl(img.s3Key),
      ]);
      responses.push({
        id: img.id,
        name: img.name,
        thumbnailUrl,
        fullUrl,
        sortOrder: img.sortOrder,
        createdAt: img.createdAt.toISOString(),
        updatedAt: img.updatedAt.toISOString(),
      });
    }

    return responses;
  }

  async upload(
    buffer: Buffer,
    originalFilename: string,
    name?: string,
  ): Promise<BackgroundImageResponse> {
    if (buffer.length > MAX_RAW_SIZE) {
      throw new ValidationError(
        `Image too large. Maximum size is ${MAX_RAW_SIZE / 1024 / 1024}MB.`,
      );
    }

    // Validate that sharp can read this image
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) {
      throw new ValidationError("Invalid image file");
    }

    // Use crypto.randomUUID for a unique S3 key prefix
    const id = crypto.randomUUID();

    // Process images
    const fullBuffer = await sharp(buffer)
      .resize({ width: FULL_WIDTH, withoutEnlargement: true })
      .webp({ quality: FULL_QUALITY })
      .toBuffer();

    const thumbBuffer = await sharp(buffer)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();

    const s3Key = `backgrounds/${id}.webp`;
    const thumbnailS3Key = `backgrounds/${id}_thumb.webp`;

    // Upload to S3
    const client = this.ensureS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: fullBuffer,
        ContentType: "image/webp",
      }),
    );

    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: thumbnailS3Key,
        Body: thumbBuffer,
        ContentType: "image/webp",
      }),
    );

    // Derive name from filename if not provided
    const derivedName = name || this.deriveNameFromFilename(originalFilename);

    // Create DB record
    const image = await this.repository.create({
      name: derivedName,
      s3Key,
      thumbnailS3Key,
    });

    const [thumbnailUrl, fullUrl] = await Promise.all([
      this.getPresignedUrl(thumbnailS3Key),
      this.getPresignedUrl(s3Key),
    ]);

    return {
      id: image.id,
      name: image.name,
      thumbnailUrl,
      fullUrl,
      sortOrder: image.sortOrder,
      createdAt: image.createdAt.toISOString(),
      updatedAt: image.updatedAt.toISOString(),
    };
  }

  async rename(id: string, name: string): Promise<BackgroundImageResponse> {
    const image = await this.repository.findById(id);
    if (!image) {
      throw new NotFoundError("Background image not found");
    }

    const updated = await this.repository.update(id, { name });
    const [thumbnailUrl, fullUrl] = await Promise.all([
      this.getPresignedUrl(updated.thumbnailS3Key),
      this.getPresignedUrl(updated.s3Key),
    ]);

    return {
      id: updated.id,
      name: updated.name,
      thumbnailUrl,
      fullUrl,
      sortOrder: updated.sortOrder,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async reorder(ids: string[]) {
    await this.repository.reorder(ids);
  }

  async delete(id: string) {
    const image = await this.repository.findById(id);
    if (!image) {
      throw new NotFoundError("Background image not found");
    }

    // Delete S3 objects (use allSettled so both are attempted even if one fails)
    const client = this.ensureS3Client();
    const results = await Promise.allSettled([
      client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: image.s3Key })),
      client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: image.thumbnailS3Key })),
    ]);

    for (const result of results) {
      if (result.status === "rejected") {
        getLogger().warn(
          { err: result.reason, id },
          "Failed to delete S3 object for background image — proceeding with DB deletion",
        );
      }
    }

    // Delete DB record (onDelete: SetNull clears FK on ReverseShares)
    await this.repository.delete(id);
  }

  /** Derive a display name from a filename: strip extension, replace separators, title-case */
  deriveNameFromFilename(filename: string): string {
    const nameWithoutExt = filename.replace(/\.[^.]+$/, "");
    return (
      nameWithoutExt
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim() || "Untitled"
    );
  }

  private ensureS3Client() {
    if (!s3Client) {
      throw new Error("S3 client is not configured");
    }
    return s3Client;
  }

  private async getPresignedUrl(key: string): Promise<string> {
    // Use the public S3 client so presigned URLs contain the browser-reachable
    // endpoint (STORAGE_URL) instead of the Docker-internal hostname.
    const client = createPublicS3Client();
    if (!client) {
      throw new Error("S3 client is not configured");
    }
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucketName, Key: key }), {
      expiresIn: PRESIGNED_EXPIRY,
    });
  }
}
