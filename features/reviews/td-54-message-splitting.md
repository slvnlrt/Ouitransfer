# TD-54 — Review Findings

**Reviewer:** Code review agent
**Date:** 2026-06-26

## Finding 1 — Critical — Missing `filesTable` namespace in PUBLIC_SHARE_NAMESPACES ✅ FIXED

**File:** `apps/web/src/i18n/message-keys.ts:74-87`
**Issue:** Public share page renders `FilesViewManager` → `files-table.tsx` etc. which access
`filesTable.*` keys (column headers, select-all, etc.). Missing namespace = raw key strings.
**Fix:** Added `"filesTable"` to `PUBLIC_SHARE_NAMESPACES`.

## Finding 2 — Critical — Missing `uploadFile` namespace in REVERSE_SHARE_NAMESPACES ✅ FIXED

**File:** `apps/web/src/i18n/message-keys.ts:96-102`
**Issue:** Reverse share page uses `useUppyUpload` hook which accesses `uploadFile.errors.*`.
**Fix:** Added `"uploadFile"` to `REVERSE_SHARE_NAMESPACES`.

## Finding 3 — Critical — Auth callback routes have no NextIntlClientProvider layout ✅ FIXED

**File:** `apps/web/src/app/auth/` (no layout.tsx existed)
**Issue:** `/auth/callback` and `/auth/oidc/callback` use `auth.*` and `login.*` namespaces but
only had access to `GLOBAL_NAMESPACES` from root.
**Fix:** Created `apps/web/src/app/auth/layout.tsx` with `GLOBAL + AUTH` namespaces.

## Finding 4 — Important — Missing `fileActions` namespace in PUBLIC_SHARE_NAMESPACES ✅ FIXED

**File:** `apps/web/src/i18n/message-keys.ts:74-87`
**Issue:** `files-table-file-row.tsx` accesses `fileActions.addDescriptionPlaceholder`.
**Fix:** Added `"fileActions"` to `PUBLIC_SHARE_NAMESPACES`.

## Finding 5 — Important — Missing `contextMenu` namespace in PUBLIC_SHARE_NAMESPACES ✅ FIXED

**File:** `apps/web/src/i18n/message-keys.ts:74-87`
**Issue:** `files-grid.tsx` accesses `contextMenu.*` (guarded but better safe).
**Fix:** Added `"contextMenu"` to `PUBLIC_SHARE_NAMESPACES`.

## Finding 6 — Minor — `getMessages()` called twice per request ✅ NO ACTION NEEDED

Confirmed deduplicated via React `cache()` in next-intl internals.

## Finding 7 — Minor — Nesting behavior confirmed as REPLACE ✅ NO ACTION NEEDED

`routeMessages()` correctly includes `GLOBAL_NAMESPACES` in every route.

## Finding 8 — Minor — Type cast `as Record<string, unknown>` ✅ ACCEPTED

Harmless cast needed because `getMessages()` returns branded `Messages` type. Not worth adding
a dependency on `use-intl` internal types.

## Finding 9 — Minor — Test coverage for namespace constants ✅ ACCEPTED

Would need component-tree static analysis — out of scope. Covered by manual review tracing.
