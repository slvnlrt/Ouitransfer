/**
 * Global test setup — runs before every test file (vitest `setupFiles`).
 *
 * Establishes the security secrets that `env.ts` requires at import time so that
 * any test which (directly or transitively) imports `env.ts` or calls
 * `buildApp()` can boot without each file having to stub every secret.
 *
 * These are assigned via `process.env` (NOT `vi.stubEnv`) so that they persist
 * across a test file's own `vi.unstubAllEnvs()` cleanup. Individual tests remain
 * free to override any of these with `vi.stubEnv()` for their own scenarios.
 */

const TEST_SECRETS: Record<string, string> = {
  JWT_SECRET: "test-jwt-secret-0000000000000000-32+chars",
  CSRF_SECRET: "test-csrf-secret-1111111111111111-32+chars",
  COOKIE_SECRET: "test-cookie-secret-2222222222222-32+chars",
  ENCRYPTION_SECRET: "test-encryption-secret-3333333333-32+chars",
};

for (const [key, value] of Object.entries(TEST_SECRETS)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
