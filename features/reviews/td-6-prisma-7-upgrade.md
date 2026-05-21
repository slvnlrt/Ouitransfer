# TD-6 Prisma 7 Migration — Spec Compliance Review

## Summary
The migration largely matches the spec and plan: all 7 documented breaking changes were applied, all 9 source-file import sites were updated, the driver-adapter pattern is in place, Justfile/server-start.sh dropped `--skip-generate`, and the test suite passes (439 server tests). However, the implementation diverged from the spec in three justified ways (generated output path, type-import strategy, seed runner) and in one **unjustified, runtime-breaking way**: `prisma.config.ts` is not shipped to the deployed Docker image, which makes `prisma db push` (run at container startup) fail with `The datasource.url property is required in your Prisma config file when using prisma db push`. This is a critical bug that the spec-required check on Breaking Change #5 should have caught.

A companion code-quality review already exists at `features/reviews/td-6-prisma-7-quality.md`; this report focuses strictly on spec/plan compliance and does not re-litigate the quality findings there.

## Spec Coverage

| # | Spec Requirement | Implemented? | Notes |
|---|------------------|--------------|-------|
| BC #1 | Driver adapter (`PrismaBetterSqlite3`) wraps `new PrismaClient()` | **Yes** | `src/shared/prisma.ts:4-8`, `prisma/seed.js:6-9`, `infra/check-missing.js:10-13` |
| BC #2 | Generator block `prisma-client-js` → `prisma-client` + `output` | **Yes** (with path change) | `schema.prisma:2-3`. Spec said `./generated/prisma`, impl uses `../src/generated/prisma`. Deliberate (commit `62f0c20`) to keep generated client under `rootDir: ./src` without widening tsconfig — justified. |
| BC #3 | Import path migration from `@prisma/client` | **Yes** | All 9 files updated to `../...src/generated/prisma/client.js`. Plan's "decision" to *keep* `@prisma/client` for type-only imports was abandoned — correctly, since v7's `@prisma/client` package no longer functions as a direct entrypoint (`ERROR: Cannot find module '.prisma/client/default'` when imported). Plan was wrong; implementation was right. |
| BC #4 | `prisma.config.ts` expansion (schema, migrations, datasource.url) | **Yes** | `prisma.config.ts:1-13`. Uses `process.env.DATABASE_URL ?? "file:./prisma/ouitransfer.db"` instead of the spec's `env("DATABASE_URL")` — functionally equivalent since `dotenv/config` is imported, plus a fallback. Acceptable deviation. |
| BC #5 | `url = env("DATABASE_URL")` removed from `schema.prisma` datasource | **Yes** | `schema.prisma:6-8`. **But this creates the critical runtime failure below — once removed from the schema, the URL is *only* readable via `prisma.config.ts`, which is not shipped in the deploy bundle.** |
| BC #6 | `--skip-generate` removed from `db push` calls | **Yes** | `Justfile:121` and `infra/server-start.sh:65,70`. Grepped repo — zero remaining occurrences in code/scripts. |
| BC #7 | `postinstall: prisma generate` retained as explicit | **Yes** | `package.json:25`. |
| Seed | `prisma/seed.js` updated to adapter pattern + new import path | **Yes** (with runner change) | `prisma/seed.js:1-9`. Plan said `node prisma/seed.js` would work; impl correctly switched to `tsx prisma/seed.js` because Prisma 7 emits `.ts` files only (no `client.js`). Verified: `node prisma/seed.js` fails with `ERR_MODULE_NOT_FOUND: Cannot find module .../src/generated/prisma/client.js`. Justified divergence. |
| Files | All 9 project files in spec section "10 files affected" updated | **Yes** | Diff confirms: `shared/prisma.ts`, `scripts/reset-password.ts`, `modules/auth-providers/types.ts`, `modules/user/repository.ts`, `modules/audit/service.ts`, `modules/reverse-share/upload.service.ts`, `modules/share/service.ts`, `modules/share/repository.ts`, `modules/auth-providers/user-linking.service.ts`, `utils/file-name-generator.ts`. (Spec said "10 files" but listed 9; count is consistent.) |
| `reset-password.ts` refactor | Use shared `prisma` instance instead of `new PrismaClient()` | **Yes** | `src/scripts/reset-password.ts:4` — clean refactor. |
| `.gitignore` for generated client | Added | **Yes** (path adjusted) | `.gitignore:60-61` ignores `apps/server/src/generated/` (consistent with the path relocation in commit `62f0c20`). |
| New deps | `@prisma/adapter-better-sqlite3`, `better-sqlite3`, `dotenv` added | **Yes** | `package.json:57,62,63`. `@types/better-sqlite3` in devDeps as planned. |
| Plan Task 11 | `tsconfig.json` widened to include generated client | **Not needed** | Implementation chose to move the generated client *under* `src/` (commit `62f0c20`) rather than widening `rootDir`. Tsconfig is unchanged. Either approach is valid; this one keeps tsconfig minimal. |
| Docker | Build tools for native modules, `npm rebuild better-sqlite3`, generate post-deploy | **Yes** | `Dockerfile:44-45,69-70`. Plan didn't anticipate `npm rebuild`; impl correctly added it after observing prebuild mismatches. |
| Out-of-scope additions | `prisma` and `tsx` moved to `dependencies`; `infra/check-missing.js` rewritten from CJS to ESM with adapter; knip.json updated; `tsx` used in `server-start.sh` for `seed.js` and `check-missing.js`; Justfile `clean` recipe updated | **Yes, justified** | None of these were in the spec/plan, but all are necessary consequences of the v7 behaviour (TS-only client + need for `tsx` at runtime). Scope creep is legitimate. |

## Findings

### Critical

- [x] **`prisma.config.ts` is not included in the deployed package, causing `prisma db push`/`migrate deploy` to fail at Docker container startup.** Verified by:
  1. `apps/server/package.json:18-23` `files` field lists `["dist", "prisma", "reset-password.sh", "src/scripts"]` — **`prisma.config.ts` is not listed**.
  2. `pnpm pack` of `apps/server` confirms `prisma.config.ts` is absent from the tarball.
  3. `pnpm deploy --prod` (which uses the same `files` semantics) produces a deploy directory containing `dist/`, `prisma/`, `src/`, `reset-password.sh`, `package.json` — **no `prisma.config.ts`**.
  4. Reproduced the failure in an isolated directory: `node prisma/build/index.js db push --schema=./prisma/schema.prisma` (with `DATABASE_URL` env set) returns `Error: The datasource.url property is required in your Prisma config file when using prisma db push.` This is *exactly* the command run by `infra/server-start.sh:65` and `:70` at container startup.

  Why it slipped through:
  - Spec Breaking Change #5 says `url = env("DATABASE_URL")` is removed from the schema and "lives in `prisma.config.ts` now". Correct — but the spec did not verify that `prisma.config.ts` is reachable from every place a Prisma CLI command is invoked.
  - Local testing works because dev runs from `apps/server/` (CWD has `prisma.config.ts`).
  - The Docker build's `RUN node node_modules/prisma/build/index.js generate` at line 70 happens to succeed because `prisma generate` doesn't require the datasource URL (verified). So the build green-lights successfully.
  - Tests pass because Vitest runs from `apps/server/` and uses the env loader for `DATABASE_URL`, not the Prisma CLI.
  - The failure only manifests at runtime when the container starts. Unless someone ran `docker compose up` end-to-end on a fresh DB, this would not be caught.

  **Fix options:**
  1. Add `"prisma.config.ts"` to the `files` array in `apps/server/package.json`. Simplest, smallest change.
  2. Alternatively, pass `--url="$DATABASE_URL"` to every `prisma db push` / `migrate deploy` call in `server-start.sh`. The `--url` flag bypasses the config-file requirement (verified working). Recommended belt-and-suspenders alongside option 1.
  3. Optionally, restore `url = env("DATABASE_URL")` in `schema.prisma` as a fallback — but this contradicts Prisma 7's preferred direction.

### Important

- [x] **Docs site still references `prisma generate --schema=...` from the repo root, which now requires `prisma.config.ts` to be loadable.** `apps/docs/content/docs/v3-beta/manual-installation.mdx:163,177,246,247` and `password-reset-without-smtp.mdx:129`. With Prisma 7, `prisma generate` from `D:\Code\Ouitransfer` (repo root) still loads `apps/server/prisma.config.ts` only if invoked from `apps/server/`. Running `pnpm exec prisma generate --schema=apps/server/prisma/schema.prisma` from the repo root in the documented workflow now fails to load the config (Prisma searches `process.cwd()` for the config file, not the schema's directory). For `generate` this is benign because no datasource URL is needed. For `prisma migrate deploy --schema=apps/server/prisma/schema.prisma` at line 177/247 — this *will* fail with the same datasource-required error. The manual-installation doc walks users through commands that now don't work. **Fix:** rewrite the docs to instruct users to `cd apps/server` before each Prisma command, or replace with `pnpm --filter ouitransfer-api exec prisma ...`.

- [x] **`apps/server/reset-password.sh:70` checks the wrong location for "Prisma client present"** — `[ -d "node_modules/@prisma/client" ] && [ -f "node_modules/@prisma/client/index.js" ]`. With v7, the generated client lives at `src/generated/prisma/`, not in `node_modules/@prisma/client`. The check still happens to pass because the `@prisma/client` runtime package still exists in node_modules (it's a peer-style runtime), so `ensure_prisma()` never enters its regen branch — silently doing nothing rather than catching a missing client. This is pre-existing behaviour drift, not new bug, but the spec and plan explicitly listed `reset-password.ts` as needing migration without considering the bash wrapper that drives it. **Fix:** check `[ -f "src/generated/prisma/client.ts" ]` instead, or remove the check and let `tsx` fail with a clear `ERR_MODULE_NOT_FOUND` if the client is genuinely missing.

- [x] **Plan Task 4 contained a wrong "decision" that the implementation correctly overrode, but this was not documented.** The plan (lines 245-249) concluded: "the `@prisma/client` package in v7 still works as an import path … we may not need to change import paths at all". This is empirically false — v7's `@prisma/client` cannot be imported directly (verified: `Cannot find module '.prisma/client/default'`). The implementer ignored the plan and used relative paths to the generated client, which was correct. The plan was never updated to reflect the discovered reality. Anyone reading the plan today would see contradictory guidance. **Fix:** add a "Plan deviations" section to `features/plans/td-6-prisma-7-migration.md` documenting (a) `output` path moved to `../src/generated/prisma/`, (b) `node` → `tsx` for seed/check-missing, (c) `@prisma/client` direct import does not work — relative paths required. Alternatively, prune the plan now that the migration is done.

### Minor

- [x] **Spec lists "10 files affected" in Breaking Change #3 but only enumerates 9.** `features/specs/td-6-prisma-7-upgrade.md:68` says "10 files affected" but the bullet list has 9 entries (`shared/prisma.ts`, `scripts/reset-password.ts`, plus 7 type-only imports). The implementation correctly touched the 9 files. Cosmetic spec error — fix the count.

- [x] **Spec's example in Breaking Change #3 uses path `../prisma/generated/prisma/client`** (line 62-64) — this is now stale, since the implementation chose `../src/generated/prisma/client.js` and gitignores `apps/server/src/generated/`. The spec was never updated. Low impact (spec is historical now), but if it remains as living documentation, it should be corrected to match reality.

- [x] **Spec's `prisma.config.ts` example (line 92-99) uses `env("DATABASE_URL")` and the implementation uses `process.env.DATABASE_URL ?? "<fallback>"`.** Both work; the fallback is a small improvement. Not a bug, but worth noting that the spec was not followed verbatim. The `env()` helper from `prisma/config` is exported (verified) and slightly more idiomatic for Prisma 7; either pattern is defensible.

- [x] **`apps/server/.env.development` is the actual dev env file, but `prisma.config.ts:1` does `import "dotenv/config"` which only loads `.env`** (not `.env.development`). Since the fallback URL exists, this is silent — but it means the spec's Breaking Change #6 ("Must add `import 'dotenv/config'`") is satisfied in letter but not in spirit; the import currently loads nothing in dev. (Also flagged in the quality review.) Spec did not specify which file should be loaded — minor spec gap.

- [x] **No spec/plan acknowledgement of pnpm 10's `onlyBuiltDependencies` approval gate for native modules.** pnpm 10 by default refuses to run install scripts for native packages unless approved. `better-sqlite3` happens to work locally (verified `.node` binary is built) and the Dockerfile compensates with explicit `npm rebuild`. But there's no `onlyBuiltDependencies: [better-sqlite3]` in `pnpm-workspace.yaml` or `.npmrc`, so on a fresh clone with a different pnpm config, install could silently produce a non-functional `better-sqlite3`. Worth a one-line addition to `pnpm-workspace.yaml`.

- [ ] **Spec's "NOT Affected" section (line 117) claims "No `prisma.$use()` middleware".** Verified accurate — grepped for `\$use` in `apps/server/src/`, no matches. Good.

## Assessment

**Spec compliant?** **With fixes** — the critical `prisma.config.ts`-missing-in-Docker bug must be addressed before the migration is truly done. Everything else is either justified deviation (deliberate, correct engineering judgment) or minor documentation drift.

**Reasoning:** The implementation faithfully executed every breaking change listed in the spec and every file in the plan's file map. The four undocumented deviations (output path, `@prisma/client` import strategy, `tsx` for seed runner, `npm rebuild` step) are all correct responses to v7's real behaviour, which the spec and plan got wrong in places. The implementer's judgment exceeded the plan's accuracy — a good sign.

The single critical issue is that Breaking Change #5 (removing `url = env("DATABASE_URL")` from the schema) makes `prisma.config.ts` the *only* source of the datasource URL for CLI commands, but no one checked that `prisma.config.ts` actually reaches the Docker container. It does not. The migration passes tests, passes type-check, builds Docker images successfully, and would fail on first container start with a confusing error. The spec should have included a "verify CLI invocations resolve datasource URL in every deployment context" step; the plan should have grep'd the `files` field. Neither did.

Once the critical finding is fixed (one-line `files` array addition, plus optionally a defensive `--url=` in `server-start.sh`), and the docs site is reconciled with the new Prisma 7 CLI behaviour, this migration is complete and spec-compliant.
