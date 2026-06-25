# Phase 5 — Batch 3 Review (Tasks 6-7)

Reviewer: critical-mode spec compliance.
Scope: commits `0f4fa32` (Task 6), `fedc90b` + `4302c78` (Task 7).
Verdict: **✅ Spec compliant with caveats** — all critical requirements met. A handful of important and minor findings should be addressed before phase closure (none are blockers).

---

## Spec Compliance Review

### Task 6: File content validation (5.1, 5.2)

**Verdict: ✅ Spec compliant.**

#### 5.1 — MIME/extension consistency + magic-byte verification

- **`apps/server/src/utils/validate-file-content.ts`** (120 lines): two-layer utility implemented.
  - `BLOCKED_MIME_TYPES` Set has exactly the 5 specified entries (`x-executable`, `x-msdownload`, `x-sh`, `x-shellscript`, `x-msdos-program`). ✓
  - `DANGEROUS_EXTENSIONS` Set has exactly the 22 specified entries. ✓ (verified character-by-character against spec)
  - `isMimeTypeConsistent(mimeType, extension)` correctly:
    - returns `true` when `mimeType` is `undefined` (optional field) — line 51
    - blocks dangerous MIME types unconditionally — line 57-59
    - blocks dangerous extensions when paired with a "benign" MIME (image/*, video/*, audio/*, application/pdf, text/plain) — lines 62-72
    - is case-insensitive and strips leading `.` from extension — lines 53-54
  - `verifyMagicBytes(buffer, declaredMime)`:
    - allows when `declaredMime` is undefined ✓
    - allows when `file-type` cannot detect (text/CSV files) ✓
    - exact-match shortcut ✓
    - equivalence map handles `image/jpg ↔ image/jpeg` and `audio/mp3 ↔ audio/mpeg` ✓
    - falls back to same major-type as "consistent" (lines 113-116) ✓
    - returns `{valid: false, detected, declared}` on cross-major mismatch ✓

- **`apps/server/src/modules/file/dto.ts:7`**: `mimeType: z.string().optional()` added to `RegisterFileSchema`. ✓

- **`apps/server/src/modules/file/routes.ts:81`**: route uses `body: RegisterFileSchema` directly — no schema duplication, so Rule 10 is automatically satisfied (single source of truth). ✓

- **`apps/server/src/modules/reverse-share/dto.ts:119`**: `mimeType: z.string().optional()` added to `UploadToReverseShareSchema`. ✓

- **`apps/server/src/providers/s3-storage.provider.ts:267-284`**: `getObjectHead(objectName, bytes=4096)` ranged GET implemented (uses `Range: bytes=0-4095`). ✓

- **`apps/server/src/types/storage.ts:7`**: `getObjectHead(objectName, bytes?)` added to `StorageProvider` interface — verified on interface, not just S3 implementation. ✓

- **`apps/server/src/modules/file/service.ts:43-45`**: wrapper exists on `FileService.getObjectHead`. ✓

- **`apps/server/src/modules/file/controller.ts:73-100`**: two-layer validation wired into `registerFile`:
  - Layer 1 (consistency check) at line 73 — throws `ValidationError` on mismatch.
  - Layer 2 (magic-byte check) at lines 78-100, inside try/catch — re-throws `ValidationError` from magic mismatch, swallows S3 read failures with a warn log. ✓

- **`apps/server/src/modules/reverse-share/upload.service.ts:183-185, 253-255`**: `isMimeTypeConsistent` wired into both `registerFileUpload` and `registerFileUploadByAlias`. ✓ (Note: only Layer 1, Layer 2 magic-byte check is intentionally not applied to reverse-shares per implementer's choice — this is reasonable but undocumented in code; see Important finding I-2.)

- **`file-type` dependency**: `apps/server/package.json` adds `"file-type": "^22.0.1"` to `dependencies`. ✓

- **Tests** (`apps/server/src/utils/__tests__/validate-file-content.test.ts`): 16 test cases covering all branches including PNG-magic-byte fixture, equivalence map, undefined mime, case insensitivity, leading-dot extension. ✓

#### 5.2 — Return maxFileSize in presigned URL response

- **`apps/server/src/modules/file/controller.ts:57-59`**: `getPresignedUrl` computes `maxFileSize` from `ConfigService` and returns it in the response body. ✓
- **`apps/server/src/modules/file/routes.ts:58-62`**: 200 response schema includes `maxFileSize: z.number()`. ✓ (Rule 10 satisfied.)

---

### Task 7: AppError hierarchy + migrations (5.11, 5.16)

**Verdict: ✅ Spec compliant for declared scope.** All claimed controllers are migrated. Three controllers/middlewares are outside the declared scope and still use `reply.status(N).send({error})` — see Important findings.

#### 5.11 — AppError class hierarchy

- **`apps/server/src/utils/app-error.ts`** (57 lines): all 6 subclasses present with correct status codes/codes:
  - `AppError` base with `statusCode`, `message`, `code`, `details` ✓
  - `NotFoundError` → 404 / `NOT_FOUND` (default message "Not found") ✓
  - `ValidationError` → 400 / `VALIDATION_ERROR` (accepts `details`) ✓
  - `ForbiddenError` → 403 / `FORBIDDEN` (default "Access denied") ✓
  - `UnauthorizedError` → 401 / `UNAUTHORIZED` (default "Unauthorized") ✓
  - `ConflictError` → 409 / `CONFLICT` ✓
  - `GoneError` → 410 / `GONE` ✓ (correctly added per spec)
- File header documents the "always client-safe" convention. ✓
- **Tests** (`apps/server/src/utils/__tests__/app-error.test.ts`): 10 test cases covering every subclass. ✓

- **`apps/server/src/utils/error-handler.ts:150-159`**: `globalErrorHandler` handles `AppError` **first** (branch 0), before Zod/Prisma/JWT/Fastify branches. Only includes `details` when present (correctly omits the field rather than serializing `undefined`). ✓

- **error-handler tests** (`apps/server/src/__tests__/error-handler.test.ts`): 32 tests total, of which the new "AppError domain errors" describe block (lines 124-212) contains 7 tests covering every subclass + a logging assertion. ✓ Matches the claim of "7 new tests."

#### 5.16 — Controller and service migration

- **All 3 mapper functions are fully removed**: `git grep` for `mapShareError\|mapReverseShareError\|mapReverseShareMultipartError` returns nothing across `apps/server/src/`. ✓

- **Controllers migrated** (verified via direct read + `git grep` for residual `reply.status(N).send({ error })` in error paths):
  - `app/controller.ts`, `auth/controller.ts`, `auth-providers/controller.ts`, `file/controller.ts`, `file/download.controller.ts`, `file/multipart.controller.ts`, `folder/controller.ts`, `invite/controller.ts`, `reverse-share/controller.ts`, `reverse-share/multipart.controller.ts`, `s3-storage/controller.ts`, `share/controller.ts`, `storage/controller.ts`, `two-factor/controller.ts`, `user/controller.ts` — all migrated to throw AppError subclasses. ✓
  - `file/download.controller.ts` migrated (Pass 2). ✓
  - Remaining `reply.status(N).send()` calls in these files are all **success paths** (201, 200) — verified via grep. ✓

- **Remaining try/catch blocks** in migrated controllers (8 files) are legitimate and intentional:
  - `storage/controller.ts:13,31` — wraps `jwtVerify()` to convert to `UnauthorizedError` ✓
  - `share/controller.ts:48` — optional JWT verify for public-share access (anonymous fallback) ✓
  - `file/controller.ts:78` — guards S3 magic-byte read (swallows S3 errors as warning) ✓
  - `file/download.controller.ts:59,109,169` — optional JWT verify for public download access ✓
  - `auth-providers/controller.ts:90,224,249` — URL validation, Zod parse wrap-around ✓
  - `auth-providers/controller.ts:320` — callback handler intentionally converts errors to redirects (documented with comment line 318) ✓
  - `auth/controller.ts:111` — verify call (acceptable)
  - `app/controller.ts:37` — single guarded call

- **Services migrated to throw AppError** (`apps/server/src/modules/{auth,auth-providers,email,file,folder,invite,reverse-share,share,storage,two-factor,user,app,config}/service.ts` + sub-services): verified via diff stat — 17 service files changed, all imports of `AppError`/subclasses present. ✓

- **`throw new Error()` residuals** in `apps/server/src/modules/`: `git grep` finds **5** total, not 3 as claimed:
  1. `reverse-share/upload.service.ts:350` — retry-loop internal (caught immediately) ✓ acceptable
  2. `reverse-share/upload.service.ts:354` — retry-loop internal ✓ acceptable
  3. `reverse-share/upload.service.ts:372` — retry-loop internal ✓ acceptable
  4. **`auth/challenge.ts:29`** — "Invalid challenge token" (not mentioned by implementer)
  5. **`file/embed-token.ts:66`** — "Invalid embed token" (not mentioned by implementer)
  Items 4-5 are token-verification helpers; their callers (`embed.controller.ts:24`, `auth/controller.ts`) catch and translate. They are functionally fine as internal sentinels, but the implementer's count of "only 3" is wrong. See Minor finding M-1.

---

### Test Runs

#### `pnpm --filter ouitransfer-api test`
```
 Test Files  10 passed (10)
      Tests  106 passed (106)
   Duration  1.70s
```
✓ All server tests pass, matches the implementer's claim of 106.

#### `pnpm --filter @ouitransfer/shared test`
```
 Test Files  1 passed (1)
      Tests  11 passed (11)
   Duration  294ms
```
✓ Shared tests pass.

#### `pnpm --filter ouitransfer-api type-check`
```
> tsc --noEmit
(no errors)
```
✓ TypeScript compiles cleanly.

---

## Findings

### Important

**I-1 — `file/embed.controller.ts` is NOT migrated.**
Location: `apps/server/src/modules/file/embed.controller.ts` (132 lines, untouched in this batch).
The spec said "ALL controllers (not just 14 from original plan — `download.controller.ts` was added)". The implementer's report lists 15 controllers, but `embed.controller.ts` is a 17th controller (per `Glob apps/server/src/modules/**/*controller.ts` returns 17 files, excluding the trivial `health/controller.ts`).
This file still has:
- A blanket outer `try/catch` around `embedFile` (lines 12-97) and `generateEmbedToken` (lines 101-130).
- 11 `reply.status(N).send({ error })` calls for ERROR cases (lines 16, 24, 37, 42, 47, 57, 64, 78, 96, 104, 119-121, 129).
- Line 96 has the classic pattern this migration was meant to eliminate: `reply.status(500).send({ error: "Internal server error." })` inside a catch-all.
- Line 129 forwards `error.message` directly to the client — exactly the leak the AppError convention was designed to prevent.

**Correction path**: Migrate `embed.controller.ts` to throw `ValidationError`/`UnauthorizedError`/`NotFoundError`/`GoneError`/`ForbiddenError` and drop the outer try/catch. This is a ~30-minute task with no risk; the file uses the same patterns already migrated elsewhere.

**I-2 — Magic-byte verification is silently absent from reverse-share uploads.**
Location: `apps/server/src/modules/reverse-share/upload.service.ts:183-185, 253-255`.
Only Layer 1 (`isMimeTypeConsistent`) is wired into reverse-share registration. Layer 2 (`verifyMagicBytes`) is intentionally omitted but with no comment explaining why. Given reverse-shares accept uploads from **untrusted external users** (the more dangerous surface), this is a defensible-but-undocumented gap. Either:
- (a) Add Layer 2 to reverse-share registration (preferred — same call as file/controller.ts:78-100), OR
- (b) Add an inline comment justifying the omission (e.g., "reverse-share file uploads do not run magic-byte verification because objectName namespace is enforced and per-share quotas limit blast radius").

The spec said "Two-layer validation wired into `file/controller.ts` registerFile" and "`isMimeTypeConsistent` also wired into `reverse-share/upload.service.ts`" — strictly speaking, the implementer matched the spec. But the asymmetry is worth flagging since reverse-shares are the higher-risk path.

**I-3 — No integration test for the new `mimeType` route+controller wiring.**
The `validate-file-content.test.ts` covers the utility in isolation, but no test uses `app.inject()` to POST `/files` with a `mimeType` field and verify it survives Fastify/Zod route parsing into the controller. Rule 10/11 in `CLAUDE.md` was added precisely because of this class of bug — but in this case, the route uses `body: RegisterFileSchema` directly (same Zod object as the controller parses), so structurally the field cannot be stripped. The bug-class is mitigated by design, but the documented testing discipline is missing.

**Correction path**: add a minimal `app.inject()` test (e.g. in `apps/server/src/modules/file/__tests__/`) that posts a registerFile body with `mimeType: "image/jpeg"` and verifies the validation runs (or skip the magic-byte branch via a buffer mock).

### Minor

**M-1 — Implementer's residual `throw new Error()` count is wrong (5, not 3).**
`auth/challenge.ts:29` and `file/embed-token.ts:66` were not mentioned. Both are legitimately internal token-verification sentinels — but the under-count weakens confidence in the report's accuracy. No code change needed; update the implementer's notes to say "5 internal sentinels" with locations enumerated.

**M-2 — Route-level `preValidation` hooks still emit `reply.status(N).send({ error })`.**
- `apps/server/src/modules/app/routes.ts:30, 34`
- `apps/server/src/modules/auth-providers/routes.ts:46, 53`
- `apps/server/src/modules/file/routes.ts:27`
- `apps/server/src/modules/folder/routes.ts:21`
- `apps/server/src/modules/reverse-share/routes.ts:28`
- `apps/server/src/modules/share/routes.ts:23`
- `apps/server/src/modules/s3-storage/routes.ts:20`
- `apps/server/src/modules/user/routes.ts:21,27,32,327,354`
- `apps/server/src/modules/user/middleware.ts:14`
These are inline preValidation/middleware hooks, not controllers, so they are arguably out of scope for 5.16. But the **point of a centralized error handler is to remove duplication** — having ~12 inline sites that emit error shapes inconsistent with `ErrorResponse` (e.g. `{success: false, error: "..."}` in `auth-providers/routes.ts` vs `{error: "..."}` elsewhere) undermines the consistency goal. Converting these to `throw new UnauthorizedError(...)` etc. would unify the error response shape across the API. Recommend Phase 5 follow-up.

**M-3 — Brittle catch guard in magic-byte verification.**
`apps/server/src/modules/file/controller.ts:92-100`:
```ts
} catch (err) {
  if (err instanceof ValidationError) throw err;
  ...swallow...
}
```
Today the only AppError thrown inside is `ValidationError`, but if a future change throws another `AppError` subclass (e.g. a `GoneError` from a different S3 path), it would be silently swallowed. Prefer `if (err instanceof AppError) throw err;` — broader and future-proof.

**M-4 — `s3-storage/controller.ts:142` returns 501 inline.**
The `upload` stub returns `reply.status(501).send({...})` with a friendly message. Functionally fine, but for consistency it should use a new `NotImplementedError` (501) AppError subclass or be removed entirely (it's a dead endpoint).

**M-5 — `error-handler.ts:14-19` retains a leftover comment.**
"`Controllers that manually return errors should also follow this shape (to be migrated in a future task).`" This task is now complete (5.16). The comment is stale and should be removed or replaced with a reference to the AppError convention.

### Not findings (verified as intentional)

- `try { await request.jwtVerify(); } catch { ... }` patterns in share/download controllers are intentional — they support optional/anonymous JWT verification for public share access. Comment lines exist explaining the design choice.
- `reply.status(201).send({...})` and `reply.status(200).send({...})` in migrated files are success paths, not errors.
- `auth-providers/controller.ts:320` outer try/catch is intentional — callback errors redirect to login, not JSON (documented at line 318).
- `BLOCKED_MIME_TYPES` does not include `application/x-bat` or `application/x-php` etc. — the spec said exactly the 5 entries present, and the safety net is `DANGEROUS_EXTENSIONS`.

---

## Summary

| Aspect | Status |
|---|---|
| 5.1 utility + tests | ✅ |
| 5.1 wired into file controller (both layers) | ✅ |
| 5.1 wired into reverse-share (Layer 1 only) | ✅ (asymmetry flagged as I-2) |
| 5.1 `mimeType` in both DTOs | ✅ |
| 5.1 `getObjectHead` on interface + provider | ✅ |
| 5.2 `maxFileSize` in response + route schema | ✅ |
| 5.11 AppError + 6 subclasses incl. `GoneError` | ✅ |
| 5.11 `globalErrorHandler` handles AppError first | ✅ |
| 5.16 mapper functions removed | ✅ |
| 5.16 all controllers migrated | ❌ `embed.controller.ts` missed (I-1) |
| 5.16 all services migrated | ✅ |
| Tests pass | ✅ 106 server + 11 shared, type-check clean |

**Recommendation**: address **I-1** (migrate `embed.controller.ts`) before closing the batch — it's the only finding that contradicts the spec's literal wording ("ALL controllers"). I-2 and I-3 should be addressed but can be tracked as Phase-5 follow-ups. Minor findings can roll into `TODO-POST-PHASE-5.md`.



---

## Code Quality Review

Reviewer: critical-mode, principal engineer perspective.
Scope: same diff range (`378eeb4..61791a9`). Independent pass focused on correctness, security, testing rigor, and architectural integrity — not spec compliance.

### Findings Summary
| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 2 | C-1, C-2 |
| Important | 7 | I-1, I-2, I-3, I-4, I-5, I-6, I-7 |
| Minor | 6 | M-1, M-2, M-3, M-4, M-5, M-6 |

### Critical

**C-1 — Error response shape is silently truncated for ~98% of routes (route schemas drop `code`/`statusCode`/`details`).**
`globalErrorHandler` (`apps/server/src/utils/error-handler.ts:138-227`) builds an `ErrorResponse = { error, code, statusCode, details? }`. But the response schemas registered in route files declare only `{ error: z.string() }` — confirmed by ripgrep: 264 occurrences of `z.object({ error: z.string()… })` vs. **5** schemas that include `code`. `fastify-type-provider-zod`'s serializer compiler calls `schema.parse(data)` which strips unknown fields (Zod's default `.strip()` mode). Net effect: the rich `ErrorResponse` the handler builds is silently truncated to `{ error: "..." }` before the client sees it — `code`, `statusCode`, and `details` are dropped on the wire for nearly every route. This means:
- Clients cannot rely on `code` for programmatic error handling (defeats half the purpose of the centralized handler).
- The Zod-validation `details.issues` array is dropped — UX regression vs. what the new handler intended.
- Tests for the error handler (`apps/server/src/__tests__/error-handler.test.ts`) verify the *handler output* but not the *wire response*, so this is invisible to the test suite.

**Fix path**: either (a) add a shared error schema (`const ErrorResponseSchema = z.object({ error, code, statusCode, details: z.unknown().optional() })`) and reference it in every route's 4xx/5xx response slots, or (b) globally configure Zod's serializer to use `.passthrough()` for error responses. (a) is the clean answer. Without this fix, the entire `AppError`/`code`/`details` apparatus is half-built.

**C-2 — `RegisterFile` accepts an arbitrary `objectName` from the client; the new `getObjectHead` makes the existing missing ownership check more exploitable.**
`apps/server/src/modules/file/controller.ts:71-148` parses `input.objectName` and uses it verbatim for both the new `getObjectHead` call (line 80) **and** the `prisma.file.create` (line 144). There is no check that `input.objectName.startsWith(\`${userId}/\`)`. The reverse-share equivalent does validate (`upload.service.ts:413-428` — `validateObjectName`), so the omission here is conspicuous.

Two consequences:
1. **Pre-existing**: an authenticated user can register a DB record claiming ownership of *any* object in the bucket, including another user's path — content-theft / cross-tenant access. (Not introduced by this batch.)
2. **Newly worsened by this batch**: `getObjectHead` reads the first 4 KB of the supplied `objectName` server-side. An attacker can now ping arbitrary objects and infer existence / partial content via the magic-byte mismatch error vs. the silent-skip path (`controller.ts:93-101`). The leak is small (mismatch boolean + 8-bit MIME type) but it's a new oracle on a previously inaccessible namespace.

**Fix path**: enforce `input.objectName.startsWith(\`${userId}/\`)` at the top of `registerFile`, mirroring `ReverseShareUploadService.validateObjectName`. Throw `ValidationError("Invalid object name")`. This belongs in this batch — it's directly adjacent to the new code and the asymmetry with reverse-share is glaring.

### Important

**I-1 — `validateObjectName` is the only objectName guard, but the regular file flow has none.**
Mirror of C-2 from the design-symmetry angle: `apps/server/src/modules/reverse-share/upload.service.ts:413-428` correctly rejects null bytes, `..` sequences, and namespace-prefix mismatch. Same protections are absent in `file/controller.ts:registerFile`. The function should be extracted to a shared util (`utils/validate-object-name.ts`) and applied in both places.

**I-2 — `AppError` "client-safe message" convention is violated in 3 places.**
The doc comment at `apps/server/src/utils/app-error.ts:1-10` is explicit: "AppError messages are ALWAYS client-safe. Never construct them from raw error.message or error.toString()." Verified violations:
- `apps/server/src/modules/auth-providers/oauth-flow.service.ts:234` — `throw new UnauthorizedError(\`Token exchange failed: ${tokenResponse.status} - ${errorText}\`)` includes the raw upstream response body.
- `apps/server/src/modules/auth-providers/oauth-flow.service.ts:259-261` — same pattern for `UserInfo request failed: ${userInfoResponse.status} - ${errorText}`.
- `apps/server/src/modules/reverse-share/upload.service.ts:381` — `throw new ValidationError(\`Failed to copy file after ${maxRetries} attempts: ${message}\`)` where `message` is `error.message` from a fetch/S3 failure.

The OAuth ones happen to be caught by `auth-providers/controller.ts:handleCallbackError` which converts to a sanitized message before redirect — but that's load-bearing happenstance. If a future caller invokes these service methods outside the OAuth callback flow (which uses non-standard redirect-based error handling), raw upstream OAuth provider bodies will leak to the client.

The reverse-share retry leak (line 381) has no such safety net — it goes straight through `globalErrorHandler` to the response. The error type is also wrong: a fetch/upload retry exhaustion is **not a validation error** (400). It should be a 500 / `AppError(500, "File copy failed", "COPY_FAILED")` with the raw message logged via `getLogger().error` instead.

**Fix path**: hardcode safe messages; log the upstream detail server-side.

**I-3 — `AppController.updateConfig` downgrades a 404 to a 400.**
`apps/server/src/modules/app/controller.ts:37-46` wraps `appService.updateConfig` and on catch checks `message === "Configuration not found"`, then throws `ValidationError("Configuration not found")` — i.e. 400. But `app.service.ts:78-79` already throws `NotFoundError("Configuration not found")` (404). The catch block intercepts the 404 and rewrites it to 400. This is dead/incorrect translation logic left over from the pre-AppError world. The entire try/catch is now redundant: just call `this.appService.updateConfig(...)` and let the existing `NotFoundError` propagate.

**I-4 — `isMimeTypeConsistent` is structurally weak; documented as "consistency check" but advertised as security.**
`apps/server/src/utils/validate-file-content.ts:50-75`:
- If `mimeType` is undefined → returns `true` (line 51). Since `mimeType` is `.optional()` in the Zod schema, attackers omit it.
- If `mimeType` is `application/octet-stream`, `application/zip`, etc. → returns `true` for *any* extension including `.exe`, `.bat`, `.ps1`. The "dangerous extension" check only fires for the narrow set of "benign-looking" MIME types (`image/*`, `video/*`, `audio/*`, `application/pdf`, `text/plain`).
- Conversely, blocks legitimate code uploads: `evil.js`/`script.py`/`build.sh` with `mimeType: "text/plain"` (which is the *correct* MIME for plain text files) is rejected. This is a real UX regression for legitimate file-transfer use cases (developers sharing scripts).

Net: the function catches naive disguise attempts (exe-with-image-jpeg) and false-positives on legitimate text uploads. Either drop the `text/plain` branch from the "benign" set (sources files are commonly text/plain), or switch to an explicit allowlist mode with a config flag. At a minimum, the function's docstring should be downgraded from "MIME/extension denylist check" to "best-effort heuristic; not a security boundary".

The same applies symmetrically in `reverse-share/upload.service.ts:183` and `:253` — this is the **only** content check on the reverse-share path (no magic bytes), so its weakness compounds.

**I-5 — Magic-byte verification silently falls back on S3 read failure, making it a soft check at best.**
`apps/server/src/modules/file/controller.ts:93-101` — `catch (err) { … request.log.warn(...) }`. Any S3 error (object missing, transient network failure, IAM error, byte-range refused) skips the magic-byte check. An attacker who can induce S3 to error on a specific object bypasses Layer 2 entirely. The comment claims "the consistency check above still passed" — but I-4 shows Layer 1 is also bypassable. Both layers can fail soft simultaneously.

**Fix path**: at minimum, distinguish "no body" / "byte-range refused" (legitimate skip) from genuine read errors (treat as suspect). For genuine errors on a freshly-uploaded object, reject the registration — the object should exist if the client just uploaded it via presigned URL.

**I-6 — Zero integration tests for the new validation flow and the AppError → response pipeline (violates Rule 11).**
The new `mimeType` field passes through: Zod route schema → controller `RegisterFileSchema.parse` → `isMimeTypeConsistent` → `getObjectHead` → `verifyMagicBytes` → `prisma.file.create`. Plus the AppError → globalErrorHandler → Zod serializer pipeline. **None** of this is covered by an `app.inject` test. Confirmed via `grep "app.inject"` — only `csrf.test.ts` and `health.test.ts` use it.

This is exactly the scenario Rule 11 was written for. Unit tests of `isMimeTypeConsistent`, `verifyMagicBytes`, and `globalErrorHandler` in isolation don't catch:
- The C-1 schema-stripping bug (would manifest in `app.inject` immediately).
- Route-level Zod stripping of `mimeType` if `routes.ts` and `dto.ts` ever drift (Rule 10).
- The S3-read-failure soft-skip path (I-5) — easily verified with a mocked `FileService.getObjectHead` that rejects.

At least one integration test per new path is required by repo policy.

**I-7 — Three different error response shapes coexist; the centralized handler is undermined.**
- `{ error, code, statusCode, details? }` from `globalErrorHandler` (when route schemas permit — see C-1).
- `{ error }` from preValidation hooks in `file/routes.ts:27`, `folder/routes.ts:21`, `reverse-share/routes.ts:28`, `share/routes.ts:23`, `s3-storage/routes.ts:20`, `app/routes.ts:30,34`.
- `{ error, success: false }` from `auth-providers/routes.ts:46-57`.
Plus `user/middleware.ts:14` (`validatePasswordMiddleware`) sends `{ error }` without `code`. The point of Task 5.16 was a single error shape; this is undermined by 7+ preValidation hooks and one middleware that bypass the global handler entirely.

**Fix path**: replace `reply.status(N).send({ error })` with `throw new UnauthorizedError(...)` / `throw new ForbiddenError(...)` in every preValidation/middleware. Fastify v5 supports throwing from hooks; the global error handler will pick them up. Same for `auth-providers/routes.ts` — drop the bespoke `{ success: false, error }` shape.

### Minor

**M-1 — `reply.sent` checks scattered across `auth-providers/controller.ts` are dead code.**
Lines 169, 176, 191, 262, 275 (and more). Since the preValidation hook sends a response before the handler runs, Fastify skips the handler — these checks were defensive but never trigger. They should be removed for clarity. (If they ever fire, something more serious is wrong and we'd want a thrown error, not a silent `return`.)

**M-2 — `BLOCKED_MIME_TYPES` set is curiously narrow (5 entries) given the doc comment "never acceptable regardless of extension".**
Missing common executable-MIME aliases: `application/x-dosexec`, `application/x-bat`, `application/x-msi`, `application/x-php`, `application/x-perl`, `application/x-python-code`, `application/java-archive`. Either expand the list or downgrade the comment to "high-risk MIME flags". Tracking issue: this is a denylist, and denylists are perpetually incomplete; the comment should reflect that.

**M-3 — `s3-storage.provider.ts:getObjectHead` collects the byte-range stream into a `Buffer` with no size cap.**
Lines 263-282. If a misconfigured caller passes a huge `bytes` value (or if a future bug invokes it without the default), the entire object could be loaded into memory. Trivially mitigated: `if (bytes > 65536) throw new Error("…")` or clamp the parameter. Defense in depth.

**M-4 — `email/service.ts:157` — `ValidationError` is the wrong type for SMTP connectivity failure.**
SMTP test failures are infrastructure errors (502/503-class), not validation errors. The endpoint is admin-only so the user-facing impact is small, but the semantic is wrong. Should be an `AppError(502, "SMTP connection failed", "SMTP_ERROR")` with the raw message logged (and not interpolated into the public message — see I-2).

**M-5 — `oauth-flow.service.ts:285` throws `"No email address found in ${config.name} account"`, but `controller.ts:135` checks `errorMessage.includes("No email found")`.**
String mismatch. The controller's `no_email` branch never triggers; falls through to `unknown_error`. Pre-existing bug (the original `Error` also said "No email address found"), but **this batch touched both files and missed the opportunity to fix it**. The whole `determineCallbackError` string-matching approach is brittle — would benefit from `error instanceof ValidationError` and a tagged `code` field on the `AppError` instead (which is exactly what the new `code: "VALIDATION_ERROR"` is for, and which is now available).

**M-6 — `s3-storage/controller.ts:142-146` returns 501 via `reply.status(501).send({ error, message })` instead of `throw new AppError(501, ...)`.**
Inconsistent with the rest of the migration. The endpoint is documented as a backward-compat stub, so it's low-value, but for consistency it should `throw new AppError(501, "Use getUploadUrl endpoint", "NOT_IMPLEMENTED")`. Or — preferably — be deleted, since the rule "no production, no legacy" applies.

### Strengths

- **AppError hierarchy is well-designed.** Six subclasses cover the realistic HTTP error space without over-engineering. `details?: Record<string, unknown>` is a sensible escape hatch. `name = "AppError"` (rather than per-subclass names) is a deliberate, sane choice that keeps logs uniform.
- **`globalErrorHandler` branch order is correct and defensive.** AppError → Zod → Response serialization → JWT → Prisma → Fastify 4xx → Fastify 5xx → unknown. Each unknown-error case logs the full error via `request.log.error({ err })` so Pino serializes it properly. Generic messages for 5xx and unknown errors prevent stack-trace leaks.
- **31 tests for the error handler** cover every branch including edge cases (thrown strings, Prisma P9999 unknown codes, JWT prefix-based detection of future error codes, Fastify 5xx message sanitization). High coverage, well-structured.
- **Net code reduction of ~600 lines is real**: per-controller try/catch ladders, mapper helpers, and repeated 401/404 boilerplate are gone. The reverse-share controller alone dropped 400+ lines.
- **The `getObjectHead` implementation correctly uses `Range: bytes=0-N`** — efficient (1 request, no full download) and S3-compatible across providers.
- **Magic-byte equivalence handling** (`image/jpg` → `image/jpeg`, same-major-type fallback) avoids common false positives without losing protection.
- **Reverse-share `validateObjectName`** is excellent: null-byte rejection, path-traversal rejection, namespace-prefix enforcement. This should be the pattern used everywhere (see C-2 / I-1).

### Verdict

**Approve with conditions.** The batch ships real value (centralized error handling, real new content validation, ~600 line reduction). But two issues need to be fixed before phase closure:

1. **C-1 (response schema stripping)** is a blocker for the practical value of the work. The rich error shape exists in code but not on the wire. Fix: introduce a shared `ErrorResponseSchema` and reference it from all route 4xx/5xx response slots.
2. **C-2 (objectName ownership not enforced in `registerFile`)** is a security gap that this batch's `getObjectHead` made marginally worse. Fix: enforce `input.objectName.startsWith(\`${userId}/\`)` in `registerFile`, ideally extracting the existing reverse-share `validateObjectName` to a shared util.

I-1 through I-7 should be addressed in `TODO-POST-PHASE-5.md`. In particular, **I-6 (no integration tests)** is a recurring failure mode flagged explicitly in `CLAUDE.md` Rule 11 and should be a hard requirement before any future security-touching batch. Add a single `app.inject` test that POSTs to `/api/files` with a synthetic JWT and asserts the AppError → wire-response shape.

Minor findings can be deferred to backlog with the explicit exception of M-5 (the `No email found` string mismatch) which is a free fix while the file is open.
