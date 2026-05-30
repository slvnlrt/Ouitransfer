# TD-6 Prisma 7 Migration — Code Quality Review

## Summary
The migration from Prisma 6.11 → 7.8 is functionally correct and the test suite (661 tests) reportedly passes. The plumbing for the driver-adapter pattern, the generated-client relocation under `src/`, the Docker rebuild of native bindings, and the ESM rewrite of `infra/check-missing.js` all look sound. However, the change introduces meaningful **code duplication** (adapter init repeated four times), **inconsistent default DATABASE_URL fallbacks**, **non-standard `>=` version ranges** for new dependencies, **zero new tests** despite four new code paths instantiating Prisma differently, and **half-broken dotenv loading** (`.env` vs `.env.development`). Nothing is critical, but a handful of "important" items should be addressed before merging.

## Strengths
- **Centralised generated client output** at `apps/server/src/generated/prisma/` (`schema.prisma:3`) keeps the artifact under `rootDir: ./src` (`apps/server/tsconfig.json:7`), avoiding `outsideRootDir` TS errors. Correctly `.gitignore`d (`.gitignore:59`) and cleaned by the `just clean` recipe (`Justfile:186`).
- **Datasource URL moved to `prisma.config.ts`** is the modern Prisma 7 pattern — keeps the schema file pure and the URL configurable per environment. (`prisma.config.ts:10-12`, `schema.prisma:6-8`).
- **Refactor of `reset-password.ts`** to use the shared singleton (`apps/server/src/scripts/reset-password.ts:4`) eliminates a second PrismaClient instance and is the right direction architecturally.
- **`postinstall: prisma generate`** (`package.json:30`) keeps the dev workflow self-healing.
- **Dockerfile correctness**: `python3 make g++` added at the right stage (build stage only), `npm rebuild better-sqlite3` after `pnpm deploy --ignore-scripts` is the canonical fix for prebuild mismatches, and `prisma generate` is re-run post-deploy because `src/generated/` is intentionally excluded from the `files` field (`Dockerfile:44-45,65-70`).
- **Structural Prisma error detection** in `error-handler.ts:35-43` continues to work — no behavioural break in error mapping.
- **`@prisma/client` is still legitimately a dependency** despite no direct imports: the generated client itself imports `@prisma/client/runtime/client` at line 18 of `src/generated/prisma/client.ts`. The knip ignore (`knip.json:16`) is correct.
- **ESM rewrite of `infra/check-missing.js`** uses `fileURLToPath(import.meta.url)` properly to derive `__dirname` (`infra/check-missing.js:8`), and finally/disconnect handlers are preserved on every code path.

## Findings

### Critical
*(None.)*

### Important

- [x] **Non-standard `>=` version ranges for new runtime deps.** `apps/server/package.json:57-69` introduces `"@prisma/adapter-better-sqlite3": ">=7.3.0"`, `"@prisma/client": ">=7.3.0"`, `"prisma": ">=7.3.0"`, `"better-sqlite3": ">=8.0.0"`, `"dotenv": ">=16.0.0"`, `"@types/better-sqlite3": ">=7.0.0"`. The rest of the codebase consistently uses caret ranges (`^x.y.z`). A `>=` range silently admits future major versions on a clean install if the lockfile is regenerated. The lockfile currently pins to 7.8.0, but the ranges advertise intent — and the intent here ("any future version is fine") is wrong for a major-version-sensitive ecosystem like Prisma. **Fix:** convert to `^7.8.0` / `^12.10.0` / `^17.x` / `^7.x` for the matching `@types/*`. This is one of the most visible inconsistencies in the diff.

- [x] **Adapter+URL boilerplate duplicated four times.** The same six-line block (`new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/ouitransfer.db" })` followed by `new PrismaClient({ adapter })`) appears in:
  - `apps/server/src/shared/prisma.ts:4-8`
  - `apps/server/prisma/seed.js:6-9`
  - `infra/check-missing.js:10-13`
  - and a parallel URL fallback in `apps/server/prisma.config.ts:11`
  
  Worse, the **default fallback string differs** from the env schema: `shared/prisma.ts` uses `"file:./prisma/ouitransfer.db"` (cwd-relative) while `apps/server/src/env.ts:22` defaults to `"file:/app/server/prisma/ouitransfer.db"` (absolute Docker path). If `DATABASE_URL` is ever unset, the runtime and the validator disagree on which DB file to open — a silent footgun.
  
  **Fix:** export a tiny helper from `@ouitransfer/shared` (or a server-internal module reachable from JS) such as `function createPrismaClient(): PrismaClient` that returns a ready-made client. The JS callers (`seed.js`, `check-missing.js`) can import it directly; the TS caller (`shared/prisma.ts`) becomes a one-line re-export. At minimum, hoist the default URL to a single constant and use it everywhere (including aligning with `env.ts`).

- [x] **No tests added for any of the four new Prisma initialisation sites.** The migration touches `shared/prisma.ts`, `seed.js`, `check-missing.js`, and `prisma.config.ts`, plus changes how every module imports types. None of this is covered by a new test. The 661-passing-tests claim relies entirely on tests written against the v6 client transparently passing because the public API is compatible. That's likely true *today*, but there is no regression net for:
  - Adapter initialisation failures (e.g., missing native binding on Alpine).
  - The seed script booting under `tsx`.
  - `check-missing.js` running standalone with no `DATABASE_URL` in env.
  - The new error message shape if Prisma 7 changes error names (the `isPrismaKnownRequestError` structural check in `error-handler.ts:35-43` is fragile).
  
  **Fix:** at minimum add (a) a smoke test that `import { prisma } from "../shared/prisma.js"` resolves without throwing, (b) one integration test using `app.inject()` that exercises a Prisma-error path (e.g., unique constraint violation → 409) to lock in `isPrismaKnownRequestError` against the v7 error shape.

- [x] **`prisma.config.ts` calls `import "dotenv/config"` but no `.env` file exists** in the repo — only `.env.development` (`apps/server/.env.development` exists, `.env` does not). The import therefore loads nothing and the fallback URL is used whenever a developer runs `prisma db push` directly (i.e., outside of `just`, which itself sets `dotenv-path := "apps/server/.env.development"` in `Justfile:5`). The import looks defensive but is effectively a no-op locally. **Fix:** either use `dotenv.config({ path: ".env.development" })` with an explicit path (and document that prod relies on real env vars), or drop the import and document that DATABASE_URL must be set by the invoker.

- [x] **No error handling around adapter construction.** All four `new PrismaBetterSqlite3({ url })` calls assume the native binding loads successfully. If `better-sqlite3` fails to load (UID mismatch, Alpine glibc/musl mismatch, missing prebuild), the failure surfaces as a cryptic stack trace at import time, before any logger is initialised. **Fix:** wrap in try/catch in `shared/prisma.ts` and emit a single, actionable error message (`"better-sqlite3 native binding failed to load — did you forget to run 'npm rebuild better-sqlite3' after copying node_modules?"`).

### Minor

- [x] **Stale check in `apps/server/reset-password.sh:70`**: `if [ -d "node_modules/@prisma/client" ] && [ -f "node_modules/@prisma/client/index.js" ]` is now misleading — Prisma 7 generates the client to `src/generated/prisma/`, not into `node_modules/@prisma/client`. The check happens to still pass because `@prisma/client/index.js` still ships in the runtime package, but it no longer validates what its comment implies ("Prisma client exists and is valid"). **Fix:** check for `src/generated/prisma/client.ts` instead, or drop the check.

- [x] **`seed.js` backup path mismatch.** `Dockerfile:107` copies `seed.js` to `/app/server/prisma/seed.js` as a "bind mount backup", but the file imports `../src/generated/prisma/client.js` (`seed.js:4`). From `/app/server/prisma/`, that path resolves to `/app/server/src/generated/prisma/client.js` — which does not exist (the generated client only exists under `/app/ouitransfer-app/src/generated/prisma/`). If anyone ever runs the backup copy directly (which is the stated rationale for keeping it), it will crash. The runtime path used by `server-start.sh` is the in-bundle copy, so this is dormant — but the backup serves no functional purpose any more.
  
  **Fix:** either remove the backup `COPY` (`Dockerfile:106-107`) and the accompanying `cp` lines in `server-start.sh:50-60` that try to populate `/app/server/prisma/seed.js`, or make the backup actually executable from its target location (which would require also shipping the generated client to `/app/server/`).

- [x] **Magic path literal repeated.** The URL `"file:./prisma/ouitransfer.db"` appears verbatim in `shared/prisma.ts:5`, `seed.js:7`, `check-missing.js:11`, `prisma.config.ts:11`. Same comment as the duplication finding above — at least make it a constant.

- [x] **`apps/server/.gitignore` is not updated**, only the root `.gitignore`. The root entry `apps/server/src/generated/` works because git evaluates ignores from the repo root. Functional, but a contributor expecting per-package `.gitignore` may be confused. Low priority.

- [x] **Comment in `Dockerfile:96-97` is partially incorrect:** "Also kept in /app/infra/ as source for persistent /app/server/prisma/ copies" — but `server-start.sh` copies *from* `/app/infra/` *into* `/app/server/prisma/`. The phrasing reads as if `/app/infra/` is a destination. **Fix:** rephrase to "Also kept in /app/infra/ as the source for first-run copy into the data volume at /app/server/prisma/".

- [x] **`infra/check-missing.js` has no shebang** (it used to be CJS run via `node`, now it's an ESM file run via `tsx`). Not strictly required since it's always invoked explicitly, but adding `#!/usr/bin/env node` for consistency with `src/scripts/reset-password.ts:1` would not hurt. Truly minor.

- [x] **`@types/better-sqlite3` is in devDependencies but `better-sqlite3` is in dependencies** — correct, but the `>=7.0.0` vs `>=8.0.0` mismatch on the runtime range is sloppy. The DefinitelyTyped major usually trails the package; pinning `@types/better-sqlite3` to `^7.6.x` is fine but the inconsistency is jarring next to `"better-sqlite3": ">=8.0.0"`.

- [x] **`knip.json` adds `dotenv` to the root workspace `ignoreDependencies`** (`knip.json:11`) — but `dotenv` is only a server dep, not a root dep. The line works because root knip can't otherwise see it. Cleaner to add it under `apps/server.ignoreDependencies` alongside `@prisma/client`. Defensive, not broken.

## Recommendations

1. **Promote the adapter+URL pattern to a small factory.** Create `apps/server/src/shared/create-prisma-client.ts` (or, since JS callers need it too, a `.js` sibling) that returns `new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: DATABASE_URL_DEFAULT }) })`. Import it from all four sites. Hoist `DATABASE_URL_DEFAULT` to a constant shared with `env.ts` so the two defaults can never drift.

2. **Tighten version ranges.** Replace every `>=x.y.z` with `^x.y.z`. This is a five-minute cleanup but it eliminates an entire class of "works on my machine after a clean install" surprises.

3. **Add a minimal Prisma 7 integration test.** One `app.inject()` test that triggers `P2002` (unique-constraint violation) on a user create → expects 409 with `code: UNIQUE_CONSTRAINT`. This locks in the structural `isPrismaKnownRequestError` check against v7. Cost: ~30 lines of test code. Value: high — it's the only thing in `error-handler.ts:35-43` that could silently regress on a future Prisma update.

4. **Decide whether the `/app/server/prisma/seed.js` "backup" is real or dead code.** If it's dead, delete the `COPY` and the corresponding `cp` calls. If it's meant to be runnable, the generated-client path needs to resolve from there too.

5. **Document the dev-mode `DATABASE_URL` story** in `apps/server/README.md` or `features/specs/td-6-prisma-7-upgrade.md`. Right now the rules are: Justfile loads `.env.development`; `tsx --env-file` loads it in `dev`; `prisma.config.ts` tries `.env` (which does not exist); the fallback path differs from the env schema default. This is a maze and any of those defaults moving in isolation will cause confusing behaviour.

6. **Consider migrating server-start.sh from `prisma db push` to `prisma migrate deploy`.** The repo *has* migrations under `apps/server/prisma/migrations/`, but production uses `db push`, which ignores them. This is pre-existing (not introduced by TD-6), but the migration is a natural moment to revisit it — Prisma 7 doubles down on the migration workflow.

## Assessment

**Ready to merge?** **With fixes** — none of the findings are blocking, but at least the four "Important" items (version ranges, adapter duplication / default-URL drift, missing integration test, dotenv no-op) deserve a follow-up commit before this is considered "perfect implementation, zero technical debt" per `CLAUDE.md`. Everything else can land as minor polish.

**Reasoning:** The migration itself is solid: schema, generator location, Docker native-binding handling, ESM rewrite of `check-missing.js`, and the refactor of `reset-password.ts` are all done correctly. What's missing is the discipline layer that the rest of this codebase has consistently shown: no `>=` ranges, no duplicated init blocks with subtly different defaults, no behavioural changes without at least one new test pinning the new behaviour. The work is 80% complete; the remaining 20% is the part that distinguishes a working migration from a finished one.
