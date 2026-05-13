# Phase 3 — Post-Review Follow-ups

> Items identified by reviewer during Phase 3 Code Quality & Type Safety verification.
> I-1, I-3, I-4, I-5, I-6, I-7, I-8, M-2, M-7 fixed immediately or in follow-up batch.
> I-2 explicitly deferred to Phase 5 (Backend Hardening — controller error migration).
>
> **Second pass (quality audit)**: QA-1 through QA-9 identified by cross-review of Phase 3
> deliverables. Verified by independent agents. See "Quality Audit" section below.

---

## Fixed Immediately

- [x] **I-1 — Error handler has zero tests** — Added unit tests for `globalErrorHandler()` covering all 6 error categories.
  - File: `apps/server/src/__tests__/error-handler.test.ts`

- [x] **I-3 — AuthProviderModel duplicated Prisma type** — Replaced manual 22-line interface with `import type { AuthProvider } from "@prisma/client"; export type AuthProviderModel = AuthProvider;`
  - File: `apps/server/src/modules/auth-providers/types.ts`

- [x] **I-4 — proxy-routes.test.ts re-implemented matchRoute** — Exported `matchRoute` from `proxy.ts`, replaced inline copy in test with `import { matchRoute } from "../proxy"`. 62 tests now verify production code.
  - Files: `apps/web/src/lib/proxy.ts`, `apps/web/src/lib/__tests__/proxy-routes.test.ts`

- [x] **I-5 — noImplicitAnyLet violations** — Fixed 3 implicit-any-let violations: `useUppyUpload.ts` (2 `let response;`), `color-picker-form.tsx` (1 `let r,g,b;`). Enabled `noImplicitAnyLet: "error"` in biome.json.
  - Files: `biome.json`, `apps/web/src/hooks/useUppyUpload.ts`, `apps/web/src/app/profile/components/color-picker-form.tsx`

- [x] **I-6 — 57 console.* calls in .tsx components** — Migrated all remaining console.* calls in .tsx component files to use the structured logger.
  - Files: ~35 .tsx component files

- [x] **I-7 — Inconsistent silent catch in download.controller.ts** — Added `request.log.debug({ err }, "JWT verification failed for reverse-share download")` to the silent catch block.
  - File: `apps/server/src/modules/file/download.controller.ts`

- [x] **I-8 — console.warn in app.ts after logger setup** — Replaced `console.warn(...)` with `app.log.warn(...)` for CORS security warning.
  - File: `apps/server/src/app.ts`

- [x] **M-2 — seed.js uses `crypto` not `node:crypto`** — Changed to `import crypto from "node:crypto"`.
  - File: `apps/server/prisma/seed.js`

- [x] **M-7 — Import organization errors** — Ran `biome check --write --unsafe` across entire codebase. All import ordering fixed.

---

## Deferred — Controller Error Migration → Phase 5 (item 5.16)

- [x] **I-2 — Error handler bypassed by existing controllers** — Controllers still wrap handler bodies in try/catch returning `{ error: "..." }` while the global handler returns `{ error, code, statusCode, details? }`. Clients face two distinct error formats. Prisma errors inside catch blocks get swallowed into generic 500 instead of being mapped by the global handler. The handler primarily catches Zod schema validation errors.
   - **Why deferred**: Phase 5 (Backend Hardening) will touch these same controller files for validation/auth improvements. Migrating try/catch now then re-refactoring in Phase 5 = double work on the same files.
   - **Impact**: Medium — two concurrent error response shapes until migration
   - **Added to**: `CONSOLIDATED-TODO-LIST.md` Phase 5 as item 5.16
   - **Completed in Phase 5 (item 5.16)** — All controllers migrated to throw AppError directly

---

## Minor / Documentation

- [x] **M-1 — PrismaClient singleton doesn't memoize across HMR** — `apps/server/src/shared/prisma.ts` uses plain `const prisma = new PrismaClient()`. Consider `globalThis` memoization pattern for Vitest watch mode connection-pool leaks.
   - **Suggested phase**: Phase 8 (testing maturity)
   - **Not applicable** — tsx watch restarts the process, no HMR in server

- [x] **M-3 — Mime-type regex doesn't prefer `filename*` over `filename`** — Per RFC 6266, when both are present, `filename*` should be preferred. Current regex returns whichever appears first. Pre-existing, not introduced by Phase 3.
   - **Suggested phase**: Phase 5 (robustness) or low priority
   - **Completed in Phase 5** — RFC 5987 `filename*` priority implemented in sanitizeFilename

- [x] **M-4 — Frontend logger reads env at module load** — `NEXT_PUBLIC_LOG_LEVEL` captured once at evaluation time. Runtime overrides won't work. Intentional design, just needs a JSDoc comment.
   - **Completed in Phase 8 (item 8.17)** — Full JSDoc added explaining build-time capture

- [x] **M-5 — Health test is a route smoke test, not integration** — Single 200-status assertion doesn't exercise error handler, Prisma, JWT, or plugin chain. Consider expanding or renaming to `health.smoke.test.ts`.
   - **Suggested phase**: Phase 8 (testing maturity)
   - **Completed in Phase 8 (item 8.16)** — 5 new health integration tests added

- [x] **M-6 — Web smoke test tests shadcn Button, not app code** — Useful as test-infrastructure validation but doesn't cover Phase 3 changes.
   - **Suggested phase**: Phase 8 (testing maturity)
   - **Completed in Phase 8 (item 8.16)** — Replaced with formatFileSize unit tests

---

## Quality Audit — Phase 3 Rework Items

> Identified by cross-review audit of Phase 3 deliverables (session 2).
> Each item was verified by an independent agent, but verifications were fast/shallow —
> implementers MUST do a thorough scan for additional occurrences before closing each item.

### Critical (fix before Phase 4)

- [x] **QA-1 — `error-handler.test.ts` breaks type-check** — FIXED. Extracted typed invocation helpers (`invokeErrorHandler`, `invokeNotFoundHandler`) that encapsulate all type casts. Uses real Fastify types instead of `Parameters<>` indexing. Replaced all 24 inline cast sites. File reduced from 614→~530 lines. Type-check passes clean.
  - File: `apps/server/src/__tests__/error-handler.test.ts`

- [x] **QA-2 — `jwtSign` augmentation returns `string` instead of `Promise<string>`** — FIXED. Root cause: custom `app.decorateRequest("jwtSign", ...)` in `app.ts` was entirely redundant — `@fastify/jwt` already provides `reply.jwtSign()` natively with proper types. Removed the custom decorator, switched 3 callers from `request.jwtSign()` to `reply.jwtSign()`, rewrote `fastify.d.ts` to only contain the `FastifyJWT.user` augmentation.
  - Files: `apps/server/src/app.ts`, `apps/server/src/types/fastify.d.ts`, `apps/server/src/modules/auth/controller.ts`, `apps/server/src/modules/auth-providers/controller.ts`

- [x] **QA-3 — JWT detection by message string is fragile** — FIXED. Replaced explicit code list + message-based fallback with prefix-based detection: `code.startsWith("FST_JWT_") || code.startsWith("FAST_JWT_")`. Catches all current AND future `@fastify/jwt` error codes automatically. Removed fragile message string matching entirely. Added 3 new tests (prefix detection, future code, negative case). Test count: 30→31.
  - File: `apps/server/src/utils/error-handler.ts`, `apps/server/src/__tests__/error-handler.test.ts`

### Important (fix during or before Phase 4)

- [x] **QA-4 — 16 `as unknown as ViewModel[]` double-casts replaced with mapper module** — FIXED. Created `apps/web/src/lib/api-mappers.ts` (150 lines) with 8 mapper functions + `getUppyObjectName` helper. Eliminated 5 redundant hook-local type interfaces in favor of canonical `files-table-types.ts` exports. 16 double-casts removed (not 15 — thorough scan found one more). Remaining `as unknown as` in web: 2 legitimate (browser API, dynamic field).
  - Files: `apps/web/src/lib/api-mappers.ts` (new), `use-file-browser.ts`, `use-dashboard.ts`, `use-public-share.ts`, `useUppyUpload.ts`

- [x] **QA-5 — biome-ignore suppressions audited: 23 found, 21 removed, 2 rewritten** — FIXED. Full audit of all `biome-ignore lint/suspicious/noExplicitAny` across both apps. 21 suppressions replaced with proper types (FileItem[], UseFormRegister<GroupFormData>, DraggableProvidedDragHandleProps, ProviderFormDataMap, StringFields conditional type, etc.). 2 kept with honest justifications (server.ts crypto polyfill — no `Crypto` type without DOM lib). Created `auth-provider-form/types.ts` for shared `ProviderFormData`/`ProviderFormDataMap` types.
  - Files: 12 files across `apps/web/src/` and `apps/server/src/`, plus new `auth-provider-form/types.ts`

- [x] **QA-6 — auth-providers Prisma casts eliminated via Zod-derived types** — FIXED. Service methods now accept Zod-derived types (`CreateAuthProviderInput`, `UpdateAuthProviderInput`) instead of `Prisma.*` types. Explicit field mapping inside service ensures only validated fields reach Prisma. Removed `as unknown as Prisma.AuthProviderCreateInput` + 2 `as Prisma.AuthProviderUpdateInput` casts. Removed dead code (`OFFICIAL_PROVIDER_ALLOWED_FIELDS`, `sanitizeOfficialProviderData`). Replaced manual allowlist with `UpdateOfficialProviderSchema.parse()`. No other dangerous `as unknown as` casts found in server modules. Broader `request.body as X` pattern remains for Phase 5/5.16.
  - Files: `auth-providers/dto.ts`, `service.ts`, `controller.ts`, `types.ts`

- [x] **QA-7 — 37 console.* calls migrated to structured Pino logging** — FIXED. Thorough scan found 115 total console.* in server src (not 33). Migrated 37: 32 in `migrate-filesystem-to-s3.ts` (class now accepts `FastifyBaseLogger` via constructor), 4 in `server.ts` post-buildApp, 1 in `ensureDirectories`. All migrated calls use structured logging with context objects. 5 remaining console.* are all pre-logger bootstrap with explanatory comments (server.ts:51 pre-buildApp, server.ts:111 startup catch, storage.config.ts module-level ×2, container-detection.ts module-level). CLI scripts (reset-password, cleanup-orphan-files) left as-is — true standalone scripts.
  - Files: `migrate-filesystem-to-s3.ts`, `server.ts`, `storage.config.ts`, `container-detection.ts`

### Minor / Deferred

- [x] **QA-8 — Web component splits created ~100-120 lines of cross-file duplication** — `files-table-file-row.tsx` and `files-table-folder-row.tsx` share identical inline-edit UI (input + confirm/cancel buttons), checkbox blocks, and icon imports. Same pattern in `files-grid-file-card.tsx` vs `files-grid-folder-card.tsx`. The fast agent noted callbacks and menus do differ, so it's not a full clone — but the inline-edit widget is copy-pasted 4x.
   - **Fix**: Extract `<EditableField>` and `<SelectionCheckbox>` components. This naturally fits Phase 4 (Frontend Modernization) scope. Do a broader scan for other duplicated UI patterns across the split files — the fast agent only checked the file/folder pairs.
   - **Suggested phase**: Phase 4 (item to add)
   - Files: `apps/web/src/app/files/components/files-table-file-row.tsx`, `files-table-folder-row.tsx`, `files-grid-file-card.tsx`, `files-grid-folder-card.tsx`
   - **Completed in Phase 4 (item 4.14)** — Shared UI primitives extracted (EditableField, ItemActions, useEditableItem)

- [x] **QA-9 — Frontend "structured logger" is a console wrapper** — `apps/web/src/lib/logger.ts` is 37 lines that filter by level then call `console[method]()`. No JSON serialization, no transports, no redaction, no correlation IDs. The migration itself is complete (zero console.* in web code), but calling it "structured" is misleading.
   - **Fix**: Either (a) rename references in docs to "level-filtered logger" / "client logger", or (b) back it with a real transport in Phase 8 (Sentry breadcrumbs, OTel browser, etc.). Not blocking — but don't claim structured logging on the frontend until it actually is.
   - **Suggested phase**: Phase 8 (polish)
   - **Completed in Phase 8 (items 8.17+8.18)** — Full JSDoc and LogContext interface added, clarified as client-side level-filtered wrapper

### Reclassified from Minor

- [x] **M-1 — PrismaClient HMR memoization — NOT APPLICABLE** — Audit found `apps/server/src/shared/prisma.ts` uses plain `const prisma = new PrismaClient()` which is correct for this codebase. The server uses `tsx watch` which restarts the process on changes (no HMR). The `globalThis` memoization pattern is a Next.js-specific concern that doesn't apply here. Recommend closing this item.
   - **Action**: Close in CONSOLIDATED-TODO-LIST.md (item 8.15) with "not applicable — tsx watch restarts process" justification.
   - **Closed** — Not applicable, tsx watch restarts process

---

## Known Infrastructure Issue (Fixed)

- [x] **Lefthook pre-commit hook fails on large commits (Windows)** — When >100 files are staged, `{staged_files}` expansion exceeds Windows' ~8191 char command-line limit. Fixed by replacing `{staged_files}` with biome's native `--staged` flag in `lefthook.yml`. Biome queries git directly, avoiding command-line length limits.
  - Commit: `8323a60 fix(ci): use biome --staged flag instead of {staged_files} in lefthook`
