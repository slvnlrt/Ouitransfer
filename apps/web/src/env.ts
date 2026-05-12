import { z } from "zod";

/**
 * Server-side environment variables validated at import time.
 * Fails fast during build or server start if required values are missing/invalid.
 *
 * Note: NEXT_PUBLIC_* vars are captured at build time and embedded in client bundles.
 * Runtime changes require a rebuild.
 */
const envSchema = z.object({
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  API_BASE_URL: z
    .string()
    .url("API_BASE_URL must be a valid URL")
    .default("http://localhost:3333")
    .transform((url) => url.replace(/\/+$/, "")),
  OAUTH_ALLOWED_REDIRECT_HOSTS: z.string().optional(),
  ALLOWED_IMAGE_HOSTS: z.string().optional(),
});

// NEXT_PUBLIC_LOG_LEVEL is a build-time client-side variable.
// Validated inline in apps/web/src/lib/logger.ts with "warn" default.
// It cannot be validated here because this module runs server-side.

export const env = envSchema.parse({
  JWT_SECRET: process.env.JWT_SECRET,
  API_BASE_URL: process.env.API_BASE_URL,
  OAUTH_ALLOWED_REDIRECT_HOSTS: process.env.OAUTH_ALLOWED_REDIRECT_HOSTS,
  ALLOWED_IMAGE_HOSTS: process.env.ALLOWED_IMAGE_HOSTS,
});
