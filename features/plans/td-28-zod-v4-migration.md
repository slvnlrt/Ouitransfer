# TD-28: Zod v3 → v4 Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the entire codebase from Zod v3.25.76 to Zod v4.4.3, including switching from `fastify-type-provider-zod@4.0.2` to the official `@fastify/type-provider-zod@1.0.0`.

**Architecture:** Zod is used everywhere — 46 source files import it (37 server, 9 web). The server uses fastify-type-provider-zod for request/response validation + Swagger generation. The web app uses `@hookform/resolvers` which already supports Zod v4. The migration affects packages, imports, and several breaking API changes.

**Tech Stack:** Zod v4.4.3, @fastify/type-provider-zod 1.0.0, Fastify 5, Vitest, pnpm workspaces

---

## Key Decisions

1. **Keep `import { z } from "zod"` unchanged** — When `zod@4.x` is installed, the `"zod"` entry point IS Zod v4. No need to change to `"zod/v4"` in 46 files. This is a cosmetic preference in the FTPZ README, not a requirement.
2. **Switch to `@fastify/type-provider-zod@1.0.0`** — The official Fastify org package, same API as the community one but maintained by the Fastify team.
3. **`.describe()` stays as-is** — Still works in v4 (deprecated but functional, no warnings at runtime). 620 uses — changing to `.meta()` would be a separate task with no functional benefit now.
4. **`.email()`, `.url()`, `.trim()` stay as method forms** — Deprecated but still functional in v4. A separate cleanup pass later.

## Breaking Changes to Fix

| Change | Files | Count |
|--------|-------|-------|
| `z.record(z.string())` → `z.record(z.string(), z.string())` | `apps/web/src/app/settings/hooks/use-settings.ts` | 1 |
| `z.NEVER` → `undefined as never` | `apps/server/src/shared/quota-schema.ts` | 3 |
| `z.ZodIssueCode.custom` → `"custom"` string literal | `quota-schema.ts` + `use-settings.ts` | 9 |
| `fastify-type-provider-zod` → `@fastify/type-provider-zod` imports | 24 server files + 4 test files | 28 |
| Error handler validation type update | `error-handler.ts` + `error-handler.test.ts` | 2 |
| `.default()` behavior audit (no longer makes input optional) | 26 uses across server+web | audit only |

---

### Task 1: Update Package Dependencies

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `apps/server/package.json`

- [ ] **Step 1: Update pnpm-workspace.yaml catalog and remove override**

Change catalog entry from `zod: "^3.25.76"` to `zod: "^4.4.3"`. Remove the `"zod@^4.0.0": "4.4.3"` override (no longer needed since all apps will be on v4).

- [ ] **Step 2: Update apps/server/package.json**

Replace `"fastify-type-provider-zod": "^4.0.2"` with `"@fastify/type-provider-zod": "^1.0.0"`. Remove the old `fastify-type-provider-zod` entry.

- [ ] **Step 3: Run pnpm install**

Run: `pnpm install` to update lockfile.
Expected: Clean install, all peer dependencies satisfied.

- [ ] **Step 4: Commit**

```
git add pnpm-workspace.yaml apps/server/package.json pnpm-lock.yaml
git commit -m "chore(deps): upgrade zod v3→v4, switch to @fastify/type-provider-zod"
```

---

### Task 2: Update FTPZ Imports (Server Source Files)

**Files to modify (all `from "fastify-type-provider-zod"` → `from "@fastify/type-provider-zod"`):**
- `apps/server/src/app.ts`
- `apps/server/src/config/swagger.config.ts`
- `apps/server/src/utils/error-handler.ts`
- 19 route files in `apps/server/src/modules/*/routes.ts`
- 4 test files in `apps/server/src/__tests__/`

- [ ] **Step 1: Bulk replace import paths in all server source files**

Find: `from "fastify-type-provider-zod"`
Replace: `from "@fastify/type-provider-zod"`

This affects ~24 source files and 4 test files.

- [ ] **Step 2: Run type-check to verify imports resolve**

Run: `pnpm --filter @ouitransfer/server run type-check`

- [ ] **Step 3: Commit**

```
git add apps/server/src/
git commit -m "refactor(server): update imports to @fastify/type-provider-zod"
```

---

### Task 3: Fix Zod v4 Breaking API Changes

**Files:**
- Modify: `apps/server/src/shared/quota-schema.ts`
- Modify: `apps/web/src/app/settings/hooks/use-settings.ts`

- [ ] **Step 1: Fix z.NEVER in quota-schema.ts**

Replace all 3 occurrences of `return z.NEVER;` with `return undefined as never;`.

- [ ] **Step 2: Fix z.ZodIssueCode.custom in quota-schema.ts**

Replace `code: z.ZodIssueCode.custom` with `code: "custom"` (3 occurrences).

- [ ] **Step 3: Fix z.record() in use-settings.ts**

Change `z.record(z.string())` to `z.record(z.string(), z.string())` on line 113.

- [ ] **Step 4: Fix z.ZodIssueCode.custom in use-settings.ts**

Replace `code: z.ZodIssueCode.custom` with `code: "custom"` (6 occurrences).

- [ ] **Step 5: Run type-check on both apps**

Run: `pnpm --filter @ouitransfer/server run type-check && pnpm --filter @ouitransfer/web run type-check`

- [ ] **Step 6: Commit**

```
git add apps/server/src/shared/quota-schema.ts apps/web/src/app/settings/hooks/use-settings.ts
git commit -m "fix: update Zod v4 breaking API changes (z.NEVER, z.record, ZodIssueCode)"
```

---

### Task 4: Update Error Handler for FTPZ v4 Validation Shape

**Files:**
- Modify: `apps/server/src/utils/error-handler.ts`
- Modify: `apps/server/src/__tests__/error-handler.test.ts`

- [ ] **Step 1: Verify or update the validation error shape in handleZodValidationError**

The `@fastify/type-provider-zod@1.0.0` may use a different internal validation error structure. Check if `params.issue.path` and `params.issue.message` are still the correct shape. If the structure changed, update the type annotation in `handleZodValidationError` and the extraction logic.

- [ ] **Step 2: Verify or update the Symbol in error-handler.test.ts**

Check if `Symbol.for("ZodFastifySchemaValidationError")` is still used by `@fastify/type-provider-zod@1.0.0`. If it changed, update the test helper `makeZodValidationError`.

- [ ] **Step 3: Run error handler tests**

Run: `pnpm --filter @ouitransfer/server test -- --reporter=verbose src/__tests__/error-handler.test.ts`

- [ ] **Step 4: Commit if changes were needed**

```
git add apps/server/src/utils/error-handler.ts apps/server/src/__tests__/error-handler.test.ts
git commit -m "fix(server): update error handler for @fastify/type-provider-zod v1"
```

---

### Task 5: Audit .default() Behavior Changes

**Context:** In Zod v4, `.default()` short-circuits and returns the default value directly (must match output type). In Zod v3, it was parsed through the schema (matched input type). Also, defaults inside optional fields ARE now applied.

- [ ] **Step 1: Audit all 26 .default() usages**

Review each usage to determine if the behavior change matters:

**Server route query params** (e.g., `z.coerce.number().default(1)` for pagination): Fastify sends `undefined` for missing query params. In Zod v4, `.default()` short-circuits when input is `undefined`, returning the default directly. For simple types (number, boolean), the behavior is functionally identical. **No change needed.**

**DTO fields with `.default(false)` / `.default(true)`**: Same reasoning — these are boolean defaults on simple schemas. **No change needed.**

**`env.ts` defaults**: Environment variable defaults use `.default()` on coerced types. Since `.default()` now short-circuits and the default values are already the output type, **no change needed.**

- [ ] **Step 2: Document findings**

If any `.default()` usage requires a change (e.g., `.default()` on a schema with `.transform()` where the default was an input-type value), fix it.

---

### Task 6: Full Verification Suite

- [ ] **Step 1: Type-check all packages**

Run: `pnpm run type-check`

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: 1944 tests pass (1596 server + 334 web + 14 shared).

- [ ] **Step 3: Run lint**

Run: `pnpm lint`

- [ ] **Step 4: Fix any failures, iterate until green**

---

### Task 7: Update Tracking Files

- [ ] **Step 1: Update features/TECHNICAL-DEBT.md — mark TD-28 as Done**
- [ ] **Step 2: Update features/zod-v4-migration.md — mark as completed**
- [ ] **Step 3: Update features/SESSIONS.md — add session log entry**
- [ ] **Step 4: Commit tracking updates**

```
git add features/
git commit -m "docs: mark TD-28 Zod v4 migration as done"
```
