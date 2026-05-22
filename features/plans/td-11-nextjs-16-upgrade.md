# TD-11 — Next.js 15 → 16 Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Next.js from 15.5.18 to 16.x across both `apps/web` and `apps/docs`.

**Architecture:** Version bumps in pnpm catalog + package-level deps, minor code changes (proxy rename, config promotion, cookies fix), then full verification (type-check, tests, build, smoke test).

**Tech Stack:** Next.js 16, React 19, next-intl 4.x, fumadocs 15.x, pnpm catalogs, Turbopack (now default in dev)

**Spec:** `features/specs/td-11-nextjs-16-upgrade.md`

---

## File Map

| File | Change |
|------|--------|
| `pnpm-workspace.yaml` | Bump `next`, `react`, `react-dom` catalog versions |
| `apps/web/package.json` | Bump `@next/bundle-analyzer` |
| `apps/web/next.config.ts` | Move `serverActions` out of `experimental` |
| `apps/web/src/middleware.ts` | Rename to `proxy.ts`, rename export |
| `apps/web/src/i18n/request.ts` | Consolidate `cookies()` await |
| `apps/docs/package.json` | Bump `fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx` |

---

### Task 1: Pre-Upgrade Baseline

Ensure the working tree is clean and current tests pass before making changes.

**Files:** None modified

- [ ] **Step 1: Verify clean working tree**

Run: `git status`
Expected: Clean working tree, no uncommitted changes.

- [ ] **Step 2: Run web tests to establish baseline**

Run: `pnpm --filter ouitransfer-web test`
Expected: All tests pass (current count: ~221 tests).

- [ ] **Step 3: Run web type-check baseline**

Run: `pnpm --filter ouitransfer-web type-check`
Expected: No type errors.

---

### Task 2: Version Bumps

Update Next.js and related packages across the monorepo.

**Files:**
- Modify: `pnpm-workspace.yaml` — `next`, `react`, `react-dom` catalog entries
- Modify: `apps/web/package.json` — `@next/bundle-analyzer`
- Modify: `apps/docs/package.json` — `fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx`

- [ ] **Step 1: Bump Next.js and React in pnpm catalog**

In `pnpm-workspace.yaml`, update the catalog entries:

```yaml
# Before:
  next: "15.5.18"
  react: "^19.1.0"
  react-dom: "^19.1.0"

# After:
  next: "^16.0.0"
  react: "^19.2.0"
  react-dom: "^19.2.0"
```

React bump is required because fumadocs 16.x requires `react: '^19.2.0'`.

- [ ] **Step 2: Bump @next/bundle-analyzer**

In `apps/web/package.json`, update the devDependency:

```json
// Before:
"@next/bundle-analyzer": "^15.3.3",

// After:
"@next/bundle-analyzer": "^16.0.0",
```

- [ ] **Step 3: Bump fumadocs packages for docs app**

In `apps/docs/package.json`, update these dependencies:

```json
// Before:
"fumadocs-core": "15.2.7",
"fumadocs-mdx": "11.6.10",
"fumadocs-ui": "15.2.7",

// After:
"fumadocs-core": "16.4.3",
"fumadocs-mdx": "13.0.8",
"fumadocs-ui": "16.4.3",
```

**Why these specific versions:**
- fumadocs-core/ui 16.4.3 = last version where `zod` peer dep is `'*'` (any version). 16.4.4+ requires `zod: '4.x.x'` which is incompatible with our zod 3.x.
- fumadocs-mdx 13.0.8 = bridge version supporting both `next: '^15.3.0 || ^16.0.0'` and `fumadocs-core: '^15.0.0 || ^16.0.0'`.
- If these exact versions cause issues, try fumadocs-core/ui 16.2.2 (no zod peer dep at all) as a fallback.

- [ ] **Step 4: Run pnpm install**

Run: `pnpm install`

Expected: Lockfile updates. Watch for:
- Peer dependency warnings (especially from `next-intl`, `fumadocs-*`)
- Resolution failures

If `next-intl` resolves to a version older than 4.12, run `pnpm update next-intl` to ensure proxy.ts support.

- [ ] **Step 5: Verify resolved versions**

Run: `pnpm ls next next-intl next-themes @next/bundle-analyzer react react-dom --filter ouitransfer-web --depth 0`
Run: `pnpm ls next fumadocs-core fumadocs-mdx fumadocs-ui react react-dom --filter ouitransfer-docs --depth 0`

Expected: `next` resolves to 16.x in both apps, `react`/`react-dom` to 19.2.x. Note the exact versions for the commit message.

- [ ] **Step 6: Commit version bumps**

```
git add pnpm-workspace.yaml apps/web/package.json apps/docs/package.json pnpm-lock.yaml
git commit -m "chore: bump next 15→16, react 19.1→19.2, fumadocs 15→16, bundle-analyzer 15→16"
```

---

### Task 3: next.config.ts — Promote serverActions Out of experimental

The `serverActions` config was promoted to stable in Next.js 14. Our config still has it under `experimental`, which Next.js 16 may warn about or ignore.

**Files:**
- Modify: `apps/web/next.config.ts:68-72`

- [ ] **Step 1: Move serverActions to top-level**

In `apps/web/next.config.ts`, change:

```typescript
// Before:
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  images: {
    remotePatterns: process.env.ALLOWED_IMAGE_HOSTS
      ? parseImageHosts(process.env.ALLOWED_IMAGE_HOSTS)
      : DEFAULT_IMAGE_PATTERNS,
  },
  serverExternalPackages: [],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

// After:
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  images: {
    remotePatterns: process.env.ALLOWED_IMAGE_HOSTS
      ? parseImageHosts(process.env.ALLOWED_IMAGE_HOSTS)
      : DEFAULT_IMAGE_PATTERNS,
  },
  serverExternalPackages: [],
  serverActions: {
    bodySizeLimit: "50mb",
  },
};
```

Note: The entire `experimental` key is removed since `serverActions` was the only property in it.

- [ ] **Step 2: Verify the config compiles**

Run: `pnpm --filter ouitransfer-web type-check`
Expected: No errors. If `serverActions` is not recognized at the top level in the NextConfig type, check the Next.js 16 types — it may still need to be under `experimental` in 16.x. If so, revert this change.

- [ ] **Step 3: Commit**

```
git add apps/web/next.config.ts
git commit -m "chore(web): promote serverActions out of experimental"
```

---

### Task 4: Middleware → Proxy Rename

Next.js 16 renames `middleware.ts` to `proxy.ts`. The old name is deprecated but still works. We rename now to follow the recommended pattern.

**Files:**
- Rename: `apps/web/src/middleware.ts` → `apps/web/src/proxy.ts`

- [ ] **Step 1: Rename the file**

```powershell
git mv apps/web/src/middleware.ts apps/web/src/proxy.ts
```

- [ ] **Step 2: Rename the export function**

In `apps/web/src/proxy.ts`, change the function name:

```typescript
// Before (line 112):
export async function middleware(request: NextRequest) {

// After:
export async function proxy(request: NextRequest) {
```

No other changes needed in this file:
- `NextRequest` and `NextResponse` types are unchanged in Next.js 16
- `config.matcher` export format is unchanged
- No `skipMiddlewareUrlNormalize` is used (no rename needed)
- No `NextMiddleware` type is used (no rename needed)

- [ ] **Step 3: Verify no other files import middleware.ts**

Run: `rg "middleware" apps/web/src/ --include "*.ts" --include "*.tsx" -l`

If any files import from `@/middleware` or `./middleware`, update the import paths. Based on research, no files import the middleware directly — it's auto-discovered by Next.js from the `src/` root.

- [ ] **Step 4: Commit**

```
git add apps/web/src/proxy.ts
git commit -m "chore(web): rename middleware.ts → proxy.ts for next.js 16"
```

---

### Task 5: Fix cookies() Await in request.ts

The `cookies()` call in `apps/web/src/i18n/request.ts` uses a two-step pattern that should be consolidated.

**Files:**
- Modify: `apps/web/src/i18n/request.ts:34-35`

- [ ] **Step 1: Consolidate the cookies() call**

In `apps/web/src/i18n/request.ts`, change:

```typescript
// Before (lines 33-36):
export default getRequestConfig(async ({ locale }) => {
  const cookieStore = cookies();
  const cookiesList = await cookieStore;
  const localeCookie = cookiesList.get("NEXT_LOCALE");

// After:
export default getRequestConfig(async ({ locale }) => {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("NEXT_LOCALE");
```

The intermediate `cookiesList` variable is removed. `cookies()` returns a `Promise<ReadonlyRequestCookies>` — awaiting it directly is cleaner and matches Next.js 16 expectations.

- [ ] **Step 2: Commit**

```
git add apps/web/src/i18n/request.ts
git commit -m "fix(web): await cookies() inline in i18n request config"
```

---

### Task 6: Type-Check Both Apps

Verify all TypeScript compiles cleanly after the changes.

**Files:** None modified (verification only)

- [ ] **Step 1: Type-check web app**

Run: `pnpm --filter ouitransfer-web type-check`
Expected: No errors.

Common issues to watch for:
- `NextConfig` type may not include `serverActions` at top level → move it back under `experimental` if needed
- `proxy.ts` export signature may need adjustment if Next.js 16 expects a different type
- New strict type checks introduced in Next.js 16

- [ ] **Step 2: Type-check docs app**

Run: `pnpm --filter ouitransfer-docs type-check`
Expected: No errors.

If fumadocs types conflict with Next.js 16, check for a fumadocs update:
```powershell
pnpm --filter ouitransfer-docs outdated fumadocs-core fumadocs-mdx fumadocs-ui
```

If updates are available, bump to the latest compatible versions in `apps/docs/package.json`.

- [ ] **Step 3: Fix any type errors**

Address each error individually. Common fixes:
- Import path changes
- Type signature updates
- Config shape changes

- [ ] **Step 4: Commit fixes (if any)**

```
git add -A  # stage only the specific fixed files
git commit -m "fix: resolve type errors from next.js 16 upgrade"
```

---

### Task 7: Run Tests

Verify the test suites still pass.

**Files:** None modified (verification only)

- [ ] **Step 1: Run web tests**

Run: `pnpm --filter ouitransfer-web test`
Expected: All ~221 tests pass.

If tests fail:
- Check for Next.js API changes in test mocks
- Check for Turbopack behavior differences affecting test setup
- Fix test files as needed

- [ ] **Step 2: Run server tests (regression check)**

Run: `pnpm --filter ouitransfer-server test`
Expected: All ~456 tests pass. The server doesn't depend on Next.js, but run it to confirm no shared-package regressions.

- [ ] **Step 3: Commit test fixes (if any)**

```
git add <fixed-test-files>
git commit -m "fix: update tests for next.js 16 compatibility"
```

---

### Task 8: Build Verification

Verify production builds succeed for both apps.

**Files:** None modified (verification only)

- [ ] **Step 1: Build web app**

Run: `pnpm --filter ouitransfer-web build`
Expected: Build completes without errors. Watch for:
- Turbopack build warnings (now the default bundler)
- Deprecated API warnings
- next-intl plugin compatibility issues

- [ ] **Step 2: Build docs app**

Run: `pnpm --filter ouitransfer-docs build`
Expected: Build completes without errors. Watch for:
- fumadocs-mdx plugin compatibility with Next.js 16
- MDX compilation issues under Turbopack

If the docs build fails due to fumadocs incompatibility:
1. Check `pnpm --filter ouitransfer-docs outdated fumadocs-core fumadocs-mdx fumadocs-ui`
2. Update to latest compatible versions
3. If no compatible version exists, this is a **blocker** — document it and keep docs on Next.js 15 temporarily (separate catalog entry)

- [ ] **Step 3: Commit any build fixes**

```
git add <fixed-files>
git commit -m "fix: resolve build issues from next.js 16 upgrade"
```

---

### Task 9: Dev Smoke Test

Verify development servers start correctly with Turbopack (now the default).

**Files:** None modified (verification only)

- [ ] **Step 1: Start web dev server**

Run: `pnpm --filter ouitransfer-web dev`

Expected: Server starts on port 3000 with Turbopack. You should see output mentioning Turbopack (not Webpack). Wait for the "Ready" message.

Verify:
- No startup errors or warnings
- The `proxy.ts` file is picked up (test by visiting a protected route — should redirect to `/login`)

Stop the server with Ctrl+C.

- [ ] **Step 2: Start docs dev server**

Run: `pnpm --filter ouitransfer-docs dev`

Expected: Server starts on port 3001. Wait for the "Ready" message.

Verify:
- No startup errors
- MDX content renders correctly

Stop the server with Ctrl+C.

- [ ] **Step 3: Final commit (if any remaining changes)**

If any adjustments were needed during smoke testing:
```
git add <files>
git commit -m "fix: adjustments from next.js 16 dev smoke test"
```

---

## Summary

| Task | Description | Risk | Effort |
|------|-------------|------|--------|
| 1 | Pre-upgrade baseline | None | 2 min |
| 2 | Version bumps | Low | 5 min |
| 3 | Config: serverActions promotion | Low | 2 min |
| 4 | Middleware → Proxy rename | Low | 3 min |
| 5 | cookies() await fix | None | 1 min |
| 6 | Type-check | Medium | 5-15 min |
| 7 | Run tests | Low | 5 min |
| 8 | Build verification | Medium | 10-20 min |
| 9 | Dev smoke test | Low | 5 min |

**Total estimated time:** 30-60 minutes

**Biggest risks:**
1. **fumadocs compatibility** — exact-pinned versions may not support Next.js 16. Mitigation: check for updates, or keep docs on Next.js 15 with a separate catalog entry.
2. **Turbopack as default** — some edge cases in CSS/import resolution may behave differently. Mitigation: full test suite + build verification catches most issues.
3. **next-intl plugin** — config wrapper may need adjustment. Mitigation: type-check + build catches this early.
