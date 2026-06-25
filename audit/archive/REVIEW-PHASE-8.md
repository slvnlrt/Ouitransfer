# Phase 8 — Polish & Production Readiness — Review Report

## Summary

**Assessment: PASS WITH FINDINGS**

Phase 8 delivers 9 tasks across 10 commits with solid execution. The work is well-structured: timeout hardening, dependency upgrades, frontend security headers, ConfigService refactor, upload resume, i18n completion, test improvements, and CI/performance tooling. Type-checking passes for both server and web. All 208 web tests pass. Server tests: 19 of 21 suites pass; 2 flaky suites (`auth-refresh.integration.test.ts`, `csrf.test.ts`) time out under resource contention but pass individually — the auth-refresh mock was correctly updated for the ConfigService refactor; the csrf test was not modified in Phase 8.

There is **1 Critical** finding (CSP `connect-src` blocks presigned S3 uploads), **3 Important** findings, and **4 Minor** findings.

## Verification

### Type-Check Results
- `pnpm --filter ouitransfer-api type-check` → ✅ exit code 0
- `pnpm --filter ouitransfer-web type-check` → ✅ exit code 0

### Test Results
- `pnpm --filter ouitransfer-web test` → ✅ 17 files, 208 tests, all pass (17.24s)
- `pnpm --filter ouitransfer-api test` → ⚠️ 19 passed, 2 failed (timeout)
  - `auth-refresh.integration.test.ts` — "Hook timed out in 10000ms" (passes when run individually)
  - `csrf.test.ts` — "Hook timed out in 10000ms" (not modified in Phase 8; passes individually)
  - **Verdict**: Resource contention timeouts, not Phase 8 regressions

### Grep Verification
- Remaining Portuguese: `"Erro no removeObject"` found at `apps/server/src/modules/file/service.ts:29` (missed by Task 1)
- `ConfigService` class: Only 2 occurrences remain — both in test file comments (acceptable)
- `process.env` in web `src/lib/`: Only `NEXT_PUBLIC_LOG_LEVEL` (build-time client var, correctly documented)
- `process.env` in middleware: None — uses validated `env.JWT_SECRET`

---

## Findings

### Critical (Must Fix)

#### C-1: CSP `connect-src 'self'` blocks presigned S3 uploads

**File**: `apps/web/src/middleware.ts:70`

The middleware's Content-Security-Policy sets `connect-src 'self'`, which restricts `fetch`/`XMLHttpRequest` to the same origin. However, the upload flow (both regular files and reverse shares) uses Uppy to PUT directly to presigned S3 URLs on the storage server — which is a **different origin** (e.g., `http://storage:9000` or an external S3 endpoint).

This will cause all file uploads to fail in production with a CSP violation:

```
Refused to connect to 'http://storage:9000/bucket/...' because it violates
the Content-Security-Policy directive: "connect-src 'self'"
```

**Fix**: Expand `connect-src` to include the storage endpoint. Since the storage URL is configurable and may be external, this needs a dynamic approach:

```typescript
// Option A: Use the API_BASE_URL and storage URL from env
`connect-src 'self' ${env.API_BASE_URL}`,

// Option B: Use a dedicated env var for allowed connect sources
`connect-src 'self' ${env.CSP_CONNECT_SOURCES || ''}`.trim(),
```

Note: The presigned URL host is determined by `SERVER_IP` on the backend (the public-facing S3 endpoint). The frontend doesn't know this URL at build time. The cleanest fix is to either:
1. Add a `CSP_CONNECT_SOURCES` env var to the web env schema
2. Or proxy uploads through the API (already partially possible via the duplex proxy routes)

---

### Important (Should Fix)

#### I-1: Missed Portuguese string in `file/service.ts`

**File**: `apps/server/src/modules/file/service.ts:29`

Task 1 (commit `03a6cd1`) was specifically about translating all Portuguese comments and strings. One was missed:

```typescript
getLogger().error({ err }, "Erro no removeObject");
```

Should be:

```typescript
getLogger().error({ err }, "Error removing object from storage");
```

#### I-2: Multipart `listParts` and `completeMultipartUpload` lack objectName ownership validation

**Files**: `apps/server/src/modules/file/multipart.controller.ts:111-128`, `apps/server/src/modules/file/multipart.controller.ts:65-87`

The `listParts` and `completeMultipartUpload` endpoints accept an `objectName` from the client but do not validate that the objectName belongs to the authenticated user. The `createMultipartUpload` endpoint correctly generates the objectName server-side with the user's ID prefix, but subsequent operations blindly trust the client-provided objectName.

For the authenticated file routes, this means a user could potentially call `listParts` or `completeMultipartUpload` with another user's objectName/uploadId. While S3 would likely reject mismatched uploadId/objectName combinations, adding a `validateObjectName(objectName, userId)` check (which already exists and is used in `FileController.registerFile`) would provide defense-in-depth.

The reverse-share multipart controller (`reverse-share/multipart.controller.ts`) has the same pattern but is less concerning since those are public endpoints validated by reverse-share access checks.

#### I-3: E2E workflow uses `${{ secrets.FOO || 'fallback' }}` — secrets should not leak into logs

**File**: `.github/workflows/e2e.yml:35-37`

The secrets fallback pattern `${{ secrets.CI_JWT_SECRET || 'ci-test-secret-...' }}` is fine functionally, but the hardcoded fallback strings are printed in the workflow YAML and could be visible in Actions logs. Since these are test-only values this is low-risk, but using `env` block defaults would be cleaner:

```yaml
env:
  JWT_SECRET: ci-test-secret-that-is-at-least-32-characters-long
```

Then override with repository secrets when configured. This avoids the `||` pattern entirely.

---

### Minor (Nice to Have)

#### M-1: `pnpm audit` CI job may fail on transitive vulnerabilities

**File**: `.github/workflows/ci.yml:79`

The commit message for `4457a55` documents "Remaining 3 high vulns are transitive and not directly fixable" (fast-xml-builder via @aws-sdk, fast-uri via @commitlint/@fastify/swagger). The CI audit job uses `--audit-level=high`, which will flag these unfixable transitive vulnerabilities and fail the build. This may cause CI to be red until upstream releases these fixes.

Consider either:
- Using `pnpm audit --audit-level=critical` instead (less strict)
- Adding `pnpm.auditConfig.ignoreCves` in `package.json` for known transitive issues
- Making the audit job `continue-on-error: true` with a warning step

#### M-2: Lighthouse CI `startServerCommand` may not work for production readiness testing

**File**: `.lighthouserc.cjs:6`

The config uses `pnpm dev:web` as the start command, which runs Next.js in development mode. Production performance characteristics (code splitting, minification, optimized images) differ significantly from dev mode. For production readiness assessment, consider using `pnpm build:web && pnpm --filter ouitransfer-web start` instead.

#### M-3: `next.config.ts` uses raw `process.env.ALLOWED_IMAGE_HOSTS` instead of validated env

**File**: `apps/web/next.config.ts:59`

The env schema in `env.ts` now includes `ALLOWED_IMAGE_HOSTS`, but `next.config.ts` still reads it directly from `process.env.ALLOWED_IMAGE_HOSTS`. This is technically correct (Next.js config runs before the app starts), but it creates an inconsistency: the same env var is validated in one place and not the other.

This is not a bug — `next.config.ts` is a build-time config file that runs independently of the app runtime. But for consistency, consider importing and using the validated value.

#### M-4: Test file `smoke.test.tsx` comment references deleted Button tests

**File**: `apps/web/src/__tests__/smoke.test.tsx:4`

The JSDoc says "Previously tested the third-party Button primitive (not meaningful)." This historical comment is fine but will become stale over time. Consider simplifying to just describe what the tests do now.

---

## What I Verified Not To Be A Problem

1. **ConfigService refactor completeness**: Grepped for `ConfigService` class usage — only 2 comment references remain in test files. All 12 production files were correctly migrated to standalone function imports (`getConfigValue`, `setConfigValue`, `validatePasswordAuthDisable`, `validateAllProvidersDisable`, `getGroupConfigs`). Test mocks were correctly updated in `auth-refresh.integration.test.ts`, `admin-prevalidation.integration.test.ts`, and `multipart-list-parts.integration.test.ts`.

2. **Timeout values reasonableness**: `connectionTimeout: 30s` (slowloris protection), `keepAlive: 30s` (conservative, nginx default is 75s), `requestTimeout: 4h` (covers 10GB at ~700KB/s). The JSDoc rationale is clear. The `serverFactory` correctly removes the previous `res.setTimeout(0)` / `req.setTimeout(0)` and sets `server.timeout` to match `requestTimeout`.

3. **Upload resume architecture**: Full-stack implementation is clean. S3 `ListPartsCommand` pagination is correctly handled with `IsTruncated` / `NextPartNumberMarker` loop. Parts with null fields are filtered out. The `listParts` method is added to `StorageProvider` interface, implemented in `S3StorageProvider`, exposed through `FileService`, and routed through both authenticated (`GET /files/multipart/list-parts`) and public (`POST /reverse-shares/alias/:alias/multipart/list-parts`) endpoints. The reverse-share endpoints correctly use POST (not GET) to keep passwords in request body.

4. **Frontend proxy routes**: All 5 new reverse-share multipart routes are correctly registered in `proxy-routes.ts` with `cookie: false` (public endpoints). The authenticated `list-parts` route correctly uses `query: true` for GET query string forwarding.

5. **InternalError class**: Correctly added to `app-error.ts` with status 500 and code `INTERNAL_ERROR`. Used in `getGroupConfigs` for JSON parse failures — appropriate.

6. **Security headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` — all correct and appropriate.

7. **Dependency upgrades**: `@fastify/jwt` 9→10, `nodemailer` 6→8, `@types/nodemailer` 6→8, `axios` 1.10→1.15.2, `next` 15.3.6→15.5.18. Commit message documents specific CVEs fixed and remaining transitive issues. Breaking changes (nodemailer error code rename `NoAuth→ENOAUTH`) are noted as not affecting the codebase.

8. **Env validation expansion**: `API_BASE_URL` with `.url()` validation and trailing-slash stripping, `OAUTH_ALLOWED_REDIRECT_HOSTS` and `ALLOWED_IMAGE_HOSTS` as optional strings — all correctly used in their consumers (`proxy.ts`, `next.config.ts`).

9. **Portuguese comment scan completeness**: Grep for accented Portuguese characters (`àáâãéêíóôõúçÀÁÂÃÉÊÍÓÔÕÚÇ`) in `.ts`/`.tsx` shows only legitimate content: test data in `sanitize-filename.test.ts` and `timing-safe.test.ts`, language names in `language-switcher.tsx`.

10. **Health test quality**: The getter-based mock pattern (`get s3Client()`) with mutable `storageState` is a correct approach for testing dynamic module-level state in Vitest. Tests cover healthy, degraded (DB only), and degraded (both DB + storage) states.

11. **OAuth redirect test quality**: Tests cover all 6 built-in OAuth hosts, relative URLs, protocol-relative attack, malformed URLs, empty strings, and the credential-in-URL attack pattern (`https://allowed@evil.com`). The env-driven extension test correctly uses `vi.doMock`/`vi.resetModules` with `__resetAllowedRedirectHostsForTest()`.

12. **E2E workflow structure**: Docker Compose startup, health check polling, database seeding, artifact upload, and cleanup are all correctly ordered. The Playwright config correctly skips `webServer` in CI mode.

---

## Conclusion

Phase 8 is a strong "polish" phase with appropriate focus areas. The timeout hardening, dependency upgrades, upload resume feature, and CI tooling are all well-executed. The ConfigService refactor is clean and complete.

The **one critical issue** (CSP `connect-src 'self'` blocking presigned S3 uploads) must be fixed before any production deployment — it would completely break file uploads. The 3 Important items should also be addressed, particularly the missed Portuguese string (since Task 1 was specifically about this) and the objectName ownership validation gap.

Overall quality is high. The codebase is in good shape for production readiness once the CSP issue is resolved.
