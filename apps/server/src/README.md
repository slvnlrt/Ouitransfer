# Server Architecture

Fastify 5 API server. Port 3333 in development, configurable via `PORT` env var.

## Directory Structure

```
src/
  app.ts              Fastify app factory — registers plugins, routes, error handler
  server.ts           Entry point — creates app, runs migrations, starts listening
  env.ts              Zod-validated environment variables (fail-fast on bad config)
  modules/            Feature modules (see below)
  config/             Configuration helpers
  providers/          External service providers
  shared/             Singletons shared across the app
  utils/              Pure utility functions and error classes
  types/              TypeScript interfaces
  middleware/         Fastify hooks (CSRF, etc.)
  scripts/            One-off scripts (not part of the server runtime)
```

## Modules

Each feature lives in `src/modules/{feature}/` with a consistent structure:

```
modules/
  auth/               Login, logout, token refresh, password reset
  auth-providers/     OAuth provider configuration
  two-factor/         TOTP 2FA setup and verification
  user/               User CRUD, admin management
  file/               File upload, download, metadata
  folder/             Folder creation and management
  share/              Share links (public, password-protected, expiring)
  reverse-share/      Receive-only share links
  invite/             User invite system
  storage/            Storage quota and usage
  s3-storage/         S3/presigned URL operations
  config/             Runtime app configuration (SMTP, branding, etc.)
  email/              Email sending (SMTP)
  app/                App info endpoint
  health/             Health check (DB + S3)
  audit/              Audit log endpoint (admin only)
```

### Module file conventions

| File | Purpose |
|------|---------|
| `routes.ts` | Route registration — Zod body/params/response schemas, plugin hooks |
| `controller.ts` | Request handlers — parse input, call service, return response |
| `service.ts` | Business logic — Prisma queries, S3 calls, domain rules |
| `dto.ts` | Shared Zod schemas and TypeScript types for this module |

**Important**: Route-level schemas in `routes.ts` and controller-level validation must stay in sync. `fastify-type-provider-zod` strips unknown fields silently — missing a field from the route schema means it will never reach the controller.

## Config (`src/config/`)

| File | Purpose |
|------|---------|
| `auth.config.ts` | JWT secrets, token TTLs, cookie options |
| `csrf.config.ts` | CSRF double-submit cookie configuration |
| `storage.config.ts` | S3 endpoint, bucket, credentials |
| `swagger.config.ts` | OpenAPI/Swagger setup (dev-only) |
| `timeout.config.ts` | Per-route body size limits and timeouts |
| `directories.config.ts` | Local temp directory paths |

## Providers (`src/providers/`)

- **`storage.provider.ts`**: S3Client instance. Wraps `@aws-sdk/client-s3`. Used for HeadBucket, PutObject, GetObject, DeleteObject, presigned URLs.

## Shared (`src/shared/`)

- **`prisma.ts`**: PrismaClient singleton. Import from here — never instantiate directly.

## Utils (`src/utils/`)

| File | Purpose |
|------|---------|
| `app-error.ts` | AppError base class + 6 subclasses (NotFoundError, UnauthorizedError, ForbiddenError, ValidationError, ConflictError, InternalError) |
| `error-handler.ts` | `globalErrorHandler` — Fastify error hook that maps AppError/Zod/Prisma errors to HTTP responses |
| `error-response-schema.ts` | Shared `ErrorResponseSchema` Zod schema — used in route error schemas |
| `logger.ts` | Pino logger instance |
| `sanitize-filename.ts` | Strips dangerous characters from filenames, applies RFC 5987 `filename*` encoding |
| `validate-file-content.ts` | MIME + magic-byte validation, blocked extension/MIME-type lists |
| `validate-object-name.ts` | Path traversal protection for S3 object names |
| `timing-safe.ts` | Timing-safe string comparisons (for backup codes, tokens) |
| `file-name-generator.ts` | Random unique filename generation |
| `container-detection.ts` | Detects Docker environment |
| `parse-trust-proxy.ts` | Parses `TRUST_PROXY` env var for Fastify |

## Types (`src/types/`)

- **`storage.types.ts`**: `IStorageProvider` interface — implemented by the S3 storage provider.

## Validation

All route input/output is validated with Zod via `fastify-type-provider-zod`. Schemas are defined in module `dto.ts` files and referenced in `routes.ts`. The type provider derives TypeScript types automatically — no separate interface needed.

## Auth

- **Access tokens**: JWT, 15-minute TTL, stored in httpOnly cookie (`access_token`)
- **Refresh tokens**: Rotating refresh tokens with replay detection, stored in httpOnly cookie (`refresh_token`)
- **2FA**: TOTP via `otpauth` (RFC 6238). Backup codes stored hashed.
- **Brute-force protection**: Per-account `LoginAttempt` model with lockout
- **Token version**: Incremented on privilege changes (password, admin status, 2FA changes) to invalidate existing tokens

## Adding a New Feature

1. Create `src/modules/{feature}/` directory
2. Add `routes.ts` — register with `fastify.register()`, define Zod schemas
3. Add `controller.ts` — handlers that call the service
4. Add `service.ts` — business logic, Prisma queries
5. Add `dto.ts` — shared Zod schemas and types
6. Register the module in `src/app.ts`
7. Add Prisma schema changes if needed, then run `just db-generate` + `just db-migrate-dev`
