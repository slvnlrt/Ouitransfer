# Session Log

## 2026-05-14
- Created `features/` directory structure
- Split feature specs from audit TODO into individual spec files (5.1–5.4)
- Archived all refactor/audit tracking files into `audit/archive/`

## 2026-05-16
- Added 6.x UI workstream (audit → fixes → visual redesign)
- Cleaned up CLAUDE.md (removed phase detail, added new structure)
- Refined workflow: removed `decisions/`, explicit review-correction loop
- Completed 6.1 UI audit: 5 Critical, 22 Important, 18 Minor findings across components/pages/hooks
- Wrote 6.2 implementation plan (10 tasks, all 45 findings covered)
- Executed all 10 tasks of 6.2:
  - T1: Design token migration (42+ files, hardcoded colors → semantic tokens)
  - T2: OAuth cookie security fix (removed document.cookie token assignment)
  - T3: Quick wins batch (16 items: forwardRef, drag ghost CSS, line-clamp, rename, etc.)
  - T4: i18n fixes (26 new keys, 13 files, hardcoded English → t() calls)
  - T5: Utility extractions (useCopyToClipboard, useFileUpload, Spinner, StatusIcon, FileTypeIcon, app-info)
  - T6: WCAG landmarks (duplicate <main> → <div>)
  - T7: Layout unification (PageLayout component, 7 loading.tsx, layout renames)
  - T8: Hook decomposition (4 god hooks → orchestrator + sub-hooks)
  - T9: Large component splits (share-details, reverse-share modals, register form)
  - T10: Icon picker rewrite (lazy-loading, ~95% bundle reduction)
- All tests passing (205/205), type-check clean
- 6.2 marked Done, next: 6.3 Visual Redesign

## 2026-05-17
- Completed 6.3 Visual Redesign:
  - T1: Theme foundation — indigo palette (hue 265), Inter font, 0.625rem radius
  - T2: Background effect — 3-blob gradient mesh, 20-25s drift, warm accent; fixed StaticBackgroundLights hardcoded green
  - T3: Navigation — removed backdrop-blur, solid bg + shadow-sm, refined typography
  - T4: Landing page — slower icon glow, refined partner card, solid tagline
  - T5: Auth pages — rounded-xl cards, reduced blur, stronger shadows
  - T6: Dashboard cards — hover lift, shadow transitions, refined icon containers
  - T7: Loading screen — calmer opacity pulse + expanding bar animation
  - T8: Button/Input — scoped transitions, focus ring animation, hover scale
  - T9: Modal/dropdown — backdrop blur[2px], bg-black/60, slide-from-bottom
  - T10: Empty/error states — entrance animations (fade+translate)
  - T11: Dark mode polish pass — blue-tinted neutrals verified
- Review: 3 Critical + 4 Important + 8 Minor → all resolved
  - Fixed: auth input blur, button foreground token, home navbar, chart consistency, transition scoping, input ring transition, share page headers, icon glow timing, card translate, partner card opacity
- 6.x UI Overhaul complete (6.1 audit → 6.2 fixes → 6.3 redesign)
- Next: 5.x features (quotas, cleanup, groups, LDAP)

## 2026-05-18
- Completed 5.1 Per-User Storage Quotas (spec → plan → implementation → review → fixes)
  - Schema: `maxFileSizeOverride BigInt?`, `maxTotalStorageOverride BigInt?` on User model
  - New `modules/quota/` (repository, service, controller, routes, dto) with `resolveEffectiveLimits(userId)`
  - Refactored 3 copy-pasted enforcement points to use QuotaService
  - Admin endpoints: GET/PATCH `/users/:id/quota`
  - Frontend: functional quota widget, warning banners, admin per-user quota management
  - i18n: 20 new keys translated in all 23 locales
  - Tests: 250 server (16 unit + 9 integration new) + 215 web
  - Review: 9 Important + 12 Minor findings → all resolved
- Fixed pre-existing bug: `just db-dev-init` now seeds after schema push
- Reported B-7: login shows "unexpected error" for short passwords (400 validation not handled)
- Next: 5.4 Groups (depends on 5.1) or 5.2 Auto-cleanup (independent)

## 2026-05-18 (session 2) — B-7 Bug Fix + Technical Debt
- Fixed B-7: login VALIDATION_ERROR → "invalid credentials" (no password policy leak)
  - Security principle: login forms must never divulge password policy info
  - Added regression test for VALIDATION_ERROR → invalidCredentials
- Resolved TD-2: ACCOUNT_LOCKED error code for login lockout
  - Added `ACCOUNT_LOCKED` to shared error codes
  - Server: `AppError(403, ..., ACCOUNT_LOCKED, { remainingMinutes })` replaces `ForbiddenError`
  - Frontend: dedicated lockout message with `{minutes}` in all 23 locales (native translations)
  - Added `LOGIN_LOCKED` audit action (distinct from `LOGIN_FAILURE`)
  - `app.inject()` integration test verifying wire format
  - Added 401/403 response schemas to login, 2FA login, and reset-password routes
- Resolved TD-1: removed unsafe `<TData>` generic from 88 API endpoint functions (10 files)
  - All functions now use concrete `Promise<ResultType>` return types
  - Normalized `two-factor/index.ts` to match standard pattern (6 functions)
  - Standardized `invite/index.ts` (all 3 functions unwrap `.data`)
  - Fixed `AddFiles200` type (`SimpleShare` → `Share`)
  - Fixed Login200 type (union: user response | 2FA challenge), removed `as LoginResponse` cast
  - Added convention documentation in barrel export
- Final review: principal-level review caught 5 Important + 5 Minor findings, all addressed
- Opened TD-3: 2FA brute-force gap (completeTwoFactorLogin bypasses per-account lockout)
- Tests: 255 server + 221 web, both type-checks clean
- 8 commits total (eaedb68..dd02dce)
- Next: 5.x features (groups, auto-cleanup, LDAP)
