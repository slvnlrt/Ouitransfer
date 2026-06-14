# Red Team Report — A4: Sharing & Reverse-Share & Public Surfaces

## Summary

The public-facing share and reverse-share surfaces are the highest-exposure part of Ouitransfer:
unauthenticated visitors interact with download endpoints, password gates, and (for reverse-share)
direct-to-storage upload presigning. The access-control core is generally well-built — share tokens
and aliases use strong entropy (cuid / `randomBytes(24)`), passwords are bcrypt-compared
(constant-time), the visitor cookie is signed + httpOnly + alias-scoped, and the reverse-share entry
points consistently gate on `isActive`, `assertOwnerActive`, expiry, and password.

However, the **download enforcement layer (`file/routes.ts`) diverges from the share-read layer
(`share/service.ts`)**: the public `POST /files/download` and `POST /files/download-url` endpoints
re-implement their own access check (`checkFileAccess`) that validates **only password and
ownership** — it does **not** re-check expiry, max-views, owner-active, manual pause, or any
one-time/limit semantics. As a result, the entire share-lifecycle gate (expired / paused /
maxed-out / deactivated-owner) is **client-side-only for actual file retrieval**. An attacker who
has (or guesses) a file's `objectName` can pull the bytes regardless of share state, and on a
no-password share, without ever touching the share endpoint at all.

The single most serious issue is in the **reverse-share multipart upload flow**: the public
`part-url` / `complete` / `abort` / `list-parts` endpoints accept a fully client-controlled
`objectName` and pass it straight to S3 **without `validateObjectName`** — unlike every other upload
path. This lets an unauthenticated visitor with any one reverse-share link write to / abort /
enumerate arbitrary object keys (e.g. another user's `userId/...` namespace).

Counts by severity: **Critical 2, High 3, Medium 5, Low 4, Info 3.**

The 3 most serious:
1. **A4-01 (Critical)** — Reverse-share multipart endpoints accept arbitrary `objectName` (no
   namespace validation) → cross-tenant object write / abort / enumeration.
2. **A4-02 (Critical)** — Share download bypasses all lifecycle gates (expiry / maxViews / pause /
   owner-inactive); enforcement on the byte-retrieval path checks password + ownership only.
3. **A4-03 (High)** — No per-share password brute-force rate limit; download-side password check is
   also unthrottled and bypasses access auditing.

---

## Public endpoint inventory

| Route | Method | Auth | What protects it |
|---|---|---|---|
| `/shares/:shareId` | GET | Public (optional JWT) | share id (cuid); service gates expiry/maxViews/owner-active/password/identification |
| `/shares/:shareId/access` | POST | Public, **csrfExempt** | share id + password in body |
| `/shares/alias/:alias` | GET | Public (optional JWT) | alias (5–30 chars, user-chosen) + service gates |
| `/shares/alias/:alias/access` | POST | Public, **csrfExempt** | alias + password in body |
| `/shares/alias/:alias/metadata` | GET | Public, rate 60/min | alias; **returns metadata even for expired/maxed/owner-inactive shares** |
| `/shares/alias/:alias/identify` | POST | Public, **csrfExempt**, rate 30/h per ip+alias | sets signed visitor cookie |
| `/files/download` | POST | **Public (no preValidation)**, rate 20/min | `checkFileAccess`: password OR ownership only |
| `/files/download-url` | POST | **Public (no preValidation)**, rate 20/min | `checkFileAccess`: password OR ownership only |
| `/reverse-shares/:id/upload` | GET | Public | id; gates isActive/owner-active/expiry; password→401 |
| `/reverse-shares/alias/:alias/upload` | GET | Public | alias + gates |
| `/reverse-shares/:id/upload/access` | POST | Public, **csrfExempt** | id + password |
| `/reverse-shares/alias/:alias/upload/access` | POST | Public, **csrfExempt** | alias + password |
| `/reverse-shares/:id/presigned-url` | POST | Public, **csrfExempt** | id + gates + password; objectName server-generated |
| `/reverse-shares/alias/:alias/presigned-url` | POST | Public, **csrfExempt** | alias + gates + password |
| `/reverse-shares/:id/register-file` | POST | Public, **csrfExempt** | id + gates + password; `validateObjectName` enforced |
| `/reverse-shares/alias/:alias/register-file` | POST | Public, **csrfExempt** | alias + gates + password; `validateObjectName` enforced |
| `/reverse-shares/:id/check-password` | POST | Public, **csrfExempt** | id; **password oracle, unthrottled** |
| `/reverse-shares/alias/:alias/multipart/create` | POST | Public, **csrfExempt** | alias + gates + password; objectName server-generated |
| `/reverse-shares/alias/:alias/multipart/part-url` | POST | Public, **csrfExempt** | alias + gates + password; **objectName client-controlled, NOT validated** |
| `/reverse-shares/alias/:alias/multipart/complete` | POST | Public, **csrfExempt** | same — **objectName not validated** |
| `/reverse-shares/alias/:alias/multipart/abort` | POST | Public, **csrfExempt** | same — **objectName not validated** |
| `/reverse-shares/alias/:alias/multipart/list-parts` | POST | Public, **csrfExempt** | same — **objectName not validated** |
| `/reverse-shares/alias/:alias/metadata` | GET | Public | alias; returns name/desc/counts |

All `/reverse-shares/files/...` and management routes (`PUT/DELETE/PATCH /reverse-shares...`,
`/shares` CRUD, notify/remind, visits) require `preValidation` (JWT) and are owner-scoped.

---

## Findings

### [CRITICAL] Reverse-share multipart endpoints accept arbitrary objectName (cross-namespace write) — ID A4-01
- **Severity:** Critical
- **Location:** `apps/server/src/modules/reverse-share/multipart.service.ts:68-129`;
  routes `apps/server/src/modules/reverse-share/routes.ts:1058-1260`;
  `apps/server/src/modules/file/service.ts:53-84`
- **OWASP:** A01 Broken Access Control / A08 Software & Data Integrity (object-key injection)
- **Description:** Every other upload path generates `objectName` server-side and/or calls
  `validateObjectName(objectName, expectedPrefix)` (see `upload.service.ts:211`,`327`;
  `file/routes.ts:1380`,`1430`,`1472`,`1522`). The reverse-share **multipart** handlers
  `getMultipartPartUrlByAlias`, `completeMultipartUploadByAlias`, `abortMultipartUploadByAlias`,
  and `listPartsByAlias` take `objectName` from the request body and pass it directly to
  `fileService.getPresignedPartUrl` / `completeMultipartUpload` / `abortMultipartUpload` /
  `listParts` (multipart.service.ts:78, 97, 113, 128) with **no namespace check**. Only
  `createMultipartUploadByAlias` generates a safe key (line 58) — but the client is free to ignore
  that and pass any `objectName` to the subsequent calls.
- **Attack scenario:** Attacker needs only one valid reverse-share alias (these are public upload
  links, freely shared). With it:
  ```
  # 1. obtain a presigned PUT URL for an ARBITRARY key in a victim user's namespace
  curl -X POST https://host/api/reverse-shares/alias/PUBLICALIAS/multipart/part-url \
    -H 'Content-Type: application/json' \
    -d '{"uploadId":"<id from create-on-victim-key>","objectName":"victimUserId/some-existing-file.pdf","partNumber":"1"}'
  ```
  Because `objectName` is unvalidated, the attacker can:
  - Abort/disrupt other in-flight multipart uploads by key (`/multipart/abort`).
  - Enumerate part metadata of arbitrary keys (`/multipart/list-parts`) — information disclosure of
    ETags/sizes for keys they shouldn't see.
  - In combination with a multipart `create` on a victim-namespace key, complete a multipart upload
    that writes content under a non-reverse-share prefix, defeating the namespace isolation the rest
    of the codebase relies on (the file would not be tracked by quota or DB, but it pollutes
    storage / can overwrite if the provider permits, and bypasses the reverse-share `maxFiles`,
    `maxFileSize`, `allowedFileTypes`, and owner-quota controls entirely).
- **Evidence:** `multipart.service.ts:68-86` (`getMultipartPartUrlByAlias` — `objectName` param used
  verbatim, no `validateObjectName`); contrast `upload.service.ts:211`
  (`validateObjectName(fileData.objectName, \`reverse-shares/${reverseShareId}\`)`).
- **Remediation:** In `validateReverseShareAccessByAlias` callers (or inside each multipart method),
  call `validateObjectName(objectName, \`reverse-shares/${reverseShare.id}\`)` before touching
  storage — exactly as `registerFileUpload` does. `createMultipartUploadByAlias` must also return a
  key the caller is then *forced* to reuse (validate that the `objectName` in subsequent calls
  matches the `reverse-shares/<id>/` prefix).

### [CRITICAL] Share file download bypasses all lifecycle gates (expiry / maxViews / pause / owner-inactive) — ID A4-02
- **Severity:** Critical
- **Location:** `apps/server/src/modules/file/routes.ts:103-151` (`checkFileAccess`), used by
  `POST /files/download` (1150-1292) and `POST /files/download-url` (1038-1148);
  contrast `apps/server/src/modules/share/service.ts:265-305`
- **OWASP:** A01 Broken Access Control
- **Description:** The share **read** path (`getShare`) enforces, in order: owner-inactive (line
  265), persisted deactivation / manual pause / maxViews (273-284), defensive expiry (289-291),
  password (293-330), identification (348-368), atomic maxViews increment (370-376). The actual
  **byte retrieval** goes through `checkFileAccess`, which only does: "is there *any* share
  containing this file with no password → grant" / "password matches → grant" / "JWT owner →
  grant" (routes.ts:126-150). It never loads the share's `isActive`, `expiration`, `maxViews`,
  `deactivatedAt`, or `creator.isActive`. So the lifecycle gate is **purely advisory** — it only
  stops the frontend from rendering the share, not the download.
- **Attack scenario:**
  - For a **no-password** share: the attacker never needs the share at all. If they learn a file's
    `objectName` (leaked in the non-owner share response — see A4-08 — or guessed), they can fetch
    it directly:
    ```
    curl -X POST https://host/api/files/download \
      -H 'Content-Type: application/json' \
      -d '{"objectName":"<userId>/<uuid>-file.pdf"}'
    ```
    This works even after the share is **expired, paused, max-views-reached, or the owner's account
    is deactivated** — none of those states are consulted on the download path.
  - For a **password** share: once a visitor has the password (legitimately, one time), they can
    download forever regardless of expiry/maxViews/pause, and even share the bare `objectName` +
    password with others, bypassing per-recipient one-time/limit intentions.
  - The view-limit is meaningless for downloads: `incrementViewsAtomic` runs only in `getShare`
    (service.ts:370), never on the download path, so a maxViews=1 share can be downloaded
    unlimited times.
- **Evidence:** `checkFileAccess` (routes.ts:103-151) loads `share` with `include:{security:true}`
  only and branches solely on `share.security.password`. No `isActive`/`expiration`/`maxViews`/
  `creator` selected or checked.
- **Remediation:** Make `checkFileAccess` enforce the same gate set as `getShare`: reject the share
  as an access grantor if `!share.isActive`, `share.expiration < now`, `maxViews` reached, or
  `creator.isActive === false`. Ideally extract one `assertShareAccessible(share)` helper used by
  both `getShare` and `checkFileAccess`. Consider requiring a short-lived signed download grant
  issued by the share-read path rather than re-deriving access from `objectName`.

### [HIGH] No per-share password brute-force protection; download-path password check is unaudited and unthrottled — ID A4-03
- **Severity:** High
- **Location:** `share/service.ts:307-330` (no rate limit, no lockout per share);
  `file/routes.ts:130-136` (`checkFileAccess` bcrypt.compare with no audit/rate scoping);
  `POST /shares/:shareId/access` has `csrfExempt` and no `config.rateLimit`
  (routes.ts:226-290); `POST /reverse-shares/:id/check-password` (routes.ts:651-682)
- **OWASP:** A07 Identification & Authentication Failures
- **Description:** The share password endpoints rely only on the **global** 100 req/min/IP limiter
  (app.ts). There is no per-share attempt counter or lockout. `SHARE_PASSWORD_FAILED` audit events
  are written but never consulted to throttle. Worse, the same password can be brute-forced through
  the **download** endpoints (`/files/download`, `/files/download-url`, 20/min/IP) where
  `checkFileAccess` does `bcrypt.compare` and emits **no audit event at all** — a quieter oracle.
  `/reverse-shares/:id/check-password` is an explicit boolean password oracle.
- **Attack scenario:** Distribute guesses across IPs (or just accept 100/min) against
  `POST /shares/alias/:alias/access` until `INVALID_PASSWORD` becomes `200`. For reverse shares,
  hammer `check-password` for a clean true/false signal with no side effects.
- **Evidence:** `share/routes.ts:226` (access route — no `rateLimit` in `config`, contrast notify
  at line 853 which sets one); `file/routes.ts:130-136` (no audit on password compare).
- **Remediation:** Add a per-share (and per-share+IP) rate limit / progressive lockout on
  `/access`, `/check-password`, and the download endpoints when a password is supplied and fails;
  audit failed password attempts on the download path too; consider a generic lockout reusing the
  login brute-force machinery keyed by shareId.

### [HIGH] Reverse-share `maxFiles` and owner-quota enforced via read-then-write race (TOCTOU) — ID A4-04
- **Severity:** High
- **Location:** `apps/server/src/modules/reverse-share/upload.service.ts:213-219`, `329-336`
  (maxFiles count-then-create); `enforceReverseShareQuota` 413-450 (calculate-then-create)
- **OWASP:** A04 Insecure Design (race condition) / abuse of resource limits
- **Description:** `registerFileUpload` checks `currentFileCount >= maxFiles` and the owner storage
  quota with a `count`/`calculateStorageUsed` read, then later `createFile` — non-atomic and not in
  a transaction. Concurrent public uploads (the endpoint is unauthenticated) all read the same
  pre-write count, all pass, then all insert. The limit is silently exceeded under parallelism.
- **Attack scenario:** Fire N parallel `register-file` calls against a reverse share with
  `maxFiles=10`; many more than 10 land. Same for the owner's storage quota — an attacker can drive
  the owner well past their storage limit (especially with soft enforcement) by racing uploads,
  causing storage-exhaustion / cost amplification attributed to the victim owner.
- **Evidence:** upload.service.ts:214-218 (`countFilesByReverseShareId` then later
  `createFile` at 238) with no `$transaction`/atomic guard, mirroring the share view-count race
  that *was* fixed with `incrementViewsAtomic`.
- **Remediation:** Enforce `maxFiles` with an atomic conditional insert or a transaction that
  re-counts under a write lock; enforce quota in the same transaction as the file insert (or accept
  a small documented overage but cap it hard). The presigned-URL step is too early to enforce — the
  registration step must be the atomic chokepoint.

### [HIGH] Reverse-share file `size` is client-declared and never reconciled with the stored object — ID A4-05
- **Severity:** High
- **Location:** `upload.service.ts:221-241` (`maxFileSize` checks `BigInt(fileData.size)`;
  `createFile` stores client `size`); quota uses the same declared size (236, 253-258)
- **OWASP:** A04 Insecure Design / quota integrity
- **Description:** On the public `register-file` path the server trusts the client-supplied `size`
  for the per-file `maxFileSize` check, owner quota accounting, and the stored `ReverseShareFile.size`.
  The actual bytes were PUT directly to S3 via the presigned URL; the server never `HEAD`s the
  object to confirm real size. (Contrast direct uploads in `file/routes.ts:429-468` which read
  magic bytes from S3 — though they too trust `size`.)
- **Attack scenario:** Visitor requests a presigned URL, uploads a 5 GB file, then calls
  `register-file` declaring `size: 1`. Quota and `maxFileSize` are evaluated against `1`, so the
  upload "fits"; the owner's bucket fills with untracked bytes (quota under-counts reality).
  Repeating this is a storage-exhaustion / cost attack attributed entirely to the owner, defeating
  the entire B3 quota design.
- **Evidence:** upload.service.ts:221 (`BigInt(fileData.size) > reverseShare.maxFileSize`) and
  238-241 (`createFile({...fileData, size: uploadSize})`) — `uploadSize` is `BigInt(fileData.size)`,
  never the S3 object size.
- **Remediation:** After upload, `HEAD` the object and use the real `Content-Length` for the
  `maxFileSize` check, quota accounting, and the stored size; reject if the declared size diverges.
  Also set a max object size on the bucket / presign policy where the provider supports it.

### [MEDIUM] Public share metadata leaks existence/details for expired, maxed, paused, and owner-inactive shares — ID A4-06
- **Severity:** Medium
- **Location:** `share/service.ts:1191-1218` (`getShareMetadataByAlias`);
  `reverse-share/service.ts:512-540` (`getReverseShareMetadataByAlias`)
- **OWASP:** A01 Broken Access Control / A04 (info exposure)
- **Description:** Unlike `getShare`, the metadata endpoints apply **no** owner-active / isActive
  gate — they return `name`, `description`, file/folder counts, `hasPassword`, and field-requirement
  flags for any existing alias regardless of lifecycle state. The reverse-share metadata even
  returns `name`/`description`/`totalFiles` for inactive shares.
- **Attack scenario:** Confirm a share/alias exists and read its name/description and file count
  after it's been "expired" or "paused" (the owner believes it is private/closed). Enumerate aliases
  (5-char minimum, user-chosen, often guessable / squatted) to discover and profile shares.
- **Evidence:** `share/service.ts:1197-1217` computes `isExpired`/`isMaxViewsReached` but still
  returns full metadata; no `creator.isActive` check at all (the service’s `findShareByAlias` does
  not gate it).
- **Remediation:** Return 404 (or a minimal `{exists:false}`) for owner-inactive shares; consider
  withholding `name`/`description` for expired/maxed/paused shares, returning only enough for the
  frontend to render the correct closed-state message. Apply `assertOwnerActive` here too.

### [MEDIUM] Reverse-share presign issues an upload URL before any limit is enforced — ID A4-07
- **Severity:** Medium
- **Location:** `upload.service.ts:45-100`, `102-163` (presign checks active/owner/expiry/password
  but **not** `maxFiles`, `maxFileSize`, `allowedFileTypes`, or quota)
- **OWASP:** A04 Insecure Design
- **Description:** The presigned PUT URL is handed out after only the gate checks; the actual size,
  count, type, and quota limits are deferred to `register-file`. A visitor can presign and PUT bytes
  to storage even if registration will later be rejected (over maxFiles, wrong type, oversize).
  Those bytes are never cleaned up (no DB row → not in any delete sweep that keys off DB).
- **Attack scenario:** Loop: presign → PUT junk → never register. Storage fills with orphan objects
  under `reverse-shares/<id>/...` that no quota counts and no cleanup removes. Amplified storage
  exhaustion on the owner's bucket.
- **Evidence:** `upload.service.ts:80-99` returns a PUT URL with no count/quota check; enforcement
  only at `registerFileUpload` (213+).
- **Remediation:** Enforce `maxFiles`/quota (best-effort) at presign too, and add an orphan-object
  sweep that deletes `reverse-shares/<id>/*` objects with no corresponding DB row after the presign
  TTL. Constrain the presign with a content-length-range policy.

### [MEDIUM] Non-owner share response leaks `objectName`, `userId`, folder `objectName` — enables A4-02 — ID A4-08
- **Severity:** Medium
- **Location:** `share/service.ts:94-117` (`formatShareResponse` non-owner branch keeps
  `files[].objectName`, `files[].userId`, `folders[].objectName`, `folders[].userId`);
  `ShareResponseSchema` (dto.ts:114-146) includes those fields for all callers
- **OWASP:** A01 / A04 (sensitive data exposure)
- **Description:** When a non-owner reads a share, recipients and owner-only metadata are stripped
  (118-144), but each file/folder still exposes the raw S3 `objectName` and the owner's `userId`.
  `objectName` is the exact key needed to abuse the download bypass (A4-02), and it embeds the
  owner's `userId` (keys are `${userId}/...`). This is unnecessary for a downloader (downloads are
  driven by `objectName` posted back, but the legitimate flow already has it; exposing the owner's
  internal user id is gratuitous).
- **Attack scenario:** A visitor to a no-password share reads the file list, harvests every
  `objectName`, and downloads each directly via `/files/download` indefinitely (A4-02), and now also
  knows the owner's internal `userId` for further targeting.
- **Evidence:** `share/service.ts:94-100` maps files including `...file` (spreads `objectName`,
  `userId`); non-owner branch at 130-144 does not redact them.
- **Remediation:** For non-owner responses, omit `userId` and replace `objectName` with an opaque,
  per-share file token; have downloads reference that token (validated against share state) instead
  of the raw `objectName`. This also closes A4-02's direct-key attack.

### [MEDIUM] Identification gate is satisfiable by anyone (self-asserted cookie), and visitor cookie email match grants recipient linkage — ID A4-09
- **Severity:** Medium
- **Location:** `share/routes.ts:1030-1094` (`/identify` — accepts any name/email, sets cookie);
  `share/service.ts:347-368` (cookie satisfies REQUIRED gate); 433-455 (self-declared email →
  recipient link)
- **OWASP:** A07 / A04 (weak identity assertion)
- **Description:** This is partly by-design (the spec calls it a "comfort signal"), but worth
  flagging: a "REQUIRED" name/email identification gate is satisfied by an unauthenticated visitor
  simply POSTing any value to `/identify` (rate-limited 30/h per ip+alias). There is no
  verification. A visitor can also set their cookie email to a known recipient's address and be
  linked to that `ShareRecipient` (`self_declared`), polluting the owner's per-recipient
  download/access stats and the activity log with attributed-but-spoofed entries.
- **Attack scenario:** Set `email` to `victim@corp.com` in `/identify`; all subsequent downloads are
  attributed to that recipient (`lastDownloadedAt`, `downloadCount` bumped). Owner's audit trail and
  "who downloaded" view are now falsifiable by any visitor.
- **Evidence:** `service.ts:441-454` matches `shareId_email` from cookie and updates recipient
  stats; cookie content is purely visitor-supplied (`/identify` sets it from request body with no
  check, routes.ts:1084-1090).
- **Remediation:** Keep the comfort labeling but never mutate recipient stats from a self-declared
  match; only `"token"`-verified (`?t=` link) arrivals should write `downloadCount`/`lastDownloadedAt`.
  Clearly mark self-declared visits as unverified in the owner UI (already partly done via
  `identificationSource`).

### [MEDIUM] Notify/remind allow targeting arbitrary subset but rely on owner-scoping; recipient enumeration via ConflictError — ID A4-10
- **Severity:** Medium (Low for the public surface; included for completeness)
- **Location:** `reverse-share/service.ts:555-567` (P2002 → "already exist" ConflictError);
  `share/service.ts:968-1073` notify
- **OWASP:** A01 / A04
- **Description:** Adding a reverse-share recipient that already exists returns a distinct
  `ConflictError("...already exist...")` (service.ts:558-565), letting the **owner** (authenticated,
  so limited blast radius) probe which emails are already attached. The notify/remind endpoints are
  owner-only and rate-limited (5/10min) — good — so spam potential is bounded, but a malicious
  authenticated user can still enqueue invitation emails to arbitrary addresses (the recipient email
  is owner-supplied and unvalidated against any allow-list), i.e. use the server as a low-volume
  spam/phishing relay with the instance's branding and a real share link.
- **Attack scenario:** Authenticated user creates a share, adds `target@victim.com`, and sends a
  branded "Someone shared files with you" email with an attacker-controlled share name/description.
- **Evidence:** `share/routes.ts:849-916` notify; recipient emails are free-form
  (`UpdateShareRecipientsSchema`), only format-validated.
- **Remediation:** This is inherent to invite features; mitigate with global per-user send caps,
  optional admin allow-listing of recipient domains, and ensuring share name/description in emails
  are escaped (verify email templates). Avoid distinguishing "already exists" vs generic conflict if
  recipient lists are ever exposed to lower-trust roles.

### [LOW] `csrfExempt` public POSTs are broadly state-changing — ID A4-11
- **Severity:** Low
- **Location:** all `config: { csrfExempt: true }` routes in share/reverse-share routes;
  `app.ts` CSRF hook (~line 220+); `csrf.config.ts`
- **OWASP:** A01 / CSRF surface
- **Description:** Many public mutation endpoints are CSRF-exempt by necessity (anonymous visitors
  have no CSRF token). This is acceptable because they are unauthenticated and same-origin-agnostic,
  but `register-file`, `presigned-url`, and the multipart writes are state-changing and exempt — so
  CSRF can't protect against the abuse in A4-01/A4-04/A4-05/A4-07. CORS (`credentials:true`,
  origin allow-list) is the only cross-origin guard, and these flows don't need credentials.
- **Evidence:** routes.ts lines 229, 324, 482, 527, 572, 612, 654, 1009, 1061, 1115, 1171, 1216.
- **Remediation:** No CSRF fix needed (anonymous), but treat these as fully attacker-controlled and
  rely on the input-validation/rate-limit/quota fixes above. Ensure the global CSRF fallback set and
  per-route flags stay in sync (already tested).

### [LOW] Reverse-share metadata + upload-info enumeration via short user-chosen aliases — ID A4-12
- **Severity:** Low
- **Location:** `shared/alias-schema.ts:13-23` (min 5 chars, `[a-zA-Z0-9-]`)
- **OWASP:** A04
- **Description:** Aliases are user-chosen, 5–30 chars, and used in public URLs. 5-char aliases over
  alphanumerics are guessable/enumerable at scale, and the metadata endpoints (A4-06) plus
  `GET .../upload` return useful info for valid ones. Share **ids** (cuid) are not enumerable; the
  alias is the weak link.
- **Evidence:** alias-schema.ts ALIAS_MIN_LENGTH=5.
- **Remediation:** Rate-limit metadata/upload-info by IP (metadata has 60/min — relatively loose);
  consider a higher alias minimum length or reserved-prefix namespace; add per-IP enumeration
  detection.

### [LOW] Reverse-share download proxy URL built from client-trusted objectName for internal storage — ID A4-13
- **Severity:** Low (owner-only path, but worth noting)
- **Location:** `reverse-share/service.ts:343-346` (`/api/files/download?objectName=...`)
- **OWASP:** A03 (injection surface) / A01
- **Description:** For internal storage, `downloadReverseShareFile` builds a download URL embedding
  the file's `objectName` as a query param. The endpoint is owner-scoped (good), and `objectName`
  comes from the DB (not the request), so this is low risk, but it routes through
  `/api/files/download` which (per A4-02) checks only password/ownership — for a reverse-share file
  the access path in `file/routes.ts:1179-1215` correctly re-validates owner JWT, so it's contained.
- **Evidence:** service.ts:345.
- **Remediation:** Prefer presigned/streamed delivery with a short-lived signed token over passing
  `objectName` in a URL; ensure `/files/download` reverse-share branch (routes.ts:1192-1197) stays
  owner-only (it currently is).

### [LOW] `markExpiredInactive` and other lifecycle writes are fire-and-forget on the public path — ID A4-14
- **Severity:** Low
- **Location:** `upload.service.ts:60-65`, `122-126`, `185-189`; `share/service.ts:386-391`
- **OWASP:** A04
- **Description:** Expiry-deactivation persistence is `void ... .catch(...)`; the request still
  throws the right 410, so functionally fine, but a flaky DB means the persisted `isActive` flag may
  lag, leaving cleanup sweeps and metadata gating inconsistent. Combined with A4-06, an expired
  share whose flag wasn't persisted keeps leaking metadata.
- **Evidence:** as above.
- **Remediation:** Acceptable as-is for availability; ensure the cleanup sweep is the authoritative
  backfill and that metadata gating computes expiry from the date (not just the flag).

### [INFO] Passwords correctly kept out of query strings; bodies + body-only password design is sound — ID A4-15
- Public access/upload endpoints all take `password` in the **body** and document "never as a query
  parameter" (e.g. routes.ts:235, 800, 1053). Multipart `part-url` was deliberately changed from GET
  to POST so the password isn't in the URL (routes.ts:1066-1067). Good — passwords won't land in
  access logs/referrers.

### [INFO] Token and tracking-token entropy is strong — ID A4-16
- Share ids and recipient tracking tokens: `crypto.randomBytes(24).toString("base64url")`
  (`share/service.ts:587`) ≈ 192 bits; share/reverse-share ids are cuid. Tracking-token query
  param is regex+length bounded (routes.ts:35-43). Not enumerable. The alias is the only guessable
  identifier (A4-12).

### [INFO] Visitor cookie is signed, httpOnly, sameSite=strict, alias-scoped, and self-validating — ID A4-17
- `visitor-cookie.ts:31-57` unsigns, JSON-parses via Zod, and rejects cookies whose `alias` doesn't
  match the requested share (line 43) — so a cookie for share A can't be replayed against share B.
  `recipientId` is only ever written server-side after `?t=` token verification
  (`share/routes.ts:80-90`, service.ts:421-424), and `resolveDownloadRecipient` re-checks that the
  `recipientId` belongs to the share (recipient-resolution.ts:46-55). The forgery risk is bounded to
  the self-declared comfort signal already covered in A4-09. Cookie design is solid.

---

## Tested-and-OK

- **Token/id entropy & enumeration:** share ids (cuid) and recipient tracking tokens (192-bit
  random) are not guessable (A4-16). Only the user-chosen alias is weak (A4-12).
- **Password comparison timing:** all share/reverse-share password checks use `bcrypt.compare`
  (constant-time) — `share/service.ts:308`, `file/routes.ts:131`, `upload.service.ts:71` etc. No
  plaintext `===` or early-exit string compares found.
- **Passwords in transit:** never accepted as query params; body-only by design and documentation;
  multipart part-url converted GET→POST specifically for this (A4-15).
- **Visitor cookie forgery/cross-share replay:** signed + alias-bound + Zod-validated; cannot grant
  access to a different share; `recipientId` server-written only and re-verified (A4-17).
- **objectName path traversal (non-multipart paths):** `validateObjectName` rejects null bytes,
  `..`, and wrong-prefix on the direct-upload and reverse-share `register-file` paths
  (`validate-object-name.ts`; `upload.service.ts:211`,`327`). (Multipart paths are the gap — A4-01.)
- **Deactivated-owner gate on reverse-share entry points:** `assertOwnerActive` is applied on
  every public reverse-share read/presign/register/multipart entry
  (upload.service.ts:55,117,180,296; multipart.service.ts:26; service.ts:118,170). Consistent.
  (Note: the regular-share **download** path is the exception — A4-02.)
- **Reverse-share file download / delete / copy / update / recipients:** all owner-scoped via
  `findFileById(...).reverseShare.creatorId !== creatorId` checks (service.ts:304-368, 484-510) and
  `preValidation`. No IDOR found on these authed paths.
- **maxViews atomicity (share read path):** `incrementViewsAtomic` uses a conditional
  `updateMany(where: views < maxViews)` — race-safe for the *read/view* counter
  (repository.ts:296-314). (The download path simply never increments — A4-02.)
- **Atomic recipient sync on update:** `updateShare` recipient diffing runs inside `$transaction`
  (service.ts:571-593).
- **CSRF exemption consistency:** per-route `csrfExempt` + fallback `CSRF_EXEMPT_ROUTES` set kept in
  sync and test-covered; safe methods short-circuit (app.ts CSRF hook). Public mutation endpoints
  are anonymous (no credential to forge) — CSRF not the relevant control there.
