# Phase 3 — Post-Review Follow-ups

> Items identified by reviewer during Phase 3 Code Quality & Type Safety verification.
> I-3, I-4, I-5, I-7, I-8, M-2, M-7 fixed immediately after review.
> Remaining items forwarded to relevant future phases or documented as known limitations.

---

## Fixed Immediately

- [x] **I-3 — AuthProviderModel duplicated Prisma type** — Replaced manual 22-line interface with `import type { AuthProvider } from "@prisma/client"; export type AuthProviderModel = AuthProvider;`
  - File: `apps/server/src/modules/auth-providers/types.ts`

- [x] **I-4 — proxy-routes.test.ts re-implemented matchRoute** — Exported `matchRoute` from `proxy.ts`, replaced inline copy in test with `import { matchRoute } from "../proxy"`. 62 tests now verify production code.
  - Files: `apps/web/src/lib/proxy.ts`, `apps/web/src/lib/__tests__/proxy-routes.test.ts`

- [x] **I-5 — noImplicitAnyLet violations** — Fixed 3 implicit-any-let violations: `useUppyUpload.ts` (2 `let response;`), `color-picker-form.tsx` (1 `let r,g,b;`). Enabled `noImplicitAnyLet: "error"` in biome.json.
  - Files: `biome.json`, `apps/web/src/hooks/useUppyUpload.ts`, `apps/web/src/app/profile/components/color-picker-form.tsx`

- [x] **I-7 — Inconsistent silent catch in download.controller.ts** — Added `request.log.debug({ err }, "JWT verification failed for reverse-share download")` to the silent catch block.
  - File: `apps/server/src/modules/file/download.controller.ts`

- [x] **I-8 — console.warn in app.ts after logger setup** — Replaced `console.warn(...)` with `app.log.warn(...)` for CORS security warning.
  - File: `apps/server/src/app.ts`

- [x] **M-2 — seed.js uses `crypto` not `node:crypto`** — Changed to `import crypto from "node:crypto"`.
  - File: `apps/server/prisma/seed.js`

- [x] **M-7 — Import organization errors** — Ran `biome check --write --unsafe` across entire codebase. All import ordering fixed.

---

## Deferred — Error Handler Coverage (Phase 3 / Phase 8)

- [ ] **I-1 — Error handler has zero tests** — `globalErrorHandler()` in `apps/server/src/utils/error-handler.ts` routes 6 error categories with conditional logic, but has no unit tests. Should add tests for: Zod validation, Prisma P2002/P2025/P2003/P2014/unknown, JWT expired/invalid, Fastify 4xx/5xx, unknown fallback. The handler is a pure function — easy to test with mock reply.
  - **Impact**: High — most important new abstraction
  - **Suggested phase**: Phase 8 (testing maturity) or standalone task

- [ ] **I-2 — Error handler bypassed by existing controllers** — Controllers still wrap handler bodies in try/catch returning `{ error: "..." }` while the global handler returns `{ error, code, statusCode, details? }`. Clients face two distinct error formats. Prisma errors inside catch blocks get swallowed into generic 500 instead of being mapped by the global handler. The handler primarily catches Zod schema validation errors.
  - **Impact**: Medium — controller migration is a separate task
  - **Suggested phase**: Phase 4 (backend refinement) — migrate controllers to let errors propagate, or adopt `AppError` pattern
  - **Note**: Acknowledged in `error-handler.ts:9-11`

---

## Deferred — Frontend Logger Component Migration

- [ ] **I-6 — 57 console.* calls remain in .tsx component files** — Phase 3.8 migrated all hooks/lib files (54 calls). Components still use raw `console.error` which won't respect `NEXT_PUBLIC_LOG_LEVEL`. Honest scoping: hooks-only migration was intentional, component migration deferred.
  - **Impact**: Low — components mostly use `console.error` in error boundaries
  - **Suggested phase**: Phase 4 (frontend refinement)

---

## Minor / Documentation

- [ ] **M-1 — PrismaClient singleton doesn't memoize across HMR** — `apps/server/src/shared/prisma.ts` uses plain `const prisma = new PrismaClient()`. Consider `globalThis` memoization pattern for Vitest watch mode connection-pool leaks.
  - **Suggested phase**: Phase 8 (testing maturity)

- [ ] **M-3 — Mime-type regex doesn't prefer `filename*` over `filename`** — Per RFC 6266, when both are present, `filename*` should be preferred. Current regex returns whichever appears first. Pre-existing, not introduced by Phase 3.
  - **Suggested phase**: Phase 5 (robustness) or low priority

- [ ] **M-4 — Frontend logger reads env at module load** — `NEXT_PUBLIC_LOG_LEVEL` captured once at evaluation time. Runtime overrides won't work. Intentional design, just needs a JSDoc comment.

- [ ] **M-5 — Health test is a route smoke test, not integration** — Single 200-status assertion doesn't exercise error handler, Prisma, JWT, or plugin chain. Consider expanding or renaming to `health.smoke.test.ts`.
  - **Suggested phase**: Phase 8 (testing maturity)

- [ ] **M-6 — Web smoke test tests shadcn Button, not app code** — Useful as test-infrastructure validation but doesn't cover Phase 3 changes.
  - **Suggested phase**: Phase 8 (testing maturity)
