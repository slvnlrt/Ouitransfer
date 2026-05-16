# Phase 5 Quality Audit — Post-Implementation Review

Found during a systematic review of all Phase 5 work. Every item must be fixed.

## Critical — Runtime Bugs

### [x] QA-C1: auth-providers error schemas cause 500 instead of 401/403
**File:** `apps/server/src/modules/auth-providers/routes.ts` (lines 79-82, 103-114, 137-153, 174-189, 215-230, 251-265, 294-296)
**Problem:** All error response schemas (401, 403, 500) across 7 routes declare `z.object({ success: z.boolean(), error: z.string() })`. The preValidation hooks throw `UnauthorizedError`/`ForbiddenError` → `globalErrorHandler` sends `{ error, code, statusCode }`. The Zod serializer does `safeParse()` → fails (missing `success` field) → throws `ResponseSerializationError` → Fastify anti-loop protection → client gets 500 instead of the intended status code.
**Fix:** Replace all error response schemas with `ErrorResponseSchema` from `utils/error-response-schema.ts`.

### [x] QA-C2: auth-providers adminPreValidation uses `usersCount <= 1` (unfixed security bug)
**File:** `apps/server/src/modules/auth-providers/routes.ts`, line 39
**Problem:** The admin bypass condition is `if (usersCount <= 1) return;` — allows unauthenticated access to admin endpoints when exactly 1 user exists. The fix in Task 3 (5.6) changed `app/routes.ts` to `=== 0` but missed this copy.
**Fix:** Change to `if (usersCount === 0) return;`.

### [x] QA-C3: /auth/refresh endpoint uses reply.send() instead of throwing AppError
**File:** `apps/server/src/modules/auth/routes.ts`, line 387
**Problem:** `return reply.status(401).send({ error: "Missing refresh token" })` bypasses `globalErrorHandler`. No `code` field, not logged by the error handler, inconsistent with the Phase 5 architecture.
**Fix:** Replace with `throw new UnauthorizedError("Missing refresh token");`

## Important — Security & Architecture

### [x] QA-I1: adminPreValidation duplicated 3 times with diverging logic
**Files:**
- `apps/server/src/modules/app/routes.ts:16-41` — correct (`=== 0`, warn log)
- `apps/server/src/modules/audit/routes.ts:11-22` — no user-count bypass (intentional for audit)
- `apps/server/src/modules/auth-providers/routes.ts:36-55` — WRONG (`<= 1`, error log)
**Problem:** Copy-pasted security-critical code. Diverging logic caused QA-C2.
**Fix:** Extract a shared `createAdminPreValidation({ allowSetupBypass: boolean })` middleware in a shared auth middleware module. All three files import and use it. `audit/routes.ts` uses `allowSetupBypass: false`, the other two use `allowSetupBypass: true`.

### [x] QA-I2: s3-storage routes missing all error response schemas
**File:** `apps/server/src/modules/s3-storage/routes.ts`
**Problem:** None of the 4 routes define error schemas (400, 401, 403, 500). OpenAPI docs incomplete, no schema validation on error responses.
**Fix:** Add `ErrorResponseSchema` entries for relevant error codes on each route.

### [x] QA-I3: invite/routes.ts admin check in controller, not preValidation
**File:** `apps/server/src/modules/invite/routes.ts:31-40`, `apps/server/src/modules/invite/controller.ts:10-12`
**Problem:** `POST /invite-tokens` preValidation only calls `jwtVerify()`. The admin check (`if (!request.user?.isAdmin)`) is in the controller. Inconsistent with the pattern used in app/routes.ts, audit/routes.ts where admin checks are in preValidation.
**Fix:** Use the shared `createAdminPreValidation` from QA-I1. Remove the manual admin check from the controller.

### [x] QA-I4: invite/routes.ts missing 401 error schema
**File:** `apps/server/src/modules/invite/routes.ts`, line 25-28
**Problem:** Route defines 403 and 500 but NOT 401. The preValidation throws `UnauthorizedError` (401).
**Fix:** Add `401: ErrorResponseSchema` to the route schema.

### [x] QA-I5: 30 redundant jwtVerify() calls in controllers (already done by preValidation)
**Files and counts:**
- `modules/file/controller.ts` — 5 redundant (checkFile, listFiles, deleteFile, updateFile, moveFile)
- `modules/folder/controller.ts` — 5 redundant (checkFolder, listFolders, updateFolder, moveFolder, deleteFolder)
- `modules/reverse-share/controller.ts` — 12 redundant (createReverseShare, listUserReverseShares, getReverseShare, updateReverseShare, updatePassword, deleteReverseShare, downloadFile, deleteFile, activateReverseShare, deactivateReverseShare, updateFile, copyFileToUserFiles)
- `modules/share/controller.ts` — 7 redundant (createShare, listUserShares, updatePassword, addItems, removeItems, addRecipients, removeRecipients, notifyRecipients)
- `modules/app/controller.ts` — 1 redundant (testSmtpConnection — also has redundant isAdmin check)
**Problem:** Each redundant call hits the `trusted` callback (tokenVersion DB/cache lookup). Wasteful and clutters the code.
**Note:** Intentional jwtVerify calls (routes WITHOUT preValidation) must be preserved:
- `storage/controller.ts` — 2 calls (routes have NO preValidation, controller is sole auth gate)
- `file/download.controller.ts` — 3 calls (optional auth in try/catch for mixed public/authenticated access)
- `share/controller.ts:49` — 1 call (`getShare` — optional auth for mixed public/owner access)
**Fix:** Remove redundant `await request.jwtVerify()` calls from controller methods where the route already has `preValidation`. Keep intentional ones (listed above).

### [x] QA-I6: storage/routes.ts has no preValidation hooks — auth only in controller
**File:** `apps/server/src/modules/storage/routes.ts`
**Problem:** The 2 storage routes (`/storage/disk-space`, `/storage/check-upload`) have no `preValidation` hooks. Auth is done inside the controller. Inconsistent with every other authenticated route in the codebase.
**Fix:** Add shared `preValidation` hook to both routes (same pattern as file/folder/share/etc). Remove jwtVerify from controller.

### [x] QA-I7: Missing integration tests for admin route auth enforcement
**Problem:** No `app.inject()` tests that verify admin-protected routes (app configs, auth-providers, user management) correctly reject unauthenticated (401) and non-admin (403) requests.
**Fix:** Add integration tests covering the shared `adminPreValidation` middleware.

## Minor — Code Quality

### [x] QA-M1: 9 preValidation hooks log JWT failures at `error` level instead of `warn`
**Files (all use `request.log.error` for expected JWT failures):**
- `auth-providers/routes.ts:46`
- `auth/routes.ts:267, 300, 332`
- `share/routes.ts:24`
- `folder/routes.ts:22`
- `file/routes.ts:28`
- `reverse-share/routes.ts:28`
- `two-factor/routes.ts:15`
- `user/routes.ts:23`
- `invite/routes.ts:35`
**Problem:** JWT verification failure in preValidation is an expected event (expired tokens, anonymous access). Logging at `error` pollutes error logs. Only `app/routes.ts` and `audit/routes.ts` correctly use `warn`.
**Fix:** Change all to `request.log.warn`.

### [x] QA-M2: share/controller.ts:53 logs optional JWT failure at `error` level
**File:** `apps/server/src/modules/share/controller.ts`, line 53
**Problem:** `request.log.error({ err }, "JWT verification failed")` in `getShare()` — this is the unauthenticated share access path where JWT failure is completely normal.
**Fix:** Change to `request.log.debug` or remove entirely.

### [x] QA-M3: Missing error schemas on various routes (OpenAPI completeness)
**Files:**
- `s3-storage/routes.ts` — 4 routes, 0 error schemas (covered in QA-I2)
- `storage/routes.ts` — 2 routes, no error schemas after adding preValidation
- `invite/routes.ts` — missing 401 (covered in QA-I4)
**Fix:** Add `ErrorResponseSchema` for all applicable error codes.
