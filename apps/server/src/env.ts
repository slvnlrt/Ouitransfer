import { z } from "zod";

const envSchema = z.object({
  // Storage configuration
  ENABLE_S3: z.union([z.literal("true"), z.literal("false")]).default("false"),
  S3_ENDPOINT: z.string().optional(),
  S3_PORT: z.string().optional(),
  S3_USE_SSL: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET_NAME: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.union([z.literal("true"), z.literal("false")]).default("false"),
  S3_REJECT_UNAUTHORIZED: z.union([z.literal("true"), z.literal("false")]).default("true"),

  // Legacy encryption vars (kept for backward compatibility but not used with S3/Garage)
  ENCRYPTION_KEY: z.string().optional(),
  DISABLE_FILESYSTEM_ENCRYPTION: z.union([z.literal("true"), z.literal("false")]).default("true"),

  // Application configuration
  PORT: z.coerce.number().int().min(1).max(65535).optional().default(3333),
  PRESIGNED_URL_EXPIRATION: z.coerce.number().int().min(60).max(86400).optional().default(3600),
  PRESIGNED_GET_URL_EXPIRATION: z.coerce.number().int().min(60).max(86400).optional().default(900),
  SECURE_SITE: z.union([z.literal("true"), z.literal("false")]).default("true"),
  STORAGE_URL: z.string().optional(), // Storage URL for internal storage presigned URLs (required when ENABLE_S3=false, e.g., https://syrg.OUITRANSFER.com or http://192.168.1.100:9379)
  DATABASE_URL: z.string().optional().default("file:/app/server/prisma/ouitransfer.db"),
  CUSTOM_PATH: z.string().optional(),

  // Security
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  TRUST_PROXY: z
    .string()
    .optional()
    .default("loopback")
    .transform((v) => v.toLowerCase()),
  ENABLE_API_DOCS: z.union([z.literal("true"), z.literal("false")]).optional(),
});

export const env = envSchema.parse(process.env);
