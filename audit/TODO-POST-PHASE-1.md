# TODO Post-Phase 1: Reviewer Follow-ups

> Phase 1 (Tooling & DX Foundation) + Phase 7 partial (security deps) reviewed 2026-04-21.
> Review identified 4 critical, 17 warning, and 9 suggestion items.
> Items marked [x] were fixed immediately. Remaining items tracked for Phase 2+.

---

## Critical (fix before any release)

- [x] **C1 — Stale per-app lockfiles** — `apps/{server,web,docs}/pnpm-lock.yaml` still committed. Docker uses them and would reinstall vulnerable packages (speakeasy, crypto-js, react-qr-reader). Per-app lockfiles deleted. Dockerfile update deferred to Phase 2 but MUST happen before any `v*` tag triggers `docker.yml`.

- [x] **C2 — E2E smoke test wrong URL** — `e2e/smoke.spec.ts:10` used `http://localhost:3333/api/health` but route is `/health` (no `/api` prefix). Fixed.

- [x] **C3 — Web port 3000 vs 5487 inconsistency** — Dev uses 3000 (`next dev -p 3000`), production uses 5487 (supervisor). Documented in CLAUDE.md. Not a bug, just needs clarity.

- [x] **C4 — Renovate pin strategy floods PRs** — `rangeStrategy: "pin"` would convert every `^x.y.z` to pinned on first run (~100 PRs). Changed to `"bump"`. Also fixed deprecated `matchPackagePatterns` → `matchPackageNames`.

---

## Warning (fix in Phase 2)

- [ ] **W1 — turbo.json: lint/type-check/test depend on ^build** — Forces unnecessary upstream builds. Remove `dependsOn: ["^build"]` from lint, and from type-check/test until shared packages exist.

- [ ] **W2 — turbo.json: no inputs/globalDependencies** — Cache invalidation too coarse. Any README change busts lint cache. Add `inputs` arrays and `globalDependencies: ["biome.json", ".node-version"]`.

- [ ] **W3 — biome.json files.includes patterns may not exclude correctly** — Test `biome check apps/web/src/components/ui/button.tsx` to verify UI components are excluded. Simplify to `"!apps/web/src/components/ui/**"`.

- [ ] **W4 — knip.json: root deps may appear unused** — `@playwright/test`, `vitest`, `turbo`, etc. only used from configs/scripts ignored by Knip. Add to `ignoreDependencies` or declare proper entry points.

- [ ] **W5 — commitlint footer-max-line-length still 100** — Auto-generated footers (Co-authored-by, BREAKING CHANGE) will warn. Consider `[0, "always"]` for footer-max-line-length.

- [ ] **W6 — pre-push hook runs full validate** — 30-60s on cold cache. Will get `--no-verify`'d. Consider dropping (CI covers it) or scoping to changed workspaces only. Also: pre-push will block ALL pushes until 31 pre-existing type errors are fixed.

- [ ] **W7 — Lefthook pre-commit glob missing yml/yaml/md** — Biome 2.x can format these. Expand glob or document exclusion.

- [ ] **W8 — Changeset `release` script is a no-op** — All packages are `private: true`. `changeset publish` does nothing. Replace with a tag-based workflow or document "version tracking only".

- [ ] **W9 — Dockerfile pnpm version drift** — Uses `corepack enable pnpm` without version pin. Should use `corepack prepare pnpm@10.6.0 --activate` to match `packageManager`.

- [ ] **W10 — CI build job doesn't depend on test** — Broken tests won't block build. Add `test` to `needs` if test gating is desired.

- [ ] **W11 — CI has no Turbo cache** — Each job does cold Turbo from scratch. Add `actions/cache` for `.turbo` or consolidate jobs.

- [ ] **W12 — TOTP token format validation missing** — `two-factor/service.ts` doesn't strip whitespace/dashes from tokens before `validate()`. Users paste `"123 456"` from authenticator apps. Add `token.replace(/[\s-]/g, '')` or validate at DTO boundary.

- [ ] **W13 — Disable 2FA requires only password, no 2FA code** — Pre-existing issue, not introduced by Phase 1. Attacker with password can bypass 2FA by disabling it. Track as security follow-up.

- [x] **W14 — `npx tsc` in all apps** — `npx` may download tsc on cold cache. Changed to `tsc --noEmit` in all 3 apps.

- [ ] **W15 — .env.example: NEXT_PUBLIC_UPLOAD_CHUNK_SIZE_MB empty** — `parseInt('', 10)` = NaN. Set a default value (e.g., `=50`).

- [ ] **W16 — Root .envrc vs per-app .env ambiguity** — Server reads from `apps/server/.env` via dotenv, root `.envrc` loads root `.env`. Mixed strategy confuses contributors. Clarify in Phase 2.

- [ ] **W17 — .gitignore malformed comments** — Line 15 has `apps/web/# Editor directories` (comment glued to path). Clean up in Phase 2 .gitignore consolidation.

---

## Suggestions (future improvements)

- [ ] **S1** — Add `"packages/*"` to pnpm-workspace.yaml now (no-op, signals Phase 2 intent)
- [ ] **S2** — Add webkit + firefox Playwright projects for cross-browser coverage
- [ ] **S3** — Consider adding vitest to each app's devDeps explicitly (currently hoisted from root)
- [ ] **S5** — Replace trivial smoke tests with real integration tests (e.g., server `buildApp()` boot, web component render with i18n)
- [ ] **S6** — Review knip.json MDX entry points — knip's MDX support may produce false positives
- [ ] **S7** — Verify no `.github/dependabot.yml` exists (would conflict with Renovate)
- [ ] **S8** — Remove `chmod +x` from Justfile (broken on Windows, redundant on Unix)
- [ ] **S9** — Commitlint scope-enum severity 1 (warning) doesn't enforce. Bump to 2 or drop.

---

## Deferred to Phase 2 (blocking for Docker releases)

- [ ] **Dockerfile multi-stage build rework** — Must switch from per-app lockfiles to workspace root lockfile. Current Dockerfile will fail after per-app lockfile deletion. MUST be done before any `v*` tag is pushed.
