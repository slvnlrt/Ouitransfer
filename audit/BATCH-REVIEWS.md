\## BATCH 1



\---

Security Fix Verification Report

0.1 — Prototype pollution protection re-enabled — PASS

apps/server/src/app.ts:36-37:

onProtoPoisoning: "error",

onConstructorPoisoning: "error",

Both set to "error" as required. Correct.

\---

0.2 — Body limit reduced to 50MB — PASS (with one concern)

\- apps/server/src/app.ts:30 — bodyLimit: 50 \* 1024 \* 1024 ✓

\- apps/server/src/server.ts:65 — fileSize: 50 \* 1024 \* 1024, // 50MB ✓

\- apps/server/src/modules/reverse-share/routes.ts:389 — bodyLimit: 50 \* 1024 \* 1024 ✓

\- apps/web/next.config.ts:22 — bodySizeLimit: "50mb" ✓

All four values match the spec.

Concerns (non-blocking, but worth flagging):

1\. Functional regression risk — this is a big one. The app advertises itself as a "WeTransfer alternative" and reverse-share/routes.ts literally exposes a multipart upload API for files ≥100MB (see line 605: "Initializes a multipart upload for large files (≥100MB)"). A 50MB global bodyLimit on the Fastify app is fine for API metadata payloads (presigned URL requests, register-file calls), because actual file bytes go to S3 directly via presigned URLs — they never hit Fastify's body parser. So this is probably safe in practice.

&#x20;  

&#x20;  However, fastifyMultipart.limits.fileSize = 50MB in server.ts:65 means any route that still accepts multipart file uploads through Fastify itself is now capped at 50MB. If any legacy "upload via API" path exists (non-presigned), it will silently truncate/reject >50MB files. Recommend grepping for request.file() / request.files() callers and confirming they're all metadata, not raw file bytes. If any raw-bytes path exists, either migrate it to presigned uploads or make the limit configurable via env var.

2\. Stylistic — reverse-share/routes.ts:389 has an odd leading-space indent (       bodyLimit: — 7 spaces vs 6 for the other properties). Not a bug but will show up in any formatter pass.

3\. Defense-in-depth suggestion: the 50MB value is hardcoded in 4 places. Centralize it (e.g., env.BODY\_LIMIT\_BYTES with 50 \* 1024 \* 1024 default) so operators can tune without touching code.

\---

0.5 — CORS restricted to allowlist — PASS

apps/server/src/app.ts:71-84:

const allowedOrigins = process.env.CORS\_ORIGINS

&#x20; ? process.env.CORS\_ORIGINS.split(",").map((o) => o.trim())

&#x20; : \["http://localhost:3000", "http://localhost:5487"];

app.register(fastifyCors, {

&#x20; origin: (origin, cb) => {

&#x20;   if (!origin || allowedOrigins.includes(origin)) {

&#x20;     cb(null, true);

&#x20;   } else {

&#x20;     cb(new Error("Not allowed by CORS"), false);

&#x20;   }

&#x20; },

&#x20; credentials: true,

});

\- origin: true is gone ✓

\- Allowlist from CORS\_ORIGINS env var with sensible localhost defaults ✓

\- credentials: true preserved ✓

Minor concerns (not failures):

\- !origin is allowed (same-origin, curl, server-to-server). That's the standard pattern and is fine, but combined with credentials: true and trustProxy: true, it means any non-browser client (no Origin header) effectively bypasses the check. This is expected CORS behavior — CORS is a browser mechanism — but worth documenting.

\- Production footgun: if an operator forgets to set CORS\_ORIGINS in production, they get localhost-only, which will break the deployed web app. A startup warning when NODE\_ENV=production \&\& !CORS\_ORIGINS would be prudent. Not a security failure; an operability concern.

\- http://localhost:3000 is not used by any app in this monorepo (web=5487, docs=3001, server=3333). Where does 3000 come from? Probably Fumadocs dev default or legacy. Worth verifying; if unused, drop it.

\---

0.6 — SECURE\_SITE defaults to "true" — PASS

\- apps/server/src/env.ts:22: SECURE\_SITE: z.union(\[z.literal("true"), z.literal("false")]).default("true") ✓

\- apps/server/src/server.ts:47-51: warning is logged when SECURE\_SITE === "false" ✓

Correct.

Minor: the warning is logged once at startup. If an operator starts the server and never reads the log, they may not notice. Optionally: also emit on each cookie-issuing request in dev, or refuse to start if SECURE\_SITE=false \&\& NODE\_ENV=production. Not required for this fix.

\---

0.12 — TLS bypass scoped to S3 only — PASS

Verified:

1\. No global TLS bypass anywhere in apps/server/ — grep NODE\_TLS\_REJECT\_UNAUTHORIZED returns zero matches. ✓

2\. Imports at storage.config.ts:2-5: https, NodeHttpHandler from @smithy/node-http-handler, and S3Client. Correct. ✓

3\. Both s3Client (line 92-97) and createPublicS3Client (line 149-154) use NodeHttpHandler with an httpsAgent that respects rejectUnauthorized. ✓

4\. rejectUnauthorized is derived from env.S3\_REJECT\_UNAUTHORIZED (defaulting to "true", i.e., secure-by-default). ✓

5\. @smithy/node-http-handler is present in the lockfile (4.0.6) as a transitive dep of the AWS SDK — no new package.json install needed, it resolves at runtime. ✓

Minor observations:

\- httpsAgent is set unconditionally, even when useSSL=false (http). In that case the agent is unused by the underlying handler, so it's harmless — but stylistically you could gate it with storageConfig.useSSL.

\- NodeHttpHandler also accepts httpAgent for plain HTTP; not setting it means default pooling for HTTP requests. Fine for now, but if you want consistent connection reuse / timeout behavior across HTTP and HTTPS, add httpAgent: new http.Agent(...) too.

\- Not strictly a concern, but worth noting: requestTimeout: 300000 is applied to S3 operations. For very large multipart part uploads this might be tight; verify against your largest expected part size on slow links. Pre-existing behavior, not introduced here.

\---

0.13 — Next.js image patterns restricted — PASS

apps/web/next.config.ts:6-18:

images: {

&#x20; remotePatterns: process.env.ALLOWED\_IMAGE\_HOSTS

&#x20;   ? process.env.ALLOWED\_IMAGE\_HOSTS.split(",").map((host) => ({

&#x20;       protocol: "https" as const,

&#x20;       hostname: host.trim(),

&#x20;     }))

&#x20;   : \[

&#x20;       { protocol: "https" as const, hostname: "localhost" },

&#x20;       { protocol: "http" as const, hostname: "localhost" },

&#x20;       { protocol: "https" as const, hostname: "127.0.0.1" },

&#x20;       { protocol: "http" as const, hostname: "127.0.0.1" },

&#x20;     ],

},

\- No hostname: "\*\*" ✓

\- Defaults to localhost only ✓

\- ALLOWED\_IMAGE\_HOSTS env var for custom hosts ✓

Concerns (important, not failures):

1\. Custom-host branch drops http: when ALLOWED\_IMAGE\_HOSTS is set, all entries are forced to https. That's the right default, but means an operator running plain-HTTP behind a TLS-terminating proxy is fine, but anyone running true HTTP (dev, private LAN) loses their image loader silently. Consider a syntax like http://host.tld parsed into {protocol, hostname} instead of bare hostnames.

2\. No wildcard subdomain support: ALLOWED\_IMAGE\_HOSTS=cdn.example.com works, but \*.example.com would be treated as the literal hostname \*.example.com and never match. If you actually need subdomain wildcards (common for S3/CDN setups), Next.js remotePatterns does support hostname: "\*.example.com" — but the current parser doesn't surface that usefully. Document the limitation or add explicit wildcard support.

3\. User avatars / external image sources: if the app uses remote avatars (Gravatar, OAuth provider avatars), ALLOWED\_IMAGE\_HOSTS must include them or <Image> will 400. This is a functional regression relative to \*\*. Verify the web app's actual image sources before shipping — likely needs at minimum whatever host serves user-uploaded thumbnails (your STORAGE\_URL host). Recommend: a quick grep in apps/web for next/image usage with remote URLs to compile a default allowlist.

4\. Ports: remotePatterns entries have no port. If internal storage is served on http://127.0.0.1:9379, this pattern matches by hostname only and Next should accept any port — but double-check against Next 15 semantics; some versions require explicit port: "" for "any port".

\---

0.16 — removeAdditional enabled — PASS

apps/server/src/app.ts:22-26:

ajv: {

&#x20; customOptions: {

&#x20;   removeAdditional: "all",

&#x20; },

},

Set to "all" as required. ✓

Caveat worth raising: removeAdditional: "all" only affects Ajv, which validates non-Zod schemas. This app uses fastify-type-provider-zod — routes defined with Zod schemas go through the Zod validator compiler (line 62), not Ajv. So for most of this codebase, removeAdditional is a no-op unless routes use raw JSON Schema. It's still correct to set defensively, but don't expect it to strip extra fields on Zod-validated routes. If stripping on Zod routes matters, use .strict() or .strip() (the latter is the Zod default, so unknown keys are already dropped before reaching handlers).

\---

Overall Verdict: ALL PASS

All seven items are correctly implemented and the code is syntactically sound. No regressions or broken imports were detected.

Prioritized follow-ups (non-blocking):

\- Important: Validate that no route uploads raw file bytes >50MB through Fastify multipart (audit request.file() / request.files() callers). Fix #0.2 is safe only if all large uploads go via S3 presigned URLs.

\- Important: Compile a realistic default ALLOWED\_IMAGE\_HOSTS (Gravatar, OAuth avatars, STORAGE\_URL host) or audit apps/web for <Image src=...> remote URLs — otherwise users will see broken images post-deploy.

\- Minor: Fix the 7-space indent on reverse-share/routes.ts:389.

\- Minor: Consider dropping the unused http://localhost:3000 from CORS defaults, or documenting why it's there.

\- Minor: Add a production-mode guard that refuses startup (or at minimum loudly warns) if SECURE\_SITE=false or CORS\_ORIGINS is unset in NODE\_ENV=production.

\- Minor: Note in docs that removeAdditional: "all" applies to Ajv-validated routes only, not Zod-validated ones.



\---

## BATCH 2

---
Verification Report — Batch 2 Security Fixes
Item 0.3 — JWT auth on /s3/* routes: PASS
- All 4 routes (POST /s3/upload-url, GET /s3/download-url, DELETE /s3/object/:objectName, GET /s3/exists) have the preValidation hook that calls request.jwtVerify() and returns 401 on failure (routes.ts:16‑22, 28, 55, 83, 106).
- Controller ownership checks:
  - getUploadUrl: prefix check objectName.startsWith(\${userId}/\`)` → 403 (controller.ts:36‑38).
  - getDownloadUrl / deleteObject / checkExists: prisma.file.findFirst({ where: { objectName, userId } }) → 403 (lines 86‑89, 150‑153, 180‑183).
- prisma imported from ../../shared/prisma (line 16). ✅
- any casts are limited to (request as any).user?.userId, consistent with the pattern elsewhere in the codebase. No new unnecessary bare any types.
Concerns (important, not blocking)
1. Prefix check bypass via path traversal: objectName.startsWith(\${userId}/\`) accepts values like <userId>/../other-user/file. The S3 SDK/proxy generally normalizes, but this should be hardened with an explicit check for .. segments or use path.posix.normalize and re-test the prefix. Low-to-medium risk depending on whether Garage/MinIO resolves ..`.
2. getUploadUrl does not verify userId is non-null before the startsWith check. If userId is undefined, ${userId}/ becomes "undefined/", which is a string that a malicious client could prefix their path with. Very unlikely to be reachable (jwtVerify would have rejected), but a defensive if (!userId) return 401 would be cleaner and match the other handlers.
3. Race / TOCTOU on delete: ownership check followed by a separate deleteObject call is fine here since objectName scoping already binds to userId.
---
Item 0.7 — exec() replaced with statfs(): PASS
- import { statfs } from "node:fs/promises" is present (line 2). ✅
- No child_process, promisify, execAsync references anywhere in modules/storage/. ✅
- Removed methods (_tryDiskSpaceCommand, _getMountInfo, _detectMountPoint, _safeParseInt, _parseSize) — all gone. Grep confirms no dangling references. ✅
- _getFileSystemInfo now uses statfs() natively with bsize * blocks / bsize * bavail. ✅
- prisma uses the shared singleton (import { prisma } from "../../shared/prisma", line 5). No new PrismaClient(). ✅
- _ensureNumber retained (line 12) and used in getDiskSpace. ✅
- _detectSynologyVolumes retained (line 29), uses /proc/mounts via fs.promises.readFile with safe regex ^\/volume\d+$. ✅
- Public API signatures of getDiskSpace and checkUploadAllowed unchanged. ✅
- File compiles logically: all referenced private methods exist.
Minor observations
1. statfs availability: introduced in Node 18.15+/19+ for POSIX. Project targets Node 24 (CLAUDE.md), so fine. Worth a note for anyone running older Node.
2. bsize * blocks overflow: in theory can exceed Number.MAX_SAFE_INTEGER for very large FS (> 8 EB). Not a realistic concern but bigint-safe arithmetic would be more correct. Not a regression — the old code had the same limitation.
3. bavail vs bfree: using bavail (available to non-root) is the correct choice for upload gating — good. ✅
---
Item 0.14 — Auth moved to preValidation hooks: PASS
- Routes:
  - POST /files (file/routes.ts:49): preValidation present. ✅
  - POST /folders (folder/routes.ts:29): preValidation present. ✅
  - DELETE /shares/:id (share/routes.ts:122): preValidation present. ✅
- Controllers — await request.jwtVerify() removed from:
  - registerFile (file/controller.ts:58‑63): starts directly with userId extraction + null check. ✅
  - registerFolder (folder/controller.ts:19‑24): same pattern. ✅
  - deleteShare (share/controller.ts:170‑175): same pattern. ✅
- userId extraction and null‑check preserved in all three. ✅
Concerns (important)
1. Inconsistency — partial fix: Other controller methods still call await request.jwtVerify() inside the handler even though their routes also have preValidation (e.g. file/controller.ts:141, 247, 298, 353, 383, 439, 468, 527; folder/controller.ts:86, 131, 203, 272, 350; share/controller.ts:17, 37, 57, 97, 121, 148, 197, 221, 273). This means:
   - Double verification on every authenticated request (minor perf cost — JWT verify is cheap but still work).
   - Silent swallowing of jwtVerify errors: these await request.jwtVerify() calls are inside try { ... } catch (error) { return reply.status(400)... } blocks in several places (e.g. folder/controller.ts:78‑80, share/controller.ts:190‑192). If jwtVerify throws, client gets a misleading 400 with the JWT error message leaked — a minor info disclosure and already-inconsistent behavior vs. the preValidation 401.
   - More importantly: the stated scope of 0.14 is only "the three specific handlers". If the intent is that preValidation is authoritative, the other controllers should be cleaned up in a follow-up. Flagging this as debt introduced by partial migration, not a regression.
2. Share controller mixed style within file: deleteShare has no jwtVerify, but createShare (line 17), listUserShares (line 37), etc. still do. Future maintainers may be confused about which style to use. Add a comment or finish the migration.
3. GET /shares/:shareId route (share/routes.ts:70) has NO preValidation — this is intentional because getShare does an optional jwtVerify inside a try/catch (controller.ts:55‑60) to allow anonymous access. Not in scope of 0.14 but worth noting the pattern should survive.
---
Item 0.15 — z.any() replaced with proper schemas: PASS
- UpdateAuthProviderSchema imported from ./dto (routes.ts:6). ✅ Verified it exists in dto.ts:66 with all expected fields.
- PUT /providers/:id body: UpdateAuthProviderSchema (line 209). ✅
- AuthProviderResponseSchema defined at routes.ts:8‑27 with 18 properly-typed fields. ✅
- GET /providers/all response: z.array(AuthProviderResponseSchema) (line 101). ✅
- POST /providers response: AuthProviderResponseSchema (line 135). ✅
- PUT /providers/:id response: AuthProviderResponseSchema (line 213). ✅
- No remaining z.any() in auth-providers/routes.ts (grep confirmed zero matches). ✅
Concerns (minor)
1. clientSecret: z.string().optional() in the response schema (line 19). If the intent is to never leak the secret to admin reads, this field shouldn't be in the response schema at all — Fastify serializes response schemas and will strip unlisted fields, but will also include them if present. Verify the controller actually omits clientSecret before sending (quick recommendation: use .omit({ clientSecret: true }) for list responses and only include it where strictly needed, or never return it). This is a real security concern worth flagging — an OIDC clientSecret being exposed in admin GET responses is a secret-leak vector, especially if admin sessions are compromised or the endpoint is logged.
2. issuerUrl in UpdateAuthProviderSchema is z.string().url() but in AuthProviderResponseSchema it's z.string().nullable() — fine, but asymmetric. Not a bug.
3. Inconsistent indentation in the routes file (lines 99‑119 and 133‑156 use 3-space indentation in some nested response: blocks). Cosmetic; not functional.
---
Summary
Item	Status	Risk Level
0.3 — /s3/* JWT	PASS	1 important (path traversal in prefix check)
0.7 — exec removal	PASS	clean
0.14 — preValidation	PASS (for the 3 specified handlers)	1 important (partial migration — other handlers still do double jwtVerify)
0.15 — z.any()	PASS	1 important (clientSecret exposure in response schema)
Follow-ups I'd add to the TODO list
1. (security) Audit AuthProviderResponseSchema — remove or explicitly scrub clientSecret from admin GET responses. Grep controllers for what they actually return.
2. (security) Harden S3 objectName prefix check against path traversal (.., URL-encoded variants, null bytes).
3. (cleanup) Complete the 0.14 migration: remove the redundant await request.jwtVerify() from all handlers whose routes now have preValidation. This is debt that will silently drift.
4. (defensive) Add a !userId early-return in S3StorageController.getUploadUrl before the startsWith check, matching the pattern used in the other three S3 methods.

---

## BATCH 3

---
Verification Report
Item 0.4 — Embed endpoint auth via signed tokens: PASS (with concerns)
Verified:
- embed-token.ts exists (lines 1-34): HS256 via jose, 24h TTL, purpose="embed" claim. Token carries fileId + shareId. ✅
- Route GET /embed/:token (routes.ts:143-166) — no preValidation, takes signed token as URL param. ✅
- embedFile controller (controller.ts:585-649): verifies token → checks share exists → checks share.files contains fileId → checks expiration → media-type whitelist → streams. ✅
- POST /files/embed-token (routes.ts:168-193) has preValidation; controller checks share.creatorId === userId before minting. ✅
- Old GET /embed/:id path is gone. Media cannot be accessed with just a file ID.
Concerns (important, not blocking):
1. EMBED_SECRET regenerated on every server restart (embed-token.ts:7-9). All outstanding embed tokens become invalid on deploy/restart. The comment acknowledges this, but note it means embedded media in emails or cached pages will break after any restart. For a 24h TTL and frequent-restart dev scenarios this is mostly fine; in prod it's a UX rough edge. Consider persisting the secret in AppConfig like jwtSecret is.
2. Share-level maxViews and password NOT re-checked on embed access. The controller checks expiration but not security.password, security.maxViews, or security.views count. If a user generates an embed URL for a password-protected share, then revokes password, or the share hits max views — embed still works for 24h. This may be intentional (embed is a distinct capability granted to share owners) but should be documented. Arguably critical if password is the only gate preventing leakage.
3. Token-in-URL logging risk. Embed tokens live in URLs, so they land in proxy/access logs, referrers, browser history. With 24h TTL, a leaked log line is a 24-hour live bearer token. Acceptable but worth noting.
---
Item 0.8 — Rate limiting installed: PASS
Verified:
- @fastify/rate-limit imported (app.ts:6) and registered globally (app.ts:87-99) with max: 100, timeWindow: "1 minute". ✅
- keyGenerator uses x-forwarded-for with request.ip fallback (app.ts:91-93). ✅
- errorResponseBuilder returns { error, message, retryAfter } (app.ts:94-98). ✅
- Per-route overrides all present:
  - POST /auth/login 5/min ✅ (routes.ts:28-33)
  - POST /auth/2fa/login 5/min ✅ (routes.ts:71-76)
  - POST /auth/forgot-password 3/min ✅ (routes.ts:123-128)
  - POST /auth/reset-password 3/min ✅ (routes.ts:149-154)
  - POST /2fa/verify 5/min ✅ (two-factor/routes.ts:81-86)
  - GET /files/presigned-url 30/min ✅ (file/routes.ts:22-27)
  - POST /s3/upload-url 30/min ✅ (s3-storage/routes.ts:28-33)
Minor concern: keyGenerator trusts x-forwarded-for as a string (first header wins), but trustProxy: true is also set on Fastify. When behind multiple proxies, x-forwarded-for is a comma-separated list — the entire string becomes the key, meaning a client sending different downstream proxy headers could fragment its own rate limit bucket (or conversely, attackers could spoof this header on a non-proxied deployment). Safer: use request.ip alone (Fastify already parses x-forwarded-for when trustProxy is set). Important but not critical.
---
Item 0.9 — 2FA challenge token: PASS (with one concern)
Verified:
- challenge.ts (lines 1-34): jose HS256, 5m TTL, purpose="2fa-challenge", dedicated CHALLENGE_SECRET. ✅
- Login response returns challengeToken (auth/controller.ts:34-40); service still returns userId internally but it's converted before leaving the server. ✅
- CompleteTwoFactorLoginSchema takes challengeToken (dto.ts:40-44). ✅
- Controller verifies token → extracts userId → passes to service (controller.ts:62-76). ✅
- Frontend updated: use-login.ts uses twoFactorChallengeToken state (line 31), sends challengeToken (line 154); types.ts declares challengeToken: string in both request and response (lines 55, 74). ✅
Concern (minor/important):
- Same "secret regenerated on restart" pattern. For a 5-minute TTL this is essentially harmless — a user mid-2FA at deploy time gets one extra "invalid challenge" error and re-logs. Acceptable.
- The challenge token does not bind to user-agent or IP. A stolen challenge token within its 5-min window can complete 2FA from any origin, assuming the attacker also has the 2FA code. Low practical risk but worth noting — if defense in depth matters here, bind ua/ip into the JWT claims and verify them.
---
Item 0.10 — Server-side objectName for reverse-share uploads: PARTIAL PASS ⚠️
Verified (primary path):
- GetPresignedUrlSchema (dto.ts:113-116) now accepts filename + extension, no objectName. ✅
- Service getPresignedUrl (service.ts:208-252) and getPresignedUrlByAlias (service.ts:254-299) both:
  - Sanitize filename: .replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 100) ✅
  - Generate reverse-shares/{id}/{Date.now()}-{crypto.randomUUID()}-{sanitized}.{ext} ✅ 
  - For the alias variant, namespace uses reverseShare.id (not the client-controlled alias). ✅
  - Return generated objectName in response. ✅
- Controllers extract filename, extension, password from body (controller.ts:194-222, 224-252). ✅
- Routes (reverse-share/routes.ts:286-314, 316-345) use GetPresignedUrlSchema.extend({ password }) as body. ✅
CRITICAL FINDING — Multipart path bypasses this fix:
createMultipartUploadByAlias in service.ts lines 822-840 still generates objectName like this:
const objectName = `reverse-shares/${alias}/${Date.now()}-${Math.random().toString(36).substring(7)}-${filename}.${extension}`;
Three separate problems here:
1. Uses alias (client-controlled string) in the path instead of resolving to reverseShare.id. This is inconsistent with the non-multipart alias path (line 281) that correctly uses reverseShare.id.
2. No filename sanitization. Raw filename is interpolated — a malicious uploader could inject .. or special characters.
3. Uses Math.random() instead of crypto.randomUUID() — weaker uniqueness/predictability than the other path.
The route body schema (reverse-share/routes.ts:659-663) accepts filename: z.string().min(1) and extension: z.string().min(1) with no regex constraint, so path traversal via ../../../etc/passwd-style filenames is nominally possible in the object key (depending on S3 client behavior — most AWS SDKs will encode, but the generated key is still adversarial garbage the owner can't predict).
Also note: registerFileUpload* (controllers, lines 254–324) still accepts objectName from the client body via UploadToReverseShareSchema (dto.ts:95-103). If the presigned URL flow is the only way to upload, this is fine — the S3 PUT fails without a matching presign. But if someone can craft an arbitrary objectName that happens to be writable (e.g., via a presigned URL they legitimately received), they could then register it to a different reverse share. Worth confirming the service validates that the stored objectName was actually issued for this reverseShareId (it doesn't appear to — look at lines 301-351, registerFileUpload trusts fileData.objectName as-is). Minor but worth addressing.
Fix needed for multipart:
async createMultipartUploadByAlias(alias, filename, extension, password?) {
  const reverseShare = await this.validateReverseShareAccessByAlias(alias, password);
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 100);
  const objectName = `reverse-shares/${reverseShare.id}/${Date.now()}-${crypto.randomUUID()}-${sanitized}.${extension}`;
  // ...
}
(validateReverseShareAccessByAlias already returns the reverseShare object, so just capture its return value.)
---
Item 0.11 — Passwords moved from query to body: PASS (with backward-compat caveat)
Verified:
- No querystring schema anywhere in share/routes.ts or reverse-share/routes.ts contains password. ✅
- New routes all present:
  - POST /shares/:shareId/access ✅ (routes.ts:94-120)
  - POST /shares/alias/:alias/access ✅ (routes.ts:348-374)
  - POST /reverse-shares/:id/upload/access ✅ (reverse-share/routes.ts:201-228)
  - POST /reverse-shares/alias/:alias/upload/access ✅ (reverse-share/routes.ts:256-283)
- GET /files/download-url → POST /files/download-url (file/routes.ts:115-141) with body. ✅
- GET /files/download → POST /files/download (file/routes.ts:195-211) with body. ✅
- Controllers accept password from body, fall back to query for backward compat:
  - share/controller.ts:54-55, 262-263
  - reverse-share/controller.ts:76-77, 101-103
  - file controller does NOT check query anymore (only body) — stricter. ✅
Concerns (important):
1. The "query fallback" still accepts passwords in URLs. The comment says "legacy GET, deprecated" (share/controller.ts:53, 261; reverse-share/controller.ts:75, 101) — but the routes schemas no longer declare querystring, so with ajv removeAdditional: "all" (app.ts:25) unknown query params are stripped before the handler runs. So request.query.password will always be undefined on the new POST routes. The fallback is dead code.
   Verify: on POST /shares/:shareId/access, the route has no querystring schema → fastify strips unknown query keys → (request.query as any)?.password is always undefined. The "legacy" comment is misleading — there's no longer an endpoint where password-in-query reaches the handler.
   This is not a bug (stripping is the safe default), but the dead code + misleading comment should be cleaned. Or — if the intent was to keep old clients working during a deprecation window, this is broken silently: old clients sending ?password=xxx on GET /shares/:shareId now land on the GET route with no body, password ignored, and get "Password required" errors. Check whether the frontend has been fully migrated; if not, this is a real regression.
2. No deprecation telemetry / 410 Gone on the old GET paths for password-protected shares. Clients upgrading late will get confusing "Password required" errors instead of a clear signal. Minor.
3. POST /files/download-url and POST /files/download have no rate limit and no auth on the route itself. Auth is checked inside the handler (JWT fallback at line 249, 301-309), which is fine, but without a rate limit someone could bulk-iterate objectName values (they're predictable: {userId}/{timestamp}-{random7}-{name}.{ext}). Against a public share, a weak password can be brute-forced via this endpoint. Consider adding rateLimit: { max: 20, timeWindow: "1 minute" } to these POSTs. Important.
---
Summary
Item	Status	Notes
0.4 Embed tokens	✅ PASS	Concerns: in-memory secret, share security not re-checked on embed, URL logging
0.8 Rate limiting	✅ PASS	Minor: x-forwarded-for string used as key; prefer request.ip
0.9 2FA challenge	✅ PASS	Minor: no UA/IP binding on challenge token
0.10 Server-side objectName	⚠️ PARTIAL	Multipart path in reverse-share service.ts:832 bypasses fix (uses alias in path, no sanitization, Math.random). Also registerFileUpload still trusts client-supplied objectName.
0.11 Passwords out of query	✅ PASS	Concerns: dead "query fallback" code; no rate limit on POST /files/download* (brute-force vector)
Critical action needed: Fix createMultipartUploadByAlias in reverse-share/service.ts to use reverseShare.id, sanitize filename, and use crypto.randomUUID(). Without this, item 0.10 is not fully closed — a determined uploader can still choose much of the object path on the multipart route.
Important actions (non-blocking):
- Add rate limit to POST /files/download-url and POST /files/download.
- Validate that objectName submitted to registerFileUpload* matches the reverse-shares/{id}/... namespace for that reverse share.
- Remove the dead request.query?.password fallbacks (or keep them but document that fastify strips them — they do nothing).
- Re-check share security (password, maxViews) inside embedFile if embed links should respect those controls.
- Consider persisting EMBED_SECRET in AppConfig so 24h-TTL embeds survive restarts.




