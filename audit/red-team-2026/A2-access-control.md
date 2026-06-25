# Red Team Report — A2: Authorization & Access Control

## Summary

I performed an exhaustive review of the Ouitransfer authorization layer: the two
pre-validation middlewares (`jwt-prevalidation.ts`, `admin-prevalidation.ts`), the
JWT token model (`token-version.ts`, `fastify.d.ts`, `schema.prisma`), and the
route → controller → service → Prisma query path of every module that exposes an
id-addressable resource (file, folder, share, reverse-share, group, quota, user,
notification, invite, background-image, audit, two-factor, ldap, auth-providers,
config/app, storage).

The overall posture is **good**. The codebase is consistent about (a) gating
admin routes through `createAdminPreValidation`, (b) gating user routes through
`createJwtPreValidation`, and (c) scoping per-user resources with either
DB-level `where: { id, userId }` filters or a `findUnique(...).userId !== userId`
check. Zod schemas + Fastify `removeAdditional: "all"` strip unknown body fields,
which closes mass-assignment of `role`/`isAdmin`/`userId`/`ownerId` at the
validation boundary. Privilege-change propagation is sound: changing `isAdmin`,
`isActive`, or the password increments `tokenVersion` (invalidating every existing
JWT) and revokes refresh tokens, and `rotateRefreshToken` re-reads `isAdmin` from
the DB — so a stale token cannot retain elevated privileges.

However I found **one High-severity IDOR** (add another user's files/folders to
your own share, then download them), plus several lower-severity gaps and design
risks worth fixing.

**Counts by severity:** High: 1 · Medium: 2 · Low: 4 · Informational: 3

The three most serious:
1. **A2-01 (High)** — `POST/DELETE /shares/:shareId/items` adds files/folders to a
   share without verifying the items belong to the caller → cross-tenant file read (IDOR).
2. **A2-02 (Medium)** — No "last admin" / self-lockout protection: an admin can
   delete, deactivate, or demote the only admin (including themselves), bricking
   all admin access.
3. **A2-03 (Medium)** — Admin config/auth-provider/app routes use
   `allowSetupBypass: true`, so during the zero-user setup window they are fully
   unauthenticated and writable by anyone who can reach the API.

---

## Route inventory & guard matrix

Legend — Auth: JWT = `createJwtPreValidation`, OPT = optional jwtVerify inside
handler, NONE = public. Admin: ADMIN = `createAdminPreValidation{allowSetupBypass:false}`,
ADMIN* = `allowSetupBypass:true`. Ownership: DB = scoped Prisma query, POST = fetch
then compare, n/a = not an owned resource.

| Route | Method | Auth | Admin | Ownership check | Verdict |
|---|---|---|---|---|---|
| /auth/login, /auth/2fa/login, /auth/forgot-password, /auth/reset-password, /auth/refresh | POST | NONE | — | n/a | OK (public by design) |
| /auth/me | GET | OPT | — | self | OK |
| /auth/logout | POST | OPT | — | self | OK |
| /auth/trusted-devices(/:id) | GET/DELETE | JWT | — | self (`userId`) | OK |
| /auth/config | GET | NONE | — | n/a | OK |
| /providers (`/auth` prefix) | GET | NONE | — | n/a | OK (public list) |
| /providers/all, POST/PUT/DELETE /providers, /providers/order | * | — | ADMIN* | n/a | OK guard; see A2-03 |
| /providers/:provider/authorize, /callback | GET | NONE | — | n/a | OK (OAuth) |
| /2fa/setup,verify-setup,verify,disable,backup-codes,status | * | JWT | — | self (`userId`) | OK |
| /auth/register | POST | — | ADMIN* | n/a (isAdmin forced by service) | OK; see A2-03/A2-07 |
| /users | GET | — | ADMIN* | n/a | OK |
| /users/:id | GET | — | ADMIN* | n/a | OK |
| /users (update) | PUT | — | ADMIN* | n/a | OK; see A2-02 |
| /users/:id/activate,deactivate,image | PATCH | — | ADMIN* | n/a | OK; see A2-02 |
| /users/:id | DELETE | — | ADMIN* | n/a | OK; see A2-02 |
| /users/avatar | POST/DELETE | JWT | — | self (`userId`) | OK |
| /files/presigned-url | GET | JWT | — | objectName namespaced to userId | OK |
| /files | POST | JWT | — | objectName validated; folderId scoped | OK |
| /files/check | POST | JWT | — | self | OK |
| /files | GET | JWT | — | DB (`where userId`) | OK |
| /files/:id | PATCH | JWT | — | POST (`fileRecord.userId !== userId`) | OK |
| /files/:id/move | PUT | JWT | — | DB (`findFirst id,userId`) | OK |
| /files/:id | DELETE | JWT | — | POST (`fileRecord.userId !== userId`) | OK |
| /files/download-url, /files/download | POST | OPT (share or owner) | — | `checkFileAccess` (share-or-owner) | OK; see A2-04 |
| /files/multipart/* | POST/GET | JWT | — | `validateObjectName(objectName, userId)` | OK |
| /folders, /folders/check | POST | JWT | — | parent scoped to userId | OK |
| /folders | GET | JWT | — | DB (`where userId`) | OK |
| /folders/:id | PATCH | JWT | — | POST (`folderRecord.userId !== userId`) | OK |
| /folders/:id/move | PUT | JWT | — | DB + descendant scoped | OK |
| /folders/:id | DELETE | JWT | — | POST (`folderRecord.userId !== userId`) | OK |
| /shares | POST | JWT | — | files/folders scoped (`id,userId`) | OK |
| /shares/me | GET | JWT | — | DB (`creatorId`) | OK |
| /shares/:shareId, /access | GET/POST | OPT | — | public read gate (owner stripped) | OK |
| /shares/alias/:alias(/access,/metadata) | GET/POST | OPT/NONE | — | public read gate | OK |
| /shares (update) | PUT | JWT | — | service `creatorId !== userId` | OK |
| /shares/:shareId/pause,resume | PATCH | JWT | — | service `creatorId !== userId` | OK |
| /shares/:id | DELETE | JWT | — | route `creatorId !== userId` | OK |
| /shares/:shareId/password | PATCH | JWT | — | service `creatorId !== userId` | OK |
| **/shares/:shareId/items** | POST/DELETE | JWT | — | share owner only — **items NOT scoped** | **VULN A2-01** |
| /shares/:shareId/recipients | POST/DELETE | JWT | — | service `creatorId !== userId` | OK |
| /shares/:shareId/alias | POST | JWT | — | service `creatorId !== userId` | OK |
| /shares/:shareId/notify,remind | POST | JWT | — | service `creatorId !== userId` | OK |
| /shares/alias/:alias/identify | POST | NONE | — | n/a (visitor cookie) | OK |
| /shares/:shareId/visits | GET | JWT | — | route `creatorId !== userId` | OK |
| /reverse-shares | POST | JWT | — | creatorId=self | OK |
| /reverse-shares | GET | JWT | — | DB (`creatorId`) | OK |
| /reverse-shares/:id | GET | JWT | — | service `creatorId !== userId` | OK |
| /reverse-shares (update), /:id/password | PUT | JWT | — | service `creatorId !== userId` | OK |
| /reverse-shares/:id | DELETE | JWT | — | service `creatorId !== userId` | OK |
| /reverse-shares/:id/activate,deactivate | PATCH | JWT | — | service `creatorId !== userId` | OK |
| /reverse-shares/:id/upload, /access, alias variants | GET/POST | NONE | — | public upload gate + password | OK (by design) |
| /reverse-shares/:id/presigned-url, register-file, multipart/* | POST | NONE | — | password gate, server-gen objectName | OK; see A2-05 |
| /reverse-shares/files/:fileId/download,DELETE,PUT,copy | * | JWT | — | service `file.reverseShare.creatorId !== creatorId` | OK |
| /reverse-shares/:id/recipients,notify | POST/DELETE | JWT | — | service `creatorId !== userId` | OK |
| /reverse-shares/:reverseShareId/alias | POST | JWT | — | service `creatorId !== userId` | OK |
| /storage/disk-space, /storage/check-upload | GET | JWT | — | self (`userId`,`isAdmin` from JWT) | OK |
| /users/:id/quota | GET/PATCH | — | ADMIN | n/a | OK |
| /groups, /groups/:id, members | * | — | ADMIN | n/a | OK |
| /notifications/preferences | GET/PUT | JWT | — | self (`userId`) | OK |
| /notifications/unsubscribe | GET/POST | NONE | — | signed token | OK |
| /admin/email/stats,test | GET/POST | — | ADMIN | n/a | OK |
| /admin/stats | GET | — | ADMIN | n/a | OK |
| /admin/audit-logs(/export) | GET | — | ADMIN | n/a | OK |
| /admin/ldap/* | * | — | ADMIN | n/a | OK |
| /invite-tokens | POST | — | ADMIN | n/a | OK |
| /invite-tokens/:token (validate) | GET | NONE | — | n/a | OK (public, returns only valid/used/expired) |
| /register-with-invite | POST | NONE | — | token-claimed; isAdmin=false forced | OK |
| /background-images | GET | NONE | — | n/a (public list) | OK |
| /background-images (upload,reorder,:id,delete) | * | — | ADMIN | n/a | OK |
| /app/info, /app/system-info, /app/configs/public | GET | NONE | — | n/a (public, sensitive stripped) | OK |
| /app/configs/:key, /app/configs (bulk), /app/logo, /app/test-smtp | * | — | ADMIN* | n/a | OK guard; see A2-03 |
| /app/configs (list all) | GET | — | ADMIN* | n/a | OK; see A2-03 |

---

## Findings

### [HIGH] A2-01 — IDOR: add another user's files/folders to your own share, then download them

- **ID**: A2-01
- **Severity**: High
- **Location**:
  - Route: `apps/server/src/modules/share/routes.ts:504-598` (`POST /shares/:shareId/items`, `DELETE /shares/:shareId/items`)
  - Service: `apps/server/src/modules/share/service.ts:811-847` (`addItemsToShare`)
  - Repository: `apps/server/src/modules/share/repository.ts:360-378` (`findFilesByIds`, `findFoldersByIds`)
- **OWASP**: A01:2021 Broken Access Control (IDOR / BOLA)
- **Description**: `addItemsToShare` checks that the *share* belongs to the caller
  (`share.creatorId !== userId`, service.ts:817), but it validates the *files and
  folders* only for **existence**, not **ownership**. The existence check calls
  `findFilesByIds(fileIds)` / `findFoldersByIds(folderIds)`, which query
  `prisma.file.findMany({ where: { id: { in: fileIds } } })` with **no `userId`
  filter** (repository.ts:360-378). Any existing file/folder id is then connected
  to the attacker's share via `addFilesToShare` (repository.ts:316-325), which is
  an unscoped `connect`. Compare this to `createShare` (service.ts:184-211), which
  correctly scopes the lookup to `{ id: { in }, userId }`.

  Because a non-owner share view returns each file's `objectName`
  (`formatShareResponse`, service.ts:94-100 spreads `...file` including
  `objectName`), and `/files/download` grants access to any file that belongs to a
  password-less share (`checkFileAccess`, file/routes.ts:121-136), the attacker
  can read the victim's file content end-to-end.
- **Attack scenario** (attacker = authenticated user A, victim = user B; A knows
  or obtains B's file id `ckFILE_OF_B`):
  1. `POST /shares` → A creates an empty, password-less share `shA` (A owns it).
  2. `POST /shares/shA/items` body `{ "files": ["ckFILE_OF_B"] }` → connects B's
     file to A's share. Ownership check passes (A owns `shA`); B's file is *not*
     ownership-checked.
  3. `GET /shares/shA` → response includes B's file with its `objectName`.
  4. `POST /files/download` body `{ "objectName": "<B's objectName>", "shareId": "shA" }`
     → `checkFileAccess` finds B's file in the password-less share `shA` and serves it.

  Folders work the same way (`{ "folders": ["ckFOLDER_OF_B"] }`), and the nested
  ancestor-folder logic in `checkFileAccess`/`getAncestorFolderIds` then exposes
  the victim's entire subtree.
- **Evidence**:
  - `service.ts:822` `const existingFiles = await this.shareRepository.findFilesByIds(fileIds);`
  - `repository.ts:360-368` `findFilesByIds` — `where: { id: { in: fileIds } }` (no `userId`).
  - `repository.ts:370-378` `findFoldersByIds` — same omission.
  - Contrast `service.ts:184-189` (createShare) which uses `where: { id: { in: files }, userId }`.
- **Mitigating factor**: file/folder ids are cuid (non-sequential, not trivially
  guessable). The attacker needs the victim's file/folder id, which can leak via
  shared content, screenshots, logs, error messages, or another endpoint. This
  lowers exploit *likelihood* but the access-control defect is unconditional, so
  it remains High.
- **Remediation**: Scope the existence checks to the caller. Pass `userId` into
  `findFilesByIds`/`findFoldersByIds` and add `userId` to the `where`, mirroring
  `createShare`. Treat a file/folder the caller does not own as "not found":
  ```ts
  // repository
  findFilesByIds(fileIds: string[], userId: string) {
    return prisma.file.findMany({ where: { id: { in: fileIds }, userId } });
  }
  // service.addItemsToShare — after the existing creatorId check
  const existingFiles = await this.shareRepository.findFilesByIds(fileIds, userId);
  ```
  Add an `app.inject()` integration test: user A creates a share, attempts to add
  user B's fileId, expect 404/403 and verify the file is not connected.

---

### [MEDIUM] A2-02 — No last-admin / self-lockout protection

- **ID**: A2-02
- **Severity**: Medium
- **Location**:
  - `apps/server/src/modules/user/routes.ts:206-394` (`PUT /users`, `PATCH /users/:id/deactivate`, `DELETE /users/:id`)
  - `apps/server/src/modules/user/service.ts:91-264` (`updateUser`, `deactivateUser`, `deleteUser`)
- **OWASP**: A01:2021 Broken Access Control (availability of the admin function)
- **Description**: There is no guard preventing an admin from removing the **last**
  remaining admin, nor from acting on **their own** account. `updateUser` will set
  `isAdmin: false` on any user (including the only admin or the caller);
  `deactivateUser` and `deleteUser` likewise have no "is this the last admin?" or
  "are you about to lock yourself out?" check. Because demotion/deactivation/delete
  all increment `tokenVersion` and revoke tokens, the demoted-or-deleted admin is
  immediately logged out. If that was the only admin, **no one can ever reach any
  admin route again** — admin routes require `isAdmin` and the setup bypass only
  triggers when `user.count() === 0`, which is not the case here. The instance is
  permanently bricked for administration (config, user management, providers, LDAP,
  quotas, groups, audit).
- **Attack scenario**: A compromised or careless admin session issues
  `PUT /users {"id": "<only-admin-id>", "isAdmin": false}` (or `DELETE
  /users/<only-admin-id>`). All admin capability is lost with no recovery path
  short of DB surgery / the `reset-password` script.
- **Evidence**: `service.ts:91-167` (`updateUser`) applies `isAdmin` with no admin-count
  guard; `service.ts:169-219` (`deleteUser`) is explicitly "ungated" per its own
  comment; `service.ts:245-264` (`deactivateUser`) has no guard. No `count({ where:
  { isAdmin: true } })` appears anywhere in the user module.
- **Remediation**: Before demoting (`isAdmin → false`), deactivating, or deleting a
  user who is currently an admin, count remaining admins
  (`prisma.user.count({ where: { isAdmin: true, isActive: true, id: { not: id } } })`)
  and refuse with a 409/422 if it would reach zero. Optionally also block an admin
  from deleting/deactivating their own account in the same request.

---

### [MEDIUM] A2-03 — Setup-bypass admin guard leaves config/provider/app routes unauthenticated in the zero-user window

- **ID**: A2-03
- **Severity**: Medium
- **Location**:
  - `apps/server/src/middleware/admin-prevalidation.ts:12-17` (setup bypass)
  - `apps/server/src/modules/app/routes.ts:20` (`allowSetupBypass: true` for `/app/configs`, `/app/logo`, `/app/test-smtp`)
  - `apps/server/src/modules/auth-providers/routes.ts:218` (`allowSetupBypass: true` for `/providers/all`, create/update/delete/order)
  - `apps/server/src/modules/user/routes.ts:42` (`allowSetupBypass: true` for `/auth/register`, `/users`, etc.)
- **OWASP**: A01:2021 Broken Access Control (missing function-level authz during a window)
- **Description**: `createAdminPreValidation({ allowSetupBypass: true })` returns
  early with **no authentication at all** whenever `prisma.user.count() === 0`. The
  intent is first-user bootstrap, but the same bypass is applied to powerful admin
  surfaces — bulk config writes (`PATCH /app/configs`), SMTP test (which can be
  abused to probe internal hosts / exfiltrate via crafted SMTP), auth-provider CRUD
  (an attacker could pre-seed a malicious OIDC provider that auto-registers admins),
  and the full user list. In any deployment that boots with zero users (fresh
  install, or a DB reset), every request in that window is an unauthenticated admin.
- **Attack scenario**: An attacker who can reach the API before the first
  legitimate user registers can (a) create an auth provider with
  `autoRegister: true` + `adminEmailDomains` covering their address, then OIDC-login
  as an admin; or (b) rewrite config (e.g. disable password auth, change app URL for
  phishing) — all with no credentials.
- **Evidence**: `admin-prevalidation.ts:14-17` returns before `jwtVerify`; app.ts has
  no global auth fallback, so the window is genuinely open.
- **Remediation**: Restrict `allowSetupBypass` strictly to the routes that *must*
  run with zero users (first-user `POST /auth/register` and the minimal config the
  setup wizard writes). Move `/providers*`, `/app/configs`, `/app/logo`,
  `/app/test-smtp`, `/users` listing, etc. to `allowSetupBypass: false`. Better:
  scope the bypass to a single dedicated setup endpoint and forbid all other admin
  routes until an admin exists.

---

### [LOW] A2-04 — `/files/download` and `/files/download-url` are public; password-protected share gate is "any password-less share wins"

- **ID**: A2-04
- **Severity**: Low
- **Location**: `apps/server/src/modules/file/routes.ts:103-151` (`checkFileAccess`), `1038-1148`, `1150-1292`
- **OWASP**: A01:2021 Broken Access Control
- **Description**: The download endpoints have **no `preValidation`** — access is
  decided entirely inside `checkFileAccess`, which grants access if the file (or any
  ancestor folder) belongs to **any** share with no password, else falls back to JWT
  ownership. This is correct for the public-share use case, but it means: (1) a file
  is downloadable by anyone the instant it is in one password-less share, even if
  the owner *also* placed it in a password-protected share — the password-less share
  short-circuits (`checkFileAccess` returns `true` on the first password-less share,
  routes.ts:126-129); and (2) it is the foundation that makes A2-01 directly
  exploitable. On its own this is by-design, but the "first password-less share
  wins" semantics can surprise an owner who expects a per-share password to gate a
  file that is shared in multiple shares.
- **Evidence**: `file/routes.ts:121-136` iterates all shares containing the file and
  returns `true` for the first one without a password.
- **Remediation**: When a `shareId` is supplied, evaluate access against *that*
  share only (scope the `shareWhere` by `id: shareId`) rather than any share
  containing the file. This also hardens A2-01 (a victim file added to the
  attacker's share would still be gated by that specific share's settings, and the
  ownership fix in A2-01 prevents the connect in the first place).

---

### [LOW] A2-05 — Reverse-share public upload endpoints are unauthenticated and CSRF-exempt (resource exhaustion / unsolicited writes)

- **ID**: A2-05
- **Severity**: Low
- **Location**: `apps/server/src/modules/reverse-share/routes.ts:479-682, 1005-1260`
- **OWASP**: A01 (access control to a write surface) / A04 insecure design
- **Description**: `POST /reverse-shares/:id/presigned-url`, `register-file`, and all
  the `multipart/*` routes are public + `csrfExempt`. This is required for the
  reverse-share feature (external uploaders have no account), and the server
  generates the `objectName` server-side (good — prevents path injection). The
  residual risk is that anyone who learns a reverse-share id/alias can mint
  presigned PUT URLs and write objects, bounded only by `maxFiles`/`maxFileSize`/
  password. There is no per-IP rate limit on these specific routes (unlike the
  authenticated `/files/presigned-url` which is capped at 30/min, routes.ts:324-329).
- **Evidence**: reverse-share routes 479-567 have `config: { csrfExempt: true }` but
  no `rateLimit`. Quota soft-overage is enforced (B3) but the presigned-URL mint
  itself is not throttled.
- **Remediation**: Add a per-IP (+per reverse-share) rate limit to the public
  presigned-url / multipart-create routes, mirroring the share `identify` route's
  `keyGenerator` (share/routes.ts:1038-1039). Confirms upload enforcement at
  `register-file`, not just at URL mint.

---

### [LOW] A2-06 — `POST /folders` accepts a client-supplied `objectName` without namespace validation

- **ID**: A2-06
- **Severity**: Low
- **Location**: `apps/server/src/modules/folder/routes.ts:118-157`, `folder/dto.ts:3-8`
- **OWASP**: A01 / A03 (input validation)
- **Description**: Unlike file registration (`POST /files`) which calls
  `validateObjectName(input.objectName, userId)` to confine the object to the
  user's namespace, folder creation stores the client-supplied `objectName`
  verbatim (`prisma.folder.create({ data: { objectName: input.objectName, ... } })`,
  routes.ts:141-148) with no `validateObjectName` and no null-byte/`..` rejection.
  Folder `objectName` is less load-bearing (folders are logical), and downloads go
  through file objectNames, so impact is limited — but the inconsistency is a latent
  hazard if folder objectName ever feeds an S3 operation.
- **Evidence**: `file/routes.ts:421` validates; `folder/routes.ts` has no equivalent.
  `folder/service.ts:36` `deleteObject(folderRecord.objectName)` is reached on
  folder delete, passing the unvalidated value to storage.
- **Remediation**: Apply `validateObjectName(input.objectName, userId)` in
  `POST /folders` (and `/folders/check`) for parity with file registration, or have
  the server generate the folder objectName instead of trusting the client.

---

### [LOW] A2-07 — `POST /auth/register` accepts an `isAdmin` body field that is silently ignored

- **ID**: A2-07
- **Severity**: Low (defense-in-depth / clarity)
- **Location**: `apps/server/src/modules/user/routes.ts:79-90` (register schema),
  `user/dto.ts:3-10`, `user/service.ts:41-49`
- **OWASP**: A01 (mass assignment surface)
- **Description**: The register DTO exposes `isAdmin: z.boolean().optional()`. The
  service currently overrides it with `isAdmin: isFirstUser` (service.ts:48), so the
  client value is ignored — no escalation today. But carrying an `isAdmin` field in
  a public-ish, admin-gated registration body is a footgun: a future refactor that
  forwards `data.isAdmin` to `createUser` (the repository already maps
  `isAdmin: data.isAdmin`, repository.ts:33) would turn this into privilege
  escalation. The field gives a false impression that admins can mint admins via
  register (they cannot — only the first user becomes admin).
- **Evidence**: `repository.ts:33` `isAdmin: data.isAdmin` — the wiring is already
  present; only `service.ts:48` overriding with `isFirstUser` prevents misuse.
- **Remediation**: Remove `isAdmin` from `RegisterUserSchema`/`BaseRegisterUserSchema`.
  Grant admin only via `PUT /users` (which is already admin-gated and audited). If
  admins genuinely need to create other admins at registration time, make that an
  explicit, separately-validated path.

---

### [INFO] A2-08 — `isAdmin` is carried as a JWT claim; UI/disk-space rely on it

- **ID**: A2-08
- **Severity**: Informational
- **Location**: `apps/server/src/types/fastify.d.ts:16-20`, `storage/routes.ts:46-49`
- **Description**: `request.user.isAdmin` comes from the JWT, not a per-request DB
  read. This is safe for *authorization* because every privilege change increments
  `tokenVersion` (user/service.ts:124-129) and `validateTokenVersion`
  (token-version.ts) rejects stale tokens within a 30s cache TTL; `rotateRefreshToken`
  re-reads `isAdmin` from the DB (refresh-token.service.ts:48-50, 120). Net: a
  demoted admin's token is invalidated, not merely stale. One nuance: there is a
  ≤30s window where a *promoted* user's old token still says `isAdmin:false` (until
  cache refresh / re-login) — fail-closed, so not a risk. Worth documenting; no fix
  required. Admin-only authorization correctly re-checks `isAdmin` on the verified
  token inside `admin-prevalidation.ts:26`.

---

### [INFO] A2-09 — Public share/reverse-share metadata is intentionally unauthenticated

- **ID**: A2-09
- **Severity**: Informational
- **Location**: `share/routes.ts:995-1028` (`/shares/alias/:alias/metadata`),
  `reverse-share/routes.ts:1418-1451`
- **Description**: These endpoints return name/description/file counts/hasPassword
  before any password or identification gate, by explicit design (Open Graph
  previews + identification form needs field requirements). They leak share
  *existence* and metadata to anyone with the alias. Aliases are user-chosen and may
  be guessable. This is an accepted design trade-off (documented in the code at
  share/routes.ts:991-994); flagged for completeness. If metadata enumeration is a
  concern, gate metadata behind the same rate limit (already 60/min) and consider
  not echoing description for password-protected shares.

---

### [INFO] A2-10 — Share `getShare` by raw id requires no auth and exposes file objectNames to anonymous visitors

- **ID**: A2-10
- **Severity**: Informational
- **Location**: `share/routes.ts:167-224`, `share/service.ts:71-148` (`formatShareResponse`, `isOwner=false` branch)
- **Description**: `GET /shares/:shareId` (and the alias variant) is anonymous and
  returns each file's `objectName` to non-owner visitors (recipients/owner-only
  fields are stripped, but `objectName` is not — service.ts:94-100). This is
  required so visitors can call `/files/download`. It is by design for public
  shares; noted because it is the data source that makes A2-01's exfiltration
  trivial once a foreign file is connected to the attacker's share. Fixing A2-01
  (ownership scoping on add-items) closes the abuse without changing this behavior.

---

## Tested-and-OK

The following were specifically probed for IDOR / missing-authz / escalation and
found correctly enforced:

- **File CRUD** (`/files/:id` PATCH/DELETE/move): ownership enforced via
  `fileRecord.userId !== userId` or `findFirst({ id, userId })` (file/routes.ts:790-1034).
  Update/Move DTOs (`UpdateFileSchema`, `MoveFileSchema`) only allow name/description/
  folderId — no `userId`/`objectName` mass assignment.
- **Folder CRUD**: ownership enforced consistently; recursive subtree ops scoped to
  `userId` (folder/routes.ts, folder/service.ts; `getDescendantFolderIds` filters
  `WHERE userId`).
- **Multipart upload** (`/files/multipart/*`): every route calls
  `validateObjectName(objectName, userId)` — confines parts/complete/abort/list to the
  caller's namespace (file/routes.ts:1380, 1430, 1472, 1522).
- **Share mutations** (update, pause, resume, delete, password, recipients, notify,
  remind, alias, visits): all enforce `creatorId !== userId` at service or route level
  (share/service.ts:552, 688, 724, 799, 894, 909, 925, 979, 1107; routes.ts:441, 1171).
- **Reverse-share mutations and per-file ops** (download, delete, update, copy):
  enforce `reverseShare.creatorId`/`file.reverseShare.creatorId !== creatorId`
  (reverse-share/service.ts:100, 226, 288, 310, 333, 360, 399, 413, 436, 459, 494, 551,
  577, 597; upload.service.ts:458). Copy also enforces quota (upload.service.ts:462-487).
- **Reverse-share download via `/files/download`** for `reverse-shares/...` objects:
  requires JWT and `reverseShare.creatorId === userId` (file/routes.ts:1179-1215).
- **Admin surfaces** (admin/stats, audit logs+export, quota get/set, groups CRUD+members,
  background-images write, ldap config/test/sync/logs/status, auth-provider write,
  app config write, email stats/test, invite-token create): all gated by
  `createAdminPreValidation` and re-check `request.user.isAdmin` on the verified token.
- **2FA, notifications-preferences, trusted-devices, avatar, storage**: scoped to
  `request.user.userId` (self only).
- **Mass assignment**: Zod route schemas + Fastify `removeAdditional: "all"` strip
  unknown body fields; user update goes through `UpdateUserSchema` (only allows
  firstName/lastName/username/email/image/password/isAdmin, and isAdmin is admin-gated).
  No endpoint accepts `tokenVersion`, `emailVerified`, `quota*Override` (quota is a
  separate admin-only route), `ownerId`, or `creatorId` from the client.
- **Invite registration** (`/register-with-invite`): hardcodes `isAdmin: false`,
  atomically single-use-claims the token (invite/service.ts:178-205) — no escalation,
  no token-replay user creation.
- **Privilege-change propagation**: `updateUser`/`deactivateUser` increment
  `tokenVersion` + revoke refresh tokens; `validateTokenVersion` rejects stale JWTs;
  `rotateRefreshToken` re-reads `isAdmin`/`isActive` from the DB and blocks inactive
  accounts (refresh-token.service.ts:73-76).
- **IDs are cuid** (schema.prisma) — non-sequential, mitigating blind IDOR enumeration
  (raises the bar for A2-01 but does not fix it).
