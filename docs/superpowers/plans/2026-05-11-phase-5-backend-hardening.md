# Phase 5: Backend Hardening — Implementation Plan (Rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Fastify backend with validation improvements, auth hardening, security headers, CSRF protection, and controller migration to centralized error handling.

**Architecture:** 25 items (original 17 minus 5.5 which is dropped, plus 9 new items from review) covering server config hardening (trustProxy, port, Swagger, helmet, CORS fail-fast, presigned URL expiry), data validation (MIME consistency, filename sanitization, file size), auth improvements (2FA disable, admin detection, CSRF, timing-safe comparisons, token rotation, account lockout, refresh tokens), security infrastructure (audit logging), proxy fixes (cookie forwarding, OAuth redirects), and controller migration to the centralized error handler.

**Tech Stack:** Fastify 5, Prisma, fastify-type-provider-zod, @fastify/csrf-protection (new), @fastify/helmet (new), file-type (new), Next.js proxy layer

**Key architectural decisions from review:**
- **5.5 (signed JWT cookie) is DROPPED.** JWT already provides integrity via HMAC. Signing the cookie on top is redundant, couples Fastify cookie state with the Next.js Edge middleware (which reads the raw cookie via `jose.jwtVerify()`), and provides zero additional security for JWT-in-cookie scenarios. Documented as N/A in CONSOLIDATED-TODO-LIST.
- **5.1 renamed** from "magic bytes validation" to "MIME/extension consistency + magic-byte verification". Uses `file-type` for actual magic-byte reading via ranged S3 GET.
- **5.3 fix** is deleting the redundant `LoginSchema` + controller parse, not building a parallel API.
- **CSRF (5.4)** uses explicit per-route hook application with a route inventory.
- **New item 5.18:** `@fastify/helmet` for security headers.
- **New item 5.19:** Per-route body size limits for auth/admin routes.
- **New item 5.20:** CORS fail-fast in production (crash on missing `CORS_ORIGINS` instead of logging a warning).
- **New item 5.21:** Presigned URL expiry differentiation (shorter GET expiry for downloads vs PUT expiry for uploads).
- **New item 5.22:** Timing-safe comparison audit (ensure token comparisons use `crypto.timingSafeEqual`).
- **New item 5.23:** Token rotation on privilege escalation (`tokenVersion` on User model).
- **New item 5.24:** Audit logging for security-sensitive operations (new AuditLog model + module).
- **New item 5.25:** Per-account brute-force protection / account lockout (new LoginAttempt model).
- **New item 5.26:** Refresh token / sliding session strategy (access+refresh token pair).

---

## Batch order (for subagent-driven-development)

| Task | Items | Risk | Summary |
|------|-------|------|---------|
| 1 | 5.7 + 5.8 + 5.9 + 5.12 + 5.18 + 5.19 + 5.20 + 5.21 | Low | Server config: trustProxy, Swagger, randomUUID, port, helmet, body limits, CORS fail-fast, presigned URL expiry |
| 2 | 5.17 + 5.3 + 5.10 | Low | Filename hardening: filename* preference, delete redundant LoginSchema, sanitizeFilename |
| 3 | 5.6 + 5.14 + 5.15 | Low-Med | Admin detection fix, proxy cookie:false audit, OAuth redirect validation |
| 4 | 5.13 | Medium | 2FA disable requires TOTP code |
| 5 | 5.4 + 5.22 | Medium | CSRF protection + timing-safe comparison audit |
| 6 | 5.1 + 5.2 | Medium | File MIME/magic-byte validation + presigned URL maxFileSize |
| 7 | 5.11 + 5.16 | High | AppError hierarchy + controller migration |
| 8 | 5.23 + 5.25 | High | Token rotation + account lockout (DB migrations) |
| 9 | 5.26 + 5.24 | High | Refresh token strategy + audit logging (new modules) |

---

## Task 1: Server config hardening (5.7, 5.8, 5.9, 5.12, 5.18, 5.19)

**Files:**
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/src/modules/file/controller.ts:43`
- Modify: `apps/server/src/modules/file/multipart.controller.ts:23`
- Modify: `apps/server/src/config/directories.config.ts:50`
- Test: `apps/server/src/__tests__/server-config.test.ts` (new)

### 5.9 — Replace Math.random() with crypto.randomUUID()

**Verified targets (from codebase grep):**
1. `apps/server/src/modules/file/controller.ts:43` — objectName generation
2. `apps/server/src/modules/file/multipart.controller.ts:23` — objectName generation (same pattern)
3. `apps/server/src/config/directories.config.ts:50` — temp file naming (server-only, low risk but fix for consistency)

**NOT in scope:** `reverse-share/controller.ts` — already uses `crypto.randomUUID()`, no `Math.random()` present.

- [ ] **Step 1.1: Write test that Math.random is absent from objectName generation files**

Create `apps/server/src/__tests__/server-config.test.ts`:
```typescript
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

describe("Math.random() elimination (5.9)", () => {
  const files = [
    "src/modules/file/controller.ts",
    "src/modules/file/multipart.controller.ts",
    "src/config/directories.config.ts",
  ];

  for (const file of files) {
    it(`${file} should not use Math.random()`, () => {
      const content = readFileSync(new URL(`../${file}`, import.meta.url), "utf-8");
      expect(content).not.toContain("Math.random()");
    });
  }
});
```

Run: `pnpm --filter ouitransfer-server test src/__tests__/server-config.test.ts`
Expected: FAIL (Math.random still present in all 3 files)

- [ ] **Step 1.2: Fix file/controller.ts:43**

Replace:
```typescript
const objectName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(7)}-${filename}.${extension}`;
```
With:
```typescript
import crypto from "node:crypto";
// ...
const safeFilename = `${filename}.${extension}`.replace(/[/\\?%*:|"<>]/g, "_");
const objectName = `${userId}/${crypto.randomUUID()}-${safeFilename}`;
```

Note: The inline `replace()` is temporary — Task 2 (5.10) will replace it with a proper `sanitizeFilename` utility.

- [ ] **Step 1.3: Fix multipart.controller.ts:23**

Same pattern as Step 1.2. In `apps/server/src/modules/file/multipart.controller.ts:23`, replace the `Math.random()` objectName generation with `crypto.randomUUID()`.

- [ ] **Step 1.4: Fix directories.config.ts:50**

In `apps/server/src/config/directories.config.ts:50`, replace:
```typescript
const randomSuffix = Math.random().toString(36).substring(2, 8);
```
With:
```typescript
import crypto from "node:crypto";
// ...
const randomSuffix = crypto.randomUUID().slice(0, 8);
```

- [ ] **Step 1.5: Run test to verify**

Run: `pnpm --filter ouitransfer-server test src/__tests__/server-config.test.ts`
Expected: PASS

### 5.12 — Make server port configurable via env var

- [ ] **Step 1.6: Add PORT to env schema with Zod validation**

In `apps/server/src/env.ts`, add (addresses I-10: use Zod coercion, not parseInt):
```typescript
PORT: z.coerce.number().int().min(1).max(65535).optional().default(3333),
```

This validates at startup — `PORT=foo` will fail fast with a clear Zod error instead of silently producing NaN.

- [ ] **Step 1.7: Use env.PORT in server.ts**

In `apps/server/src/server.ts`, replace the hardcoded `3333`:
```typescript
await app.listen({
  port: env.PORT,
  host: "0.0.0.0",
});

app.log.info({ port: env.PORT }, "OUITRANSFER server running");
```

No `parseInt` needed — Zod already coerces to number.

### 5.7 — Restrict trustProxy configuration

- [ ] **Step 1.8: Add TRUST_PROXY to env schema**

In `apps/server/src/env.ts`, add:
```typescript
TRUST_PROXY: z
  .string()
  .optional()
  .default("loopback")
  .transform((v) => v.toLowerCase()),
```

The `.transform(toLowerCase)` addresses I-8: `TRUST_PROXY=True` would silently become a CIDR string. Now it normalizes to lowercase first.

- [ ] **Step 1.9: Create parseTrustProxy helper and use in app.ts**

In `apps/server/src/app.ts`, add before `buildApp`:
```typescript
/**
 * Parse TRUST_PROXY env var into the type Fastify expects.
 *
 * Accepts:
 * - "true" / "false" → boolean
 * - "loopback", "linklocal", "uniquelocal" → string (Fastify keywords)
 * - A numeric string like "1" → number (hop count)
 * - A comma-separated list → string[] (CIDR ranges)
 * - A single CIDR → string
 */
function parseTrustProxy(value: string): boolean | number | string | string[] {
  if (value === "true") return true;
  if (value === "false") return false;
  // Numeric hop count (e.g. "1" = trust 1 proxy hop)
  if (/^\d+$/.test(value)) return Number(value);
  if (value.includes(",")) return value.split(",").map((s) => s.trim());
  return value; // "loopback", "linklocal", "uniquelocal", or single CIDR
}
```

Replace `trustProxy: true` with `trustProxy: parseTrustProxy(env.TRUST_PROXY)`.

### 5.8 — Protect Swagger/API docs in production

- [ ] **Step 1.10: Add ENABLE_API_DOCS to env schema**

In `apps/server/src/env.ts`, add:
```typescript
ENABLE_API_DOCS: z.union([z.literal("true"), z.literal("false")]).optional(),
```

- [ ] **Step 1.11: Gate Swagger registration — no else branch (addresses I-9)**

In `apps/server/src/app.ts`, replace the unconditional Swagger registration with:
```typescript
const isDevMode = process.env.NODE_ENV !== "production";
const docsEnabled = isDevMode || env.ENABLE_API_DOCS === "true";

if (docsEnabled) {
  registerSwagger(app);
  app.register(fastifySwaggerUi, {
    routePrefix: "/swagger",
  });

  const { default: scalarFastify } = await import("@scalar/fastify-api-reference");
  app.register(scalarFastify, {
    routePrefix: "/docs",
    configuration: {
      theme: "deepSpace",
    },
  });
}
// No else branch — globalNotFoundHandler already returns 404 for unregistered routes (I-9).
```

### 5.18 (NEW) — Security headers via @fastify/helmet

- [ ] **Step 1.12: Install @fastify/helmet**

```bash
pnpm --filter ouitransfer-server add @fastify/helmet
```

- [ ] **Step 1.13: Register helmet in app.ts**

In `apps/server/src/app.ts`, add early in `buildApp()` (before route registration):
```typescript
import helmet from "@fastify/helmet";

// Security headers: CSP, X-Content-Type-Options, X-Frame-Options, etc.
await app.register(helmet, {
  // Content-Security-Policy is set by Next.js for the frontend;
  // the API doesn't serve HTML, so a restrictive default is fine.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  // HSTS is typically set by the reverse proxy (nginx/caddy), but
  // setting it here provides defense-in-depth.
  strictTransportSecurity: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
  },
});
```

### 5.19 (NEW) — Per-route body size limits

- [ ] **Step 1.14: Add restrictive bodyLimit to auth/admin routes**

In `apps/server/src/modules/auth/routes.ts`, add `bodyLimit` to each route's options:
```typescript
// Login, register, forgot-password, reset-password, 2FA endpoints:
bodyLimit: 64 * 1024, // 64 KB — auth payloads are small JSON
```

In `apps/server/src/modules/app/routes.ts`, add to admin config endpoints:
```typescript
bodyLimit: 64 * 1024, // 64 KB
```

The global `bodyLimit: 50 * 1024 * 1024` (50 MB) remains for file-related endpoints that may carry metadata.

### 5.20 (NEW) — CORS fail-fast in production

Currently `apps/server/src/app.ts:79-84` logs a warning when `CORS_ORIGINS` is unset in production but continues serving with `localhost:5487` as the only allowed origin. This silently breaks the app for real deployments.

- [ ] **Step 1.15: Crash on missing CORS_ORIGINS in production**

In `apps/server/src/app.ts`, replace the warning-only block:
```typescript
if (!process.env.CORS_ORIGINS && process.env.NODE_ENV === "production") {
  app.log.warn(
    "[SECURITY] CORS_ORIGINS is not set in production. Defaulting to localhost only. " +
      "Set CORS_ORIGINS=https://your-domain.com to allow your frontend.",
  );
}
```
With:
```typescript
if (!process.env.CORS_ORIGINS && process.env.NODE_ENV === "production") {
  throw new Error(
    "CORS_ORIGINS is required in production. " +
    "Set CORS_ORIGINS=https://your-domain.com (comma-separated for multiple origins).",
  );
}
```

### 5.21 (NEW) — Presigned URL expiry differentiation

Downloads (GET URLs) for sensitive shares should have shorter expiry than uploads (PUT URLs). Currently all use `PRESIGNED_URL_EXPIRATION` (default 3600s = 1h).

- [ ] **Step 1.16: Add PRESIGNED_GET_URL_EXPIRATION to env schema**

In `apps/server/src/env.ts`, add:
```typescript
PRESIGNED_GET_URL_EXPIRATION: z.coerce.number().int().min(60).max(86400).optional().default(900),
```

Default: 900s (15 min) for download URLs. Upload URLs keep the existing `PRESIGNED_URL_EXPIRATION` default (3600s).

Also migrate `PRESIGNED_URL_EXPIRATION` to Zod coercion (same pattern as PORT — avoids parseInt):
```typescript
PRESIGNED_URL_EXPIRATION: z.coerce.number().int().min(60).max(86400).optional().default(3600),
```

- [ ] **Step 1.17: Use GET-specific expiry for download presigned URLs**

In `apps/server/src/modules/file/download.controller.ts:76`, replace:
```typescript
const expires = parseInt(env.PRESIGNED_URL_EXPIRATION, 10);
```
With:
```typescript
const expires = env.PRESIGNED_GET_URL_EXPIRATION;
```

Do the same in `apps/server/src/modules/reverse-share/service.ts:242` (if it generates GET/download URLs — verify by reading the function context).

Leave PUT/upload URL generation unchanged (they keep `env.PRESIGNED_URL_EXPIRATION`).

Remove all remaining `parseInt(env.PRESIGNED_URL_EXPIRATION, 10)` calls and use the Zod-coerced number directly (`env.PRESIGNED_URL_EXPIRATION`).

- [ ] **Step 1.18: Type-check**

Run: `pnpm --filter ouitransfer-server type-check`
Expected: exit 0

- [ ] **Step 1.19: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/server.ts apps/server/src/env.ts apps/server/src/modules/file/controller.ts apps/server/src/modules/file/multipart.controller.ts apps/server/src/modules/file/download.controller.ts apps/server/src/config/directories.config.ts apps/server/src/__tests__/server-config.test.ts apps/server/src/modules/auth/routes.ts apps/server/src/modules/app/routes.ts apps/server/src/modules/reverse-share/service.ts apps/server/src/modules/reverse-share/upload.service.ts apps/server/src/modules/reverse-share/multipart.service.ts
git commit -m "feat(server): configurable port/trustProxy, gated Swagger, helmet, body limits, CORS fail-fast, presigned URL expiry split (5.7/5.8/5.9/5.12/5.18-5.21)"
```

---

## Task 2: Filename/Content-Disposition hardening (5.17, 5.3, 5.10)

**Files:**
- Modify: `packages/shared/src/mime-types.ts`
- Modify: `apps/server/src/modules/auth/dto.ts`
- Modify: `apps/server/src/modules/auth/controller.ts`
- Create: `apps/server/src/utils/sanitize-filename.ts`
- Modify: `apps/server/src/modules/file/controller.ts` (use sanitizeFilename)
- Modify: `apps/server/src/modules/file/multipart.controller.ts` (use sanitizeFilename)
- Test: `packages/shared/src/__tests__/mime-types.test.ts`
- Test: `apps/server/src/utils/__tests__/sanitize-filename.test.ts`

### 5.17 — Prefer `filename*` over `filename` in Content-Disposition

- [ ] **Step 2.1: Write tests for filename* priority (including M-3: charset fallback test)**

Create or extend `packages/shared/src/__tests__/mime-types.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { extractFilenameFromContentDisposition } from "../mime-types.js";

describe("extractFilenameFromContentDisposition (5.17)", () => {
  it("prefers filename* over filename when both are present", () => {
    const header = `attachment; filename="ascii.txt"; filename*=UTF-8''utf8%20name.txt`;
    expect(extractFilenameFromContentDisposition(header)).toBe("utf8 name.txt");
  });

  it("falls back to filename when filename* is absent", () => {
    const header = `attachment; filename="fallback.txt"`;
    expect(extractFilenameFromContentDisposition(header)).toBe("fallback.txt");
  });

  it("returns null when neither is present", () => {
    expect(extractFilenameFromContentDisposition("attachment")).toBeNull();
  });

  it("handles RFC 5987 UTF-8 encoded filename*", () => {
    const header = `attachment; filename*=UTF-8''caf%C3%A9.pdf`;
    expect(extractFilenameFromContentDisposition(header)).toBe("café.pdf");
  });

  it("handles unquoted filename fallback", () => {
    const header = `attachment; filename=simple.txt`;
    expect(extractFilenameFromContentDisposition(header)).toBe("simple.txt");
  });

  it("returns null for null input", () => {
    expect(extractFilenameFromContentDisposition(null)).toBeNull();
  });

  // M-3: non-UTF-8 charset falls through to plain filename
  it("ignores filename* with non-UTF-8 charset and falls back to filename", () => {
    const header = `attachment; filename*=ISO-8859-1''cafe.pdf; filename="fallback-cafe.pdf"`;
    expect(extractFilenameFromContentDisposition(header)).toBe("fallback-cafe.pdf");
  });

  it("falls back to null when filename* is non-UTF-8 and no filename= present", () => {
    const header = `attachment; filename*=ISO-8859-1''cafe.pdf`;
    expect(extractFilenameFromContentDisposition(header)).toBeNull();
  });

  it("handles malformed percent-encoding gracefully", () => {
    const header = `attachment; filename*=UTF-8''bad%ZZname.txt; filename="good.txt"`;
    expect(extractFilenameFromContentDisposition(header)).toBe("good.txt");
  });
});
```

Run: `pnpm --filter @ouitransfer/shared test`
Expected: some tests FAIL (filename* not preferred, charset tests fail)

- [ ] **Step 2.2: Implement two-pass parsing**

In `packages/shared/src/mime-types.ts`, replace the existing `extractFilenameFromContentDisposition` function (around line 399-411):
```typescript
/**
 * Extract filename from Content-Disposition header.
 *
 * Per RFC 6266, `filename*` takes priority over `filename` when both are present.
 * Only UTF-8 charset is supported for filename* (per RFC 5987). Non-UTF-8 charsets
 * are ignored and the parser falls through to plain filename=.
 *
 * @param contentDisposition - The Content-Disposition header value
 * @returns Decoded filename or null if not found
 */
export function extractFilenameFromContentDisposition(
  contentDisposition: string | null,
): string | null {
  if (!contentDisposition) return null;

  // First pass: look for RFC 5987 filename* with UTF-8 charset only
  const extMatch = contentDisposition.match(/filename\*=UTF-8''([^;\s]+)/i);
  if (extMatch?.[1]) {
    try {
      return decodeURIComponent(extMatch[1]);
    } catch {
      // Malformed percent-encoding — fall through to filename=
    }
  }

  // Second pass: fall back to plain filename= (quoted or unquoted)
  const plainMatch = contentDisposition.match(/filename=(?:"([^"]*)"|([^;\s]*))/i);
  const filename = plainMatch ? (plainMatch[1] ?? plainMatch[2] ?? null) : null;
  return filename ? decodeURIComponent(filename) : null;
}
```

- [ ] **Step 2.3: Verify tests pass**

Run: `pnpm --filter @ouitransfer/shared test`
Expected: all tests PASS

### 5.10 — Sanitize filenames (addresses M-2: trailing dots/spaces, Windows reserved names)

- [ ] **Step 2.4: Write tests for sanitizeFilename**

Create `apps/server/src/utils/__tests__/sanitize-filename.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "../sanitize-filename.js";

describe("sanitizeFilename (5.10)", () => {
  it("removes path separators", () => {
    expect(sanitizeFilename("path/to/file.txt")).toBe("file.txt");
    expect(sanitizeFilename("path\\to\\file.txt")).toBe("file.txt");
  });

  it("strips null bytes", () => {
    expect(sanitizeFilename("file\0name.txt")).toBe("filename.txt");
  });

  it("removes leading dots (hidden files)", () => {
    expect(sanitizeFilename(".hidden")).toBe("hidden");
    expect(sanitizeFilename("...dotdot")).toBe("dotdot");
  });

  it("strips trailing dots and spaces (Windows FS safety — M-2)", () => {
    expect(sanitizeFilename("file.txt.")).toBe("file.txt");
    expect(sanitizeFilename("file.txt   ")).toBe("file.txt");
    expect(sanitizeFilename("file...")).toBe("file");
  });

  it("rejects Windows reserved names (M-2)", () => {
    expect(sanitizeFilename("CON")).toBe("_CON");
    expect(sanitizeFilename("con.txt")).toBe("_con.txt");
    expect(sanitizeFilename("NUL")).toBe("_NUL");
    expect(sanitizeFilename("COM1")).toBe("_COM1");
    expect(sanitizeFilename("LPT3.log")).toBe("_LPT3.log");
    expect(sanitizeFilename("PRN")).toBe("_PRN");
  });

  it("allows normal filenames through unchanged", () => {
    expect(sanitizeFilename("my document (2024).pdf")).toBe("my document (2024).pdf");
    expect(sanitizeFilename("résumé.docx")).toBe("résumé.docx");
  });

  it("handles empty/falsy input", () => {
    expect(sanitizeFilename("")).toBe("unnamed");
    expect(sanitizeFilename("   ")).toBe("unnamed");
  });

  it("truncates to 255 bytes preserving UTF-8 code point boundaries", () => {
    const long = "a".repeat(300) + ".txt";
    const result = sanitizeFilename(long);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(255);
  });

  it("truncates multi-byte filenames at code point boundary", () => {
    // Each emoji is 4 bytes. 64 emojis = 256 bytes, should be truncated cleanly.
    const emojis = "😀".repeat(64) + ".txt";
    const result = sanitizeFilename(emojis);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(255);
    // Should not end with a replacement character
    expect(result).not.toContain("\uFFFD");
  });
});
```

Run: `pnpm --filter ouitransfer-server test src/utils/__tests__/sanitize-filename.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 2.5: Implement sanitize-filename.ts (addresses M-2)**

Create `apps/server/src/utils/sanitize-filename.ts`:
```typescript
/**
 * Sanitize a filename to prevent path traversal and filesystem issues.
 *
 * - Strips path separators (/, \) — keeps only the basename
 * - Removes null bytes
 * - Removes leading dots to prevent hidden files
 * - Strips trailing dots and spaces (Windows FS rejects these)
 * - Prefixes Windows reserved names (CON, PRN, NUL, COM1-9, LPT1-9)
 * - Truncates to 255 bytes at a UTF-8 code point boundary
 * - Falls back to "unnamed" for empty/whitespace-only input
 *
 * Scope: this function is designed for S3 object key segments and
 * user-facing filenames in API responses. S3 keys don't have Windows
 * reserved-name restrictions, but we sanitize anyway since filenames
 * are also used in Content-Disposition headers for downloads.
 */

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

export function sanitizeFilename(filename: string): string {
  if (!filename || filename.trim() === "") return "unnamed";

  // Keep only the last segment (strip directory traversal)
  let safe = filename.replace(/\\/g, "/").split("/").pop() || "";

  // Remove null bytes
  safe = safe.replace(/\0/g, "");

  // Remove leading dots
  safe = safe.replace(/^\.+/, "");

  // Strip trailing dots and spaces (Windows FS safety)
  safe = safe.replace(/[.\s]+$/, "");

  // Fallback if nothing remains
  if (!safe.trim()) return "unnamed";

  // Prefix Windows reserved names
  if (WINDOWS_RESERVED.test(safe)) {
    safe = `_${safe}`;
  }

  // Truncate to 255 bytes at a UTF-8 code point boundary
  const buf = Buffer.from(safe, "utf8");
  if (buf.length > 255) {
    // Use TextDecoder with fatal:false to handle truncated multi-byte chars.
    // Slice to 255 bytes, decode, then strip any trailing replacement char.
    const decoder = new TextDecoder("utf-8", { fatal: false });
    safe = decoder.decode(buf.subarray(0, 255));
    // Remove trailing replacement character (U+FFFD) from truncated code point
    safe = safe.replace(/\uFFFD+$/, "");
    // Re-strip trailing dots/spaces that may have been exposed
    safe = safe.replace(/[.\s]+$/, "");
  }

  return safe || "unnamed";
}
```

- [ ] **Step 2.6: Apply sanitizeFilename in file/controller.ts and multipart.controller.ts**

In `apps/server/src/modules/file/controller.ts`, add import and replace the inline hack from Step 1.2:
```typescript
import { sanitizeFilename } from "../../utils/sanitize-filename.js";
// ...
const safeFilename = sanitizeFilename(`${filename}.${extension}`);
const objectName = `${userId}/${crypto.randomUUID()}-${safeFilename}`;
```

Apply the same pattern in `apps/server/src/modules/file/multipart.controller.ts`.

- [ ] **Step 2.7: Verify sanitize-filename tests pass**

Run: `pnpm --filter ouitransfer-server test src/utils/__tests__/sanitize-filename.test.ts`
Expected: all PASS

### 5.3 — Delete redundant LoginSchema (addresses C-5)

**Root cause (verified):** `apps/server/src/modules/auth/routes.ts:26-33` already builds a dynamic `loginSchema` using `await createPasswordSchema()` and passes it to Fastify as the route's `body` schema. Fastify validates the body against this dynamic schema BEFORE the controller runs. The controller's `LoginSchema.parse(request.body)` at `controller.ts:30` is a redundant re-validation with a misleading static `min(6)` that never actually rejects anything (the route-level check is stricter).

Fix: delete `LoginSchema` and the redundant parse. Do NOT build a parallel `createLoginSchema()` API.

- [ ] **Step 2.8: Delete LoginSchema from dto.ts**

In `apps/server/src/modules/auth/dto.ts:15-22`, delete:
```typescript
export const LoginSchema = z.object({
  emailOrUsername: z
    .string()
    .min(1, "Email or username is required")
    .describe("User email or username"),
  password: z.string().min(6, "Password must be at least 6 characters").describe("User password"),
});
export type LoginInput = z.infer<typeof LoginSchema>;
```

Keep the `LoginInput` type but derive it from the route schema pattern:
```typescript
/** Login input shape — matches the dynamic schema built in routes.ts */
export interface LoginInput {
  emailOrUsername: string;
  password: string;
}
```

- [ ] **Step 2.9: Remove redundant parse in auth/controller.ts**

In `apps/server/src/modules/auth/controller.ts:30`, replace:
```typescript
const input = LoginSchema.parse(request.body);
```
With:
```typescript
const input = request.body as LoginInput;
```

Remove the `LoginSchema` import. The body has already been validated by Fastify's route-level schema.

- [ ] **Step 2.10: Search for other LoginSchema usages and clean up**

Search the codebase for any other imports of `LoginSchema` and update them. It should only have been used in the controller.

- [ ] **Step 2.11: Type-check all modified packages**

Run: `pnpm --filter ouitransfer-server type-check && pnpm --filter @ouitransfer/shared type-check`
Expected: exit 0

- [ ] **Step 2.12: Commit**

```bash
git add packages/shared/src/mime-types.ts packages/shared/src/__tests__/ apps/server/src/utils/sanitize-filename.ts apps/server/src/utils/__tests__/ apps/server/src/modules/file/controller.ts apps/server/src/modules/file/multipart.controller.ts apps/server/src/modules/auth/dto.ts apps/server/src/modules/auth/controller.ts
git commit -m "feat(server): filename* preference, filename sanitization, delete redundant LoginSchema (5.3/5.10/5.17)"
```

---

## Task 3: Admin detection, proxy cookie hardening, OAuth redirect (5.6, 5.14, 5.15)

**Files:**
- Modify: `apps/server/src/modules/app/routes.ts`
- Modify: `apps/web/src/lib/proxy-routes.ts`
- Modify: `apps/web/src/lib/proxy.ts`
- Test: `apps/web/src/lib/__tests__/proxy-oauth-redirect.test.ts` (new)

### 5.6 — Fix admin detection logic (addresses M-1: split error handling, race note)

- [ ] **Step 3.1: Fix adminPreValidation**

In `apps/server/src/modules/app/routes.ts:11-32`, replace `adminPreValidation`:
```typescript
const adminPreValidation = async (request: FastifyRequest, reply: FastifyReply) => {
  // Count users — this is a separate concern from JWT verification.
  // DB errors must propagate to globalErrorHandler, not be swallowed as 401.
  const usersCount = await prisma.user.count();

  // Only skip auth before any user is registered (initial setup).
  // Once even one user exists, all admin endpoints require authentication.
  // NOTE: During the setup window (usersCount === 0), admin endpoints are
  // unprotected. This is acceptable for initial setup only. A future
  // improvement could restrict this bypass to the "create first user" route.
  if (usersCount === 0) {
    return;
  }

  // JWT verification — failures should return 401 Unauthorized.
  try {
    await request.jwtVerify();
  } catch (err) {
    request.log.warn({ err }, "Admin JWT verification failed");
    return reply.status(401).send({ error: "Unauthorized" });
  }

  if (!request.user.isAdmin) {
    return reply.status(403).send({ error: "Access restricted to administrators" });
  }
};
```

Key changes:
- `usersCount <= 1` → `usersCount === 0` (the actual bug)
- DB errors propagate to globalErrorHandler (no try/catch around `prisma.user.count()`)
- JWT errors caught separately with a proper error message (was `"."`)
- Race condition during setup window documented as a known limitation

### 5.14 — Standardize cookie:false on public proxy routes

- [ ] **Step 3.2: Apply cookie:false to all verified public routes**

Based on the route audit (proxy-routes.ts cross-referenced with backend route files), the following routes need `cookie: false` added:

| Route | Reason |
|-------|--------|
| `POST auth/2fa/login` | Uses challengeToken body, not JWT |
| `GET auth/providers/:provider/authorize` | OAuth redirect, public endpoint |
| `GET auth/providers/:provider/callback` | OAuth callback, public endpoint |
| `GET auth/providers` | Public provider listing for login page |
| `GET shares/alias/get/:alias` | Public share access |
| `POST shares/alias/:alias/access` | Public password-check |
| `GET shares/details/:shareId` | Public share access |
| `POST shares/:shareId/access` | Public password-check |

Routes intentionally kept WITH cookies:
- `POST auth/logout` — needs cookie to clear it
- `GET auth/me` — does optional JWT verify internally

In `apps/web/src/lib/proxy-routes.ts`, add `cookie: false` to each of the 8 routes listed above. For OAuth routes (#26, #27), also verify whether the existing `auth: true` flag is still needed — if the backend doesn't use an Authorization header on those routes, remove `auth: true` as well.

- [ ] **Step 3.3: Verify existing proxy route tests still pass**

Run: `pnpm --filter ouitransfer-web test src/lib/__tests__/proxy-routes.test.ts`
Expected: all tests PASS

### 5.15 — Validate OAuth redirect URLs (addresses I-5: env-driven extension)

- [ ] **Step 3.4: Write tests for OAuth redirect validation**

Create `apps/web/src/lib/__tests__/proxy-oauth-redirect.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isAllowedRedirectUrl } from "../proxy.js";

describe("isAllowedRedirectUrl (5.15)", () => {
  it("allows same-origin redirects", () => {
    expect(isAllowedRedirectUrl("https://app.example.com/callback", "https://app.example.com/api/x")).toBe(true);
  });

  it("allows known OAuth provider hostnames", () => {
    expect(isAllowedRedirectUrl("https://accounts.google.com/o/oauth2/auth", "https://app.example.com/api/x")).toBe(true);
    expect(isAllowedRedirectUrl("https://github.com/login/oauth/authorize", "https://app.example.com/api/x")).toBe(true);
  });

  it("rejects arbitrary external URLs", () => {
    expect(isAllowedRedirectUrl("https://evil.com/steal-token", "https://app.example.com/api/x")).toBe(false);
  });

  it("allows relative URLs (same origin implied)", () => {
    expect(isAllowedRedirectUrl("/callback?code=abc", "https://app.example.com/api/x")).toBe(true);
  });

  it("rejects protocol-relative URLs (//evil.com)", () => {
    expect(isAllowedRedirectUrl("//evil.com/steal", "https://app.example.com/api/x")).toBe(false);
  });

  it("handles malformed URLs gracefully", () => {
    expect(isAllowedRedirectUrl("not-a-url-at-all", "https://app.example.com/api/x")).toBe(false);
  });

  // I-5: env-driven extension for custom OIDC providers
  it("allows custom OIDC redirect hosts from env", () => {
    vi.stubEnv("OAUTH_ALLOWED_REDIRECT_HOSTS", "auth.acme.example.com,login.corp.net");
    // Re-import or call a function that reads env at invocation time
    expect(isAllowedRedirectUrl("https://auth.acme.example.com/auth", "https://app.example.com/api/x")).toBe(true);
    expect(isAllowedRedirectUrl("https://login.corp.net/callback", "https://app.example.com/api/x")).toBe(true);
    vi.unstubAllEnvs();
  });
});
```

Run: `pnpm --filter ouitransfer-web test src/lib/__tests__/proxy-oauth-redirect.test.ts`
Expected: FAIL (isAllowedRedirectUrl not exported)

- [ ] **Step 3.5: Implement isAllowedRedirectUrl with env extension**

In `apps/web/src/lib/proxy.ts`, add:
```typescript
/**
 * Well-known OAuth provider hostnames. Extended at runtime by
 * OAUTH_ALLOWED_REDIRECT_HOSTS env var for custom OIDC providers
 * (e.g. Keycloak, Auth0).
 */
const BUILTIN_OAUTH_HOSTS = new Set([
  "accounts.google.com",
  "github.com",
  "gitlab.com",
  "login.microsoftonline.com",
  "discord.com",
  "accounts.spotify.com",
]);

function getAllowedRedirectHosts(): Set<string> {
  const hosts = new Set(BUILTIN_OAUTH_HOSTS);
  const envHosts = process.env.OAUTH_ALLOWED_REDIRECT_HOSTS;
  if (envHosts) {
    for (const h of envHosts.split(",")) {
      const trimmed = h.trim().toLowerCase();
      if (trimmed) hosts.add(trimmed);
    }
  }
  return hosts;
}

/**
 * Validate that a redirect URL is safe:
 * - Relative URLs (starting with "/" but not "//") are always allowed
 * - Same-origin URLs are allowed
 * - Known OAuth provider hostnames (built-in + env OAUTH_ALLOWED_REDIRECT_HOSTS) are allowed
 * - Everything else is blocked
 */
export function isAllowedRedirectUrl(location: string, requestUrl: string): boolean {
  // Relative URLs are safe (same-origin implied by browser)
  if (location.startsWith("/") && !location.startsWith("//")) {
    return true;
  }

  try {
    const locationUrl = new URL(location);
    const reqUrl = new URL(requestUrl);

    // Same-origin check
    if (locationUrl.origin === reqUrl.origin) {
      return true;
    }

    // Known OAuth provider (built-in + env)
    const allowedHosts = getAllowedRedirectHosts();
    if (allowedHosts.has(locationUrl.hostname.toLowerCase())) {
      return true;
    }

    return false;
  } catch {
    // Malformed URL
    return false;
  }
}
```

- [ ] **Step 3.6: Apply validation in handleProxyRequest redirect handler**

In `apps/web/src/lib/proxy.ts`, find the redirect handling block (around line 325) and add:
```typescript
if (config.redirect && apiRes.status >= 300 && apiRes.status < 400) {
  const location = apiRes.headers.get("location");
  if (location) {
    if (!isAllowedRedirectUrl(location, req.url)) {
      logger.error(`Proxy blocked suspicious redirect to: ${location}`);
      return NextResponse.json({ error: "Invalid redirect target" }, { status: 502 });
    }
    const absoluteUrl = new URL(location, req.url).toString();
    const response = new NextResponse(null, {
      status: apiRes.status,
      headers: { location: absoluteUrl },
    });
    forwardSetCookie(apiRes, response);
    return response;
  }
}
```

- [ ] **Step 3.7: Verify tests pass**

Run: `pnpm --filter ouitransfer-web test src/lib/__tests__/proxy-oauth-redirect.test.ts`
Expected: all PASS

- [ ] **Step 3.8: Type-check**

Run: `pnpm --filter ouitransfer-server type-check && pnpm --filter ouitransfer-web type-check`
Expected: exit 0

- [ ] **Step 3.9: Commit**

```bash
git add apps/server/src/modules/app/routes.ts apps/web/src/lib/proxy-routes.ts apps/web/src/lib/proxy.ts apps/web/src/lib/__tests__/proxy-oauth-redirect.test.ts
git commit -m "feat(server,web): fix admin detection, proxy cookie:false audit, OAuth redirect validation (5.6/5.14/5.15)"
```

---

## Task 4: 2FA disable hardening (5.13)

**Files:**
- Modify: `apps/server/src/modules/two-factor/service.ts`
- Modify: `apps/server/src/modules/two-factor/controller.ts`
- Modify: `apps/web/src/http/endpoints/auth/two-factor/types.ts`
- Modify: `apps/web/src/http/endpoints/auth/two-factor/index.ts`
- Modify: `apps/web/src/app/profile/hooks/use-two-factor.ts`
- Modify: `apps/web/src/app/profile/components/two-factor-form.tsx`
- Modify: `apps/web/messages/en-US.json` + all 22 other locale files
- Test: `apps/server/src/modules/two-factor/__tests__/service.test.ts` (new)

### 5.13 — Require TOTP code to disable 2FA

- [ ] **Step 4.1: Write tests for disable 2FA with TOTP (addresses I-6: clean mock types)**

Create `apps/server/src/modules/two-factor/__tests__/service.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as OTPAuth from "otpauth";
import bcrypt from "bcryptjs";

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "../../../shared/prisma.js";
import { TwoFactorService } from "../service.js";

describe("TwoFactorService.disable2FA (5.13)", () => {
  const service = new TwoFactorService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("succeeds with valid password + TOTP code", async () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret });
    const validToken = totp.generate();
    const password = "correct-password";
    const hashedPassword = await bcrypt.hash(password, 10);

    // I-6: Use `as never` for mock values — clean, simple, no conditional-type gymnastics.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: secret.base32,
      twoFactorBackupCodes: null,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    await expect(service.disable2FA("user-1", password, validToken)).resolves.toEqual({ success: true });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user-1" },
      data: expect.objectContaining({ twoFactorEnabled: false }),
    }));
  });

  it("rejects invalid TOTP code even with correct password", async () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const password = "correct-password";
    const hashedPassword = await bcrypt.hash(password, 10);

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: secret.base32,
      twoFactorBackupCodes: null,
    } as never);

    await expect(service.disable2FA("user-1", password, "000000")).rejects.toThrow();
  });

  it("rejects wrong password even with valid TOTP", async () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret });
    const validToken = totp.generate();
    const hashedPassword = await bcrypt.hash("real-password", 10);

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: secret.base32,
      twoFactorBackupCodes: null,
    } as never);

    await expect(service.disable2FA("user-1", "wrong-password", validToken)).rejects.toThrow("Invalid password");
  });
});
```

Run: `pnpm --filter ouitransfer-server test src/modules/two-factor/__tests__/service.test.ts`
Expected: FAIL (disable2FA has wrong signature)

- [ ] **Step 4.2: Update TwoFactorService.disable2FA signature**

In `apps/server/src/modules/two-factor/service.ts`, update the `disable2FA` method to require `totpCode` as a third parameter. Read the existing method at `service.ts:158-202` and add TOTP verification between the password check and the disable operation. Follow the pattern of the existing `verify2FA` method for TOTP validation (uses `OTPAuth.TOTP.validate`). Also support backup codes as a fallback.

Reference: see `apps/server/src/modules/two-factor/service.ts` — the existing `verify2FA` method shows the exact pattern for TOTP validation with backup code fallback.

- [ ] **Step 4.3: Update TwoFactorController.disable2FA**

In `apps/server/src/modules/two-factor/controller.ts`, update the `DisableSchema` (around line 24-26):
```typescript
const DisableSchema = z.object({
  password: z.string().min(1, "Password is required"),
  totpCode: z.string().min(6, "Verification code must be at least 6 characters")
    .describe("TOTP code or backup code"),
});
```

Update the `disable2FA` method to pass `body.totpCode` to the service.

- [ ] **Step 4.4: Update frontend types**

In `apps/web/src/http/endpoints/auth/two-factor/types.ts`:
```typescript
export interface DisableTwoFactorRequest {
  password: string;
  totpCode: string; // TOTP code or backup code — now required
}
```

In `apps/web/src/http/endpoints/auth/two-factor/index.ts`, verify the `disableTwoFactor` function passes the full request body.

- [ ] **Step 4.5: Update use-two-factor.ts hook**

In `apps/web/src/app/profile/hooks/use-two-factor.ts`:
1. Add `disableTotpCode` state alongside `disablePassword`
2. Update the disable mutation to pass both fields
3. Clear both fields on success
4. Handle missing TOTP error in onError
5. Export `disableTotpCode` and `setDisableTotpCode`

- [ ] **Step 4.6: Update two-factor-form.tsx disable modal**

In `apps/web/src/app/profile/components/two-factor-form.tsx`, add a TOTP input field alongside the existing password field in the disable modal:
```tsx
<div className="space-y-2">
  <Label htmlFor="totp-code">{t("twoFactor.disable.totpLabel")}</Label>
  <Input
    id="totp-code"
    type="text"
    inputMode="numeric"
    pattern="[0-9 -]*"
    placeholder="000 000"
    value={disableTotpCode}
    onChange={(e) => setDisableTotpCode(e.target.value)}
  />
  <p className="text-sm text-muted-foreground">{t("twoFactor.disable.totpHint")}</p>
</div>
```

- [ ] **Step 4.7: Add i18n keys (addresses M-5: use [en] prefix convention)**

In `apps/web/messages/en-US.json`, add under the `twoFactor.disable` namespace:
```json
"totpLabel": "Verification code",
"totpHint": "Enter your 6-digit authenticator code or a backup code"
```

For all 22 other locale files, add the same keys with `[en]` prefix to mark them as untranslated:
```json
"totpLabel": "[en] Verification code",
"totpHint": "[en] Enter your 6-digit authenticator code or a backup code"
```

This convention makes untranslated strings visible at runtime (M-5).

Also add to `apps/web/messages/en-US.json` under `twoFactor.messages`:
```json
"enterVerificationCode": "Please enter your verification code"
```

- [ ] **Step 4.8: Verify tests pass**

Run: `pnpm --filter ouitransfer-server test src/modules/two-factor/__tests__/service.test.ts`
Expected: all PASS

- [ ] **Step 4.9: Type-check**

Run: `pnpm --filter ouitransfer-server type-check && pnpm --filter ouitransfer-web type-check`
Expected: exit 0

- [ ] **Step 4.10: Commit**

```bash
git add apps/server/src/modules/two-factor/ apps/web/src/http/endpoints/auth/two-factor/ apps/web/src/app/profile/hooks/use-two-factor.ts apps/web/src/app/profile/components/two-factor-form.tsx apps/web/messages/
git commit -m "feat(server,web): require TOTP code to disable 2FA (5.13)"
```

---

## Task 5: CSRF protection — complete redesign (5.4)

**This task was completely rewritten to address C-3 (broken on 6 axes), I-7, I-11, M-4, M-8.**

**Files:**
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/env.ts`
- Modify: `apps/web/src/config/api.ts`
- Modify: `apps/web/src/lib/proxy.ts`
- Test: `apps/server/src/__tests__/csrf.test.ts` (new)

### Architecture

**Double-submit cookie pattern (corrected design):**

1. Server registers `@fastify/csrf-protection` with `sessionPlugin: "@fastify/cookie"`
2. A `GET /csrf-token` endpoint calls `reply.generateCsrf()` which:
   - Sets a `_csrf` **secret** cookie (httpOnly, used by the plugin internally)
   - Returns a **token** (HMAC-derived from the secret) in the response body
3. Frontend calls `GET /csrf-token` on page load, stores the returned **token** in memory
4. On every state-changing request (POST/PUT/PATCH/DELETE), frontend sends the token as `X-CSRF-Token` header
5. Plugin validates the header against the cookie secret on protected routes

**Route protection strategy:**
- CSRF protection is applied via a global `onRequest` hook that:
  - Skips safe methods: GET, HEAD, OPTIONS
  - Skips routes explicitly marked as CSRF-exempt (public unauthenticated endpoints)
  - Applies `fastify.csrfProtection` to everything else
- Public unauthenticated mutation endpoints are exempt (no session = no CSRF risk):
  - `POST /auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`
  - `POST /auth/2fa/login` (uses challengeToken, not session)
  - `POST /shares/:id/access`, `/shares/alias/:alias/access` (public password-check)
  - `POST /reverse-shares/alias/:alias/*` (public upload flow)
  - `POST /register-with-invite`

### Implementation

- [ ] **Step 5.1: Install @fastify/csrf-protection**

```bash
pnpm --filter ouitransfer-server add @fastify/csrf-protection
```

- [ ] **Step 5.2: Add CSRF_SECRET to env schema**

In `apps/server/src/env.ts` (addresses C-3e: separate secret):
```typescript
CSRF_SECRET: z
  .string()
  .min(32, "CSRF_SECRET must be at least 32 characters")
  .describe("HMAC key for CSRF token generation — must be distinct from JWT_SECRET"),
```

This is a required env var with no fallback — distinct secrets are non-negotiable.

- [ ] **Step 5.3: Write CSRF tests (addresses I-11, M-8)**

Create `apps/server/src/__tests__/csrf.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

describe("CSRF protection (5.4)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // M-8: use vi.stubEnv instead of process.env mutation
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("GET /csrf-token returns a token", async () => {
    const res = await app.inject({ method: "GET", url: "/csrf-token" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe("string");
    // Should also set the _csrf cookie
    const cookies = res.cookies;
    expect(cookies.some((c: { name: string }) => c.name === "_csrf")).toBe(true);
  });

  // I-11: test a real authenticated state-changing endpoint, not /auth/logout
  it("rejects POST to authenticated endpoint without CSRF token", async () => {
    // First, get a CSRF token (to have the cookie)
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");

    // POST without X-CSRF-Token header — should be rejected
    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        cookie: `_csrf=${csrfCookie?.value}`,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows POST with valid CSRF token", async () => {
    // Get CSRF token
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");

    // POST with X-CSRF-Token header — should pass CSRF check
    // (may still return 401 from auth, but NOT 403 from CSRF)
    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        cookie: `_csrf=${csrfCookie?.value}`,
        "x-csrf-token": token,
      },
    });
    // Not 403 (CSRF) — the actual response depends on auth state
    expect(res.statusCode).not.toBe(403);
  });

  it("allows GET without CSRF token", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("allows exempt public POST without CSRF token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emailOrUsername: "test@test.com", password: "password123456" }),
    });
    // Should NOT be 403 (CSRF) — login is exempt
    expect(res.statusCode).not.toBe(403);
  });
});
```

Run: `pnpm --filter ouitransfer-server test src/__tests__/csrf.test.ts`
Expected: FAIL (CSRF not yet implemented)

- [ ] **Step 5.4: Register CSRF protection in app.ts with global hook**

In `apps/server/src/app.ts`:
```typescript
import fastifyCsrf from "@fastify/csrf-protection";

// Register CSRF protection (after fastifyCookie)
await app.register(fastifyCsrf, {
  sessionPlugin: "@fastify/cookie",
  cookieOpts: {
    httpOnly: true,    // Secret cookie is NOT readable by JS (C-3b fix)
    sameSite: "lax",   // "lax" not "strict" — strict breaks OAuth callbacks (C-3d)
    secure: env.SECURE_SITE === "true",
    path: "/",
    signed: false,     // Cookie signing handled separately if needed
  },
  csrfOpts: {
    hmacKey: env.CSRF_SECRET, // Separate from JWT_SECRET (C-3e)
  },
});

// CSRF token endpoint
app.get("/csrf-token", {
  config: {
    rateLimit: { max: 30, timeWindow: "1 minute" }, // M-4: rate limit
  },
}, async (_request, reply) => {
  const token = await reply.generateCsrf();
  return reply.send({ token });
});

// Global CSRF enforcement hook (C-3a: explicit, not auto-protect)
const CSRF_EXEMPT_ROUTES = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/2fa/login",
  "/register-with-invite",
  "/health",
  "/csrf-token",
]);

// Prefix patterns for public upload/access routes
const CSRF_EXEMPT_PREFIXES = [
  "/shares/alias/",     // public share access
  "/shares/",           // public share access (e.g. /shares/:id/access)
  "/reverse-shares/alias/", // public reverse-share upload flow
];

app.addHook("onRequest", async (request, reply) => {
  // Safe methods don't need CSRF
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return;
  }

  // Check exempt routes
  const url = request.url.split("?")[0]; // Strip query string
  if (CSRF_EXEMPT_ROUTES.has(url)) {
    return;
  }

  // Check exempt prefixes — but only for known public mutation patterns
  // (e.g. /shares/:id/access, /reverse-shares/alias/:alias/upload/access)
  for (const prefix of CSRF_EXEMPT_PREFIXES) {
    if (url.startsWith(prefix) && (url.endsWith("/access") || url.includes("/upload"))) {
      return;
    }
  }

  // Apply CSRF protection
  await (app as unknown as { csrfProtection: (req: typeof request, rep: typeof reply) => Promise<void> }).csrfProtection(request, reply);
});
```

Note: The exact API for calling csrfProtection programmatically may differ — check `@fastify/csrf-protection` docs. The plugin decorates the fastify instance with `fastify.csrfProtection` which is an `onRequest`-compatible hook function.

- [ ] **Step 5.5: Update frontend Axios to fetch and send CSRF token (addresses I-7)**

In `apps/web/src/config/api.ts` (the verified actual file, not `http/api.ts`):

```typescript
// ── CSRF Token Management ─────────────────────────────────────
// Frontend fetches the CSRF token from GET /csrf-token on first
// state-changing request, then caches it in memory. The _csrf
// cookie (httpOnly) is sent automatically by the browser.

let csrfToken: string | null = null;
let csrfFetchPromise: Promise<string | null> | null = null;

async function fetchCsrfToken(): Promise<string | null> {
  // SSR guard (I-7)
  if (typeof window === "undefined") return null;

  try {
    const res = await axios.get("/api/csrf-token", { withCredentials: true });
    csrfToken = res.data.token;
    return csrfToken;
  } catch {
    return null;
  }
}

async function getCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  // Deduplicate concurrent requests
  if (!csrfFetchPromise) {
    csrfFetchPromise = fetchCsrfToken().finally(() => {
      csrfFetchPromise = null;
    });
  }
  return csrfFetchPromise;
}

// Add CSRF request interceptor
apiInstance.interceptors.request.use(async (config) => {
  // SSR guard (I-7)
  if (typeof window === "undefined") return config;

  const method = config.method?.toUpperCase() ?? "";
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = await getCsrfToken();
    if (token) {
      config.headers["X-CSRF-Token"] = token;
    }
  }
  return config;
});

// Reset CSRF token on 403 (token expired/rotated)
apiInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 403) {
      // Clear cached token, will re-fetch on next request
      csrfToken = null;
    }
    return Promise.reject(error);
  },
);
```

No `js-cookie` dependency needed — the token comes from the API response, not the cookie (I-7).

- [ ] **Step 5.6: Forward X-CSRF-Token in proxy**

In `apps/web/src/lib/proxy.ts`, in the `buildRequestHeaders` function, add:
```typescript
const csrfToken = req.headers.get("x-csrf-token");
if (csrfToken) {
  headers["x-csrf-token"] = csrfToken;
}
```

Also forward the `_csrf` cookie — verify that the proxy's cookie forwarding already handles this (it should, since `_csrf` is an httpOnly cookie sent by the browser, and the proxy forwards cookies by default for authenticated routes).

- [ ] **Step 5.7: Verify tests pass**

Run: `pnpm --filter ouitransfer-server test src/__tests__/csrf.test.ts`
Expected: PASS

### 5.22 (NEW) — Timing-safe comparison audit

`crypto.timingSafeEqual` is not used anywhere in the codebase (verified by grep). Token comparisons that use `===` are vulnerable to timing attacks. Audit and fix:

- [ ] **Step 5.8: Audit all string-equality token comparisons**

Search the server codebase for patterns where security tokens are compared with `===`:
- CSRF token validation (handled by `@fastify/csrf-protection` — should be safe internally, but verify)
- Invite token comparisons in `apps/server/src/modules/invite/`
- Challenge token comparisons in `apps/server/src/modules/auth/`
- Share password comparisons (should use `bcrypt.compare` which is constant-time — verify)
- Backup code comparisons in `apps/server/src/modules/two-factor/service.ts`

For each string `===` comparison on a secret/token value, replace with:
```typescript
import crypto from "node:crypto";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
```

Create this as a utility in `apps/server/src/utils/timing-safe.ts` and use it in all token comparison sites.

Note: `bcrypt.compare` is already constant-time — password comparisons don't need this. Focus on: invite tokens, backup codes, challenge tokens, any raw string comparisons.

- [ ] **Step 5.9: Type-check**

Run: `pnpm --filter ouitransfer-server type-check && pnpm --filter ouitransfer-web type-check`
Expected: exit 0

- [ ] **Step 5.10: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/env.ts apps/server/src/__tests__/csrf.test.ts apps/web/src/config/api.ts apps/web/src/lib/proxy.ts apps/server/src/utils/timing-safe.ts apps/server/src/modules/
git commit -m "feat(server,web): CSRF protection + timing-safe token comparisons (5.4/5.22)"
```

---

## Task 6: File content validation (5.1, 5.2)

**Addresses I-3: real magic-byte verification via file-type + MIME consistency check. Also fixes the mimeType field issue.**

**Files:**
- Modify: `apps/server/src/modules/file/dto.ts` (add mimeType field)
- Modify: `apps/server/src/modules/file/controller.ts`
- Create: `apps/server/src/utils/validate-file-content.ts`
- Modify: `apps/server/src/providers/s3-storage.provider.ts` (add ranged GET)
- Test: `apps/server/src/utils/__tests__/validate-file-content.test.ts` (new)

### 5.1 — MIME/extension consistency + magic-byte verification

**Design (two-layer approach):**
1. **MIME/extension denylist** — fast, synchronous check against blocked MIME types and dangerous extensions
2. **Magic-byte verification** — after file upload, fetch first 4 KB from S3 via ranged GET, run `fileTypeFromBuffer`, reject if detected type contradicts declared MIME

**Fix for RegisterFileSchema missing mimeType (I-3):** Add `mimeType` as an optional field. The frontend already sends it (or can be derived from extension server-side).

- [ ] **Step 6.1: Install file-type**

```bash
pnpm --filter ouitransfer-server add file-type
```

- [ ] **Step 6.2: Add mimeType to RegisterFileSchema**

In `apps/server/src/modules/file/dto.ts`, add to `RegisterFileSchema`:
```typescript
export const RegisterFileSchema = z.object({
  name: z.string().min(1, "O nome do arquivo é obrigatório"),
  description: z.string().optional(),
  extension: z.string().min(1, "A extensão é obrigatória"),
  mimeType: z.string().optional().describe("MIME type declared by the client"),
  size: z.number({
    required_error: "O tamanho é obrigatório",
    invalid_type_error: "O tamanho deve ser um número",
  }),
  objectName: z.string().min(1, "O objectName é obrigatório"),
  folderId: z.string().optional(),
});
```

- [ ] **Step 6.3: Write tests for file validation**

Create `apps/server/src/utils/__tests__/validate-file-content.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { isMimeTypeConsistent, BLOCKED_MIME_TYPES, DANGEROUS_EXTENSIONS } from "../validate-file-content.js";

describe("isMimeTypeConsistent (5.1)", () => {
  it("accepts matching MIME type and extension", () => {
    expect(isMimeTypeConsistent("image/jpeg", "jpg")).toBe(true);
    expect(isMimeTypeConsistent("image/png", "png")).toBe(true);
    expect(isMimeTypeConsistent("application/pdf", "pdf")).toBe(true);
  });

  it("rejects executable extension with benign MIME type", () => {
    expect(isMimeTypeConsistent("image/jpeg", "exe")).toBe(false);
    expect(isMimeTypeConsistent("image/png", "js")).toBe(false);
  });

  it("accepts unknown extensions (no false positives)", () => {
    expect(isMimeTypeConsistent("application/octet-stream", "bin")).toBe(true);
  });

  it("rejects blocked MIME types regardless of extension", () => {
    expect(isMimeTypeConsistent("application/x-executable", "jpg")).toBe(false);
    expect(isMimeTypeConsistent("application/x-msdownload", "pdf")).toBe(false);
  });

  it("allows when mimeType is undefined (optional field)", () => {
    expect(isMimeTypeConsistent(undefined, "jpg")).toBe(true);
  });
});
```

Run: `pnpm --filter ouitransfer-server test src/utils/__tests__/validate-file-content.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 6.4: Create validate-file-content.ts**

Create `apps/server/src/utils/validate-file-content.ts`:
```typescript
/**
 * File content validation utilities.
 *
 * Two-layer approach:
 * 1. isMimeTypeConsistent() — fast MIME/extension denylist check (synchronous)
 * 2. verifyMagicBytes() — reads first 4 KB from S3, compares against file-type database
 */
import { fileTypeFromBuffer } from "file-type";

/** MIME types that are never acceptable regardless of extension */
export const BLOCKED_MIME_TYPES = new Set([
  "application/x-executable",
  "application/x-msdownload",
  "application/x-sh",
  "application/x-shellscript",
  "application/x-msdos-program",
]);

/** Extensions associated with executable/script files */
export const DANGEROUS_EXTENSIONS = new Set([
  "exe", "dll", "bat", "cmd", "com", "ps1", "psm1", "psd1",
  "vbs", "js", "msi", "scr", "jar", "sh", "bash", "zsh",
  "php", "asp", "aspx", "py", "rb", "pl",
]);

/**
 * Check if the declared MIME type is consistent with the file extension.
 * Returns true if consistent or unknown (no false positives on exotic formats).
 * Returns false if a dangerous mismatch is detected.
 */
export function isMimeTypeConsistent(mimeType: string | undefined, extension: string): boolean {
  if (!mimeType) return true; // optional field — no check possible

  const lowerMime = mimeType.toLowerCase();
  const lowerExt = extension.toLowerCase().replace(/^\./, "");

  // Block explicitly dangerous MIME types
  if (BLOCKED_MIME_TYPES.has(lowerMime)) {
    return false;
  }

  // Dangerous extension with a benign MIME → mismatch
  if (DANGEROUS_EXTENSIONS.has(lowerExt)) {
    const isBenignMime =
      lowerMime.startsWith("image/") ||
      lowerMime.startsWith("video/") ||
      lowerMime.startsWith("audio/") ||
      lowerMime === "application/pdf" ||
      lowerMime.startsWith("text/plain");
    if (isBenignMime) {
      return false;
    }
  }

  return true;
}

/**
 * Verify file content against declared MIME type using magic bytes.
 * Reads the provided buffer (first N bytes of the file) and compares
 * the detected type against the declared MIME.
 *
 * Returns { valid: true } if consistent, or { valid: false, detected, declared }
 * if a mismatch is found. Returns { valid: true } if the file type cannot
 * be determined (many file formats have no magic bytes — e.g. plain text, CSV).
 */
export async function verifyMagicBytes(
  buffer: Buffer | Uint8Array,
  declaredMime: string | undefined,
): Promise<{ valid: boolean; detected?: string; declared?: string }> {
  if (!declaredMime) return { valid: true };

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) {
    // file-type couldn't identify — this is common for text files, CSVs, etc.
    return { valid: true };
  }

  const declaredLower = declaredMime.toLowerCase();
  const detectedLower = detected.mime.toLowerCase();

  // Exact match
  if (declaredLower === detectedLower) return { valid: true };

  // Allow equivalent MIME types (e.g. image/jpg vs image/jpeg)
  const equivalences: Record<string, string> = {
    "image/jpg": "image/jpeg",
    "audio/mp3": "audio/mpeg",
  };
  const normalizedDeclared = equivalences[declaredLower] ?? declaredLower;
  const normalizedDetected = equivalences[detectedLower] ?? detectedLower;
  if (normalizedDeclared === normalizedDetected) return { valid: true };

  // Same major type (e.g. image/* vs image/*) — allow as consistent
  const declaredMajor = declaredLower.split("/")[0];
  const detectedMajor = detectedLower.split("/")[0];
  if (declaredMajor === detectedMajor) return { valid: true };

  // Mismatch
  return { valid: false, detected: detected.mime, declared: declaredMime };
}
```

- [ ] **Step 6.5: Add ranged GET helper to S3 provider**

In `apps/server/src/providers/s3-storage.provider.ts`, add a method:
```typescript
/**
 * Read the first N bytes of an S3 object (for magic-byte verification).
 */
async getObjectHead(objectName: string, bytes: number = 4096): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: this.bucketName,
    Key: objectName,
    Range: `bytes=0-${bytes - 1}`,
  });
  const response = await this.client.send(command);
  const stream = response.Body;
  if (!stream) throw new Error("Empty response body from S3");
  // Collect the stream into a buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
```

Add the `GetObjectCommand` import if not already present.

- [ ] **Step 6.6: Integrate validation in registerFile controller**

In `apps/server/src/modules/file/controller.ts`, in the `registerFile` method:

```typescript
import { isMimeTypeConsistent, verifyMagicBytes } from "../../utils/validate-file-content.js";

// After: const input = RegisterFileSchema.parse(request.body);

// Layer 1: MIME/extension consistency check
if (!isMimeTypeConsistent(input.mimeType, input.extension)) {
  return reply.status(400).send({
    error: "File type does not match the declared extension",
  });
}

// Layer 2: Magic-byte verification (read first 4 KB from S3)
try {
  const headBuffer = await this.s3Provider.getObjectHead(input.objectName);
  const magicResult = await verifyMagicBytes(headBuffer, input.mimeType);
  if (!magicResult.valid) {
    request.log.warn({
      declared: magicResult.declared,
      detected: magicResult.detected,
      objectName: input.objectName,
    }, "Magic-byte mismatch detected");
    return reply.status(400).send({
      error: "File content does not match the declared file type",
    });
  }
} catch (err) {
  // If S3 read fails, log but don't block — the consistency check above still passed
  request.log.warn({ err, objectName: input.objectName }, "Magic-byte verification skipped (S3 read failed)");
}
```

Also apply the `isMimeTypeConsistent` check in the reverse-share upload path. The actual file is `apps/server/src/modules/reverse-share/upload.service.ts` (NOT `reverse-share/controller.ts` — M-6 correction). Search for the register-file function in that service.

### 5.2 — Return maxFileSize in presigned URL response

- [ ] **Step 6.7: Update getPresignedUrl to include maxFileSize**

In `apps/server/src/modules/file/controller.ts`, in the `getPresignedUrl` method, add `maxFileSize` to the response:

```typescript
const maxFileSize = Number(await this.configService.getValue("maxFileSize"));
// ... existing presigned URL generation ...
return reply.status(200).send({ url, objectName, maxFileSize });
```

**Architectural note:** `content-length-range` is an S3 POST policy condition — it does NOT apply to presigned PUT URLs. The `registerFile` endpoint remains the authoritative size gate. The `maxFileSize` in the response enables client-side pre-upload validation to save bandwidth.

- [ ] **Step 6.8: Verify tests pass**

Run: `pnpm --filter ouitransfer-server test src/utils/__tests__/validate-file-content.test.ts`
Expected: all PASS

- [ ] **Step 6.9: Type-check**

Run: `pnpm --filter ouitransfer-server type-check && pnpm --filter ouitransfer-web type-check`
Expected: exit 0

- [ ] **Step 6.10: Commit**

```bash
git add apps/server/src/utils/validate-file-content.ts apps/server/src/utils/__tests__/ apps/server/src/modules/file/dto.ts apps/server/src/modules/file/controller.ts apps/server/src/providers/s3-storage.provider.ts
git commit -m "feat(server): MIME/extension consistency + magic-byte verification, presigned URL maxFileSize (5.1/5.2)"
```

---

## Task 7: Controller migration to centralized error handler (5.11, 5.16)

**Addresses I-1 (AppError first in handler, message hygiene convention) and M-7 (verification step).**

**Files:**
- Create: `apps/server/src/utils/app-error.ts`
- Modify: `apps/server/src/utils/error-handler.ts`
- Modify: All 13 controller files + `multipart.controller.ts` (14 total)
- Test: `apps/server/src/utils/__tests__/app-error.test.ts` (new)

**Controllers to migrate (14 files):**
1. `apps/server/src/modules/app/controller.ts`
2. `apps/server/src/modules/auth/controller.ts`
3. `apps/server/src/modules/auth-providers/controller.ts`
4. `apps/server/src/modules/file/controller.ts`
5. `apps/server/src/modules/file/multipart.controller.ts`
6. `apps/server/src/modules/folder/controller.ts`
7. `apps/server/src/modules/health/controller.ts`
8. `apps/server/src/modules/invite/controller.ts`
9. `apps/server/src/modules/reverse-share/controller.ts`
10. `apps/server/src/modules/s3-storage/controller.ts`
11. `apps/server/src/modules/share/controller.ts`
12. `apps/server/src/modules/storage/controller.ts`
13. `apps/server/src/modules/two-factor/controller.ts`
14. `apps/server/src/modules/user/controller.ts`

### Step 7.1-7.3: Create AppError hierarchy

- [ ] **Step 7.1: Write tests for AppError**

Create `apps/server/src/utils/__tests__/app-error.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  AppError, NotFoundError, ValidationError,
  ForbiddenError, UnauthorizedError, ConflictError,
} from "../app-error.js";

describe("AppError (5.16)", () => {
  it("creates a basic AppError", () => {
    const err = new AppError(409, "Already exists", "ALREADY_EXISTS");
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe("Already exists");
    expect(err.code).toBe("ALREADY_EXISTS");
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it("NotFoundError defaults to 404", () => {
    const err = new NotFoundError("User not found");
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
  });

  it("ValidationError defaults to 400", () => {
    const err = new ValidationError("Invalid input");
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("ForbiddenError defaults to 403", () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("Access denied");
  });

  it("UnauthorizedError defaults to 401", () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("ConflictError defaults to 409", () => {
    const err = new ConflictError("Duplicate entry");
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("CONFLICT");
  });

  it("supports structured details", () => {
    const err = new ValidationError("Bad fields", { fields: ["email", "name"] });
    expect(err.details).toEqual({ fields: ["email", "name"] });
  });
});
```

- [ ] **Step 7.2: Create app-error.ts**

Create `apps/server/src/utils/app-error.ts`:
```typescript
/**
 * Domain-specific error classes for Ouitransfer.
 *
 * Convention: AppError messages are ALWAYS client-safe. Never construct
 * them from raw error.message or error.toString() — those may contain
 * internal details. Use a hardcoded, user-friendly message instead.
 *
 * Throw from controllers and services. The globalErrorHandler catches
 * these and returns a consistent ErrorResponse shape.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, message, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, message, "VALIDATION_ERROR", details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access denied") {
    super(403, message, "FORBIDDEN");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message, "UNAUTHORIZED");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, "CONFLICT");
  }
}
```

- [ ] **Step 7.3: Update globalErrorHandler — AppError FIRST (I-1)**

In `apps/server/src/utils/error-handler.ts`, add `AppError` as the FIRST branch (before Zod):

```typescript
import { AppError } from "./app-error.js";

// Inside globalErrorHandler, BEFORE the Zod check:

// 0. AppError — domain errors from controllers/services (most common path)
// Convention: AppError messages are always client-safe.
if (error instanceof AppError) {
  response = {
    error: error.message,
    code: error.code,
    statusCode: error.statusCode,
    ...(error.details ? { details: error.details } : {}),
  };
  reply.status(response.statusCode).send(response);
  return;
}

// Then: existing Zod check (renumber to 1), response serialization (2), JWT (3), Prisma (4), Fastify (5), unknown (6)
```

- [ ] **Step 7.4: Run existing error handler tests**

Run: `pnpm --filter ouitransfer-server test src/__tests__/error-handler.test.ts`
Expected: all PASS (no regressions)

### Step 7.5-7.18: Migrate each controller

Migration pattern per controller:

**Before:**
```typescript
async someMethod(request: FastifyRequest, reply: FastifyReply) {
  try {
    const userId = request.user?.userId;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });
    // ... business logic ...
    return reply.send(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.status(400).send({ error: message });
  }
}
```

**After:**
```typescript
async someMethod(request: FastifyRequest, reply: FastifyReply) {
  const userId = request.user?.userId;
  if (!userId) throw new UnauthorizedError();
  // ... business logic ...
  return reply.send(result);
}
```

**Rules:**
1. Remove outer `try/catch` wrappers entirely
2. `reply.status(401).send(...)` → `throw new UnauthorizedError()`
3. `reply.status(403).send(...)` → `throw new ForbiddenError()`
4. `reply.status(404).send(...)` → `throw new NotFoundError("...")`
5. `reply.status(400).send(...)` → `throw new ValidationError("...")`
6. `reply.status(409).send(...)` → `throw new ConflictError("...")`
7. **Exception:** Keep try/catch for specific error recovery logic
8. **Exception:** health controller may legitimately catch for degraded reporting

- [ ] **Step 7.5: Migrate app/controller.ts**
- [ ] **Step 7.6: Migrate auth/controller.ts** (special care: login, 2FA challenge)
- [ ] **Step 7.7: Migrate auth-providers/controller.ts**
- [ ] **Step 7.8: Migrate file/controller.ts**
- [ ] **Step 7.9: Migrate file/multipart.controller.ts**
- [ ] **Step 7.10: Migrate folder/controller.ts**
- [ ] **Step 7.11: Migrate health/controller.ts** (keep selective catch for degraded state)
- [ ] **Step 7.12: Migrate invite/controller.ts**
- [ ] **Step 7.13: Migrate reverse-share/controller.ts**
- [ ] **Step 7.14: Migrate s3-storage/controller.ts**
- [ ] **Step 7.15: Migrate share/controller.ts**
- [ ] **Step 7.16: Migrate storage/controller.ts**
- [ ] **Step 7.17: Migrate two-factor/controller.ts**
- [ ] **Step 7.18: Migrate user/controller.ts**

- [ ] **Step 7.19: Type-check**

Run: `pnpm --filter ouitransfer-server type-check`
Expected: exit 0

- [ ] **Step 7.20: Run all server tests**

Run: `pnpm --filter ouitransfer-server test`
Expected: all PASS

- [ ] **Step 7.21: Verification — run full validation (M-7)**

Run: `pnpm validate`
Expected: all PASS (lint + type-check + test across all packages)

If Playwright e2e tests exist, run: `pnpm e2e`
This verifies the migration didn't change observable behavior (4xx→5xx regression etc.).

- [ ] **Step 7.22: Commit**

```bash
git add apps/server/src/utils/app-error.ts apps/server/src/utils/__tests__/app-error.test.ts apps/server/src/utils/error-handler.ts apps/server/src/modules/
git commit -m "feat(server): AppError class (first in handler) + migrate all 14 controllers to global error handler (5.11/5.16)"
```

---

## Task 8: Token rotation + account lockout (5.23, 5.25)

**These items require Prisma schema changes and a migration. They are grouped together to produce a single migration.**

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Modify: `apps/server/src/modules/auth/controller.ts`
- Modify: `apps/server/src/modules/two-factor/service.ts`
- Modify: `apps/server/src/modules/user/service.ts`
- Modify: `apps/server/src/app.ts` (JWT payload type)
- Create: `apps/server/src/modules/auth/login-attempts.service.ts`
- Test: `apps/server/src/modules/auth/__tests__/token-rotation.test.ts` (new)
- Test: `apps/server/src/modules/auth/__tests__/login-attempts.test.ts` (new)

### 5.23 — Token rotation on privilege escalation

When a user changes password, enables/disables 2FA, the existing JWT remains valid. An attacker with a stolen token retains access even after the user secures their account.

- [ ] **Step 8.1: Add tokenVersion to Prisma schema**

In `apps/server/prisma/schema.prisma`, add to the User model:
```prisma
tokenVersion Int @default(0)
```

- [ ] **Step 8.2: Generate and apply migration**

```bash
pnpm --filter ouitransfer-server exec prisma migrate dev --name add-token-version-and-login-attempts
```

Note: This migration will also include the LoginAttempt model from 5.25 below — we generate a single migration for both schema changes.

- [ ] **Step 8.3: Include tokenVersion in JWT payload**

In `apps/server/src/modules/auth/controller.ts`, wherever `reply.jwtSign()` is called, add `tokenVersion`:
```typescript
const token = await reply.jwtSign({
  userId: user.id,
  isAdmin: user.isAdmin,
  tokenVersion: user.tokenVersion,
});
```

Update the `FastifyJWT.user` type augmentation (in `apps/server/src/types/fastify.d.ts` or equivalent) to include `tokenVersion: number`.

- [ ] **Step 8.4: Validate tokenVersion on jwtVerify**

Add a Fastify `onRequest` hook (or extend the existing authenticate decorator) that, after JWT verification, checks the token's `tokenVersion` against the DB:

```typescript
// In app.ts or a dedicated auth hook:
app.decorateRequest("validateTokenVersion", async function () {
  if (!this.user?.userId) return;
  const dbUser = await prisma.user.findUnique({
    where: { id: this.user.userId },
    select: { tokenVersion: true },
  });
  if (!dbUser || dbUser.tokenVersion !== this.user.tokenVersion) {
    throw new UnauthorizedError("Session invalidated — please log in again");
  }
});
```

The exact integration point depends on the existing `app.authenticate` decorator — read it and extend accordingly. The check should happen on every authenticated request. Consider caching with a short TTL (e.g. 30s) to avoid hitting the DB on every request.

- [ ] **Step 8.5: Increment tokenVersion on security operations**

In the following service methods, after the core operation succeeds, increment `tokenVersion`:
- `apps/server/src/modules/auth/controller.ts` — password change / reset
- `apps/server/src/modules/two-factor/service.ts` — enable2FA, disable2FA
- `apps/server/src/modules/user/service.ts` — if password is changed via admin

```typescript
await prisma.user.update({
  where: { id: userId },
  data: { tokenVersion: { increment: 1 } },
});
```

- [ ] **Step 8.6: Write tests for token rotation**

Create `apps/server/src/modules/auth/__tests__/token-rotation.test.ts`:
- Test that a JWT issued before password change is rejected after the change
- Test that a JWT issued after password change (with new tokenVersion) is accepted
- Test that 2FA enable/disable increments tokenVersion

### 5.25 — Per-account brute-force protection / account lockout

- [ ] **Step 8.7: Add LoginAttempt model to Prisma schema**

In `apps/server/prisma/schema.prisma`:
```prisma
model LoginAttempt {
  id        String   @id @default(cuid())
  email     String   // email or username used in the attempt
  ipAddress String
  success   Boolean
  createdAt DateTime @default(now())

  @@index([email, createdAt])
  @@index([createdAt]) // for cleanup job
}
```

This was included in the migration from Step 8.2.

- [ ] **Step 8.8: Create login-attempts service**

Create `apps/server/src/modules/auth/login-attempts.service.ts`:

```typescript
import { prisma } from "../../shared/prisma.js";

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION_MINUTES = 15;

/**
 * Record a login attempt (success or failure).
 */
export async function recordLoginAttempt(
  email: string,
  ipAddress: string,
  success: boolean,
): Promise<void> {
  await prisma.loginAttempt.create({
    data: { email: email.toLowerCase(), ipAddress, success },
  });
}

/**
 * Check if an account is locked due to too many failed attempts.
 * Returns { locked: true, remainingMinutes } or { locked: false }.
 */
export async function isAccountLocked(
  email: string,
): Promise<{ locked: boolean; remainingMinutes?: number }> {
  const since = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000);

  // Count consecutive failures since the lockout window start
  const recentAttempts = await prisma.loginAttempt.findMany({
    where: {
      email: email.toLowerCase(),
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_FAILED_ATTEMPTS,
  });

  // If there's a success in the recent window, reset the count
  const lastSuccess = recentAttempts.findIndex((a) => a.success);
  const consecutiveFailures = lastSuccess === -1
    ? recentAttempts.filter((a) => !a.success).length
    : lastSuccess; // failures before the last success

  if (consecutiveFailures >= MAX_FAILED_ATTEMPTS) {
    const oldestFailure = recentAttempts[recentAttempts.length - 1];
    const unlockAt = new Date(oldestFailure.createdAt.getTime() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
    const remainingMs = unlockAt.getTime() - Date.now();
    if (remainingMs > 0) {
      return { locked: true, remainingMinutes: Math.ceil(remainingMs / 60000) };
    }
  }

  return { locked: false };
}

/**
 * Cleanup old login attempts (run periodically).
 */
export async function cleanupOldAttempts(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h
  await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
}
```

- [ ] **Step 8.9: Integrate lockout check in login flow**

In `apps/server/src/modules/auth/controller.ts`, in the `login` method, before password verification:
```typescript
import { isAccountLocked, recordLoginAttempt } from "./login-attempts.service.js";

// Check lockout before attempting login
const lockStatus = await isAccountLocked(input.emailOrUsername);
if (lockStatus.locked) {
  throw new ValidationError(
    `Account temporarily locked. Try again in ${lockStatus.remainingMinutes} minutes.`,
  );
}

// ... existing login logic ...

// After successful login:
await recordLoginAttempt(input.emailOrUsername, ipAddress, true);

// After failed login (in the appropriate error path):
await recordLoginAttempt(input.emailOrUsername, ipAddress, false);
```

- [ ] **Step 8.10: Add cleanup job**

In `apps/server/src/server.ts`, after server starts, register a periodic cleanup:
```typescript
// Cleanup old login attempts every hour
const cleanupInterval = setInterval(async () => {
  try {
    await cleanupOldAttempts();
  } catch (err) {
    app.log.error({ err }, "Failed to cleanup login attempts");
  }
}, 60 * 60 * 1000);

// Clear interval on server close
app.addHook("onClose", () => clearInterval(cleanupInterval));
```

- [ ] **Step 8.11: Write tests for account lockout**

Create `apps/server/src/modules/auth/__tests__/login-attempts.test.ts`:
- Test that N consecutive failures locks the account
- Test that a success resets the failure count
- Test that lockout expires after the configured duration
- Test that cleanup removes old records

- [ ] **Step 8.12: Type-check and run tests**

Run: `pnpm --filter ouitransfer-server type-check && pnpm --filter ouitransfer-server test`
Expected: exit 0, all PASS

- [ ] **Step 8.13: Commit**

```bash
git add apps/server/prisma/ apps/server/src/modules/auth/ apps/server/src/modules/two-factor/ apps/server/src/modules/user/ apps/server/src/app.ts apps/server/src/server.ts apps/server/src/types/
git commit -m "feat(server): token rotation on privilege escalation + per-account lockout (5.23/5.25)"
```

---

## Task 9: Refresh tokens + audit logging (5.26, 5.24)

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Modify: `apps/server/src/modules/auth/controller.ts`
- Modify: `apps/server/src/modules/auth/routes.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/web/src/config/api.ts`
- Create: `apps/server/src/modules/auth/refresh-token.service.ts`
- Create: `apps/server/src/modules/audit/service.ts`
- Create: `apps/server/src/modules/audit/routes.ts`
- Create: `apps/server/src/modules/audit/controller.ts`
- Test: `apps/server/src/modules/auth/__tests__/refresh-token.test.ts` (new)
- Test: `apps/server/src/modules/audit/__tests__/service.test.ts` (new)

### 5.26 — Refresh token / sliding session strategy

- [ ] **Step 9.1: Add RefreshToken model to Prisma schema**

```prisma
model RefreshToken {
  id          String   @id @default(cuid())
  token       String   @unique
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userAgent   String?
  ipAddress   String?
  expiresAt   DateTime
  revokedAt   DateTime?
  replacedBy  String?  // ID of the token that replaced this one (rotation chain)
  createdAt   DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}
```

Add `refreshTokens RefreshToken[]` relation to the User model.

- [ ] **Step 9.2: Generate migration**

```bash
pnpm --filter ouitransfer-server exec prisma migrate dev --name add-refresh-token-and-audit-log
```

This migration also includes the AuditLog model from 5.24 below.

- [ ] **Step 9.3: Create refresh token service**

Create `apps/server/src/modules/auth/refresh-token.service.ts`:

Key operations:
- `createRefreshToken(userId, userAgent, ipAddress)` — generates a cryptographically random token, stores in DB with 7d expiry, returns it
- `rotateRefreshToken(oldToken)` — validates the old token, marks it revoked, creates a new one, returns new access+refresh tokens. If the old token was already revoked, revoke the entire chain (replay detection).
- `revokeAllUserTokens(userId)` — revokes all refresh tokens for a user (used on password change, called by token rotation in 5.23)
- `cleanupExpiredTokens()` — deletes tokens expired > 24h ago

The token value should be `crypto.randomBytes(32).toString("base64url")` — not a JWT.

- [ ] **Step 9.4: Shorten access token lifetime**

In `apps/server/src/app.ts`, change JWT `expiresIn`:
```typescript
sign: {
  expiresIn: "15m", // was "1d" — now short-lived, refresh token handles session persistence
},
```

- [ ] **Step 9.5: Add POST /auth/refresh endpoint**

In `apps/server/src/modules/auth/routes.ts`, add:
```typescript
app.post("/auth/refresh", {
  config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  bodyLimit: 64 * 1024,
  schema: {
    body: z.object({
      refreshToken: z.string().min(1),
    }),
  },
}, async (request, reply) => {
  // Calls refreshTokenService.rotateRefreshToken()
  // Returns new { accessToken, refreshToken }
  // Sets the new access token as the JWT cookie
});
```

- [ ] **Step 9.6: Update login to issue both tokens**

In the auth controller login handler, after successful authentication:
- Issue the short-lived access token (JWT cookie, as before)
- Also issue a refresh token and return it in the response body
- The frontend stores the refresh token in memory (NOT localStorage — XSS risk)

- [ ] **Step 9.7: Update frontend Axios to handle refresh**

In `apps/web/src/config/api.ts`, add a 401 interceptor that:
1. On 401 response (not from /auth/refresh itself), calls `POST /api/auth/refresh` with the stored refresh token
2. If refresh succeeds, retries the original request with the new cookie
3. If refresh fails (expired/revoked), redirects to login
4. Uses a mutex to prevent concurrent refresh attempts

```typescript
let refreshPromise: Promise<boolean> | null = null;

apiInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes("/auth/refresh") &&
      typeof window !== "undefined"
    ) {
      originalRequest._retry = true;

      if (!refreshPromise) {
        refreshPromise = attemptTokenRefresh().finally(() => {
          refreshPromise = null;
        });
      }

      const success = await refreshPromise;
      if (success) {
        return apiInstance(originalRequest); // retry with new cookie
      }
      // Refresh failed — redirect to login
      window.location.href = "/login?reason=session_expired";
    }
    return Promise.reject(error);
  },
);
```

- [ ] **Step 9.8: Add cleanup for expired refresh tokens**

In `apps/server/src/server.ts`, alongside the login attempt cleanup:
```typescript
// Cleanup expired refresh tokens every hour
const refreshCleanupInterval = setInterval(async () => {
  try {
    await refreshTokenService.cleanupExpiredTokens();
  } catch (err) {
    app.log.error({ err }, "Failed to cleanup refresh tokens");
  }
}, 60 * 60 * 1000);

app.addHook("onClose", () => clearInterval(refreshCleanupInterval));
```

- [ ] **Step 9.9: Write tests for refresh token flow**

Create `apps/server/src/modules/auth/__tests__/refresh-token.test.ts`:
- Test that login returns both access and refresh tokens
- Test that POST /auth/refresh with valid token returns new pair
- Test that old refresh token is revoked after rotation
- Test replay detection (using a revoked token revokes the entire chain)
- Test that expired refresh tokens are rejected

### 5.24 — Audit logging for security-sensitive operations

- [ ] **Step 9.10: Add AuditLog model to Prisma schema**

```prisma
model AuditLog {
  id        String   @id @default(cuid())
  userId    String?  // null for failed login attempts (no user found)
  action    String   // e.g. "LOGIN_SUCCESS", "LOGIN_FAILURE", "2FA_ENABLE", "PASSWORD_CHANGE"
  ipAddress String
  userAgent String?
  metadata  String?  // JSON string for additional context
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
  @@index([action, createdAt])
  @@index([createdAt])
}
```

This was included in the migration from Step 9.2.

- [ ] **Step 9.11: Create audit service**

Create `apps/server/src/modules/audit/service.ts`:

```typescript
import { prisma } from "../../shared/prisma.js";

export type AuditAction =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILURE"
  | "LOGOUT"
  | "PASSWORD_CHANGE"
  | "PASSWORD_RESET"
  | "TWO_FACTOR_ENABLE"
  | "TWO_FACTOR_DISABLE"
  | "ADMIN_CONFIG_CHANGE"
  | "USER_CREATE"
  | "USER_DELETE"
  | "ACCOUNT_LOCKED";

export async function logAuditEvent(params: {
  userId?: string;
  action: AuditAction;
  ipAddress: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: params.userId ?? null,
      action: params.action,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });
}

export async function getAuditLogs(params: {
  userId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}) {
  return prisma.auditLog.findMany({
    where: {
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.action ? { action: params.action } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 50,
    skip: params.offset ?? 0,
  });
}
```

- [ ] **Step 9.12: Integrate audit logging at all security-sensitive points**

Add `logAuditEvent()` calls in:
- `auth/controller.ts` — login success, login failure, logout, password change, password reset
- `two-factor/service.ts` — 2FA enable, 2FA disable
- `app/controller.ts` — admin config changes
- `user/controller.ts` — user creation, user deletion
- `auth/login-attempts.service.ts` — account lockout event

Each call extracts `ipAddress` from `request.ip` and `userAgent` from `request.headers["user-agent"]`.

- [ ] **Step 9.13: Create admin audit log endpoint**

Create `apps/server/src/modules/audit/routes.ts` and `controller.ts`:
- `GET /admin/audit-logs` — paginated, filterable by userId and action
- Protected by `adminPreValidation`
- Returns `{ logs: AuditLog[], total: number }`

- [ ] **Step 9.14: Write tests for audit logging**

Create `apps/server/src/modules/audit/__tests__/service.test.ts`:
- Test that logAuditEvent creates a record
- Test that getAuditLogs filters by userId and action
- Test pagination

- [ ] **Step 9.15: Type-check and run all tests**

Run: `pnpm --filter ouitransfer-server type-check && pnpm --filter ouitransfer-server test`
Expected: exit 0, all PASS

- [ ] **Step 9.16: Commit**

```bash
git add apps/server/prisma/ apps/server/src/modules/auth/ apps/server/src/modules/audit/ apps/server/src/app.ts apps/server/src/server.ts apps/web/src/config/api.ts
git commit -m "feat(server,web): refresh token strategy + audit logging (5.24/5.26)"
```

---

## Verification Checklist

After all tasks complete:

```bash
# Full type-check
pnpm type-check

# All tests pass
pnpm test

# Lint clean
pnpm lint

# Full validation
pnpm validate
```

Expected: all pass with zero errors.

### Phase 5 items coverage:

| Item | Task | Status | Notes |
|------|------|--------|-------|
| 5.1 — MIME/extension + magic-byte validation | 6 | ☐ | Renamed from "magic bytes" per I-3. Uses file-type properly. |
| 5.2 — File size at presigned URL | 6 | ☐ | |
| 5.3 — Delete redundant LoginSchema | 2 | ☐ | C-5: delete, not redesign |
| 5.4 — CSRF protection | 5 | ☐ | Complete redesign per C-3 |
| 5.5 — Sign JWT cookie | — | N/A | **DROPPED** per C-1/C-2: JWT provides integrity; cookie signing is redundant and breaks middleware |
| 5.6 — Fix admin detection | 3 | ☐ | M-1: split error handling |
| 5.7 — Restrict trustProxy | 1 | ☐ | I-8: hop count, case normalization |
| 5.8 — Protect Swagger | 1 | ☐ | I-9: no else branch |
| 5.9 — crypto.randomUUID | 1 | ☐ | C-4: correct targets |
| 5.10 — Sanitize filenames | 2 | ☐ | M-2: trailing dots, Windows names |
| 5.11 — Sanitize error messages | 7 | ☐ | I-1: AppError first, message convention |
| 5.12 — Configurable port | 1 | ☐ | I-10: Zod coercion, no parseInt |
| 5.13 — Require TOTP to disable 2FA | 4 | ☐ | I-6: clean mock types |
| 5.14 — cookie:false on public routes | 3 | ☐ | I-4: verified route table |
| 5.15 — OAuth redirect validation | 3 | ☐ | I-5: env-driven extension |
| 5.16 — Controller migration | 7 | ☐ | M-7: verification step added |
| 5.17 — filename* preference | 2 | ☐ | M-3: charset fallback test |
| 5.18 — @fastify/helmet (NEW) | 1 | ☐ | Security headers |
| 5.19 — Per-route body limits (NEW) | 1 | ☐ | Auth/admin routes: 64 KB |
| 5.20 — CORS fail-fast in production (NEW) | 1 | ☐ | Crash on missing CORS_ORIGINS in prod |
| 5.21 — Presigned URL expiry split (NEW) | 1 | ☐ | Shorter GET (15min) vs PUT (1h) |
| 5.22 — Timing-safe comparisons (NEW) | 5 | ☐ | Audit + crypto.timingSafeEqual |
| 5.23 — Token rotation (NEW) | 8 | ☐ | tokenVersion on User, invalidate JWT on privilege change |
| 5.24 — Audit logging (NEW) | 9 | ☐ | AuditLog model, log security events, admin API |
| 5.25 — Account lockout (NEW) | 8 | ☐ | LoginAttempt model, per-account brute-force protection |
| 5.26 — Refresh tokens (NEW) | 9 | ☐ | Access+refresh pair, rotation, frontend interceptor |

### Review findings addressed:

| Finding | Resolution | Task |
|---------|-----------|------|
| C-1, C-2 | 5.5 dropped — JWT integrity suffices | N/A |
| C-3 (a-f) | CSRF completely redesigned | 5 |
| C-4 | Correct Math.random targets verified | 1 |
| C-5 | Delete LoginSchema, not redesign | 2 |
| I-1 | AppError first in handler + message convention | 7 |
| I-2 | Moot — 5.5 dropped | N/A |
| I-3 | file-type used properly + mimeType field added | 6 |
| I-4 | Route audit with verified table | 3 |
| I-5 | OAUTH_ALLOWED_REDIRECT_HOSTS env var | 3 |
| I-6 | `as never` mock pattern | 4 |
| I-7 | Correct Axios file + no js-cookie + SSR guard | 5 |
| I-8 | Hop count + case normalization | 1 |
| I-9 | No else branch for Swagger | 1 |
| I-10 | Zod coercion for PORT | 1 |
| I-11 | Proper CSRF test structure | 5 |
| M-1 | Split error handling in admin preValidation | 3 |
| M-2 | Trailing dots/spaces + Windows reserved names | 2 |
| M-3 | ISO-8859-1 fallback test | 2 |
| M-4 | CSRF token rate limit | 5 |
| M-5 | `[en]` prefix for untranslated strings | 4 |
| M-6 | Correct file reference (upload.service.ts) | 6 |
| M-7 | Full validation + e2e verification step | 7 |
| M-8 | vi.stubEnv instead of process.env mutation | 5 |

### Missing items triage:

| Item | Decision | Target |
|------|----------|--------|
| @fastify/helmet | **Added to Phase 5** as item 5.18 | Task 1 |
| Per-route body limits | **Added to Phase 5** as item 5.19 | Task 1 |
| CORS fail-fast in production | **Added to Phase 5** as item 5.20 | Task 1 |
| Presigned URL expiry differentiation | **Added to Phase 5** as item 5.21 | Task 1 |
| Timing-safe comparisons | **Added to Phase 5** as item 5.22 | Task 5 |
| Multipart upload validation gap | **Covered in Task 6** — validation applied in both registerFile paths | Task 6 |
| Token rotation on privilege escalation | **Added to Phase 5** as item 5.23 | Task 8 |
| Audit logging | **Added to Phase 5** as item 5.24 | Task 9 |
| Account lockout / per-account brute-force | **Added to Phase 5** as item 5.25 | Task 8 |
| Refresh token strategy | **Added to Phase 5** as item 5.26 | Task 9 |

---

## Post-implementation: Update tracking files

After all tasks are verified:

- [ ] Mark all Phase 5 items `[x]` in `audit/CONSOLIDATED-TODO-LIST.md`
- [ ] Mark 5.5 as `[x] N/A — dropped (JWT integrity suffices)` in CONSOLIDATED-TODO-LIST
- [ ] Update `CLAUDE.md` Phase 5 status to COMPLETE
- [ ] Update `audit/DONE.md` with Phase 5 completion summary
- [ ] Request a reviewer agent for Phase 5 via the `requesting-code-review` skill
