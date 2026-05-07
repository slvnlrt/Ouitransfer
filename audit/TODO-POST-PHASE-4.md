# Phase 4 — Post-Review Follow-ups

> Items identified by 3 reviewer agents during Phase 4 Frontend Modernization verification.
> Reviews split: A (Batches 1+2), B (Batch 3), C (Batches 4+5+6). Git range: `dcbf5aa..9c51705`.
>
> **Review C assessment: NOT READY** — 3 critical issues must be fixed before proceeding.
> Reviews A and B: ready to proceed with important fixes.

---

## Critical (Must Fix Before Proceeding)

- [ ] **C-C1 — Middleware allows un-verified JWT when JWT_SECRET is missing**
  - File: `apps/web/src/middleware.ts:14-38`
  - `getTokenPayload` falls back to `decodeJwt(token)` (zero signature verification) when `JWT_SECRET` is unset. Server requires JWT_SECRET (`apps/server/src/env.ts:28`) but web app does not. Attacker with cookie access can craft arbitrary JWT payload.
  - Related: **C-I5** (no startup validation of JWT_SECRET) and **C-I6** (algorithm not pinned to HS256).
  - Fix: throw if `JWT_SECRET` missing, pin algorithm to HS256, add `apps/web/src/env.ts` mirroring server validation. Read env at module load (Next.js 15 inlines at build time for Edge Runtime).

- [ ] **C-C2 — `a11y` translation namespace misplaced in all 23 locale files**
  - Files: `apps/web/messages/*.json` — `a11y` block nested under `reverseShares.modals.alias.a11y` instead of top-level
  - Consumed by: `apps/web/src/components/a11y/skip-to-content.tsx:6`, `route-announcer.tsx:10`
  - `useTranslations("a11y")` returns MISSING_MESSAGE. Skip-to-content and route-announcer display literal key paths. **Accessibility regression** in the items meant to improve a11y.
  - Fix: move `a11y` block to top level in all 23 locale files. Add unit test that snapshots top-level locale keys.

- [ ] **C-C3 — Public/admin path checks vulnerable to prefix confusion**
  - File: `apps/web/src/middleware.ts:54-57, 77`
  - `pathname.startsWith(p)` for paths like `/login`, `/forgot-password` — no trailing slash or exact-match check. Future route like `/loginadmin` would silently bypass auth.
  - Fix: exact match OR `startsWith(p + "/")`:
    ```ts
    function matchesPath(pathname: string, paths: readonly string[]): boolean {
      return paths.some((p) => pathname === p || pathname.startsWith(p + "/"));
    }
    ```

---

## Important — Translation & i18n

- [ ] **A-I1 — 13 new `errors` translation keys only in `en-US.json`**
  - 21 other locales missing keys from error boundaries. Non-English users see raw key names like `"somethingWentWrong"`.
  - Fix: copy keys to all 22 other locale files (English copy acceptable per existing pattern), or configure next-intl `getMessageFallback` to return English value.

---

## Important — Auth & State (Batch 3)

- [ ] **B-I1 — `auth-context.tsx:32-111` hybrid state pattern is fragile**
  - Derives user/isAdmin from TQ queries via useEffect, but also exposes setUser/setIsAdmin setters used by `useLogin.ts:108-129`. Two sources of truth converge by coincidence. Logout only removes `currentUser` queries, not `app.info`.
  - Fix: remove manual setters from AuthContext API, make useLogin/useTwoFactor invalidate queries instead. Single source of truth.

- [ ] **B-I2 — Back/forward navigation regression in file browser**
  - File: `apps/web/src/hooks/use-file-browser.ts:171-178`
  - `hasSyncedUrlRef` syncs folder once then never re-syncs. URL changes (back/forward) but `currentFolderId` doesn't update.
  - Fix: replace ref-based "sync once" with `useEffect` keyed on `[urlFolderSlug, dataLoaded, allFolders]`.

- [ ] **B-I3 — `api.ts:31` — Module-level `isRedirecting` never resets, no session_expired reason**
  - If navigation is intercepted, subsequent 401s silently swallowed. No `?reason=session_expired` on redirect.
  - Fix: append `?reason=session_expired` query param, add small timeout reset for resilience.

- [ ] **B-I5 — `app-info-context.tsx:78-80` dead code shim**
  - `useAppInfo.getState` shim for `layout.tsx:120` — but layout.tsx is a Server Component where `window` is always undefined. Both branches are dead code.
  - Fix: delete `useAppInfo.getState` from context and the guarded block from `layout.tsx:119-121`.

- [ ] **B-I6 — `zustand` still in `package.json` after full removal**
  - File: `apps/web/package.json:90` — zero usage remaining. Bundle/install bloat.
  - Fix: `pnpm --filter ouitransfer-web remove zustand`

- [ ] **B-I9 — Inconsistent `staleTime` ownership for shared query key**
  - Both `auth-context.tsx` and `app-info-context.tsx` specify `staleTime: 60_000` for `queryKeys.app.info()`. Redundant; divergence is a silent footgun.
  - Fix: centralize in a `useAppInfoQuery` hook that both consumers call.

---

## Important — Type Safety & Code Quality (Batches 1+2)

- [ ] **A-I2 — ShareFile/ShareFolder types narrowed — redundant `Number()` casts**
  - File: `apps/web/src/app/(shares)/s/[alias]/components/files-table.tsx:18-19, 226-227`
  - Types narrowed via `Pick<>`, but defensive `Number()` casts remain. Either remove casts (since mapper is the type boundary) or document the decision.
  - Fix: remove `Number()` casts and add a comment that `api-mappers.ts` normalizes types.

- [ ] **A-I3 — NEW `eslint-disable-line` comments added (dead linter)**
  - Files: `apps/web/src/components/tables/files-table.tsx:121, 125`
  - ESLint removed in Phase 1; codebase uses Biome. Comments are ineffective and misleading.
  - Fix: remove comments. If deps array is intentionally incomplete, use proper `// biome-ignore` syntax.

- [ ] **A-I4 — Visual regression: share "not found" uses wrong ErrorDisplay variant**
  - File: `apps/web/src/app/(shares)/s/[alias]/page.tsx:46-57`
  - Uses `variant="inline"` (card-sized typography) for a full-page error. Previous `ShareNotFound` had `text-2xl text-destructive`.
  - Fix: use `variant="page"` for this case, or add destructive tone to title.

---

## Important — Performance & A11y (Batches 4+5+6)

- [ ] **C-I1 — `RouteAnnouncer` is redundant — Next.js 15 has built-in `AppRouterAnnouncer`**
  - File: `apps/web/src/components/a11y/route-announcer.tsx`
  - Custom one fires on initial load (doubles announcement), uses assertive aria-live, 100ms setTimeout. Next.js's built-in skips first load, uses Shadow DOM isolation, tracks title changes.
  - Fix: delete `route-announcer.tsx` and remove from `layout.tsx:19,141`. Or at minimum add first-render guard.

- [ ] **C-I3 — RTL migration left physical `border-l`/`border-r` in shadcn primitives**
  - Files: `sheet.tsx:54,56`, `scroll-area.tsx:34`, `input-otp.tsx:45`
  - Logical positioning (`end-0`/`start-0`) paired with physical borders. Visual breakage in RTL.
  - Fix: `border-l` → `border-s` / `border-e` depending on inner-edge direction.

- [ ] **C-I4 — Dropdown/Context/Select RTL animations slide wrong direction**
  - Files: `dropdown-menu.tsx:29,192`, `context-menu.tsx:59,73`, `select.tsx:55`
  - `data-[side=left]:slide-in-from-end-2` was converted to logical, but Radix `data-side` is physical. In RTL, `end` resolves to left, so animation goes away from trigger.
  - Fix: revert these animation classes to physical (`slide-in-from-right-2`/`slide-in-from-left-2`). Logical replacement must not apply to Radix's physical `data-side`.

- [ ] **C-I7 — UTF-8 BOM on multiple TS source files**
  - Files: `rtl-languages.ts`, `i18n/request.ts`, `login/page.tsx`, `profile-picture.tsx`, ~15 shadcn UI files
  - `0xEF 0xBB 0xBF` byte prefix. Editor-config drift (Windows BOM default).
  - Fix: strip BOMs, add `.editorconfig` with `charset = utf-8`.

---

## Important — Test Coverage (Batch 3)

- [ ] **B-I8 — Missing tests for critical paths**
  - No tests for: 401 interceptor (`api.ts`), query-client retry logic (`query-client.ts`), auth-context derivation matrix (`auth-context.tsx`)
  - The 28 new tests cover individual hook return shapes but not inter-piece behavior.
  - Fix: add tests with `axios-mock-adapter` for 401 interceptor, test retry conditions, test auth state derivation.

---

## Minor — Deferred or Low Priority

- [ ] **A-M1 — ErrorDisplay variant naming misleading** — `inline` wraps in Card, `minimal` has no Card. Suggested: `page`/`card`/`inline`.
- [ ] **A-M2 — `ShareContentTable`/`ShareFilesTable` dead code (242 lines)** — File: share `files-table.tsx`. No consumer. Delete per CLAUDE.md "dead code can be deleted outright."
- [ ] **A-M3 — `formatDateTime` not adopted in share files-table** — Inline copy remains despite extraction to `@/lib/format-date-time`. Replace with import (moot if A-M2 deletes the file).
- [ ] **A-M4 — `BulkFolder = FolderItem` empty alias** — `share-multiple-items-modal.tsx:39`. Use `FolderItem` directly.
- [ ] **A-M5 — `format-date-time.ts` hardcoded to "en-US"** — Pre-existing, TODO in file. Single chokepoint makes future fix trivial.
- [ ] **A-M6 — `useEffect` reset-on-array-change pre-existing bug** — Pending changes persist if save fails. Consider TQ mutations to replace local pending state.
- [ ] **A-M7 — `use-selection-manager.ts:38,44` performance** — `files.map(f=>f.id).join(",")` on every render. Wrap in `useMemo` or use `files.length`.
- [ ] **B-I4 — `useEnabledProviders` extra fetch on first-user setup** — LoginForm always-enabled consumer triggers unnecessary query. Pass `enabled: !firstAccess`.
- [ ] **B-I7 — `use-public-share.ts` manual `browseState` reducer** — Pure derivation via `useMemo` would be simpler. Refactor when touching file.
- [ ] **B-minor — Inconsistent Axios error checking** — Mix of `as` casts and `axios.isAxiosError`. Standardize on typed guard.
- [ ] **B-minor — `queryKeys.files.list(folderId?)` parameter never exercised** — Consider removing unused parameter.
- [ ] **C-I2 — `LazyReactCrop` wrapper near-zero benefit** — Parent eagerly imports `centerCrop`, `makeAspectCrop`, CSS. Either move helpers into lazy chunk or acknowledge partial savings.
- [ ] **C-M1 — `qr-code-modal.tsx:30` race with LazyQRCode** — Download button enabled before chunk resolves. Disable until mount.
- [ ] **C-M2 — Path matching repeated in middleware + protected-route.tsx** — Centralize in `apps/web/src/lib/auth-paths.ts`.
- [ ] **C-M4 — `i18n/request.ts:12` typo `ps-PL` should be `pl-PL`** — Polish locale unreachable. Pre-existing.
- [ ] **C-M5 — RTL_LANGUAGES comment says "end-to-left"** — Should be "right-to-left". Trivial typo.
- [ ] **C-M6 — Skip-to-content uses `:focus` instead of `:focus-visible`** — Minor a11y correctness.

---

## Recommendations (Cross-Cutting)

1. **Translation CI guard**: add a Vitest test that snapshots top-level locale keys and asserts all locales have the same set. Would have caught C-C2 and A-I1.
2. **Middleware path-matching tests**: small test fed `["/login", "/loginx", "/auth/callback-evil"]` asserting which require auth.
3. **Centralize web env validation**: `apps/web/src/env.ts` mirroring server pattern. Catches C-C1 and C-I5 at build time.
4. **RTL conversion gap documentation**: bulk regex-driven conversion + Radix physical `data-side` need manual review (C-I3, C-I4).
5. **Strip all dead `eslint-disable*` comments codebase-wide** — one-shot cleanup, they're all ineffective post-Phase 1.
6. **`.editorconfig` with `charset = utf-8`** — prevent BOM reintroduction on Windows editors.
