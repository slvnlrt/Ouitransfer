# TD-6: Prisma 6 → 7 Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Prisma from v6 to v7 across the server app, adopting the driver adapter pattern and new generated client output path.

**Architecture:** Prisma 7 removes the Rust query engine in favor of Node.js driver adapters. For SQLite, we use `@prisma/adapter-better-sqlite3`. The generated client moves from `node_modules/@prisma/client` to a local `./generated/prisma` directory. The `prisma.config.ts` file becomes the central configuration hub (DB URL, migrations, seed).

**Tech Stack:** Prisma 7, `@prisma/adapter-better-sqlite3`, `better-sqlite3`, dotenv, SQLite

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `apps/server/package.json` | Modify | Update deps, scripts, add `better-sqlite3` + adapter |
| `apps/server/prisma/schema.prisma` | Modify | Generator `prisma-client` + `output`, remove `url` from datasource |
| `apps/server/prisma.config.ts` | Modify | Add `datasource.url`, `migrations`, `schema` |
| `apps/server/src/shared/prisma.ts` | Modify | Use adapter pattern, new import path |
| `apps/server/src/scripts/reset-password.ts` | Modify | Import from shared/prisma instead of standalone PrismaClient |
| `apps/server/prisma/seed.js` | Modify | Use adapter pattern, new import path |
| `apps/server/src/modules/auth-providers/types.ts` | Modify | Update import path |
| `apps/server/src/modules/user/repository.ts` | Modify | Update import path |
| `apps/server/src/modules/audit/service.ts` | Modify | Update import path |
| `apps/server/src/modules/reverse-share/upload.service.ts` | Modify | Update import path |
| `apps/server/src/modules/share/service.ts` | Modify | Update import path |
| `apps/server/src/modules/share/repository.ts` | Modify | Update import path |
| `apps/server/src/modules/auth-providers/user-linking.service.ts` | Modify | Update import path |
| `apps/server/src/utils/file-name-generator.ts` | Modify | Update import path |
| `apps/server/tsconfig.json` | Modify | Add `prisma/generated` to include |
| `Justfile` | Modify | Remove `--skip-generate` from `db-dev-init` |
| `Dockerfile` | Modify | Update `prisma generate` commands, copy generated dir |
| `infra/server-start.sh` | Modify | Remove `--skip-generate`, update seed invocation |
| `.gitignore` | Modify | Add `apps/server/prisma/generated/` |

---

### Task 1: Install Prisma 7 packages

**Files:**
- Modify: `apps/server/package.json`

- [ ] **Step 1: Update Prisma packages and add driver adapter**

```bash
cd apps/server
pnpm add @prisma/client@">=7.3.0" prisma@">=7.3.0" @prisma/adapter-better-sqlite3 better-sqlite3 dotenv
pnpm add -D @types/better-sqlite3
```

This installs:
- `prisma@>=7.3.0` (CLI — must be >=7.3.0 to avoid SQLite 3.51.0 bug and enum `@map` regression)
- `@prisma/client@>=7.3.0` (client library)
- `@prisma/adapter-better-sqlite3` (driver adapter for SQLite — wrapper around better-sqlite3)
- `better-sqlite3` (underlying native SQLite driver — required direct dependency, not bundled by adapter)
- `dotenv` (env var loading — no longer automatic in Prisma 7)
- `@types/better-sqlite3` (types for the driver)

**Note**: `better-sqlite3` has native bindings. On Node.js 24, ensure a compatible prebuilt binary exists or that build tools (python, make, gcc) are available for compilation. In Docker (Alpine), `apk add python3 make g++` may be needed in the build stage.

- [ ] **Step 2: Verify package.json updated correctly**

Run: `cat apps/server/package.json | grep -E "prisma|better-sqlite3|dotenv"`
Expected: All packages at v7 or latest versions.

- [ ] **Step 3: Commit**

```bash
git add apps/server/package.json apps/server/pnpm-lock.yaml pnpm-lock.yaml
git commit -m "chore(server): upgrade prisma to v7, add driver adapter deps"
```

---

### Task 2: Update schema.prisma and prisma.config.ts

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Modify: `apps/server/prisma.config.ts`

- [ ] **Step 1: Update schema.prisma generator and datasource blocks**

In `apps/server/prisma/schema.prisma`, replace the first 8 lines:

```prisma
generator client {
  provider = "prisma-client"
  output   = "./generated/prisma"
}

datasource db {
  provider = "sqlite"
}
```

Key changes:
- `prisma-client-js` → `prisma-client`
- Added `output = "./generated/prisma"` (required in v7)
- Removed `url = env("DATABASE_URL")` from datasource (moves to config)

- [ ] **Step 2: Update prisma.config.ts with full configuration**

Replace `apps/server/prisma.config.ts` with:

```ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

Key changes:
- Added `import "dotenv/config"` (env vars no longer auto-loaded)
- Added `datasource.url` (moved from schema)
- Added `migrations.path` and `migrations.seed` (seed moved from top-level)
- Added `schema` path

- [ ] **Step 3: Add generated directory to .gitignore**

Append to the project `.gitignore` (root or `apps/server/.gitignore` if it exists):

```
# Prisma generated client (v7)
apps/server/prisma/generated/
```

- [ ] **Step 4: Run prisma generate to verify schema is valid**

```bash
cd apps/server
pnpm exec prisma generate
```

Expected: Success, generates client to `prisma/generated/prisma/`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/prisma/schema.prisma apps/server/prisma.config.ts .gitignore
git commit -m "chore(server): update prisma schema and config for v7"
```

---

### Task 3: Update PrismaClient instantiation (shared singleton)

**Files:**
- Modify: `apps/server/src/shared/prisma.ts`

- [ ] **Step 1: Update shared/prisma.ts with driver adapter pattern**

Replace `apps/server/src/shared/prisma.ts` entirely:

```ts
import { PrismaClient } from "../../prisma/generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./prisma/ouitransfer.db",
});

const prisma = new PrismaClient({ adapter });

export { prisma };
```

Key changes:
- Import from generated path instead of `@prisma/client`
- Create `PrismaBetterSqlite3` adapter with DB URL
- Pass adapter to `PrismaClient` constructor

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/server
pnpm run type-check
```

Expected: May have errors from other files still importing `@prisma/client` — that's OK, we fix those in Task 4.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/shared/prisma.ts
git commit -m "feat(server): use prisma v7 driver adapter in shared client"
```

---

### Task 4: Update all type imports from @prisma/client

**Files:**
- Modify: `apps/server/src/modules/auth-providers/types.ts`
- Modify: `apps/server/src/modules/user/repository.ts`
- Modify: `apps/server/src/modules/audit/service.ts`
- Modify: `apps/server/src/modules/reverse-share/upload.service.ts`
- Modify: `apps/server/src/modules/share/service.ts`
- Modify: `apps/server/src/modules/share/repository.ts`
- Modify: `apps/server/src/modules/auth-providers/user-linking.service.ts`
- Modify: `apps/server/src/utils/file-name-generator.ts`

All 7 files importing types from `@prisma/client` must change to the generated path. The generated path is relative to each file's location.

- [ ] **Step 1: Update all type imports**

For each file, replace `from "@prisma/client"` with the correct relative path to `apps/server/prisma/generated/prisma/client.js`.

The relative paths from each file:

| File | Relative import path |
|------|---------------------|
| `src/modules/auth-providers/types.ts` | `../../../prisma/generated/prisma/client.js` |
| `src/modules/user/repository.ts` | `../../../prisma/generated/prisma/client.js` |
| `src/modules/audit/service.ts` | `../../../prisma/generated/prisma/client.js` |
| `src/modules/reverse-share/upload.service.ts` | `../../../../prisma/generated/prisma/client.js` |
| `src/modules/share/service.ts` | `../../../prisma/generated/prisma/client.js` |
| `src/modules/share/repository.ts` | `../../../prisma/generated/prisma/client.js` |
| `src/modules/auth-providers/user-linking.service.ts` | `../../../prisma/generated/prisma/client.js` |
| `src/utils/file-name-generator.ts` | `../../prisma/generated/prisma/client.js` |

Wait — these relative paths are deep and fragile. **Better approach**: Add a TypeScript path alias.

**Alternative: use tsconfig paths** — Add to `apps/server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@prisma/client": ["./prisma/generated/prisma/client"]
    }
  }
}
```

**However**, this only works for TypeScript — at runtime with Node.js ESM, the path won't resolve. Since the project uses `tsc` to compile to `dist/`, runtime imports resolve from `node_modules`. In Prisma 7, `@prisma/client` still exists as a package but re-exports from the generated location IF the output is configured. Let's verify this.

Actually, per Prisma 7 docs: the `@prisma/client` package in v7 **still works as an import path** — it re-exports from wherever `output` points. The change is that the output must be explicitly set, and the generated code lives locally. So **we may not need to change import paths at all** if `@prisma/client` auto-resolves.

**Decision**: Keep `from "@prisma/client"` for type imports. Only the `PrismaClient` constructor usage changes (already done in Task 3). After `prisma generate`, `@prisma/client` should re-export from the generated location.

Let's test this approach:

- [ ] **Step 1: Run type-check to see if @prisma/client imports still work**

```bash
cd apps/server
pnpm run type-check
```

If this passes, the `@prisma/client` package in v7 is re-exporting correctly and **no import path changes are needed** for type-only imports.

If it fails with import errors, then update all files per the relative path table above.

- [ ] **Step 2: If import paths need updating, do a bulk find-replace**

Only if Step 1 fails: In each of the 7 files listed above, replace `from "@prisma/client"` with the correct relative path.

- [ ] **Step 3: Verify full type-check passes**

```bash
cd apps/server
pnpm run type-check
```

Expected: PASS — no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/
git commit -m "chore(server): update prisma type imports for v7"
```

---

### Task 5: Update reset-password.ts script

**Files:**
- Modify: `apps/server/src/scripts/reset-password.ts`

- [ ] **Step 1: Replace standalone PrismaClient with shared import**

In `apps/server/src/scripts/reset-password.ts`, replace:

```ts
import { PrismaClient } from "@prisma/client";
...
const prisma = new PrismaClient();
```

With:

```ts
import { prisma } from "../shared/prisma.js";
```

Remove the `const prisma = new PrismaClient();` line (line 6).

This avoids duplicating the adapter setup and keeps a single source of truth for PrismaClient configuration.

- [ ] **Step 2: Verify type-check**

```bash
cd apps/server
pnpm run type-check
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/scripts/reset-password.ts
git commit -m "refactor(server): use shared prisma instance in reset-password script"
```

---

### Task 6: Update seed.js

**Files:**
- Modify: `apps/server/prisma/seed.js`

The seed file is a standalone JS file that creates its own PrismaClient. It needs the adapter pattern.

- [ ] **Step 1: Update seed.js imports and PrismaClient instantiation**

Replace the first 4 lines of `apps/server/prisma/seed.js`:

```js
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
```

With:

```js
import crypto from "node:crypto";
import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./prisma/ouitransfer.db",
});
const prisma = new PrismaClient({ adapter });
```

Note: The seed file runs from `apps/server/` working directory, so the relative import to `./generated/prisma/client.js` resolves from `prisma/generated/prisma/client.js`.

Wait — the seed file is AT `apps/server/prisma/seed.js`. So the relative path should be `./generated/prisma/client.js` (relative to the seed file's location, which is `prisma/`). That resolves to `prisma/generated/prisma/client.js`. Correct.

- [ ] **Step 2: Test the seed works**

```bash
cd apps/server
node prisma/seed.js
```

Or if DB doesn't exist yet:

```bash
pnpm exec prisma db push
node prisma/seed.js
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/prisma/seed.js
git commit -m "chore(server): update seed.js for prisma v7 adapter pattern"
```

---

### Task 7: Update package.json scripts

**Files:**
- Modify: `apps/server/package.json`

- [ ] **Step 1: Update postinstall script**

The `postinstall` script `prisma generate` should still work in v7, but verify.

No change needed — `prisma generate` works the same.

- [ ] **Step 2: Verify db:seed script**

`"db:seed": "node prisma/seed.js"` — no change needed, seed file updated in Task 6.

- [ ] **Step 3: Verify db:migrate scripts**

`"db:migrate": "prisma migrate deploy"` — works in v7.
`"db:migrate:dev": "prisma migrate dev"` — works in v7, but note it no longer auto-runs generate or seed. Add explicit steps if needed.

No script changes required.

- [ ] **Step 4: Commit (if any changes)**

Skip if no changes.

---

### Task 8: Update Justfile

**Files:**
- Modify: `Justfile:121`

- [ ] **Step 1: Remove --skip-generate from db-dev-init**

In `Justfile`, line 121, replace:

```
    pnpm --filter=ouitransfer-api exec prisma db push --skip-generate
```

With:

```
    pnpm --filter=ouitransfer-api exec prisma db push
```

The `--skip-generate` flag is removed in Prisma 7.

- [ ] **Step 2: Commit**

```bash
git add Justfile
git commit -m "chore: remove prisma --skip-generate flag (removed in v7)"
```

---

### Task 9: Update Dockerfile

**Files:**
- Modify: `Dockerfile:56,66`

- [ ] **Step 1: Update prisma generate commands**

Line 56 (`pnpm exec prisma generate`) — still works, no change needed.

Line 66 (`RUN node node_modules/prisma/build/index.js generate`) — still works, but the output now goes to `prisma/generated/` instead of `node_modules/@prisma/client`. Verify the generated files are included in the deployed directory.

Since `pnpm deploy` copies the package's `files` field contents, and `prisma/` is included in the `files` array (line 20 of package.json: `"prisma"`), the generated directory at `prisma/generated/` will be included.

**However**, after `pnpm deploy --prod`, the `prisma generate` at line 66 needs to also produce output in the deploy directory. Let's verify the schema is accessible there.

The `pnpm deploy` copies `prisma/` directory (because it's in `files`). So `prisma/schema.prisma` is at `/app/deploy/prisma/schema.prisma`. Running `prisma generate` there will create `/app/deploy/prisma/generated/`. This should work.

**But**: The `pnpm deploy` step at line 63 uses `--ignore-scripts`, so `postinstall` (which runs `prisma generate`) is skipped. That's why line 66 explicitly runs generate. This pattern still works in v7.

- [ ] **Step 2: Verify the deploy directory includes the adapter package**

`@prisma/adapter-better-sqlite3` and `better-sqlite3` are production dependencies, so `pnpm deploy --prod` will include them. OK.

- [ ] **Step 3: Commit (if any Dockerfile changes)**

Likely no Dockerfile changes needed. The existing flow works.

---

### Task 10: Update infra/server-start.sh

**Files:**
- Modify: `infra/server-start.sh:63,68`

- [ ] **Step 1: Remove --skip-generate from db push commands**

In `infra/server-start.sh`, line 63:

Replace:
```bash
    run_as_user node $PRISMA_CLI db push --schema=./prisma/schema.prisma --skip-generate
```

With:
```bash
    run_as_user node $PRISMA_CLI db push --schema=./prisma/schema.prisma
```

Same change on line 68 (the existing DB path):

Replace:
```bash
    run_as_user node $PRISMA_CLI db push --schema=./prisma/schema.prisma --skip-generate
```

With:
```bash
    run_as_user node $PRISMA_CLI db push --schema=./prisma/schema.prisma
```

Note: In v7, `db push` no longer has a `--skip-generate` flag. Since the client is already generated during the Docker build, we don't need generation at runtime. The `--schema` flag should still work.

Actually, wait — does `--schema` still work in v7? The migration guide says `--schema` was removed from `prisma db execute`, not from `db push`. Let me check... `db push --schema` is not listed as removed. It should still work.

- [ ] **Step 2: Commit**

```bash
git add infra/server-start.sh
git commit -m "chore(infra): remove prisma --skip-generate from server-start.sh"
```

---

### Task 11: Update tsconfig.json to include generated types

**Files:**
- Modify: `apps/server/tsconfig.json`

- [ ] **Step 1: Add prisma generated directory to TypeScript include**

The current tsconfig only includes `src/**/*`. The generated Prisma client at `prisma/generated/` needs to be accessible. Since we import it with relative paths, TypeScript should resolve it. But the generated code is outside `rootDir` (`./src`).

**Problem**: With `rootDir: "./src"`, importing from `../../prisma/generated/` will cause a TypeScript error: "File is not under rootDir."

**Solution**: Either:
1. Remove `rootDir` and adjust `include` to cover both `src/` and `prisma/generated/`
2. Use `paths` alias

Actually, the better solution in Prisma v7 is: if `@prisma/client` re-exports from the generated location (which it should in v7), then imports via `@prisma/client` work without rootDir issues. Let's confirm this during Task 4's type-check.

If it doesn't work, update tsconfig:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "../../packages/config/tsconfig/server.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "."
  },
  "include": ["src/**/*", "prisma/generated/**/*"]
}
```

This widens rootDir from `./src` to `.` (project root) and includes the generated types.

- [ ] **Step 2: Verify type-check**

```bash
cd apps/server
pnpm run type-check
```

- [ ] **Step 3: Commit (if changed)**

```bash
git add apps/server/tsconfig.json
git commit -m "chore(server): include prisma generated types in tsconfig"
```

---

### Task 12: Run full test suite and verify

- [ ] **Step 1: Ensure database exists**

```bash
cd apps/server
pnpm exec prisma db push
```

- [ ] **Step 2: Run full test suite**

```bash
cd apps/server
pnpm test
```

Expected: All 255+ tests pass.

- [ ] **Step 3: Run type-check**

```bash
cd apps/server
pnpm run type-check
```

Expected: No errors.

- [ ] **Step 4: Test seed script**

```bash
cd apps/server
pnpm exec prisma db seed
```

Expected: Seeds successfully.

- [ ] **Step 5: Test dev server starts**

```bash
cd apps/server
pnpm dev
```

Expected: Server starts on port 3333, connects to DB successfully.

- [ ] **Step 6: Final commit (if any remaining changes)**

```bash
git add -A
git commit -m "chore(server): complete prisma v7 migration"
```

---

## Review Feedback (Perplexity)

Addressed points from external review:

1. **Class casing**: `PrismaBetterSqlite3` is correct — v7 renamed from `PrismaBetterSQLite3` to `PrismaBetterSqlite3`. Verified in source: `packages/adapter-better-sqlite3/src/index.ts` exports `PrismaBetterSqlite3`.
2. **`better-sqlite3` direct dep**: Already included in Task 1 install command.
3. **`file:` prefix for SQLite URL**: Existing env files already use `file:./ouitransfer.db`. No issue.
4. **Version >= 7.3.0**: Applied — pins to `>=7.3.0` to avoid SQLite 3.51.0 bug and enum `@map` regression.
5. **CI `prisma generate`**: Non-issue — CI runs `pnpm install --frozen-lockfile` which triggers `postinstall` → `prisma generate`.
6. **Seed.js ESM**: Already uses `import` syntax. Project has `"type": "module"`. No issue.
7. **`prisma.config.ts` location**: Already at `apps/server/prisma.config.ts`, CLI runs from `apps/server/`. No issue.

## Execution Notes

- **Task 4 is the decision point**: If `@prisma/client` v7 re-exports from the generated location, most import changes are unnecessary. If not, we need the relative path updates.
- **Tasks 1-3 are sequential** (each depends on the previous).
- **Tasks 4-6** can be batched into a single agent (all are mechanical import/instantiation updates).
- **Tasks 8, 10** can be batched (both remove `--skip-generate`).
- **Task 12** is the verification gate — must pass before marking TD-6 as done.
