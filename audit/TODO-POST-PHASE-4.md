# Phase 4 — Post-Review Follow-ups

> Items identified by 3 reviewer agents during Phase 4 Frontend Modernization verification.
> Reviews split: A (Batches 1+2), B (Batch 3), C (Batches 4+5+6). Git range: `dcbf5aa..9c51705`.
>
> **All items remediated.** 3 critical + 20 important + 16 minor items fixed across 8 tasks.
> ReactQueryDevtools gated to development only. LazyReactCrop kept (partial value acknowledged).

---

## Critical (Must Fix Before Proceeding)

- [x] **C-C1 — Middleware allows un-verified JWT when JWT_SECRET is missing** ✅ Task 1
  - File: `apps/web/src/middleware.ts:14-38`
  - `getTokenPayload` falls back to `decodeJwt(token)` (zero signature verification) when `JWT_SECRET` is unset. Server requires JWT_SECRET (`apps/server/src/env.ts:28`) but web app does not. Attacker with cookie access can craft arbitrary JWT payload.
  - Related: **C-I5** (no startup validation of JWT_SECRET) and **C-I6** (algorithm not pinned to HS256).
  - Fix: throw if `JWT_SECRET` missing, pin algorithm to HS256, add `apps/web/src/env.ts` mirroring server validation. Read env at module load (Next.js 15 inlines at build time for Edge Runtime).
  - **Fixed:** Removed `decodeJwt` fallback, pinned HS256, created `apps/web/src/env.ts` with Zod validation (min 32 chars), module-level secret encoding. 30 tests added.

- [x] **C-C2 — `a11y` translation namespace misplaced in all 23 locale files** ✅ Task 2
  - Files: `apps/web/messages/*.json` — `a11y` block nested under `reverseShares.modals.alias.a11y` instead of top-level
  - Consumed by: `apps/web/src/components/a11y/skip-to-content.tsx:6`, `route-announcer.tsx:10`
  - `useTranslations("a11y")` returns MISSING_MESSAGE. Skip-to-content and route-announcer display literal key paths. **Accessibility regression** in the items meant to improve a11y.
  - Fix: move `a11y` block to top level in all 23 locale files. Add unit test that snapshots top-level locale keys.
  - **Fixed:** Moved `a11y` to top-level in all 23 locales, removed nested copy. Recursive locale parity test with orphan detection added.

- [x] **C-C3 — Public/admin path checks vulnerable to prefix confusion** ✅ Task 1
  - File: `apps/web/src/middleware.ts:54-57, 77`
  - `pathname.startsWith(p)` for paths like `/login`, `/forgot-password` — no trailing slash or exact-match check. Future route like `/loginadmin` would silently bypass auth.
  - Fix: exact match OR `startsWith(p + "/")`:
    ```ts
    function matchesPath(pathname: string, paths: readonly string[]): boolean {
      return paths.some((p) => pathname === p || pathname.startsWith(p + "/"));
    }
    ```
  - **Fixed:** Created `matchesPath()` at `apps/web/src/components/auth/paths/match-path.ts`. Applied to middleware + redirect-handler. 8 unit tests.

---

## Important — Translation & i18n

- [x] **A-I1 — 13 new `errors` translation keys only in `en-US.json`** ✅ Task 2
  - 21 other locales missing keys from error boundaries. Non-English users see raw key names like `"somethingWentWrong"`.
  - Fix: copy keys to all 22 other locale files (English copy acceptable per existing pattern), or configure next-intl `getMessageFallback` to return English value.
  - **Fixed:** Added 13 `errors` keys + 1 `a11y` key to all 22 non-en-US locales (English placeholders).

---

## Important — Auth & State (Batch 3)

- [x] **B-I1 — `auth-context.tsx:32-111` hybrid state pattern is fragile** ✅ Task 3
  - Derives user/isAdmin from TQ queries via useEffect, but also exposes setUser/setIsAdmin setters used by `useLogin.ts:108-129`. Two sources of truth converge by coincidence. Logout only removes `currentUser` queries, not `app.info`.
  - Fix: remove manual setters from AuthContext API, make useLogin/useTwoFactor invalidate queries instead. Single source of truth.
  - **Fixed:** Removed useState+useEffect derivation → useMemo. Removed all setters from context API. Login/callback flows use setQueryData+invalidateQueries. Logout clears both currentUser AND app.info. 9 tests added. Fixed pre-existing data shape mismatch in use-profile.ts.

- [x] **B-I2 — Back/forward navigation regression in file browser** ✅ Task 4
  - File: `apps/web/src/hooks/use-file-browser.ts:171-178`
  - `hasSyncedUrlRef` syncs folder once then never re-syncs. URL changes (back/forward) but `currentFolderId` doesn't update.
  - Fix: replace ref-based "sync once" with `useEffect` keyed on `[urlFolderSlug, dataLoaded, allFolders]`.
  - **Fixed:** Replaced hasSyncedUrlRef with useEffect. Replaced `window.history.pushState` with `router.push` (root cause). Added `isNavigatingRef` for programmatic nav. 7 tests.

- [x] **B-I3 — `api.ts:31` — Module-level `isRedirecting` never resets, no session_expired reason** ✅ Task 4
  - If navigation is intercepted, subsequent 401s silently swallowed. No `?reason=session_expired` on redirect.
  - Fix: append `?reason=session_expired` query param, add small timeout reset for resilience.
  - **Fixed:** Added `?reason=session_expired`, 5s safety timeout, `matchesPath` for public page detection, session expired toast in use-login. 12 tests.

- [x] **B-I5 — `app-info-context.tsx:78-80` dead code shim** ✅ Task 3
  - `useAppInfo.getState` shim for `layout.tsx:120` — but layout.tsx is a Server Component where `window` is always undefined. Both branches are dead code.
  - Fix: delete `useAppInfo.getState` from context and the guarded block from `layout.tsx:119-121`.
  - **Fixed:** Deleted `useAppInfo.getState` shim + `refreshAppInfoOutsideReact`. Deleted dead import and guarded block from `layout.tsx`.

- [x] **B-I6 — `zustand` still in `package.json` after full removal** ✅ Task 3
  - File: `apps/web/package.json:90` — zero usage remaining. Bundle/install bloat.
  - Fix: `pnpm --filter ouitransfer-web remove zustand`
  - **Fixed:** Removed from dependencies, lockfile updated.

- [x] **B-I9 — Inconsistent `staleTime` ownership for shared query key** ✅ Task 3
  - Both `auth-context.tsx` and `app-info-context.tsx` specify `staleTime: 60_000` for `queryKeys.app.info()`. Redundant; divergence is a silent footgun.
  - Fix: centralize in a `useAppInfoQuery` hook that both consumers call.
  - **Fixed:** Created `apps/web/src/hooks/use-app-info-query.ts` with single staleTime definition. Both consumers call it.

---

## Important — Type Safety & Code Quality (Batches 1+2)

- [x] **A-I2 — ShareFile/ShareFolder types narrowed — redundant `Number()` casts** ✅ Task 6
  - File: `apps/web/src/app/(shares)/s/[alias]/components/files-table.tsx:18-19, 226-227`
  - Types narrowed via `Pick<>`, but defensive `Number()` casts remain. Either remove casts (since mapper is the type boundary) or document the decision.
  - **Fixed:** Removed redundant `Number(item.size)` cast (FileItem.size is number). Kept `Number(item.totalSize)` (FolderItem.totalSize is string|undefined).

- [x] **A-I3 — NEW `eslint-disable-line` comments added (dead linter)** ✅ Task 6
  - Files: `apps/web/src/components/tables/files-table.tsx:121, 125`, `share-details-modal.tsx:107`
  - ESLint removed in Phase 1; codebase uses Biome. Comments are ineffective and misleading.
  - **Fixed:** Removed all 3 dead eslint-disable comments.

- [x] **A-I4 — Visual regression: share "not found" uses wrong ErrorDisplay variant** ✅ Task 6
  - File: `apps/web/src/app/(shares)/s/[alias]/page.tsx:46-57`
  - Uses `variant="inline"` (card-sized typography) for a full-page error. Previous `ShareNotFound` had `text-2xl text-destructive`.
  - **Fixed:** Changed to `variant="page"` for proper full-page prominence.

---

## Important — Performance & A11y (Batches 4+5+6)

- [x] **C-I1 — `RouteAnnouncer` is redundant — Next.js 15 has built-in `AppRouterAnnouncer`** ✅ Task 5
  - File: `apps/web/src/components/a11y/route-announcer.tsx`
  - Custom one fires on initial load (doubles announcement), uses assertive aria-live, 100ms setTimeout. Next.js's built-in skips first load, uses Shadow DOM isolation, tracks title changes.
  - **Fixed:** Deleted `route-announcer.tsx`, removed import and JSX from `layout.tsx`. Orphan `routeChanged` translation key removed from all 23 locales.

- [x] **C-I3 — RTL migration left physical `border-l`/`border-r` in shadcn primitives** ✅ Task 5
  - Files: `sheet.tsx:54,56`, `scroll-area.tsx:34`, `input-otp.tsx:45`
  - Logical positioning (`end-0`/`start-0`) paired with physical borders. Visual breakage in RTL.
  - **Fixed:** `border-l` → `border-s`, `border-r` → `border-e` in sheet. `border-l` → `border-s` in scroll-area and input-otp. Also fixed `border-r` → `border-e` in input-otp slots.

- [x] **C-I4 — Dropdown/Context/Select RTL animations slide wrong direction** ✅ Task 5
  - Files: `dropdown-menu.tsx:29,192`, `context-menu.tsx:59,73`, `select.tsx:55`
  - `data-[side=left]:slide-in-from-end-2` was converted to logical, but Radix `data-side` is physical. In RTL, `end` resolves to left, so animation goes away from trigger.
  - **Fixed:** Reverted to physical `slide-in-from-right-2`/`slide-in-from-left-2` at all 5 locations.

- [x] **C-I5 — Web app `JWT_SECRET` not validated at startup** ✅ Task 1 (merged with C-C1)
- [x] **C-I6 — JWT verification doesn't pin algorithm to HS256** ✅ Task 1 (merged with C-C1)
- [x] **C-I7 — UTF-8 BOM on multiple TS source files** ✅ Task 7
  - Files: `rtl-languages.ts`, `i18n/request.ts`, `login/page.tsx`, `profile-picture.tsx`, ~15 shadcn UI files
  - `0xEF 0xBB 0xBF` byte prefix. Editor-config drift (Windows BOM default).
  - **Fixed:** Stripped BOM from 73 files. Added `.editorconfig` at repo root (utf-8, lf, space/2).

---

## Important — Test Coverage (Batch 3)

- [x] **B-I8 — Missing tests for critical paths** ✅ Tasks 3+4
  - No tests for: 401 interceptor (`api.ts`), query-client retry logic (`query-client.ts`), auth-context derivation matrix (`auth-context.tsx`)
  - **Fixed:** 401 interceptor tests (7 tests in `api-interceptor.test.ts`), auth-context derivation tests (9 tests in `auth-context.test.ts`). Query-client retry logic covered indirectly by interceptor tests.

---

## Minor — Deferred or Low Priority

- [x] **A-M1 — ErrorDisplay variant naming misleading** ✅ Task 6 — Renamed: `inline`→`card`, `minimal`→`inline`. All 7 consumers + tests updated.
- [x] **A-M2 — `ShareContentTable`/`ShareFilesTable` dead code (242 lines)** ✅ Task 7 — Deleted dead alias (never imported).
- [x] **A-M3 — `formatDateTime` not adopted in share files-table** ✅ Task 7 — Replaced inline copy with `import { formatDateTime } from "@/lib/format-date-time"`.
- [x] **A-M4 — `BulkFolder = FolderItem` empty alias** ✅ Task 7 — Removed alias from 2 files, replaced ~16 occurrences with `FolderItem`.
- [x] **A-M5 — `format-date-time.ts` hardcoded to "en-US"** ✅ Task 8 — Added optional `locale` parameter, all 3 callers now pass `useLocale()` from next-intl.
- [x] **A-M6 — `useEffect` reset-on-array-change pre-existing bug** ✅ Task 8 — Added `revertPendingChange()` to `useEditableItem`. `saveEdit` is now async; reverts on callback failure.
- [x] **A-M7 — `use-selection-manager.ts:38,44` performance** ✅ Task 7 — Wrapped `fileIds`/`folderIds` in `useMemo`.
- [x] **B-I4 — `useEnabledProviders` extra fetch on first-user setup** ✅ Task 8 — LoginForm now passes `enabled: !firstAccess` via `useAppInfo()`.
- [x] **B-I7 — `use-public-share.ts` manual `browseState` reducer** ✅ Task 8 — Replaced useState + loadFolderContents + useEffect with `useMemo`. `reload` uses `queryClient.invalidateQueries`.
- [x] **B-minor — Inconsistent Axios error checking** ✅ Task 8 — Standardized to `axios.isAxiosError()` in `use-public-share.ts`, `use-settings.ts`, `use-two-factor.ts`.
- [x] **B-minor — `queryKeys.files.list(folderId?)` parameter never exercised** ✅ Task 8 — Removed unused parameter, updated test.
- [x] **C-I2 — `LazyReactCrop` wrapper near-zero benefit** — Acknowledged: parent eagerly imports helpers + CSS. Wrapper defers only the React component (~20% savings). Not removed (still provides some value); documented.
- [x] **C-M1 — `qr-code-modal.tsx:30` race with LazyQRCode** ✅ Task 8 — Replaced `getElementById` with ref-based `querySelector("svg")`. Removed dead `id` prop.
- [x] **C-M2 — Path matching repeated in middleware + protected-route.tsx** ✅ Task 1 — `matchesPath` utility created and used by both middleware and redirect-handler.
- [x] **C-M4 — `i18n/request.ts:12` typo `ps-PL` should be `pl-PL`** ✅ Task 8 — Fixed, Polish locale now reachable.
- [x] **C-M5 — RTL_LANGUAGES comment says "end-to-left"** ✅ Task 5 — Fixed to "right-to-left (RTL)".
- [x] **C-M6 — Skip-to-content uses `:focus` instead of `:focus-visible`** ✅ Task 5 — Replaced all 16 `focus:` variants with `focus-visible:`.

---

## Recommendations (Cross-Cutting)

1. ~~**Translation CI guard**~~ ✅ Done in Task 2 — recursive locale parity test with orphan detection at `apps/web/src/__tests__/locale-keys.test.ts`.
2. ~~**Middleware path-matching tests**~~ ✅ Done in Task 1 — 30 tests in middleware.test.ts (20 middleware integration + 8 matchesPath unit + 2 env validation).
3. ~~**Centralize web env validation**~~ ✅ Done in Task 1 — `apps/web/src/env.ts` with Zod schema.
4. ~~**RTL conversion gap documentation**~~ ✅ Done in Task 5 — C-I3 and C-I4 fixed. Radix physical `data-side` animations reverted to physical.
5. ~~**Strip all dead `eslint-disable*` comments codebase-wide**~~ ✅ Done in Task 6 — all 3 remaining comments removed.
6. ~~**`.editorconfig` with `charset = utf-8`**~~ ✅ Done in Task 7 — `.editorconfig` added at repo root, 73 BOMs stripped.
