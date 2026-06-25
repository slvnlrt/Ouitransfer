# Knip Audit — Dedicated Session

Full knip run (post-Phase 9) reveals significant dead code/deps never addressed.

## Status: COMPLETE

All true-positive findings triaged and remediated. Remaining knip output is expected
false positives (shadcn sub-components, barrel re-exports, Zod schema types).

## Actions

- [x] Triage all findings: true positives vs false positives
- [x] Delete genuinely dead files (15 files deleted)
- [x] Remove unused dependencies (2 removed: `@radix-ui/react-collapsible`, `@axe-core/playwright`)
- [x] Fix unlisted dependencies (added to knip.json ignoreDependencies)
- [x] Clean up unused exports (12 exports removed/unexported)
- [x] Refine `knip.json` config to reduce false positives
- [x] Add knip to pre-commit hook (lefthook) — commit `1112f7a`

## Summary of Changes

### Dead Files Deleted (15)

**Replaced/superseded components:**
- `apps/web/src/components/files/files-view.tsx` — replaced by `files-view-manager.tsx`
- `apps/web/src/components/general/file-selector.tsx` — app uses Uppy for upload
- `apps/web/src/app/files/components/file-list.tsx` — replaced by file-browser system
- `apps/web/src/app/files/components/search-bar.tsx` — only imported by dead file-list.tsx
- `apps/web/src/app/(shares)/s/[alias]/components/files-table.tsx` — replaced by other share components
- `apps/web/src/app/profile/components/color-picker-form.tsx` — duplicate of customization/ version

**Unused shadcn components (re-generatable via `npx shadcn@latest add`):**
- `apps/web/src/components/ui/collapsible.tsx`
- `apps/web/src/components/ui/password-input.tsx`
- `apps/web/src/components/ui/sheet.tsx`

**Dead types/barrels:**
- `apps/web/src/types/layout.ts` — dead `Config` type
- `apps/web/src/app/login/types/index.ts` — dead `LoginFormProps`
- `apps/web/src/app/(shares)/reverse-shares/types/index.tsx` — empty file
- `apps/web/src/lib/i18n-mock.ts` — unused mock

**Other:**
- `apps/web/src/app/settings/components/redirect-uri-input.tsx` — unused
- `apps/docs/src/components/ui/background-lights.tsx` — unused visual effect

### Dependencies Removed (2)
- `@radix-ui/react-collapsible` (web) — only consumer was deleted collapsible.tsx
- `@axe-core/playwright` (root devDep) — unused

### Dead Exports Removed/Unexported (12)

**Removed entirely (0 imports):**
- `getTempUploadDir`, `getUploadsDir`, `getTempFilePath` (directories.config.ts) — filesystem storage vestiges
- `TOKEN_COOKIE_NAME` (auth.config.ts) — old cookie name from pre-Phase 5
- `getTimeoutForFileSize` (timeout.config.ts)
- `createFieldTitles` (settings/constants.ts)
- `UPLOAD_PROGRESS` (r/[alias]/constants)
- `downloadFile` (zip-download.ts)
- `__resetCsrfStateForTest` (api.ts)

**Unexported (used internally only):**
- `AUDIT_ACTIONS` (audit/service.ts)
- `downloadUrlCache` (download-url-cache.ts)
- `getSenderDisplay` (received-files-file-row.tsx)
- `loginSchema` + `LoginFormData` (use-login.ts)
- `PROVIDER_PATTERNS`, `DEFAULT_SCOPES_BY_TYPE`, `DISCOVERY_SUPPORTED_PROVIDERS`, `FALLBACK_ENDPOINTS` + individual provider configs (providers.config.ts)

### Duplicate Export Removed (1)
- `useFiles` alias of `useFileBrowser` (use-file-browser.ts) — all consumers use `useFileBrowser`

### knip.json Config Updated
- Added root workspace with entry points (`.lighthouserc.cjs`, `infra/check-missing.js`)
- Added `reset-password.ts` as server entry point
- Added `@vitest/coverage-v8`, `postcss`, `@commitlint/types` to ignoreDependencies
- Remaining knip output (~100 unused exports) is shadcn sub-components and barrel re-exports — expected and acceptable

### False Positives Identified During Triage (not deleted)
- `tailwindcss` (web devDep) — used via `@import "tailwindcss"` in globals.css
- `tw-animate-css` (web + docs) — imported in CSS files
- `apps/web/src/hooks/use-secure-configs.ts` — has 8 active consumers
- `apps/web/src/components/modals/previews/index.ts` — imported by file-preview-modal.tsx
- `apps/docs/src/components/ui/zoomable-image.tsx` — imported in 13 MDX files
