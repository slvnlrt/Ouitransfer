# Phase 8: Polish & Production Readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production-harden the application: fix security gaps, implement upload resume, clean up code quality items, add proper i18n, and set up CI tooling.

**Architecture:** Security headers added at both layers (Fastify helmet already done; Next.js middleware needs CSP). Server timeouts hardened. Upload resume implemented as full-stack feature (S3 ListParts → server endpoint → proxy route → frontend). ConfigService refactored from class to functions. CI expanded with Lighthouse, bundle analyzer, a11y testing.

**Tech Stack:** Fastify 5, Next.js 15, Prisma, S3 (AWS SDK v3), Uppy, Playwright, Vitest, Zod

---

## Items Closed (no work needed)

- **8.8** — Helmet: already configured in `apps/server/src/app.ts:112-135` with CSP, HSTS, frameAncestors
- **8.14** — Route matcher: O(n) with n=124 is acceptable, microsecond-level
- **8.15** — PrismaClient singleton: already closed (server uses tsx watch, not HMR)
- **8.21** — Coverage reporting: skipped per user decision

---

## Task 1: Portuguese Comments Scan & Fix

**Audit items:** New task (user-requested)

**Files:** All `.ts` and `.tsx` files across `apps/server/src/`, `apps/web/src/`, `packages/`

**Context:** The codebase has Portuguese comments from original development. Known example at `apps/web/src/hooks/useUppyUpload.ts:277-278`.

- [ ] **Step 1: Scan for Portuguese comments**

  Use the Grep tool (NOT command-line grep — we're on Windows) to search for common Portuguese words in comments across all `.ts`/`.tsx` files. Search patterns:
  - `// .*\b(não|vamos|por|enquanto|para|simplificar|indicando|partes|enviadas|retornamos|implementar|resumo|arquivo|função|configuração|verificar|adicionar|remover|atualizar|receber|enviar|buscar|criar|deletar|salvar|carregar|executar|permitir|bloquear|usuario|senha|chave)\b`
  - Also search for: `todo.*portug`, any `/* ... */` block comments with Portuguese
  - Check ALL files, not just known ones

- [ ] **Step 2: Replace each Portuguese comment with English equivalent**

  For each found comment, translate to English. Preserve the comment's intent and technical meaning. Keep the same comment style (// vs /* */).

  Known instance to fix:
  ```typescript
  // File: apps/web/src/hooks/useUppyUpload.ts:277-278
  // BEFORE:
  // Para simplificar, não vamos implementar resumo de upload por enquanto
  // Retornamos array vazio indicando que não há partes já enviadas

  // AFTER: (this specific comment will be removed entirely in Task 6 when listParts is implemented)
  ```

- [ ] **Step 3: Verify no Portuguese remains**

  Re-run the same grep patterns to confirm zero hits.

- [ ] **Step 4: Run type-check**

  ```bash
  pnpm --filter ouitransfer-api type-check && pnpm --filter ouitransfer-web type-check
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add -A && git commit -m "chore: translate remaining Portuguese comments to English"
  ```

---

## Task 2: Documentation & License

**Audit items:** 8.1, 8.2, 8.3

**Files:**
- Create: `LICENSE` (root)
- Modify: `CONTRIBUTING.md` (root)
- Create: `apps/server/src/README.md`
- Create: `apps/web/src/README.md`

### 8.1 — LICENSE file

- [ ] **Step 1: Create Apache-2.0 LICENSE file at repository root**

  Use the standard Apache-2.0 text. Copyright holder: "Ouitransfer Contributors". Year: 2024-present.

### 8.2 — CONTRIBUTING.md

- [ ] **Step 2: Rewrite CONTRIBUTING.md**

  The current file (`CONTRIBUTING.md`, 160 lines) is a generic GitHub tutorial with no project-specific content. Replace entirely with a developer-focused guide covering:

  1. **Prerequisites**: Node 24, pnpm 10.6.0, Docker (for storage)
  2. **Local Setup**: `pnpm install`, `just dev` (or `pnpm dev`), database: `just db-migrate-dev`, `just db-seed`
  3. **Project Structure**: Monorepo layout (apps/server, apps/web, apps/docs, packages/shared, packages/config)
  4. **Development Workflow**: `just dev` starts all apps, `just test` runs tests, `just lint` runs Biome
  5. **Code Standards**: Biome for linting+formatting (auto-enforced via Lefthook pre-commit), conventional commits (enforced via commitlint)
  6. **Testing**: Vitest for unit/integration tests (`pnpm test`), Playwright for E2E (`pnpm e2e`). Run `pnpm --filter <app> test` for specific apps.
  7. **Common `just` Commands**: `just --list` for all recipes. Key: `just dev`, `just test`, `just lint`, `just validate`, `just db-generate`, `just db-migrate-dev`, `just db-studio`, `just db-seed`, `just db-reset`, `just clean`
  8. **Pull Requests**: Target `main` branch. Conventional commit format. CI runs lint, type-check, test, build.
  9. **Architecture Notes**: Server is Fastify 5 + Prisma (SQLite) + S3. Web is Next.js 15 (App Router) + React 19. Single catch-all proxy at `apps/web/src/app/api/[...proxy]/route.ts`.

  Keep the reference to `burger-cie/ouitransfer` GitHub repository. Remove all the step-by-step GitHub tutorial content (fork button screenshots, etc.).

### 8.3 — App READMEs

- [ ] **Step 3: Create `apps/server/src/README.md`**

  Brief architecture guide:
  - Module structure: `src/modules/{feature}/` with `controller.ts`, `service.ts`, `routes.ts`, `dto.ts`
  - Config: `src/config/` (auth, csrf, storage, swagger, timeout)
  - Providers: `src/providers/` (S3 storage provider)
  - Shared: `src/shared/` (prisma singleton)
  - Utils: `src/utils/` (app-error hierarchy, sanitize-filename, etc.)
  - Types: `src/types/` (storage interface)
  - Validation: Zod schemas via `fastify-type-provider-zod`
  - Auth: JWT in httpOnly cookies, 2FA via otpauth TOTP
  - How to add a new feature: create module directory, add controller/service/routes, register in app.ts

- [ ] **Step 4: Create `apps/web/src/README.md`**

  Brief architecture guide:
  - App Router structure: `src/app/` for pages, `src/components/` for UI
  - Data fetching: TanStack Query v5 hooks in `src/hooks/`
  - API communication: Axios via catch-all proxy (`src/lib/proxy.ts` + `proxy-routes.ts`)
  - HTTP endpoints: `src/http/endpoints/` (typed Axios wrappers)
  - State: TanStack Query cache (no Zustand/Context for server state)
  - Auth: JWT verification in middleware (`src/middleware.ts`)
  - i18n: next-intl, 23 languages, messages in `messages/`
  - UI: shadcn/ui + Radix primitives + lucide-react icons
  - How to add a new page: create route in `src/app/`, add proxy route if needed, create TQ hook

- [ ] **Step 5: Commit**

  ```bash
  git add LICENSE CONTRIBUTING.md apps/server/src/README.md apps/web/src/README.md
  git commit -m "docs: add LICENSE, rewrite CONTRIBUTING.md, add app READMEs"
  ```

---

## Task 3: Server Security Hardening

**Audit items:** 8.7, 8.11

**Files:**
- Modify: `apps/server/src/config/timeout.config.ts`
- Modify: `apps/server/src/app.ts` (lines 36-63)
- Modify: `.github/workflows/ci.yml`

### 8.11 — Production Timeouts

**Current state** (`apps/server/src/config/timeout.config.ts`):
- `connection.timeout: 0` (disabled)
- `connection.keepAlive: 20 * 60 * 60 * 1000` (20 HOURS)
- `request.timeout: 0` (disabled)
- `request.bodyTimeout: 0` (disabled)
- `file.uploadTimeout: 0`, `file.downloadTimeout: 0`

**Current state** (`apps/server/src/app.ts:36-63`):
- `connectionTimeout: 0` (line 36)
- `keepAliveTimeout: envTimeoutOverrides.keepAliveTimeout` (defaults to 20h)
- `requestTimeout: envTimeoutOverrides.requestTimeout` (defaults to 0)
- `serverFactory` sets `res.setTimeout(0)`, `req.setTimeout(0)`, `server.timeout = 0`

**Problem:** All timeouts disabled = slowloris vulnerability. 20h keepAlive is insane.

- [ ] **Step 1: Rewrite `timeout.config.ts`**

  ```typescript
  /**
   * Timeout configuration for production safety.
   *
   * Balances large file transfer needs with protection against slowloris
   * and resource-exhaustion attacks. All values in milliseconds.
   *
   * Override via environment variables:
   *   KEEP_ALIVE_TIMEOUT, REQUEST_TIMEOUT
   */

  export const timeoutConfig = {
    connection: {
      /** Time to wait for a new connection to complete the handshake. */
      timeout: 30_000, // 30 seconds
      /** How long to keep idle connections open. Nginx default is 75s. */
      keepAlive: 30_000, // 30 seconds
    },

    request: {
      /**
       * Maximum time for an entire request (including body upload).
       * Set high to accommodate large multipart uploads over slow connections.
       * For a 10 GB file at 10 Mbps ≈ ~2.2 hours.
       */
      timeout: 4 * 60 * 60 * 1000, // 4 hours
      /** Time to receive request body. 0 = disabled (rely on requestTimeout). */
      bodyTimeout: 0,
    },

    file: {
      uploadTimeout: 4 * 60 * 60 * 1000, // 4 hours
      downloadTimeout: 2 * 60 * 60 * 1000, // 2 hours
      /** Max time between stream chunks before considering transfer stalled. */
      streamTimeout: 30_000, // 30 seconds
    },

    token: {
      expiration: 60 * 60 * 1000, // 1 hour
    },
  };

  /** Adjust token expiration for very large files. */
  export function getTimeoutForFileSize(fileSizeBytes: number) {
    const fileSizeGB = fileSizeBytes / (1024 * 1024 * 1024);

    if (fileSizeGB > 100) {
      return {
        ...timeoutConfig,
        token: { expiration: 24 * 60 * 60 * 1000 },
      };
    }

    if (fileSizeGB > 10) {
      return {
        ...timeoutConfig,
        token: { expiration: 4 * 60 * 60 * 1000 },
      };
    }

    return timeoutConfig;
  }

  /** Environment-based overrides for deployment flexibility. */
  export const envTimeoutOverrides = {
    keepAliveTimeout: process.env.KEEP_ALIVE_TIMEOUT
      ? parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10)
      : timeoutConfig.connection.keepAlive,

    requestTimeout: process.env.REQUEST_TIMEOUT
      ? parseInt(process.env.REQUEST_TIMEOUT, 10)
      : timeoutConfig.request.timeout,

    tokenExpiration: process.env.TOKEN_EXPIRATION
      ? parseInt(process.env.TOKEN_EXPIRATION, 10)
      : timeoutConfig.token.expiration,
  };
  ```

- [ ] **Step 2: Update `app.ts` server factory**

  In `apps/server/src/app.ts`, change:
  - Line 36: `connectionTimeout: 0` → `connectionTimeout: timeoutConfig.connection.timeout`
  - Lines 46-47: Remove `res.setTimeout(0)` and `req.setTimeout(0)` (let Fastify manage)
  - Line 59: `server.timeout = 0` → `server.timeout = envTimeoutOverrides.requestTimeout`

  The `serverFactory` should become:
  ```typescript
  serverFactory: (handler) => {
    const server = http.createServer((req, res) => {
      req.on("close", () => {
        if (typeof global !== "undefined" && global.gc) {
          setImmediate(() => global.gc!());
        }
      });
      handler(req, res);
    });

    server.maxHeadersCount = 0;
    server.timeout = envTimeoutOverrides.requestTimeout;
    server.keepAliveTimeout = envTimeoutOverrides.keepAliveTimeout;
    server.headersTimeout = envTimeoutOverrides.keepAliveTimeout + 1000;

    return server;
  },
  ```

### 8.7 — pnpm audit + CI

- [ ] **Step 3: Run `pnpm audit` and check for vulnerabilities**

  ```bash
  pnpm audit --audit-level=high
  ```

  If vulnerabilities are found, fix them (pnpm update, overrides in package.json). If false positives, document in the commit message.

- [ ] **Step 4: Add audit step to CI workflow**

  In `.github/workflows/ci.yml`, add a new job after the `lint` job:

  ```yaml
  audit:
    name: Security Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: ".node-version"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --audit-level=high
  ```

  Add `audit` to the `build` job's `needs` array: `needs: [lint, type-check, test, audit]`.

- [ ] **Step 5: Run tests**

  ```bash
  pnpm --filter ouitransfer-api test
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add apps/server/src/config/timeout.config.ts apps/server/src/app.ts .github/workflows/ci.yml
  git commit -m "fix: harden server timeouts and add security audit to CI"
  ```

---

## Task 4: Frontend Security & Env Validation

**Audit items:** 8.9, 8.10

**Files:**
- Modify: `apps/web/src/middleware.ts`
- Modify: `apps/web/src/env.ts`
- Modify: `apps/web/src/lib/proxy.ts` (line 16, use validated env)

### 8.10 — Frontend Env Validation

**Current state** (`apps/web/src/env.ts`, 10 lines): Only validates `JWT_SECRET`.

**Missing env vars used raw via `process.env`:**
- `API_BASE_URL` — used in `apps/web/src/lib/proxy.ts:16`
- `NEXT_PUBLIC_LOG_LEVEL` — used in `apps/web/src/lib/logger.ts:14`
- `ALLOWED_IMAGE_HOSTS` — used in `apps/web/next.config.ts:58`
- `OAUTH_ALLOWED_REDIRECT_HOSTS` — used in `apps/web/src/lib/proxy.ts:44`

- [ ] **Step 1: Expand `apps/web/src/env.ts`**

  ```typescript
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

  export const env = envSchema.parse({
    JWT_SECRET: process.env.JWT_SECRET,
    API_BASE_URL: process.env.API_BASE_URL,
    OAUTH_ALLOWED_REDIRECT_HOSTS: process.env.OAUTH_ALLOWED_REDIRECT_HOSTS,
    ALLOWED_IMAGE_HOSTS: process.env.ALLOWED_IMAGE_HOSTS,
  });
  ```

  **Note:** `NEXT_PUBLIC_LOG_LEVEL` is a client-side env var captured at build time. It cannot be validated server-side via Zod because it's embedded in the client bundle. It is already handled with a fallback default in `logger.ts:14`. Document this in a comment in env.ts:

  ```typescript
  // NEXT_PUBLIC_LOG_LEVEL is a build-time client-side variable.
  // Validated inline in apps/web/src/lib/logger.ts with "warn" default.
  // It cannot be validated here because this module runs server-side.
  ```

- [ ] **Step 2: Update `proxy.ts` to use validated env**

  In `apps/web/src/lib/proxy.ts:16`, change:
  ```typescript
  // BEFORE:
  const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost:3333").replace(/\/+$/, "");

  // AFTER:
  import { env } from "@/env";
  const API_BASE_URL = env.API_BASE_URL;
  ```

  Also update `getAllowedRedirectHosts()` (line 44) to use `env.OAUTH_ALLOWED_REDIRECT_HOSTS` instead of `process.env.OAUTH_ALLOWED_REDIRECT_HOSTS`.

### 8.9 — CSP & Security Headers in Next.js

**Current state** (`apps/web/src/middleware.ts`, 83 lines): Only handles auth/route protection. No security headers.

- [ ] **Step 3: Add security headers to middleware responses**

  The middleware currently returns `NextResponse.next()` or `NextResponse.redirect()`. For all responses (including redirects), add security headers.

  Create a helper function in the middleware file:

  ```typescript
  function addSecurityHeaders(response: NextResponse): NextResponse {
    // Prevent MIME-type sniffing
    response.headers.set("X-Content-Type-Options", "nosniff");

    // Prevent clickjacking (defense-in-depth, server also sets via helmet)
    response.headers.set("X-Frame-Options", "DENY");

    // Control referrer information
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    // Restrict browser features
    response.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()"
    );

    // CSP — the server already sets a strict CSP via helmet for API responses.
    // This CSP covers the Next.js frontend pages served by the web container.
    response.headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        // Scripts: self + inline for Next.js hydration (required by App Router)
        "script-src 'self' 'unsafe-inline'",
        // Styles: self + inline for Tailwind/styled components
        "style-src 'self' 'unsafe-inline'",
        // Images: self + blob (for preview) + data (for QR codes) + storage URL
        "img-src 'self' blob: data:",
        // Fonts: self
        "font-src 'self'",
        // Connect: self + API + storage (for presigned URL uploads)
        "connect-src 'self'",
        // Forms: self
        "form-action 'self'",
        // Frames: none
        "frame-ancestors 'none'",
        // Base URI: self
        "base-uri 'self'",
      ].join("; ")
    );

    return response;
  }
  ```

  Then wrap every `NextResponse.next()` and `NextResponse.redirect()` call to go through this function. The pattern:

  ```typescript
  // Before:
  return NextResponse.next();

  // After:
  return addSecurityHeaders(NextResponse.next());
  ```

  **Important:** For `NextResponse.redirect()`, security headers are less critical (the browser follows the redirect), but adding them is defense-in-depth.

- [ ] **Step 4: Run type-check and tests**

  ```bash
  pnpm --filter ouitransfer-web type-check && pnpm --filter ouitransfer-web test
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/src/env.ts apps/web/src/middleware.ts apps/web/src/lib/proxy.ts
  git commit -m "feat: add frontend security headers and env validation"
  ```

---

## Task 5: Logger & ConfigService Refactor

**Audit items:** 8.17, 8.18, 8.22

**Files:**
- Modify: `apps/web/src/lib/logger.ts`
- Modify: `apps/server/src/modules/config/service.ts`
- Modify: All files that import `ConfigService` (search for `new ConfigService()`)

### 8.17 + 8.18 — Frontend Logger

**Current state** (`apps/web/src/lib/logger.ts`, 37 lines): Level-filtered console wrapper. No JSDoc, claims to be a "structured logger" in some code comments but isn't.

- [ ] **Step 1: Add JSDoc and honest naming to logger**

  ```typescript
  /**
   * Client-side logger with level filtering.
   *
   * A thin console wrapper that filters messages below the configured level.
   * NOT a structured logger — no JSON serialization, no transports, no redaction.
   *
   * The log level is captured once at module evaluation time from
   * `NEXT_PUBLIC_LOG_LEVEL` (build-time env var). Runtime changes require a
   * rebuild. Defaults to "warn" if not set.
   *
   * Usage:
   *   logger.debug("Fetching data", { url, params });
   *   logger.error("Upload failed", { err: error.message });
   */

  type LogLevel = "debug" | "info" | "warn" | "error";

  interface LogContext {
    [key: string]: unknown;
  }

  const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  const currentLevel: LogLevel =
    (process.env.NEXT_PUBLIC_LOG_LEVEL as LogLevel) || "warn";

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
  }

  function formatMessage(
    level: LogLevel,
    message: string,
    context?: LogContext,
  ): void {
    if (!shouldLog(level)) return;

    const method =
      level === "error" ? "error" : level === "warn" ? "warn" : "log";

    if (context && Object.keys(context).length > 0) {
      console[method](`[${level.toUpperCase()}] ${message}`, context);
    } else {
      console[method](`[${level.toUpperCase()}] ${message}`);
    }
  }

  /** Client-side level-filtered logger. See module JSDoc for details. */
  export const logger = {
    debug: (message: string, context?: LogContext) =>
      formatMessage("debug", message, context),
    info: (message: string, context?: LogContext) =>
      formatMessage("info", message, context),
    warn: (message: string, context?: LogContext) =>
      formatMessage("warn", message, context),
    error: (message: string, context?: LogContext) =>
      formatMessage("error", message, context),
  };
  ```

  Also search for any code comments or docs that call this a "structured logger" and update to "client logger" or "level-filtered logger".

### 8.22 — ConfigService Refactor

**Current state** (`apps/server/src/modules/config/service.ts`, 67 lines): Stateless class where every method just calls `prisma.appConfig.*`. Instantiated as `new ConfigService()` in multiple controllers.

- [ ] **Step 2: Refactor ConfigService to standalone functions**

  Replace the class with exported functions:

  ```typescript
  import { prisma } from "../../shared/prisma.js";
  import { InternalError, NotFoundError } from "../../utils/app-error.js";

  export async function getConfigValue(key: string): Promise<string> {
    const config = await prisma.appConfig.findUnique({
      where: { key },
    });

    if (!config) {
      throw new NotFoundError(`Configuration ${key} not found`);
    }

    return config.value;
  }

  export async function setConfigValue(key: string, value: string): Promise<void> {
    await prisma.appConfig.update({
      where: { key },
      data: { value },
    });
  }

  export async function validatePasswordAuthDisable(): Promise<boolean> {
    const enabledProviders = await prisma.authProvider.findMany({
      where: { enabled: true },
    });

    return enabledProviders.length > 0;
  }

  export async function validateAllProvidersDisable(): Promise<boolean> {
    const passwordAuthEnabled = await getConfigValue("passwordAuthEnabled");
    return passwordAuthEnabled === "true";
  }

  export async function getGroupConfigs(
    group: string,
  ): Promise<Record<string, unknown>> {
    const configs = await prisma.appConfig.findMany({
      where: { group },
    });

    return configs.reduce<Record<string, unknown>>((acc, curr) => {
      let value: unknown = curr.value;

      switch (curr.type) {
        case "number":
          value = Number(curr.value);
          break;
        case "boolean":
          value = curr.value === "true";
          break;
        case "json":
          try {
            value = JSON.parse(curr.value);
          } catch {
            throw new InternalError(
              `Invalid JSON in config key "${curr.key}": ${curr.value}`,
            );
          }
          break;
        case "bigint":
          value = BigInt(curr.value);
          break;
      }

      acc[curr.key] = value;
      return acc;
    }, {});
  }
  ```

  Key changes:
  - Class → standalone exported functions
  - `JSON.parse` in `getGroupConfigs` now has error handling (wraps in `InternalError`)
  - Imports `InternalError` from app-error utility

- [ ] **Step 3: Update all callers**

  Search for `new ConfigService()` across the server codebase. Each caller needs to be updated:

  ```typescript
  // BEFORE:
  import { ConfigService } from "../config/service.js";
  // ...
  private configService = new ConfigService();
  // ...
  await this.configService.getValue("key");

  // AFTER:
  import { getConfigValue } from "../config/service.js";
  // ...
  await getConfigValue("key");
  ```

  Check every controller/service that uses ConfigService. Likely callers: AuthController, TwoFactorController, FileController, AppController, and their services.

- [ ] **Step 4: Run tests**

  ```bash
  pnpm --filter ouitransfer-api test && pnpm --filter ouitransfer-web test
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/src/lib/logger.ts apps/server/src/modules/config/service.ts
  # Also add all updated callers
  git commit -m "refactor: convert ConfigService to standalone functions, add logger JSDoc"
  ```

---

## Task 6: Upload Resume

**Audit item:** 8.4

**Files:**
- Modify: `apps/server/src/types/storage.ts` (add `listParts` to interface)
- Modify: `apps/server/src/providers/s3-storage.provider.ts` (implement `listParts`)
- Modify: `apps/server/src/modules/file/service.ts` (add `listParts` passthrough)
- Modify: `apps/server/src/modules/file/multipart.controller.ts` (add endpoint)
- Modify: `apps/server/src/modules/file/routes.ts` (add route)
- Modify: `apps/server/src/modules/reverse-share/multipart.controller.ts` (add endpoint)
- Modify: `apps/server/src/modules/reverse-share/multipart.service.ts` (add method)
- Modify: `apps/server/src/modules/reverse-share/routes.ts` (add route)
- Modify: `apps/web/src/lib/proxy-routes.ts` (add proxy routes)
- Modify: `apps/web/src/http/endpoints/files/index.ts` (add HTTP function)
- Modify: `apps/web/src/http/endpoints/files/types.ts` (add types)
- Modify: `apps/web/src/http/endpoints/reverse-shares/index.ts` (add HTTP function)
- Modify: `apps/web/src/hooks/useUppyUpload.ts` (implement listParts callback)

**Context:** Uppy's S3 multipart plugin expects a `listParts(file, { uploadId, key })` callback that returns `Array<{ PartNumber: number, Size: number, ETag: string }>`. Currently returns `[]`, meaning interrupted uploads restart from zero.

### Server Side

- [ ] **Step 1: Add `listParts` to StorageProvider interface**

  In `apps/server/src/types/storage.ts`, add:
  ```typescript
  listParts(
    objectName: string,
    uploadId: string,
  ): Promise<Array<{ PartNumber: number; Size: number; ETag: string }>>;
  ```

- [ ] **Step 2: Implement `listParts` in S3StorageProvider**

  In `apps/server/src/providers/s3-storage.provider.ts`:
  - Add `ListPartsCommand` to the imports from `@aws-sdk/client-s3`
  - Implement the method:

  ```typescript
  async listParts(
    objectName: string,
    uploadId: string,
  ): Promise<Array<{ PartNumber: number; Size: number; ETag: string }>> {
    this.ensureClient();
    const allParts: Array<{ PartNumber: number; Size: number; ETag: string }> = [];
    let partNumberMarker: number | undefined;

    // S3 ListParts is paginated (max 1000 parts per call)
    do {
      const command = new ListPartsCommand({
        Bucket: bucketName,
        Key: objectName,
        UploadId: uploadId,
        ...(partNumberMarker !== undefined && {
          PartNumberMarker: partNumberMarker,
        }),
      });

      const response = await s3Client!.send(command);

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

      partNumberMarker = response.IsTruncated
        ? response.NextPartNumberMarker
        : undefined;
    } while (partNumberMarker !== undefined);

    return allParts;
  }
  ```

- [ ] **Step 3: Add `listParts` to FileService**

  In `apps/server/src/modules/file/service.ts`, add:
  ```typescript
  async listParts(
    objectName: string,
    uploadId: string,
  ): Promise<Array<{ PartNumber: number; Size: number; ETag: string }>> {
    return await this.storageProvider.listParts(objectName, uploadId);
  }
  ```

- [ ] **Step 4: Add `listParts` endpoint to FileMultipartController**

  In `apps/server/src/modules/file/multipart.controller.ts`, add:
  ```typescript
  async listParts(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError();
    }

    const { uploadId, objectName } = request.query as {
      uploadId: string;
      objectName: string;
    };

    if (!uploadId || !objectName) {
      throw new ValidationError("uploadId and objectName are required");
    }

    const parts = await this.fileService.listParts(objectName, uploadId);

    return reply.status(200).send(parts);
  }
  ```

- [ ] **Step 5: Add route in file routes.ts**

  In `apps/server/src/modules/file/routes.ts`, add a new GET route (follow the pattern of `part-url`):

  ```typescript
  app.get(
    "/files/multipart/list-parts",
    {
      schema: {
        description: "Lists uploaded parts for a multipart upload, used to resume interrupted uploads",
        querystring: z.object({
          uploadId: z.string().min(1).describe("The multipart upload ID"),
          objectName: z.string().min(1).describe("The object name (key)"),
        }),
        response: {
          200: z.array(
            z.object({
              PartNumber: z.number(),
              Size: z.number(),
              ETag: z.string(),
            }),
          ),
          ...ErrorResponseSchema,
        },
      },
    },
    multipartController.listParts.bind(multipartController),
  );
  ```

- [ ] **Step 6: Add `listParts` to reverse-share multipart chain**

  Apply the same pattern to the reverse-share module:
  - `apps/server/src/modules/reverse-share/multipart.service.ts`: Add `listPartsByAlias` method
  - `apps/server/src/modules/reverse-share/multipart.controller.ts`: Add `listPartsByAlias` endpoint
  - `apps/server/src/modules/reverse-share/routes.ts`: Add route at `/reverse-shares/alias/:alias/multipart/list-parts`

### Frontend Side

- [ ] **Step 7: Add proxy routes**

  In `apps/web/src/lib/proxy-routes.ts`, add:
  ```typescript
  r("GET", "files/multipart/list-parts", "/files/multipart/list-parts", { query: true }),
  ```

  And for reverse shares (5-segment route):
  ```typescript
  r(
    "GET",
    "reverse-shares/alias/:alias/multipart/list-parts",
    "/reverse-shares/alias/:alias/multipart/list-parts",
    { query: true },
  ),
  ```

- [ ] **Step 8: Add HTTP endpoint functions**

  In `apps/web/src/http/endpoints/files/types.ts`, add:
  ```typescript
  export interface ListMultipartPartsParams {
    uploadId: string;
    objectName: string;
  }

  export type ListMultipartPartsResult = Array<{
    PartNumber: number;
    Size: number;
    ETag: string;
  }>;
  ```

  In `apps/web/src/http/endpoints/files/index.ts`, add:
  ```typescript
  export const listMultipartParts = async (
    params: ListMultipartPartsParams,
  ): Promise<ListMultipartPartsResult> => {
    const { data } = await apiInstance.get("/api/files/multipart/list-parts", {
      params,
    });
    return data;
  };
  ```

  Do the same for reverse-shares endpoints.

- [ ] **Step 9: Implement listParts callback in useUppyUpload.ts**

  In `apps/web/src/hooks/useUppyUpload.ts`, replace the stub at lines 274-280:

  ```typescript
  async listParts(file: UppyFile<Meta, Body>, { uploadId, key }: UppyUploadResult) {
    logger.debug("[Upload:Multipart] Listing parts for resume", {
      fileName: file.name,
      uploadId,
      key,
    });

    try {
      let parts: Array<{ PartNumber: number; Size: number; ETag: string }>;

      if (customMultipartRef.current) {
        parts = await customMultipartRef.current.listParts(uploadId, key);
      } else {
        const { listMultipartParts } = await import(
          "@/http/endpoints/files"
        );
        parts = await listMultipartParts({
          uploadId,
          objectName: key,
        });
      }

      logger.debug("[Upload:Multipart] Found existing parts", {
        count: parts.length,
      });
      return parts;
    } catch (error) {
      logger.warn("[Upload:Multipart] Failed to list parts, starting fresh", {
        err: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  },
  ```

  Also update the `CustomMultipartFunctions` interface (find it in the same file) to include:
  ```typescript
  listParts: (uploadId: string, objectName: string) => Promise<Array<{ PartNumber: number; Size: number; ETag: string }>>;
  ```

- [ ] **Step 10: Write server integration tests**

  Add tests in `apps/server/src/modules/file/__tests__/multipart.test.ts`:
  - Test `GET /files/multipart/list-parts` returns parts from S3
  - Test missing params returns 400
  - Test unauthenticated returns 401

- [ ] **Step 11: Run full test suites**

  ```bash
  pnpm --filter ouitransfer-api test && pnpm --filter ouitransfer-web test
  ```

- [ ] **Step 12: Commit**

  ```bash
  git add apps/server/src/types/storage.ts apps/server/src/providers/s3-storage.provider.ts
  git add apps/server/src/modules/file/ apps/server/src/modules/reverse-share/
  git add apps/web/src/lib/proxy-routes.ts apps/web/src/http/endpoints/
  git add apps/web/src/hooks/useUppyUpload.ts
  git commit -m "feat: implement upload resume via S3 ListParts"
  ```

---

## Task 7: Translations & i18n Polish

**Audit items:** 8.19, M-1 (from Phase 7), M-2 (from Phase 7)

**Files:**
- Modify: All 23 `apps/web/messages/*.json` locale files
- Modify: `apps/web/src/components/tables/files-table-folder-row.tsx` (line 89)
- Modify: `apps/web/src/utils/file-icons.tsx` (lines 441-450)

### M-1 — Hardcoded "Move" label

- [ ] **Step 1: Fix hardcoded "Move" label**

  In `apps/web/src/components/tables/files-table-folder-row.tsx:89`, change:
  ```typescript
  // BEFORE:
  { key: "move", icon: Move, label: "Move", onClick: () => onMoveFolder(folder) }

  // AFTER:
  { key: "move", icon: Move, label: t("filesTable.actions.move"), onClick: () => onMoveFolder(folder) }
  ```

  Then add `"move": "Move"` to the `filesTable.actions` section in `apps/web/messages/en-US.json`.

### 8.19 — Translate placeholder strings

- [ ] **Step 2: Add "move" key + translate all placeholder strings**

  **Keys to translate** (15 from Phase 4 + 1 "move"):

  Under `errors`:
  - `somethingWentWrong`, `tryAgain`, `goHome`, `pageNotFound`, `pageNotFoundMessage`
  - `shareUnavailable`, `shareErrorMessage`, `uploadUnavailable`, `uploadErrorMessage`
  - `accessDenied`, `accessDeniedMessage`, `errorLoadingSettings`, `refreshPage`

  Under `a11y`:
  - `skipToContent`

  Under `auth`:
  - `sessionExpired`

  Under `filesTable.actions`:
  - `move`

  **Translation strategy** (per user decision):
  - **AI-translate for common languages** (12): fr-FR, de-DE, es-ES, it-IT, pt-BR, nl-NL, pl-PL, ru-RU, tr-TR, sv-SE, el-GR, uk-UA
  - **Leave English for exotic/complex-script languages** (10): ar-SA, fa-IR, he-IL, hi-IN, ja-JP, ko-KR, zh-CN, th-TH, vi-VN, id-ID

  For each of the 12 common languages, provide accurate translations for all 16 strings. For the 10 exotic languages, keep the English text as-is (better than broken machine translation).

### M-2 — Webhook icon for graphql/proto

- [ ] **Step 3: Replace Webhook icon for graphql/proto file types**

  In `apps/web/src/utils/file-icons.tsx:441-450`, change the `Webhook` icon to more semantic alternatives:

  ```typescript
  // GraphQL — use Braces (represents schema/code structure)
  {
    extensions: ["graphql", "gql"],
    icon: Braces,
    color: "text-pink-600",
  },
  // Protocol Buffers — use FileCode (represents code file)
  {
    extensions: ["proto", "protobuf"],
    icon: FileCode,
    color: "text-blue-700",
  },
  ```

  Make sure `Braces` and `FileCode` are imported from `lucide-react`. Check if they're already imported; if not, add them.

- [ ] **Step 4: Run tests**

  ```bash
  pnpm --filter ouitransfer-web type-check && pnpm --filter ouitransfer-web test
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/messages/ apps/web/src/components/tables/files-table-folder-row.tsx apps/web/src/utils/file-icons.tsx
  git commit -m "feat: translate placeholder strings, fix hardcoded Move label, improve file type icons"
  ```

---

## Task 8: Test Improvements

**Audit items:** 8.13, 8.16

**Files:**
- Modify/Create: `apps/server/src/__tests__/` (expand health test, add error handler tests)
- Modify/Create: `apps/web/src/__tests__/` (replace Button smoke test with real app component tests)
- Create: Tests for OAuth proxy flow

### 8.16 — Expand health test and web smoke test

- [ ] **Step 1: Expand server health test**

  In `apps/server/src/__tests__/health.test.ts` (112 lines, 3 tests), add test cases for:
  - Both DB and storage unhealthy → 503 with both checks failed
  - Response includes `uptime` and `timestamp` fields
  - Invalid route → 404 (tests the global 404 handler)

- [ ] **Step 2: Replace web Button smoke test with real app tests**

  `apps/web/src/__tests__/smoke.test.tsx` currently tests the shadcn Button component (third-party). Replace with tests for actual app components or hooks. Good candidates:
  - Test `formatDateTime()` with different locales (already done in Phase 7: `format-date-time.test.ts`)
  - Test `matchesPath()` utility from auth paths
  - Test `sanitizeFilename()` if it exists on web
  - Test a real app component (e.g., ErrorDisplay variants)

### 8.13 — OAuth proxy flow test

- [ ] **Step 3: Write OAuth proxy flow integration tests**

  Create `apps/web/src/__tests__/proxy-oauth.test.ts`:
  - Test that OAuth redirect responses are validated against the allowlist
  - Test that `isAllowedRedirectUrl()` correctly allows/blocks URLs
  - Test custom hosts via `OAUTH_ALLOWED_REDIRECT_HOSTS`
  - Test that non-redirect OAuth responses use `text()` not `json()`

  Note: This tests the proxy utilities, not the actual OAuth flow (which requires real providers). Use the existing `__resetAllowedRedirectHostsForTest()` function exposed in `proxy.ts`.

- [ ] **Step 4: Run all tests**

  ```bash
  pnpm --filter ouitransfer-api test && pnpm --filter ouitransfer-web test
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/__tests__/ apps/web/src/__tests__/
  git commit -m "test: expand health tests, add OAuth proxy tests, improve web smoke tests"
  ```

---

## Task 9: CI & Performance Tooling

**Audit items:** 8.5, 8.6, 8.12, 8.20

**Files:**
- Modify: `.github/workflows/ci.yml` (Lighthouse step)
- Modify: `.github/workflows/e2e.yml` (Docker Compose, axe-core)
- Modify: `apps/web/package.json` (bundle analyzer dep)
- Modify: `apps/web/next.config.ts` (bundle analyzer config)
- Modify: `playwright.config.ts` (update for CI)
- Create/Modify: `e2e/smoke.spec.ts` (add a11y checks)

### 8.6 — Bundle Analyzer

- [ ] **Step 1: Install and configure @next/bundle-analyzer**

  Add `@next/bundle-analyzer` to `apps/web/package.json` devDependencies.

  In `apps/web/next.config.ts`, wrap the config:
  ```typescript
  import type { NextConfig } from "next";
  import createNextIntlPlugin from "next-intl/plugin";

  const withNextIntl = createNextIntlPlugin();

  const nextConfig: NextConfig = {
    // ... existing config ...
  };

  // Bundle analyzer: run with ANALYZE=true pnpm --filter ouitransfer-web build
  const withBundleAnalyzer =
    process.env.ANALYZE === "true"
      ? (await import("@next/bundle-analyzer")).default({ enabled: true })
      : (config: NextConfig) => config;

  export default withBundleAnalyzer(withNextIntl(nextConfig));
  ```

  Add script to `apps/web/package.json`:
  ```json
  "analyze": "ANALYZE=true next build"
  ```

### 8.5 — Lighthouse CI

- [ ] **Step 2: Set up Lighthouse CI configuration**

  Create `.lighthouserc.cjs` at repository root:
  ```javascript
  module.exports = {
    ci: {
      collect: {
        url: [
          "http://localhost:3000/",
          "http://localhost:3000/login",
        ],
        startServerCommand: "pnpm dev:web",
        startServerReadyPattern: "Ready",
        numberOfRuns: 3,
      },
      assert: {
        assertions: {
          "categories:performance": ["warn", { minScore: 0.8 }],
          "categories:accessibility": ["error", { minScore: 0.9 }],
          "categories:best-practices": ["error", { minScore: 0.9 }],
          "categories:seo": ["warn", { minScore: 0.8 }],
        },
      },
      upload: {
        target: "temporary-public-storage",
      },
    },
  };
  ```

  Add `@lhci/cli` to root `devDependencies` and add script:
  ```json
  "lighthouse": "lhci autorun"
  ```

  **Note:** Lighthouse CI is a local/CI tool — it won't run in this session but the configuration is set up.

### 8.12 — Accessibility testing with axe-core

- [ ] **Step 3: Install @axe-core/playwright and add a11y checks**

  Add `@axe-core/playwright` to root `devDependencies`.

  Update `e2e/smoke.spec.ts` to include accessibility checks:
  ```typescript
  import AxeBuilder from "@axe-core/playwright";
  import { expect, test } from "@playwright/test";

  test.describe("Smoke tests", () => {
    test("homepage loads", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveTitle(/ouitransfer/i);
    });

    test("homepage passes accessibility checks", async ({ page }) => {
      await page.goto("/");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });

    test("login page passes accessibility checks", async ({ page }) => {
      await page.goto("/login");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });

    test("API health endpoint responds", async ({ request }) => {
      const response = await request.get("http://localhost:3333/health");
      expect(response.ok()).toBeTruthy();
    });
  });
  ```

### 8.20 — E2E CI Workflow

- [ ] **Step 4: Update e2e.yml for Docker Compose + testing**

  Rewrite `.github/workflows/e2e.yml`:

  ```yaml
  name: E2E Tests

  on:
    push:
      branches: [main]
    pull_request:
      branches: [main]

  concurrency:
    group: e2e-${{ github.ref }}
    cancel-in-progress: true

  jobs:
    e2e:
      name: Playwright E2E
      runs-on: ubuntu-latest
      timeout-minutes: 30
      steps:
        - uses: actions/checkout@v4
        - uses: pnpm/action-setup@v4
        - uses: actions/setup-node@v4
          with:
            node-version-file: ".node-version"
            cache: "pnpm"
        - run: pnpm install --frozen-lockfile
        - run: pnpm exec playwright install --with-deps chromium

        - name: Build application
          run: pnpm build

        - name: Start application stack
          run: |
            docker compose -f docker-compose.yaml up -d
          env:
            JWT_SECRET: ${{ secrets.CI_JWT_SECRET || 'ci-test-secret-that-is-at-least-32-characters-long' }}
            CSRF_SECRET: ${{ secrets.CI_CSRF_SECRET || 'ci-csrf-secret-that-is-at-least-32-characters-long' }}
            COOKIE_SECRET: ${{ secrets.CI_COOKIE_SECRET || 'ci-cookie-secret-at-least-32-characters-long-here' }}

        - name: Wait for services to be healthy
          run: |
            echo "Waiting for server health..."
            timeout 120 bash -c 'until curl -fs http://localhost:3333/health; do sleep 2; done'
            echo "Waiting for web..."
            timeout 120 bash -c 'until curl -fs http://localhost:5487; do sleep 2; done'
            echo "All services healthy"

        - name: Seed database
          run: |
            docker compose exec -T server npx prisma db seed

        - name: Run E2E tests
          run: pnpm e2e

        - name: Upload report
          uses: actions/upload-artifact@v4
          if: ${{ !cancelled() }}
          with:
            name: playwright-report
            path: playwright-report/
            retention-days: 14

        - name: Stop services
          if: always()
          run: docker compose down -v
  ```

  **Note:** This workflow requires the Docker images to be built. In CI, this may need a prior build step or pre-built images. The workflow configuration is the deliverable; actual E2E test execution depends on the Docker infrastructure being set up correctly. The `playwright.config.ts` webServer config should be disabled in CI (use the Docker Compose stack instead):

  Update `playwright.config.ts` to conditionally skip webServer in CI:
  ```typescript
  // Only start dev servers locally — CI uses Docker Compose
  ...(process.env.CI
    ? {}
    : {
        webServer: [
          {
            command: "pnpm dev:server",
            port: 3333,
            reuseExistingServer: true,
            timeout: 30000,
          },
          {
            command: "pnpm dev:web",
            port: 3000,
            reuseExistingServer: true,
            timeout: 30000,
          },
        ],
      }),
  ```

- [ ] **Step 5: Run type-check**

  ```bash
  pnpm type-check
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add .github/workflows/e2e.yml .github/workflows/ci.yml playwright.config.ts e2e/
  git add apps/web/package.json apps/web/next.config.ts .lighthouserc.cjs package.json pnpm-lock.yaml
  git commit -m "feat: add bundle analyzer, Lighthouse CI, a11y testing, enable E2E workflow"
  ```

---

## Verification

After all tasks are complete:

```bash
# Full test suite
pnpm test

# Type checking
pnpm type-check

# Lint
pnpm lint
```

Expected: all pass with zero errors.
