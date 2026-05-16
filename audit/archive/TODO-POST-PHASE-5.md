# Phase 5 — Post-Review Follow-ups

Items discovered during Phase 5 reviews. All items have been resolved.

## From Batch 1 Review (Tasks 1-2)

### Fixed inline (commit 21dd68f)
- [x] I-1: `parseTrustProxy` extracted to `utils/parse-trust-proxy.ts` + 7 unit tests
- [x] I-2: `extractFilenameFromContentDisposition` second-pass `decodeURIComponent` wrapped in try/catch
- [x] I-3: `directories.config.ts` `getTempFilePath` now uses `sanitizeFilename`
- [x] I-4: `reverse-share/upload.service.ts` bespoke sanitizers replaced with `sanitizeFilename`

### Minor — fixed in backlog pass
- [x] M-1: `server-config.test.ts` replaced with behavioral docsEnabled tests
- [x] M-2: Helmet reordered before rate-limit in `app.ts`
- [x] M-3: CSP conditionally relaxed when Swagger docs are enabled
- [x] M-4: `docsEnabled` gate tested with 4 integration tests
- [x] M-5: `bodyLimit` constant extracted (`AUTH_BODY_LIMIT`, `SMALL_BODY_LIMIT`)

## From Batch 2 Review (Tasks 3-5)

Full review: [`audit/REVIEW-PHASE-5-BATCH-2.md`](./REVIEW-PHASE-5-BATCH-2.md)

### Fixed inline (commits e32182c + next fix commit)
- [x] Spec: BOM corruption of 22 locale files — stripped all BOMs
- [x] Spec: Missing CSRF exemption for `/reverse-shares/:id/upload/access`
- [x] Spec: Zod `.refine()` enforcing `CSRF_SECRET !== JWT_SECRET`
- [x] C-1: Route schema in `two-factor/routes.ts` missing `totpCode` field (Zod strips unknown props)
- [x] C-2: `/auth/register` removed from CSRF exempt list (admin-only endpoint after first user)
- [x] I-3: Trailing-slash CSRF bypass — normalized URL before exempt check
- [x] I-4: Backup code comparison in `disable2FA` now uses `normalizedCode`
- [x] I-5: `DisableSchema.totpCode` now has `.trim()`
- [x] I-7: CSRF 403 cache-clear now checks for CSRF-specific error message

### Important — fixed in backlog pass
- [x] I-1: CSRF tests now hit real routes (logout endpoint + production exempt list assertions)
- [x] I-2: `CSRF_EXEMPT_DYNAMIC` replaced with per-route `config: { csrfExempt: true }` flag. Config extracted to `csrf.config.ts`. Dynamic suffix matching removed.
- [x] I-6: Dead entry `/api/auth/request-password-reset` in `AUTH_API_PREFIXES` replaced with `/api/auth/forgot-password`
- [x] I-8: CSRF token rotation/lifecycle tests added (round-trip + cross-session mismatch)

### Minor — fixed in backlog pass
- [x] M-1: `timingSafeEqual` JSDoc documents UTF-16 string length behavior and ASCII safety contract
- [x] M-2: `disable2FA` branch shape inverted to `if (!totpVerified)` for readability
- [x] M-3: `getAllowedRedirectHosts` now builds Set once at module load with `__resetAllowedRedirectHostsForTest()` export
- [x] M-4: CSRF config extracted to `apps/server/src/config/csrf.config.ts`
- [x] M-5b: `csrf.test.ts` imports production `CSRF_EXEMPT_ROUTES` directly
- [x] M-6: `totpCode` description documents accepted formats (6-digit TOTP or XXXXX-XXXXX backup code)
- [x] M-7: `disableTotpCode` cleared on error in catch handler
- [x] M-8: `__resetCsrfStateForTest()` exported from `api.ts`

## From Batch 3 Review (Tasks 6-7)

Full review: [`audit/REVIEW-PHASE-5-BATCH-3.md`](./REVIEW-PHASE-5-BATCH-3.md)

### Fixed inline (commits 61791a9 + next fix commit)
- [x] Spec I-1: `embed.controller.ts` migrated to AppError (was completely missed)
- [x] Spec M-3: Catch guard in `file/controller.ts` broadened to `instanceof AppError`
- [x] Spec M-5: Stale comment in `error-handler.ts` updated
- [x] C-2/I-1: `validateObjectName` extracted to shared util, applied in `registerFile`
- [x] I-2: Client-unsafe AppError messages fixed (OAuth + reverse-share copy retry)
- [x] I-3: Dead try/catch in `AppController.updateConfig` removed (was downgrading 404→400)
- [x] M-5: String mismatch in OAuth email error detection fixed

### Critical — fixed in backlog pass
- [x] C-1: Shared `ErrorResponseSchema` created and applied to ~176 error response schemas across 13 route files

### Important — fixed in backlog pass
- [x] I-4: `isMimeTypeConsistent` hardened — dangerous extensions checked even when MIME is undefined or `application/octet-stream`
- [x] I-5: Magic-byte S3 error handling distinguishes expected (debug) vs unexpected (warn) failures
- [x] I-6: 5 integration tests for validation pipeline and AppError→response flow
- [x] I-7: All ~13 preValidation/middleware hooks converted from `reply.status().send()` to `throw AppError`

### Minor — fixed in backlog pass
- [x] Spec M-1: `auth/challenge.ts` and `file/embed-token.ts` converted from `throw new Error` to `UnauthorizedError`
- [x] Spec M-2: All preValidation hooks now throw AppError (same as I-7)
- [x] Spec M-4: `s3-storage/controller.ts` 501 → `throw new AppError(501, ..., "NOT_IMPLEMENTED")`
- [x] M-1: Dead `reply.sent` checks removed from `auth-providers/controller.ts`
- [x] M-2: `BLOCKED_MIME_TYPES` documented as intentionally non-exhaustive denylist
- [x] M-3: `getObjectHead` `bytes` parameter capped at `MAX_HEAD_BYTES = 4096`
- [x] M-4: `email/service.ts` SMTP failure now throws `AppError(503, ..., "EMAIL_DELIVERY_FAILED")`
- [x] M-6: Same as Spec M-4 (s3-storage 501 fixed)

## From Batch 4 Review (Tasks 8-9)

Full review: [`audit/REVIEW-PHASE-5-BATCH-4.md`](./REVIEW-PHASE-5-BATCH-4.md)

### Fixed inline (commits b2efdfb + CQ fix commit)
- [x] Spec C-1: OIDC users had no refresh token — added httpOnly cookie
- [x] Spec C-2: Integration tests for `/auth/refresh` and `/admin/audit-logs` (13 tests)
- [x] Spec I-1: Frontend refresh interceptor tests (5 tests)
- [x] Spec I-2: OIDC cookie maxAge units fixed (ms → seconds)
- [x] Spec I-3: Logout now revokes refresh tokens + clears cookie
- [x] Spec I-4: PASSWORD_RESET audit now includes userId
- [x] Spec M-1/M-2: Audit typing fixes
- [x] CQ-1: tokenVersion increment on isAdmin/isActive changes + cache invalidation on delete
- [x] CQ-2: Refresh token rotation race condition fixed (conditional updateMany)
- [x] CQ-3: Login refresh token unified on httpOnly cookie (removed body token)
- [x] CQ-4: OIDC callback uses `env.SECURE_SITE` instead of `request.protocol`
- [x] CQ-5: OIDC access-token cookie changed to session cookie (removed maxAge)
- [x] CQ-6: ACCOUNT_LOCKED audit now receives ipAddress from caller
- [x] CQ-7: Migration fixed — removed broken INSERT for login_attempts
- [x] CQ-8: Audit route no longer allows unauthenticated access when usersCount === 0
- [x] CQ-9: Added documentation comment for inline tokenVersion increment in password reset

### Minor — fixed in backlog pass
- [x] CQ-10: Refresh token body/cookie fallback — N/A after CQ-3 (cookie-only approach)
- [x] CQ-11: `RefreshToken.replacedBy` documented as audit chain value (stores raw token, not FK — intentional for replay detection forensics)
- [x] CQ-12: Cleanup retention fixed — revoked tokens kept 24h, expired tokens cleaned after 24h
- [x] CQ-13: `AuditAction` typed as Zod enum; route validates `action` filter against allowed values
- [x] CQ-14: Audit `metadata` parsed from JSON string to object before API response
- [x] CQ-15: `LoginAttempt.email` normalized with `trim().toLowerCase()` in all service functions
- [x] CQ-16: N/A — dead `refreshTokenValue` singleton already removed by CQ-3 fix
- [x] CQ-17: Integration tests no longer mock `validateTokenVersion` — use real validation with correct `tokenVersion` in test JWTs
- [x] CQ-18: `recordLoginAttempt` skips recording when account is already locked
- [x] CQ-19: `AuditLog.userId` filter validated as non-empty string via Zod route schema
