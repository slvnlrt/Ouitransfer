# Red Team Report — A3: File / Folder / Storage

## Summary

I traced the full upload→storage-key→S3 pipeline and the download→authz→stream/presign pipeline across the
`file`, `folder`, `storage`, `reverse-share`, and `background-image` modules, plus the sanitization/validation
utilities and the S3 provider.

The authenticated, owner-scoped direct-upload path is reasonably well defended: storage keys are server-generated
(`${userId}/${uuid}-${safeFilename}`), `validateObjectName` is applied on register/multipart endpoints, and a
two-layer MIME/magic-byte check exists. However the **anonymous reverse-share multipart pipeline** is the weak
point: four public, CSRF-exempt routes accept a client-supplied `objectName` and pass it **straight to S3 with no
`validateObjectName` call**, allowing an attacker to drive an S3 `CompleteMultipartUpload` / `AbortMultipartUpload`
against an arbitrary key — i.e. overwrite or destroy any other user's stored object. The server-side magic-byte
defense is also **fail-open** in several ways (optional `mimeType`, swallowed S3 errors, "same-major-type" pass),
and the streaming download serves attacker-influenced content with `Content-Disposition: inline` and an
extension-derived `Content-Type`, which combined with the same-origin `/api/*` proxy rewrite (which does NOT attach
the frontend CSP) creates a stored-content rendering surface.

Severity counts:
- Critical: 2
- High: 3
- Medium: 4
- Low: 3
- Informational: 2

The three most serious are A3-01 (anonymous arbitrary-key S3 write/overwrite via reverse-share multipart),
A3-02 (magic-byte / MIME validation is fail-open and bypassable), and A3-03 (inline-disposition download +
same-origin proxy without CSP → stored HTML/SVG rendering).

## Data-flow notes (how a storage key is built from user input)

**Direct upload (authenticated):**
1. `GET /files/presigned-url?filename&extension` → key built server-side:
   `objectName = ${userId}/${crypto.randomUUID()}-${sanitizeFilename(filename.extension)}`
   (`file/routes.ts:366-367`). Client never controls the key here. Good.
2. Client PUTs bytes directly to S3 via the presigned PUT.
3. `POST /files` (register) — client now sends back `objectName`; this IS validated:
   `validateObjectName(input.objectName, userId)` (`file/routes.ts:421`).
4. Multipart variant: `POST /files/multipart/create` builds the key server-side
   (`file/routes.ts:1330-1331`); `part-url` / `complete` / `abort` / `list-parts` re-validate the
   client-supplied `objectName` with `validateObjectName(objectName, userId)`
   (`file/routes.ts:1380, 1430, 1472, 1522`). Good.

**Reverse-share upload (anonymous / public):**
1. `POST /reverse-shares/:id/presigned-url` and `/alias/:alias/presigned-url` build the key server-side:
   `reverse-shares/${id}/${Date.now()}-${uuid}-${sanitizeFilename(filename)}.${extension}`
   (`reverse-share/upload.service.ts:82, 145`). Good.
2. `POST /reverse-shares/:id/register-file` validates:
   `validateObjectName(fileData.objectName, \`reverse-shares/${reverseShareId}\`)`
   (`reverse-share/upload.service.ts:211, 327`). Good.
3. **Multipart variant (`/reverse-shares/alias/:alias/multipart/*`)** — `create` builds the key server-side
   (`reverse-share/multipart.service.ts:57-58`), BUT `part-url`, `complete`, `abort`, and `list-parts` take the
   client `objectName` and forward it to S3 **without any `validateObjectName`**
   (`reverse-share/multipart.service.ts:68-129`). This is the break.

`validateObjectName` (`utils/validate-object-name.ts`) is the only namespace guard: it rejects `\0`, rejects `..`,
and requires `objectName.startsWith(\`${expectedPrefix}/\`)`. It is the choke point — wherever it is not called,
the key is unconstrained.

`sanitizeFilename` (`utils/sanitize-filename.ts`) only ever produces a single path segment (it does
`.split("/").pop()`), so it cannot introduce traversal into a server-built key. It is a hardening layer, not the
authz boundary.

## Findings

### [CRITICAL] Anonymous arbitrary-key S3 write/overwrite & delete via reverse-share multipart — ID A3-01
- **Severity:** Critical
- **Location:** `apps/server/src/modules/reverse-share/multipart.service.ts:68-129`;
  routes `apps/server/src/modules/reverse-share/routes.ts:1058-1260`
- **OWASP:** A01 Broken Access Control (object-key injection / IDOR write)
- **Description:** The public, `csrfExempt` reverse-share multipart routes
  (`POST /reverse-shares/alias/:alias/multipart/part-url`, `/complete`, `/abort`, `/list-parts`) accept an
  `objectName` field directly from the request body (`dto` schema is only `z.string().min(1)`,
  `routes.ts:1073, 1127, 1182, 1228`) and pass it unmodified into S3 operations:
  `getMultipartPartUrlByAlias` → `getPresignedPartUrl(objectName, ...)`,
  `completeMultipartUploadByAlias` → `completeMultipartUpload(objectName, ...)`,
  `abortMultipartUploadByAlias` → `abortMultipartUpload(objectName, ...)`
  (`multipart.service.ts:78, 97, 113, 128`). **None of these call `validateObjectName`** — unlike every other
  multipart endpoint in the codebase. `validateReverseShareAccessByAlias` only checks the share is active / not
  expired / password (if any) — it never checks that `objectName` belongs to `reverse-shares/<id>/`.
- **Attack scenario:**
  1. Attacker finds/owns any active reverse-share alias (password-less ones are wide open; for password-protected
     ones the attacker just supplies the password they already know to upload).
  2. Attacker initiates their own legitimate multipart upload to get a valid presigned PUT flow, OR directly calls
     `POST /.../multipart/complete` with `objectName = "<victimUserId>/<uuid>-secret.pdf"` (a victim's existing
     key) plus a forged/known `uploadId` + `parts`. With a real `uploadId` obtained by first calling
     `createMultipartUpload` (server-generated key) and then swapping the `objectName` on `part-url`/`complete`,
     the attacker can upload parts and finalize against an **arbitrary destination key**, overwriting the victim's
     object content.
  3. `abort` with a victim `objectName` + a discovered `uploadId` lets the attacker cancel in-progress uploads;
     `list-parts` leaks part metadata (sizes/ETags) for arbitrary keys (information disclosure).
  4. Net effect: cross-tenant object overwrite (integrity/data-destruction), cross-tenant DoS of uploads, and
     metadata disclosure — all available to an anonymous external uploader.
- **Evidence:**
  - `multipart.service.ts:68-86` (`getMultipartPartUrlByAlias` — no validation, forwards `objectName`)
  - `multipart.service.ts:88-103` (`completeMultipartUploadByAlias` — no validation)
  - `multipart.service.ts:105-118` (`abortMultipartUploadByAlias` — no validation)
  - `multipart.service.ts:120-129` (`listPartsByAlias` — no validation)
  - Contrast with the safe authenticated path: `file/routes.ts:1380, 1430, 1472, 1522` all call
    `validateObjectName(objectName, userId)`.
- **Remediation:** In all four `*ByAlias` multipart methods, after resolving the reverse share, call
  `validateObjectName(objectName, \`reverse-shares/${reverseShare.id}\`)` before any S3 call (mirror
  `registerFileUpload`). Also enforce reverse-share file-count / size / allowed-type / owner-quota limits on
  `complete` (today multipart completion bypasses the `maxFiles`/`maxFileSize`/`allowedFileTypes` checks that
  `registerFileUpload` performs — see A3-05).

### [CRITICAL] Magic-byte / MIME validation is fail-open and trivially bypassable — ID A3-02
- **Severity:** Critical (defense that is widely believed to exist effectively does not enforce)
- **Location:** `apps/server/src/modules/file/routes.ts:423-468`;
  `apps/server/src/utils/validate-file-content.ts:67-147`; dto `apps/server/src/modules/file/dto.ts:7`
- **OWASP:** A04 Insecure Design / A05 Security Misconfiguration (unrestricted upload of dangerous content)
- **Description:** The upload content checks are advisory, not enforcing, in multiple independent ways:
  1. **`mimeType` is optional.** `RegisterFileSchema.mimeType` is `z.string().optional()` (`dto.ts:7`). Both the
     MIME-consistency check (`if (input.mimeType && ...)`, `routes.ts:424`) and the magic-byte check
     (`if (input.mimeType)`, `routes.ts:429`) are **entirely skipped when the client omits `mimeType`.** An
     attacker simply doesn't send it and uploads an `.exe`/`.html`/`.svg` with no content inspection at all.
  2. **Magic-byte check is fail-open on error.** The `catch` block (`routes.ts:444-467`) treats `range`,
     `not supported`, `empty response`, `nosuchkey`, `not found`, AND every unexpected S3 error as "skip and
     continue registering". A storage backend that doesn't honor `Range` (RustFS/MinIO edge cases) silently
     disables the check for all uploads.
  3. **`verifyMagicBytes` passes on undetectable and same-major-type.** It returns `{valid:true}` when `file-type`
     can't identify the buffer (`validate-file-content.ts:120-122` — true for HTML, SVG, plain text, CSV, many
     script types) and when declared vs detected share a major type (`validate-file-content.ts:141-143`).
  4. **`isMimeTypeConsistent` only blocks a benign-MIME + dangerous-ext combo.** Declaring
     `mimeType: "application/octet-stream"` with extension `pdf`, or any non-benign MIME with a dangerous ext that
     isn't in the explicit benign set, returns `true` (`validate-file-content.ts:88-101`). Declaring
     `text/html` + `.html` is fully "consistent" and allowed.
  5. There is **no extension allowlist/denylist enforced on the direct-upload register path** — `DANGEROUS_EXTENSIONS`
     is only consulted indirectly through `isMimeTypeConsistent`, which is skipped when `mimeType` is absent.
- **Attack scenario:** Upload `payload.html` (or `.svg`, `.exe`, `.js`) via the normal presigned-PUT flow, then
  `POST /files` with `extension:"html"`, `name:"payload.html"`, and **no `mimeType`**. The file is stored and
  registered with zero content validation. Combined with A3-03 it becomes stored XSS; on its own it is unrestricted
  file storage / malware hosting under the app's domain.
- **Evidence:** `dto.ts:7`; `file/routes.ts:424` (`if (input.mimeType && ...)`); `file/routes.ts:429`
  (`if (input.mimeType)`); `file/routes.ts:449-466` (fail-open catch); `validate-file-content.ts:78` (`if (!mimeType) return true`);
  `validate-file-content.ts:120-122, 141-143`.
- **Remediation:** Make `mimeType` required for registration (or derive it server-side from the extension via
  `getMimeType` and always run both layers). Run the magic-byte check unconditionally; on an *unexpected* S3
  failure, **fail closed** (reject the registration) rather than continue. Add an enforced extension denylist
  (reuse `DANGEROUS_EXTENSIONS`) at the register layer independent of `mimeType`. Apply the identical hardening to
  the reverse-share register path (`upload.service.ts:206, 322` only do Layer-1 and skip magic bytes entirely).

### [HIGH] Inline-disposition streaming download + same-origin proxy without CSP → stored content rendering (XSS) — ID A3-03
- **Severity:** High
- **Location:** `apps/server/src/modules/file/routes.ts:1210-1214, 1286-1290`;
  `apps/web/src/proxy.ts:119-123` vs `:67-110`
- **OWASP:** A03 Injection (Stored XSS) / A05 Security Misconfiguration
- **Description:** `POST /files/download` and the reverse-share branch stream the object with
  `Content-Type` derived from the *filename extension* (`getContentType(fileRecord.name)`) and
  `Content-Disposition: inline; filename="..."` (`routes.ts:1286-1287` and `:1210-1211`). For an attacker-named
  `.html`/`.svg`/`.xml` file this yields `text/html` / `image/svg+xml` served `inline`. The web proxy rewrites
  `/api/*` to the Fastify server **and returns that response without calling `addSecurityHeaders`**
  (`proxy.ts:119-123` returns the rewrite directly; the frontend CSP at `proxy.ts:85-107` is only applied to
  `NextResponse.next()`/redirect branches). The server-side helmet CSP for API responses is `default-src 'none'`
  in production (`app.ts:136-140`), which blocks `<script>` execution, but does **not** prevent the browser from
  rendering HTML, and `default-src 'none'` does not stop SVG-borne vectors in every engine; more importantly the
  content is same-origin with the authenticated app, so any future relaxation of the API CSP, or a path served
  through the Next.js side, becomes directly exploitable. The `nosniff` header is set by the proxy only on the
  non-API branches, not on the rewritten API stream.
- **Attack scenario:** Victim opens a share containing `report.html` and clicks download/preview; the browser
  navigates to `/api/files/download` (same origin) which renders the HTML inline. With A3-02 there is no content
  check preventing the HTML from being stored. The download presigned-URL path is safe (it forces
  `attachment` — `s3-storage.provider.ts:78,81`), but the **streaming** path used for internal storage is not.
- **Evidence:** `file/routes.ts:1210-1211` (reverse-share branch `inline`), `file/routes.ts:1286-1287`
  (`inline` + extension-derived content-type); `proxy.ts:122` (API rewrite returned without security headers);
  `app.ts:136-140` (API CSP only `default-src 'none'`, no `sandbox`, no forced `Content-Disposition`).
- **Remediation:** Always serve user-content downloads with `Content-Disposition: attachment` and a neutral
  `Content-Type: application/octet-stream` (or add `X-Content-Type-Options: nosniff` + `Content-Security-Policy:
  sandbox` on these responses). Apply `addSecurityHeaders` (or an equivalent restrictive CSP incl. `sandbox`) to
  the proxied `/api/*` responses in `proxy.ts`. Never echo an HTML/SVG content-type for stored user uploads.

### [HIGH] `POST /files/download-url` is a non-rate-limit-bypassing object-name oracle / broad access via password-less shares — ID A3-04
- **Severity:** High
- **Location:** `apps/server/src/modules/file/routes.ts:1070-1108` and `checkFileAccess` `:103-151`
- **OWASP:** A01 Broken Access Control
- **Description:** `download-url` and `download` look the file up purely by `objectName`
  (`prisma.file.findFirst({ where: { objectName } })`, `routes.ts:1073, 1175`). Access is then granted if **any**
  share (or any share covering an ancestor folder) that contains the file has no password
  (`checkFileAccess` returns `true` on the first password-less share — `routes.ts:126-129`). There is no check
  that the requester is actually a recipient of that share, and no binding between the supplied `objectName` and
  the supplied `shareId`. Because `objectName` follows the predictable shape `${userId}/${uuid}-${name}`, and the
  list/recursive endpoints expose `objectName` for the owner, a leaked or guessed `objectName` that happens to be
  in any link-shared (password-less) collection is downloadable by anyone. The endpoint is rate-limited (20/min)
  but the UUID makes blind enumeration impractical; the real risk is that ANY password-less share effectively
  makes its objects fetchable by `objectName` from any anonymous caller, with the `shareId` being optional/unbound
  for the actual authorization decision.
- **Attack scenario:** A user creates a public (no-password) link share. The `objectName` leaks (browser history,
  referrer, logs, a recipient forwards it). Any third party can POST that `objectName` to `/files/download` with
  no `shareId` and retrieve the bytes, and download-tracking attribution can be spoofed via the visitor cookie /
  omitted `shareId`.
- **Evidence:** `file/routes.ts:1073` (lookup by objectName only); `checkFileAccess` `routes.ts:121-136`
  (grants on any password-less share, no recipient binding); `shareId` is optional and only used for tracking,
  not authorization (`routes.ts:1071, 1136`).
- **Remediation:** Require and validate `shareId`; confirm the file belongs to that specific share and that the
  share is currently active/non-expired and (where applicable) that the caller satisfies recipient/identification
  rules. Do not treat "exists in some password-less share somewhere" as authorization for a request that targets a
  raw `objectName`.

### [HIGH] Reverse-share multipart upload has no quota/size/count/type enforcement — orphan-part & quota-exhaustion DoS — ID A3-05
- **Severity:** High
- **Location:** `apps/server/src/modules/reverse-share/multipart.service.ts:48-66, 88-103`;
  routes `reverse-share/routes.ts:1006-1166`
- **OWASP:** A04 Insecure Design (resource exhaustion)
- **Description:** `createMultipartUploadByAlias` only validates share access, then immediately calls
  `createMultipartUpload` (`multipart.service.ts:54-60`). There is **no** `maxFiles`, `maxFileSize`,
  `allowedFileTypes`, or owner-quota check (all of which `registerFileUpload` enforces —
  `upload.service.ts:213-236`). Likewise `completeMultipartUploadByAlias` finalizes the object with no size/quota
  re-check and **without ever creating a `ReverseShareFile` DB row** (the public flow has no `register` step after
  multipart complete), so completed multipart objects are not counted toward the owner's quota at all and bypass
  every reverse-share restriction. An anonymous attacker can also spam `createMultipartUpload` to accumulate
  incomplete multipart uploads (each consuming storage), throttled only by the global 100/min rate limit. The
  lifecycle abort rule (7 days, `storage.config.ts:91`) is the only backstop and applies to internal storage only.
- **Attack scenario:** Against any active alias, loop `POST /.../multipart/create` thousands of times → thousands
  of dangling multipart uploads consuming the owner's/operator's storage for up to 7 days, none counted by quota.
  Or complete a huge multipart upload that far exceeds `maxFileSize`/owner quota since neither is checked on the
  multipart path.
- **Evidence:** `multipart.service.ts:48-66` (create — no limits); `multipart.service.ts:88-103` (complete — no
  limits, no DB row); contrast `upload.service.ts:213-236` (register enforces maxFiles/maxFileSize/allowedFileTypes/quota).
- **Remediation:** Enforce `maxFiles`/`maxFileSize`/`allowedFileTypes`/owner-quota in `createMultipartUploadByAlias`
  (pre-check) and again at `complete`; create the `ReverseShareFile` row at completion so quota accounting and
  limits apply; rate-limit the create endpoint specifically.

### [MEDIUM] Folder `objectName` is fully attacker-controlled and stored/deleted unvalidated — ID A3-06
- **Severity:** Medium
- **Location:** `apps/server/src/modules/folder/dto.ts:6, 22`; `folder/routes.ts:145, 682`
- **OWASP:** A01 Broken Access Control (object-key injection)
- **Description:** `RegisterFolderSchema.objectName` is `z.string().min(1)` and is persisted verbatim
  (`folder/routes.ts:145`) with **no `validateObjectName`**. On folder delete, the stored value is passed straight
  to S3 `DeleteObject`: `await folderService.deleteObject(folderRecord.objectName)` (`folder/routes.ts:682`).
  Folders don't normally have S3 objects, but because the value is unvalidated an attacker can register a folder
  whose `objectName` is **any key** (e.g. `victimUserId/<uuid>-secret.pdf`, or `backgrounds/...`), then delete the
  folder to trigger a `DeleteObject` on that arbitrary key — a cross-tenant object-deletion primitive.
- **Attack scenario:** `POST /folders` with `objectName:"<victimUserId>/<uuid>-target.pdf"`, then
  `DELETE /folders/:id?force=true` → S3 `DeleteObject` removes the victim's file.
- **Evidence:** `folder/dto.ts:6`; `folder/routes.ts:141-148` (stored raw); `folder/routes.ts:682`
  (`deleteObject(folderRecord.objectName)`); `folder/service.ts:36-43`.
- **Remediation:** Either stop accepting `objectName` for folders entirely (generate it server-side or drop the
  field), or `validateObjectName(input.objectName, userId)` on register. Guard `deleteObject` to a namespace check
  before issuing the S3 delete.

### [MEDIUM] `S3_ENDPOINT` / `STORAGE_URL` SSRF surface via admin/env config (no scheme/host allowlist) — ID A3-07
- **Severity:** Medium
- **Location:** `apps/server/src/config/storage.config.ts:21-46, 100-136`; `apps/server/src/env.ts:6,21`
- **OWASP:** A10 SSRF / A05 Security Misconfiguration
- **Description:** The S3 endpoint is built from `S3_ENDPOINT`/`S3_PORT`/`S3_USE_SSL` and the public client from
  `STORAGE_URL`, with no validation that these are not internal/metadata addresses
  (`buildEndpointUrl` just concatenates scheme+host+port — `storage.config.ts:42-46`). `copyReverseShareFileToUserFiles`
  performs server-side `fetch()` to a presigned URL derived from these (`upload.service.ts:495-527`). While these
  come from env (not request body), `STORAGE_URL` is reflected into client-facing presigned URLs and the server
  fetches against the endpoint, so a misconfigured/poisoned value (e.g. `http://169.254.169.254/...`) turns the
  copy/orphan-sweep operations into SSRF requests from the server. `S3_REJECT_UNAUTHORIZED=false` additionally
  disables TLS verification for these connections (`storage.config.ts:37, 66-67, 130-131`).
- **Attack scenario:** An operator with config access (or any flow that can influence these values — check the
  admin settings surface) points `S3_ENDPOINT`/`STORAGE_URL` at an internal service or cloud metadata endpoint;
  server-side `fetch`/S3 calls then reach internal resources.
- **Evidence:** `storage.config.ts:42-46` (no host validation), `storage.config.ts:100-136` (public client from
  `STORAGE_URL`), `upload.service.ts:504, 527` (server-side fetch), `storage.config.ts:37` (TLS bypass toggle).
- **Remediation:** Validate `S3_ENDPOINT`/`STORAGE_URL` at boot: require https in production, reject private/loopback/
  link-local ranges unless explicitly allowlisted, and document `S3_REJECT_UNAUTHORIZED=false` as test-only.

### [MEDIUM] No declared-vs-actual size verification; size & quota are taken from client input — ID A3-08
- **Severity:** Medium
- **Location:** `apps/server/src/modules/file/routes.ts:471-526`; `reverse-share/upload.service.ts:221-241`
- **OWASP:** A04 Insecure Design (quota bypass)
- **Description:** Quota and per-file-size enforcement use the client-declared `size` (`BigInt(input.size)`,
  `routes.ts:473, 492, 521`) — the actual S3 object size is never reconciled (`HeadObject` is available via
  `fileExists`/`getObjectHead` but not used for size). A client can PUT a large object to its presigned URL but
  register it with `size: 1`, so quota accounting and `maxFileSize`/`maxTotalStorage` checks are all defeated.
  The presigned PUT itself imposes no size limit (no content-length-range conditions on the signed URL —
  `s3-storage.provider.ts:85-101`).
- **Attack scenario:** Obtain a presigned PUT, upload 5 GB, then `POST /files` with `size: 1`. Quota shows ~0 used;
  repeat to exhaust the operator's disk while staying "within quota".
- **Evidence:** `file/routes.ts:473, 492, 521` (size from input, no Head reconciliation);
  `s3-storage.provider.ts:92-100` (no content-length-range in presigned PUT).
- **Remediation:** On register, `HeadObject` the uploaded key and use the real `ContentLength` for quota/size
  checks (reject mismatches); and/or sign PUT URLs with a `content-length-range` policy. The orphan sweep should
  reconcile DB `size` against actual S3 size.

### [MEDIUM] Reverse-share multipart filename sanitizer diverges and is weaker — ID A3-09
- **Severity:** Medium (defense-in-depth inconsistency; not directly exploitable given server-built key)
- **Location:** `apps/server/src/modules/reverse-share/multipart.service.ts:57`
- **OWASP:** A04 Insecure Design
- **Description:** `createMultipartUploadByAlias` uses an ad-hoc sanitizer
  `filename.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 100)` instead of the shared `sanitizeFilename`. It does
  not strip leading dots, does not handle Windows reserved names, does not collapse `..` (it would turn `..` into
  `..` since `.` and chars are allowed — though the static `reverse-shares/<id>/<ts>-<uuid>-` prefix prevents the
  `..` from being leading). Inconsistent sanitization across the codebase is a latent bug source; the `..`
  retention is contained only by the surrounding server-generated prefix.
- **Evidence:** `multipart.service.ts:57` vs `upload.service.ts:81, 144` (which use `sanitizeFilename`).
- **Remediation:** Use the shared `sanitizeFilename` everywhere for consistency.

### [LOW] Dead/incorrect GET download path for internal-storage reverse-share files — ID A3-10
- **Severity:** Low (availability/correctness; potential confusion in security review)
- **Location:** `apps/server/src/modules/reverse-share/service.ts:343-346`
- **OWASP:** N/A (functional)
- **Description:** For internal storage, `downloadReverseShareFile` returns
  `\`/api/files/download?objectName=${encodeURIComponent(file.objectName)}\`` as a **GET** URL, but the only
  `/files/download` handler is **POST** (`file/routes.ts:1152`). There is no GET route, so this URL 404s. If a GET
  variant is later added to fix this, it must replicate the (already weak) authz of A3-04 — a GET that fetches by
  `objectName` from the query string would be an even easier object oracle and would leak `objectName` in logs/
  referrers.
- **Evidence:** `reverse-share/service.ts:345`; absence of GET `/files/download` (only POST at
  `file/routes.ts:1152`).
- **Remediation:** Fix the flow to use the existing POST authz, and if adding a GET, gate it with proper share-/
  ownership-based authorization and avoid `objectName` in the query string.

### [LOW] `sanitizeFilename` does not neutralize RTL-override / bidi control chars; double-extension allowed — ID A3-11
- **Severity:** Low
- **Location:** `apps/server/src/utils/sanitize-filename.ts:20-57`; `utils/file-name-generator.ts:192-207`
- **OWASP:** A04 Insecure Design (UI spoofing)
- **Description:** `sanitizeFilename` removes null bytes, path separators, leading/trailing dots and spaces, and
  Windows reserved names, but does NOT strip Unicode bidi controls (U+202E RLO etc.) or other zero-width/control
  characters beyond `\0`. A filename like `photo‮gpj.exe` displays as `photoexe.jpg` in the UI/Content-
  Disposition while the real extension is `.exe`. `parseFileName` keys only off the last `.`, so `invoice.pdf.exe`
  parses extension `exe` (fine) but `invoice.exe.pdf`-style double extensions are not flagged. The
  Content-Disposition encoder (`s3-storage.provider.ts:46-83`) strips control chars 0x00-0x1F/0x7F-0x9F but not
  bidi marks in the 0x200x range used in the UTF-8 `filename*` value.
- **Evidence:** `sanitize-filename.ts:27` (only `\0` removed among controls); `file-name-generator.ts:193`
  (last-dot extension parsing); `s3-storage.provider.ts:57-64` (control filter range excludes bidi marks).
- **Remediation:** Strip Unicode bidi/zero-width controls (U+200B-200F, U+202A-202E, U+2066-2069, U+FEFF) in
  `sanitizeFilename`, and consider warning on multiple extensions where the trailing one is in `DANGEROUS_EXTENSIONS`.

### [LOW] `getObjectHead` Range cap is good, but no global `sharp` pixel limit on image processing — ID A3-12
- **Severity:** Low
- **Location:** `apps/server/src/modules/background-image/service.ts:56-73`;
  `apps/server/src/modules/user/avatar.service.ts:9-26`; `apps/server/src/modules/app/logo.service.ts`
- **OWASP:** A04 Insecure Design (resource exhaustion)
- **Description:** Avatar (5 MB cap, `user/routes.ts:458-465`) and background image (10 MB cap,
  `background-image/service.ts:49-53`) bound the *compressed* input, but `sharp` is invoked without
  `limitInputPixels`, relying on libvips' default (~268 Mpx). A small highly-compressed image (PNG/WebP "pixel
  bomb") within the byte cap can still decode to hundreds of MB of RAM during `.metadata()`/`.resize()`. No
  explicit `failOn`/`limitInputPixels` is set anywhere (grep found none).
- **Evidence:** `background-image/service.ts:56, 65, 70` and `avatar.service.ts:9, 14` (no `limitInputPixels`);
  grep for `limitInputPixels|pixelLimit|failOn` → no matches.
- **Remediation:** Pass `sharp(buffer, { limitInputPixels: <reasonable>, failOn: "error" })` and reject images
  whose declared dimensions exceed a sane cap before resizing.

### [INFO] Magic-byte verification reads only first 4 KB; polyglots pass — ID A3-13
- **Severity:** Informational
- **Location:** `apps/server/src/providers/s3-storage.provider.ts:270-294`; `validate-file-content.ts:113-147`
- **Description:** `getObjectHead` caps at 4096 bytes (`MAX_HEAD_BYTES`). `file-type` reads leading magic bytes, so
  a polyglot whose first bytes match a benign type (e.g. a valid GIF/JPEG header) but whose tail is HTML/JS passes
  the "same-major-type" or detection check. Combined with A3-02/A3-03 this aids stored-XSS. This is inherent to
  header-only sniffing; documenting as a residual limitation.
- **Remediation:** Treat magic-byte checks as one layer only; the authoritative defenses are forced `attachment`
  download (A3-03) and an extension denylist (A3-02).

### [INFO] Presigned GET URL forces `attachment` (good) but echoes attacker-derived content-type — ID A3-14
- **Severity:** Informational
- **Location:** `apps/server/src/providers/s3-storage.provider.ts:103-134`
- **Description:** `getPresignedGetUrl` always sets `ResponseContentDisposition` to an `attachment; ...` value
  (`:78, 81, 129`) — this is the correct, safe behavior and neutralizes inline rendering on the presigned-URL
  download path. It does set `ResponseContentType: getContentType(rcdFileName)` (`:130`), which is benign given the
  forced attachment. Noting as a positive control and a contrast to the unsafe *streaming* path (A3-03).

## Tested-and-OK

- **Direct-upload key generation** is server-side and not client-influenced (`file/routes.ts:367, 1331`).
- **`validateObjectName` correctly rejects** `..`, null bytes, and out-of-namespace prefixes
  (`utils/validate-object-name.ts`) and IS applied on `POST /files` register and all authenticated multipart
  sub-routes (`file/routes.ts:421, 1380, 1430, 1472, 1522`) and on reverse-share `register-file`
  (`upload.service.ts:211, 327`).
- **`sanitizeFilename` cannot introduce path traversal** into a server-built key — it reduces to a single basename
  via `.split("/").pop()` and strips backslashes/null/leading-trailing dots (`utils/sanitize-filename.ts:24-33`).
- **Presigned PUT/GET use a separate public client** and the GET path forces `attachment` disposition
  (`s3-storage.provider.ts:78-81, 129`).
- **Avatar/background upload byte-size caps** are enforced via streaming with an early abort (avatar 5 MB,
  `user/routes.ts:458-465`) and a length check (background 10 MB, `background-image/service.ts:49-53`); sharp
  `.metadata()` is used to reject non-images.
- **Folder move loop protection** (`isDescendantOf`) and ancestor/descendant CTEs are user-scoped and bounded
  (`folder/routes.ts:32-73`, `file/folder-ancestors.ts` LIMIT 100).
- **Global `bodyLimit` 50 MB**, `maxParamLength` 500, proto/constructor poisoning set to error, request/keepalive
  timeouts configured (`app.ts:37-47`).
- **CSRF** is enforced globally with explicit per-route exemptions; reverse-share public upload routes are
  intentionally `csrfExempt` (`app.ts:230-257`, `reverse-share/routes.ts`).
- **Authenticated multipart `partNumber`** is range-validated 1-10000 (`file/routes.ts:1376`,
  `reverse-share/routes.ts:1097`).
