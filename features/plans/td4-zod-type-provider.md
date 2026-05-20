# TD-4 — Zod Type Provider: Controller-to-Plugin Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all controller classes with idiomatic `FastifyPluginAsyncZod` plugin functions using `.route()` with inline handlers, enabling end-to-end TypeScript type inference from Zod schemas (eliminating ~75 `as` casts and all redundant `.parse()` calls).

**Architecture:** Each module's `routes.ts` becomes a `FastifyPluginAsyncZod` plugin with `.route()` calls and inline handlers. Controller classes are deleted. Services remain module-level singletons. Private methods become module-level functions. `server.ts` registration unchanged.

**Tech Stack:** Fastify 5, fastify-type-provider-zod 4.0.2, Zod 3.x, TypeScript 5.x

---

## Reference: The Idiomatic Pattern

### BEFORE (current — broken type inference):

```typescript
// routes.ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import { SomeController } from "./controller.js";
import { SomeSchema } from "./dto.js";

export async function someRoutes(app: FastifyInstance) {  // ← bare type, ZodTypeProvider LOST
  const controller = new SomeController();

  app.post("/path", {
    schema: { body: SomeSchema },
  }, controller.doThing.bind(controller));  // ← handler typed as (req: FastifyRequest) → body is unknown
}

// controller.ts
export class SomeController {
  private service = new SomeService();

  async doThing(request: FastifyRequest, reply: FastifyReply) {
    const input = request.body as SomeInput;  // ← unsafe cast to work around unknown
    // ...
  }
}
```

### AFTER (target — full type inference):

```typescript
// routes.ts
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { SomeSchema } from "./dto.js";

const service = new SomeService();  // module-level singleton (stateless, same as before)

export const someRoutes: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: "POST",
    url: "/path",
    schema: { body: SomeSchema },
    handler: async (request, reply) => {
      // request.body is AUTOMATICALLY typed as z.infer<typeof SomeSchema>
      // No cast needed! Full type safety.
      const result = await service.doThing(request.body);
      return reply.send(result);
    },
  });
};

// controller.ts → DELETED
```

### Key rules for the migration:

1. **Plugin function type**: `FastifyPluginAsyncZod` from `fastify-type-provider-zod` (type-only import)
2. **Arrow function export**: `export const xxxRoutes: FastifyPluginAsyncZod = async (app) => { ... }`
3. **`.route()` method**: NOT `.get()/.post()` shorthands — `.route()` with `method` + `url` for type inference
4. **Inline handlers**: The handler is defined inline in the `.route()` call, NOT a separate function
5. **No `as` casts**: `request.body`, `request.params`, `request.query` are auto-typed from schema
6. **No redundant `.parse()`**: Zod validation already happened via the validator compiler
7. **Services**: Instantiate at module level (same lifetime as before — stateless singletons)
8. **Private methods**: Become plain module-level functions
9. **`preValidation` hooks**: Keep as-is (they're already plain functions)
10. **Existing inline handlers** (like `/auth/refresh`): Fold into the new `.route()` pattern
11. **Keep schemas in dto.ts**: Don't move schemas inline — reference them from dto.ts as before
12. **Keep all route options**: `config.csrfExempt`, `config.rateLimit`, `bodyLimit`, `preValidation` — these all stay
13. **ESM imports**: Keep `.js` extensions on all relative imports
14. **`server.ts` unchanged**: `app.register(someRoutes)` calls stay exactly as they are

### What NOT to change:
- `app.ts` (already has `withTypeProvider<ZodTypeProvider>()`)
- `server.ts` (registration calls stay the same)
- `dto.ts` files (schemas stay as they are)
- Service files (no changes needed)
- Test files (they use `app.inject()` — routes are tested through HTTP, not via controller methods)
- Middleware files (already plain functions)

---

## Batches

Modules are grouped by complexity tier. Each batch is one subagent dispatch.

### Batch 0: Extract shared `setAuthCookies` utility

**Why first:** Auth, auth-providers, user, and the inline `/auth/refresh` handler all duplicate cookie-setting logic. Extract once, then all HIGH/MEDIUM modules can use it.

**Scope:**
- [ ] Read the cookie-setting logic in `auth/controller.ts` (login + completeTwoFactorLogin), `auth-providers/controller.ts` (callback + setAuthCookie), `user/controller.ts` (register — first-user auto-login), and the inline `/auth/refresh` handler in `auth/routes.ts`
- [ ] Create `apps/server/src/utils/auth-cookies.ts` with a `setAuthCookies(reply, { accessToken, refreshToken })` utility that sets both the access token cookie and the refresh token cookie
- [ ] Also extract `getClientInfo(request)` from auth/controller.ts into the same file or a nearby utility — it's used by login, completeTwoFactorLogin, logout, resetPassword
- [ ] Write unit tests for the utility in `apps/server/src/__tests__/auth-cookies.test.ts`
- [ ] Do NOT modify any routes or controllers yet — just create the utility
- [ ] Run `pnpm --filter server test` to ensure nothing breaks

**Agent:** worker

---

### Batch 1: TRIVIAL tier (8 modules, ~16 handlers)

**Modules:** audit, admin/stats, health, health/status, quota, storage, invite, reverse-share/multipart

**Characteristics:** Pure delegation, no Fastify-specific APIs beyond basics, zero shared private methods. Completely mechanical conversion.

**Per module:**
- [ ] Rewrite `routes.ts` as `FastifyPluginAsyncZod` with `.route()` + inline handlers
- [ ] Move any logic from `controller.ts` handlers inline into the route handlers
- [ ] Move any service instantiation to module level in routes.ts
- [ ] Remove all `as` casts on `request.body`, `request.params`, `request.query` — they are now typed
- [ ] Remove all redundant `Schema.parse(request.body)` calls — Zod validation already happened
- [ ] Delete the `controller.ts` file
- [ ] Remove the controller import from `routes.ts`
- [ ] Run `pnpm --filter server test` — all existing tests must still pass (tests use `app.inject()`, they don't care about controllers)
- [ ] Commit

**Specific notes:**
- `health/controller.ts`: The `check()` method doesn't take request/reply — the route already has an inline wrapper. Just inline the check logic directly in the route handler.
- `health/status.controller.ts` → `health/routes.ts` already has the status route, fold it in.
- `admin/stats.controller.ts` → fold into `admin/routes.ts`
- `invite/controller.ts` already uses `FastifyRequest<{ Params: ... }>` typed generics — those become unnecessary with `.route()` type inference

**Agent:** worker-fast (8 modules but all purely mechanical)

---

### Batch 2: LOW tier — Part A (4 modules, ~32 handlers)

**Modules:** group, two-factor, s3-storage, file/multipart

**Characteristics:** Mostly delegation with light request parsing. No complex Fastify API usage.

**Per module — same steps as Batch 1, plus:**
- [ ] `group/controller.ts`: Keep module-level `serializeGroup`/`serializeMember` helper functions in `routes.ts` (they're already module-level)
- [ ] `two-factor/controller.ts`: Keep module-level Zod schemas (used for body parsing) in `routes.ts` or move to `dto.ts` if they don't exist there yet. Remove redundant `.parse()` calls. Keep audit fire-and-forget calls inline.
- [ ] `s3-storage/controller.ts`: Path traversal validation logic stays inline in handlers
- [ ] `file/multipart.controller.ts`: Pure delegation — fold into `file/routes.ts` multipart section (or keep as separate route file if it's already separate)
- [ ] Run `pnpm --filter server test` — all tests pass
- [ ] Commit per module or as one batch

**Agent:** worker

---

### Batch 3: LOW tier — Part B (4 modules, ~50 handlers)

**Modules:** share, reverse-share, ldap, app

**Characteristics:** Similar to Part A but larger handler counts. Some have minor Fastify API usage.

**Per module — same steps as Batch 1, plus:**
- [ ] `share/controller.ts`: `getShare` has an optional `request.jwtVerify()` call (try/catch, used to pass userId context) — keep it inline in the handler
- [ ] `reverse-share/controller.ts`: 17 handlers, two service instances. Move both to module level.
- [ ] `ldap/controller.ts`: Has 3 service dependencies (configRepository, syncLogRepository, syncService). Move all to module level. `updateConfig` has non-trivial logic (password masking, encryption, scheduler restart) — keep it inline in the handler.
- [ ] `app/controller.ts`: Has 3 services + `request.file()` usage in `uploadLogo`. Keep streaming logic inline.
- [ ] Run `pnpm --filter server test`
- [ ] Commit

**Agent:** worker

---

### Batch 4: MEDIUM tier (5 modules, ~28 handlers)

**Modules:** file, file/download, file/embed, folder, user

**Characteristics:** Significant inline business logic, DB queries, file streaming, some JWT/cookie usage.

**Per module — same steps as Batch 1, plus:**
- [ ] `file/controller.ts`: Has 1 private method (`getAllUserFilesRecursively`) → module-level function. Significant inline business logic (quota checks, MIME validation, magic bytes). Keep it all inline in handlers.
- [ ] `file/download.controller.ts`: Has duplicated access-check logic between `getDownloadUrl` and `downloadFile` — extract a shared module-level `checkFileAccess()` helper as part of the migration. Uses `request.jwtVerify()`, `reply.header()`, `reply.send(stream)`.
- [ ] `file/embed.controller.ts`: Token verification + streaming with `reply.header()`. Straightforward inline.
- [ ] `folder/controller.ts`: Has 1 private method (`isDescendantOf`) → module-level function. Inline DB queries for ownership checks.
- [ ] `user/controller.ts`: Uses `setAuthCookies` utility (from Batch 0) for first-user auto-login. `uploadAvatar` has complex streaming with `request.file()`. Module-level `serializeUser` stays.
- [ ] Run `pnpm --filter server test`
- [ ] Commit per module

**Agent:** worker-smart (significant inline logic requires judgment)

---

### Batch 5: HIGH tier (2 modules, ~20 handlers)

**Modules:** auth, auth-providers

**Characteristics:** Heavy Fastify API usage, shared private methods, cookie/JWT/redirect logic, duplicated patterns.

**auth module:**
- [ ] `auth/controller.ts`: 10 handlers + 1 private method (`getClientInfo` → already extracted in Batch 0). Cookie-setting via `setAuthCookies` utility (Batch 0). Complex `login`/`completeTwoFactorLogin` with 2FA branching, `logout` with `reply.clearCookie`, `getCurrentUser` with optional JWT verify.
- [ ] `auth/routes.ts`: The inline `/auth/refresh` handler (lines 366-428) is already a plain function — fold it into the `.route()` pattern and use `setAuthCookies` utility.
- [ ] All `preValidation` hooks stay as-is (already plain functions)
- [ ] Keep all `config.csrfExempt`, `config.rateLimit`, `bodyLimit` options

**auth-providers module:**
- [ ] `auth-providers/controller.ts`: 8 handlers + 6+ private methods. ALL private methods become module-level functions. `callback` is the most complex — uses `reply.jwtSign()`, `reply.setCookie()`, `reply.redirect()`, try/catch with redirect error handling.
- [ ] Use `setAuthCookies` utility where applicable (may not be 1:1 match with auth-providers' cookie logic — check and adapt)
- [ ] Run `pnpm --filter server test`
- [ ] Commit per module

**Agent:** worker-smart

---

### Batch 6: Cleanup & verification

- [ ] Run `pnpm --filter server test` — full test suite pass
- [ ] Run `pnpm --filter server run type-check` — zero type errors
- [ ] Grep for remaining `as` casts on `request.body`, `request.params`, `request.query` in `apps/server/src/modules/` — should be zero (except legitimate uses like `request.user`)
- [ ] Grep for remaining `.parse(request.body)` / `.parse(request.params)` / `.parse(request.query)` — should be zero
- [ ] Grep for remaining `controller.ts` files in `apps/server/src/modules/` — should be zero
- [ ] Grep for remaining `import.*Controller` in route files — should be zero
- [ ] Verify no remaining `FastifyInstance` type annotation on plugin function parameters (should all be `FastifyPluginAsyncZod`)
- [ ] Run `pnpm --filter server run lint` — fix any issues
- [ ] Commit final cleanup

**Agent:** worker

---

## Verification Checklist (post-completion)

1. `pnpm --filter server test` — all 255+ tests pass
2. `pnpm --filter server run type-check` — 0 errors
3. `pnpm --filter server run lint` — clean
4. Zero `controller.ts` files remain in `apps/server/src/modules/`
5. Zero `as SomeType` casts on `request.body`/`.params`/`.query` in route handlers
6. Zero redundant `.parse()` calls in route handlers
7. All route files use `FastifyPluginAsyncZod` type
8. All routes use `.route()` method (not `.get()/.post()` shorthands)
9. `pnpm build` succeeds (full build including web app)
