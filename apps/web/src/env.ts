import { z } from "zod";

/**
 * Server-side environment variables, validated lazily on first access.
 *
 * Validation is deferred (not module-level) so that `next build` can import
 * route modules during the "Collecting page data" phase without crashing.
 * Turborepo strict mode (the v2 default) only passes through env vars listed
 * in `passThroughEnv` / `globalEnv`; a module-level `z.parse()` would fail
 * during build if any required var isn't declared there.
 *
 * At runtime (server start, incoming request) the getter runs once, validates
 * all vars via Zod, and caches the result. If validation fails the process
 * crashes immediately — production safety is preserved.
 *
 * Note: NEXT_PUBLIC_* vars are captured at build time and embedded in client
 * bundles. Runtime changes require a rebuild.
 */
const envSchema = z.object({
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  API_BASE_URL: z
    .string()
    .url("API_BASE_URL must be a valid URL")
    .default("http://localhost:3333")
    .transform((url) => url.replace(/\/+$/, "")),
  ALLOWED_IMAGE_HOSTS: z.string().optional(),
  CSP_STORAGE_ORIGINS: z
    .string()
    .optional()
    .refine(
      (v) =>
        !v || v.split(/\s+/).every((origin) => /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)),
      "Must be space-separated origins (e.g., http://storage:9000 https://cdn.example.com)",
    ),
});

// NEXT_PUBLIC_LOG_LEVEL is a build-time client-side variable.
// Validated inline in apps/web/src/lib/logger.ts with "warn" default.
// It cannot be validated here because this module runs server-side.

type Env = z.infer<typeof envSchema>;

let _cached: Env | null = null;

function getEnv(): Env {
  if (_cached) return _cached;
  _cached = envSchema.parse({
    JWT_SECRET: process.env.JWT_SECRET,
    API_BASE_URL: process.env.API_BASE_URL,
    ALLOWED_IMAGE_HOSTS: process.env.ALLOWED_IMAGE_HOSTS,
    CSP_STORAGE_ORIGINS: process.env.CSP_STORAGE_ORIGINS,
  });
  return _cached;
}

/**
 * Validated server-side environment.
 *
 * Uses a `Proxy` so that `env.JWT_SECRET` (property access) triggers lazy
 * validation on first use — no call-site changes required for existing
 * `import { env } from "@/env"` consumers.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof Env];
  },
});
