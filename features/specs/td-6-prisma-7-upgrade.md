# TD-6 — Prisma 6 → 7 Upgrade

## Overview

Prisma 7 is a major release that removes the Rust query engine in favor of Node.js-native driver adapters. This changes how PrismaClient is imported, instantiated, and configured.

**Current state:** Prisma 6.11.0 (`@prisma/client` + `prisma` devDep)
**Target:** Prisma 7.x (latest stable)
**Database:** SQLite
**No automated migration tools exist.** Prisma provides only a manual upgrade guide and an AI-agent prompt document.

## Breaking Changes (Impact on Ouitransfer)

### 1. Driver Adapter Required

`new PrismaClient()` no longer works. Must provide a driver adapter.

**Before:**
```ts
const prisma = new PrismaClient();
```

**After:**
```ts
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
```

**Files affected:** `src/shared/prisma.ts`, `src/scripts/reset-password.ts`, `prisma/seed.js`

### 2. Generator Block Change

**Before:**
```prisma
generator client {
  provider = "prisma-client-js"
}
```

**After:**
```prisma
generator client {
  provider = "prisma-client"
  output   = "./generated/prisma"
}
```

- `provider` renamed from `prisma-client-js` to `prisma-client`
- `output` is now **required** — client generated to a local path, no longer in `node_modules`

### 3. Import Path Change

**Before:**
```ts
import { PrismaClient } from "@prisma/client";
import type { User } from "@prisma/client";
```

**After:**
```ts
import { PrismaClient } from "../../generated/prisma/client.js";
import type { User } from "../../generated/prisma/client.js";
```

The path is relative to the consuming file and depends on the `output` field in the generator block. Example above is from a file at `src/modules/X/` depth (two levels up to `src/generated/prisma/client.js`).

**9 files affected** (all in `apps/server/src/`):
- `shared/prisma.ts` — `PrismaClient`
- `scripts/reset-password.ts` — `PrismaClient`
- `modules/auth-providers/types.ts` — `type AuthProvider`
- `modules/user/repository.ts` — `type User`
- `modules/audit/service.ts` — `type AuditLog`
- `modules/reverse-share/upload.service.ts` — `type Prisma`
- `modules/share/service.ts` — `type Prisma`
- `modules/share/repository.ts` — multiple named exports
- `modules/auth-providers/user-linking.service.ts` — `type Prisma`
- `utils/file-name-generator.ts` — `type Prisma`

### 4. `prisma.config.ts` Expansion

Already exists at `apps/server/prisma.config.ts` with seed config only. Must add `datasource.url`.

**Before:**
```ts
import { defineConfig } from "prisma/config";
export default defineConfig({ seed: "node prisma/seed.js" });
```

**After:**
```ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "node prisma/seed.js" },
  datasource: { url: env("DATABASE_URL") },
});
```

> **Implementation note:** The actual implementation uses `process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL` with an explicit fallback constant instead of `env("DATABASE_URL")`. This is functionally equivalent — both read the `DATABASE_URL` environment variable — but the fallback avoids a startup error when `DATABASE_URL` is unset in local development.

### 5. Datasource Block Simplified

`url = env("DATABASE_URL")` removed from `schema.prisma` — lives in `prisma.config.ts` now.

### 6. Env Vars No Longer Auto-Loaded

Must add `import "dotenv/config"` in `prisma.config.ts`. Runtime code already handles this via Fastify's env loading.

### 7. `postinstall` Script Removed

`prisma generate` no longer runs automatically on install or after migrations. The `"postinstall": "prisma generate"` script in `package.json` should be kept (it's explicit, not the removed implicit behavior).

### 8. Seed File Update

`prisma/seed.js` imports `PrismaClient` from `@prisma/client` and must switch to the new import path + adapter pattern.

## NOT Affected

- **No `prisma.$use()` middleware** — nothing to migrate
- **No MongoDB** — SQLite only, no blockers
- **ESM already configured** — `"type": "module"` present, ESM imports with `.js` extensions
- **Node.js 24** — exceeds minimum 20.19

## New Dependencies

| Package | Purpose |
|---------|---------|
| `@prisma/adapter-better-sqlite3` | SQLite driver adapter (required) |
| `dotenv` | Explicit env loading for `prisma.config.ts` |

## Risk Assessment

- **Low risk** — the codebase has clean Prisma usage (no middleware, no exotic patterns)
- **Mechanical migration** — import paths + instantiation pattern, no logic changes
- **Test suite validates** — 426 server tests cover all DB-touching code
- **.gitignore update needed** — `prisma/generated/` should be in `.gitignore`

## Decisions

1. **Output path:** `./generated/prisma` (relative to schema location = `apps/server/prisma/generated/prisma/`)
2. **Import alias:** Use relative paths (no tsconfig path alias — keeps consistency with existing codebase)
3. **Seed file:** Keep as `.js` — just update imports and add adapter
