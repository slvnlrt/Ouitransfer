import * as https from "node:https";
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

import { env } from "../env.js";
import type { StorageConfig } from "../types/storage.js";

/**
 * Storage configuration:
 * - Default (ENABLE_S3=false or not set): Internal storage (S3_* env vars point to internal storage service, e.g. RustFS container)
 * - ENABLE_S3=true: External S3 (AWS, S3-compatible, etc) using env vars
 *
 * Credentials always come from environment variables (S3_* env vars).
 */
export const storageConfig: StorageConfig = {
  endpoint: env.S3_ENDPOINT || "",
  port: env.S3_PORT ? Number(env.S3_PORT) : undefined,
  useSSL: env.S3_USE_SSL === "true",
  accessKey: env.S3_ACCESS_KEY || "",
  secretKey: env.S3_SECRET_KEY || "",
  region: env.S3_REGION || "",
  bucketName: env.S3_BUCKET_NAME || "",
  forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
};

/**
 * Whether to reject self-signed TLS certificates for S3 connections.
 * Should only be disabled for testing with self-signed certificates.
 * This is scoped to S3 client only, not globally.
 */
export const rejectUnauthorized = env.S3_REJECT_UNAUTHORIZED !== "false";

/**
 * Build the endpoint URL from a StorageConfig (DRY — used by s3Client and publicS3Client).
 */
function buildEndpointUrl(config: StorageConfig): string {
  const scheme = config.useSSL ? "https" : "http";
  const port = config.port ? `:${config.port}` : "";
  return `${scheme}://${config.endpoint}${port}`;
}

/**
 * Storage is ALWAYS S3-compatible:
 * - ENABLE_S3=false → Internal storage (automatic)
 * - ENABLE_S3=true  → External S3 (AWS, S3-compatible, etc)
 */
const hasValidConfig = storageConfig.endpoint && storageConfig.accessKey && storageConfig.secretKey;

export const s3Client = hasValidConfig
  ? new S3Client({
      endpoint: buildEndpointUrl(storageConfig),
      region: storageConfig.region,
      credentials: {
        accessKeyId: storageConfig.accessKey,
        secretAccessKey: storageConfig.secretKey,
      },
      forcePathStyle: storageConfig.forcePathStyle,
      requestHandler: new NodeHttpHandler({
        httpsAgent: new https.Agent({
          rejectUnauthorized: rejectUnauthorized,
        }),
        requestTimeout: 300000, // 5 minutes timeout for S3 operations
      }),
    })
  : null;

export const bucketName = storageConfig.bucketName;

/**
 * Storage is always S3-compatible
 * ENABLE_S3=true means EXTERNAL S3, otherwise uses internal storage
 */
export const isS3Enabled = s3Client !== null;
export const isExternalS3 = env.ENABLE_S3 === "true";
export const isInternalStorage = s3Client !== null && env.ENABLE_S3 !== "true";

/**
 * Creates a public S3 client for presigned URL generation.
 * - Internal storage (ENABLE_S3=false): Uses STORAGE_URL (e.g., https://storage.example.com)
 * - External S3 (ENABLE_S3=true): Uses the original S3 endpoint configuration
 *
 * @returns S3Client configured with public endpoint, or null if S3 is disabled
 */
export function createPublicS3Client(): S3Client | null {
  if (!s3Client) {
    return null;
  }

  let publicEndpoint: string;

  if (isInternalStorage) {
    // Internal storage: use STORAGE_URL
    if (!env.STORAGE_URL) {
      throw new Error(
        "[STORAGE] STORAGE_URL environment variable is required when using internal storage (ENABLE_S3=false). " +
          "Set STORAGE_URL to your public storage URL with protocol (e.g., https://storage.example.com or http://192.168.1.100:9000)",
      );
    }
    publicEndpoint = env.STORAGE_URL;
  } else {
    // External S3: use the original endpoint configuration
    publicEndpoint = buildEndpointUrl(storageConfig);
  }

  return new S3Client({
    endpoint: publicEndpoint,
    region: storageConfig.region,
    credentials: {
      accessKeyId: storageConfig.accessKey,
      secretAccessKey: storageConfig.secretKey,
    },
    forcePathStyle: storageConfig.forcePathStyle,
    requestHandler: new NodeHttpHandler({
      httpsAgent: new https.Agent({
        rejectUnauthorized: rejectUnauthorized,
      }),
      requestTimeout: 300000, // 5 minutes timeout for S3 operations
    }),
  });
}

/**
 * Ensures the configured S3 bucket exists, creating it if necessary.
 * Called once at server startup.
 * console.log is acceptable here — runs at module init, before Pino logger is available.
 */
export async function ensureBucket(): Promise<void> {
  if (!s3Client || !bucketName) {
    console.log("[STORAGE] S3 not configured — skipping bucket check");
    return;
  }
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`[STORAGE] Bucket "${bucketName}" exists`);
  } catch (error: unknown) {
    const err = error as { name?: string };
    if (err.name === "NotFound" || err.name === "NoSuchBucket") {
      console.log(`[STORAGE] Creating bucket "${bucketName}"...`);
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`[STORAGE] Bucket "${bucketName}" created`);
    } else {
      console.error(
        `[STORAGE] Bucket check failed for "${bucketName}":`,
        err.name,
        (error as Error).message,
      );
      throw error;
    }
  }
}
