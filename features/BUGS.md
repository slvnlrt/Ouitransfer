# Bug Report

> Bugs discovered during testing and development.
> **Voir aussi :** [`TECHNICAL-DEBT.md`](TECHNICAL-DEBT.md) — dettes techniques · [`SECURITY.md`](SECURITY.md) — findings sécurité
>
> All resolved bugs are archived:
> - B-1 through B-20: `features/archive/BUGS-2026-05.md`
> - B-21 through B-25: `features/archive/BUGS-2026-05-31.md`

## Open

_None._

## Resolved (recent)

### B-34: A file PREVIEW counted as a download in shares — RESOLVED

- **Severity**: Low–Medium — wrong tracking; a recipient who only previewed a file showed as "Téléchargé",
  and `remindNonDownloaders` then skipped them.
- **Files**: `apps/server/src/modules/file/routes.ts`, `apps/server/src/modules/share/routes.ts`,
  `apps/web/src/{lib/download-url-cache.ts,http/endpoints/files/index.ts,http/endpoints/shares/{index,types}.ts,
  hooks/use-file-preview.ts,components/modals/share-details/share-details-activity-section.tsx}`, all 23 locale files.
- **Root cause**: download tracking fired at presigned-URL **generation** time. The opaque per-share file
  token (`st1_…`) binds `{shareId,fileId}`, so the server resolved the share for BOTH preview and download
  (`if (shareId) trackShareDownload(...)`), bumping recipient `downloadCount`/`lastDownloadedAt`. The client
  never sent an intent, so the server couldn't tell a view from a download. (The frontend `shareId` arg was
  only a cache-scope key, never sent — the prior "preview omits shareId" comment was misleading.)
- **Fix (first-class "viewed" event, per two Opus design reviews)**: a preview is recorded as its own
  `ShareVisit{action:"preview", fileId}` and never touches download stats. The client declares an explicit
  `intent: "preview" | "download"` on `POST /files/download-url` (default `"download"` → existing callers
  unchanged); the preview path (`loadPreview`) sends `"preview"` for **all** file types (no client
  previewability oracle). `intent` is also in the presigned-URL cache key (default `"download"`, fixed
  position) so a real download after a preview of the same file still hits the server (C-1 guard). The
  activity log gained a distinct **"Aperçu"** row (file-level, with the **file name**) clearly separate from
  the share-level "Consulté", and now shows the file name on download rows too — answering "which file?".
  `/shares/:id/visits` resolves file names via a batch lookup (no `ShareVisit→File` relation, so no
  migration) and accepts `?action=preview`. The `FILE_DOWNLOAD` audit records the server-resolved `intent`.
- **Design notes / deferred**: the residual spoof (a recipient sending `intent:"preview"` on a real
  download) only keeps the spoofer in the reminder set — it can never hide a real download from the owner.
  No per-recipient "viewed" aggregate badge (previews live in the activity log). Reverse-shares and a cleaner
  dedicated `view|download` tracking endpoint are tracked in `TECHNICAL-DEBT.md`.
- **Status**: Resolved (2026-06-29) — spec/plan + two Opus design reviews under
  `features/{plans,reviews}/b-34-…`. Server + web suites green; type-check + lint clean.

### B-33: Recipient download/upload tooltips showed UTC time instead of the user's local time — RESOLVED

- **Severity**: Low — cosmetic but misleading (off-by-timezone, e.g. −2h)
- **Files**: `apps/web/src/components/modals/share-details/share-details-recipients-list.tsx`,
  `apps/web/src/components/general/recipient-selector.tsx`,
  `apps/web/src/app/(shares)/reverse-shares/components/reverse-share-recipient-selector.tsx`
- **Symptom**: In the "manage recipients" view, hovering the "Téléchargé" badge showed
  "Téléchargé le {date} à {heure}" with the time in **UTC**, while every other date in the UI is
  rendered in the user's local timezone. Same issue on the reverse-share "Uploaded" tooltip.
- **Root cause**: These tooltips used next-intl's `useFormatter().dateTime(...)`, which renders in the
  provider's configured timezone (UTC on the server) rather than the browser's local zone. The rest of
  the app uses the canonical `formatDateTime(dateString, "table", locale)` util (`lib/format-date-time.ts`),
  which uses `Intl.DateTimeFormat(locale, …)` with no `timeZone` → the browser's local time.
- **Fix**: Switched all four occurrences (downloaded ×3, uploaded ×1) to `formatDateTime(..., "table", locale)`,
  aligning both timezone AND format with the rest of the UI. `useFormatter` kept only where still needed
  (the access `relativeTime`). Updated the two component tests to add the `useLocale` mock and assert via
  the same formatter (TZ/format-robust).
- **Status**: Resolved (2026-06-29) — full web suite (428) green; type-check + lint clean.

### B-32: Infinite "Loading Please Wait" on /login after session expiry on tab return — RESOLVED

- **Severity**: High — recurring UX dead-end; only a manual hard reload (F5) recovered
- **File**: `apps/web/src/contexts/auth-context.tsx`
- **Symptom**: After the tab sat idle long enough for the session to expire, returning to it
  auto-logged-out and redirected to `/login`, but the page hung on the full-screen
  "Loading Please Wait" spinner. A hard reload (F5) reached the login form correctly — proving
  it was a stale **client** state, not a server/network problem. The mirror-direction symptom on
  `/dashboard` was previously mitigated by `refetchOnWindowFocus: false` (commit `0386f85`), but
  that only reduced refetches; it did not fix this underlying derivation.
- **Root cause**: `AuthProvider` derived `isAuthenticated` from `currentUserQuery.data?.user`
  **without consulting `isError`**. React Query *retains the previous `data`* across a failed
  refetch, so when `getCurrentUser` refetched and returned **401** after expiry, the stale user
  stayed in cache → `isAuthenticated` stayed `true` → `/login` showed the spinner and tried to
  redirect to `/dashboard` (bounce) indefinitely. F5 cleared the cache → `false` → form.
- **Fix**: Treat a **401/403** from the current-user probe as unauthenticated *before* the
  `data?.user` branch, ignoring any retained stale data. Network/timeout errors (no response) are
  deliberately NOT treated as logout (offline ≠ logged out), mirroring the `api.ts` refresh
  interceptor — they keep the cached state. Two regression tests added (401 → drops stale user;
  network error → keeps cached user). **No** request timeout / resolution ceiling was added (that
  approach was deliberately reverted earlier in `123c76a`).
- **Status**: Resolved (2026-06-29) — full web suite (426) green; type-check + lint clean.

### B-31: Invitation emails sent in English despite the sender's UI being in another language — RESOLVED

- **Severity**: Medium — wrong-language emails (share/reverse-share/user invitations) for every non-English operator
- **Files**: `apps/web/src/components/general/language-switcher.tsx`, `apps/web/src/i18n/request.ts`,
  `apps/server/src/modules/email/i18n/loader.ts`, `apps/server/src/modules/user/{dto,service,routes,repository}.ts`,
  `apps/server/src/modules/invite/{service,routes}.ts`, `apps/server/src/utils/request-locale.ts`,
  `packages/shared/src/locales.ts`
- **Description**: An admin whose dashboard was in French still received the share-invitation email in English.
  Two compounding root causes:
  1. **`user.locale` was never persisted from the UI.** The language switcher only set the `NEXT_LOCALE`
     cookie (which drives the UI) and called no API; no endpoint wrote `user.locale`, and `UpdateUserSchema`
     had no `locale` field. So `user.locale` stayed at its `"en"` default for every normally-created user, and
     the invitation paths (`share`/`reverse-share`/`invite` services, `locale: user?.locale ?? "en"`) resolved
     to English.
  2. **Format mismatch.** The UI uses full BCP-47 tags (`fr-FR`); email message files are keyed by base
     language (`fr`, `en`) and the i18n loader did **no** prefix matching, so even a persisted `fr-FR` would
     have fallen back to English.
- **Fix**:
  - New canonical `@ouitransfer/shared/locales` (single source of truth for the 23 UI locales + Accept-Language
    resolution); `request.ts` and the server now consume it (drift-guarded by tests).
  - New self-service `PATCH /users/me/locale` (Zod-validated against `SUPPORTED_UI_LOCALES`); the language
    switcher persists the choice for authenticated users (fire-and-forget, skipped for anonymous share visitors).
  - `user.locale` is also seeded at registration (both `/auth/register` and invite registration) from the
    request's `NEXT_LOCALE` cookie / `Accept-Language`, so users never get English mail merely for never
    opening the switcher.
  - The email i18n loader now resolves `fr-FR → fr → en` (base-language fallback) in both the async and
    pre-loaded-sync paths.
- **Note**: existing accounts created before this fix keep `locale = "en"` until the user re-selects their
  language once (now persisted) — acceptable as the app has no production users.
- **Status**: Resolved (2026-06-29) — full server suite (1911) + web (426) + shared (24) green; lint clean.

### B-28: Share password update returns 404 — PATCH/PUT method mismatch

- **Severity**: High (feature broken in production)
- **Files**: `apps/web/src/http/endpoints/shares/index.ts:140`
- **Description**: The frontend calls `PUT /api/shares/:id/password` but the server route declares `PATCH /shares/:shareId/password`. Fastify treats unknown method+URL combinations as 404. The reverse-share equivalent is consistent (`PUT` on both sides) — only shares is affected.
- **Fix**: Changed `apiInstance.put(...)` → `apiInstance.patch(...)` in `shares/index.ts`.
- **Status**: Fixed (2026-06-10)

### B-29 (gap): Authenticated Ouitransfer users not identified in share activity log — RESOLVED

- **Severity**: Low — UX/tracking gap, no security impact
- **Description**: A **non-owner authenticated user** accessing a share via `GET /shares/:shareId`
  showed as "anonymous" in the activity log even though their `userId` was known from the JWT, because
  `ShareVisit.identificationSource` only supported `"token" | "self_declared" | null` and `userId` was
  not stored. (The original report also flagged owners not appearing; see the owner decision below.)
- **Fix**: Added `ShareVisit.userId` (FK → `User`, `onDelete: SetNull`, migration `share_visit_user`)
  and a new `identificationSource = "authenticated_user"` (verified, JWT-backed). The share-access and
  file-download paths now identify a logged-in non-owner visitor (snapshotting `username`/`email`),
  with precedence `token > self_declared (matched cookie) > authenticated_user > anonymous` — a
  verified account also wins over an **unmatched** cookie. `/shares/:id/visits` exposes
  `authenticated_user` + an `isOwner` flag (raw `userId` stripped from the payload). The frontend
  renders a **verified** badge (no spoofable hint) and a "You" indicator. GDPR: `deleteUser` nulls the
  `visitorEmail`/`visitorName` snapshots on the deleted user's visit rows. i18n in all 23 locales.
- **Owner decision (post-review)**: owner self-accesses are **intentionally NOT tracked** — the
  owner's own share-details/management modal is the primary caller of `GET /shares/:shareId` (refetch
  on open + every `invalidateShare()`), so logging owner views would fill the activity log with
  self-referential noise. This matches the owner-download path (also untracked).
- **Status**: Resolved (2026-06-13) — spec/plan/review under `features/{specs,plans,reviews}/b-29-…`.
  Opus review: 0 Critical / 1 Important / 4 Minor, all fixed.

### B-30: CORS rejection returns 500 instead of 403 — RESOLVED

- **Severity**: Medium — mauvaise UX (message "An unexpected error occurred" au lieu d'une erreur CORS explicite)
- **File**: `apps/server/src/app.ts`
- **Description**: Quand une requête arrive depuis une origine non autorisée, le callback CORS appelait `cb(new Error("Not allowed by CORS"), false)`. Cette `Error` générique remontait dans le `globalErrorHandler` qui ne la reconnaît pas comme une `AppError` → retournait 500 au lieu de 403. Le frontend affichait alors "An unexpected error occurred" au lieu d'un message CORS. Symptôme le plus visible : le **login** (un POST → le navigateur envoie un en-tête `Origin`) tombe en 500 depuis un host non listé dans `CORS_ORIGINS`, alors qu'un GET sans `Origin` passe.
- **Reproduced**: Accès depuis un internal host (`OUITRANSFER_INTERNAL_HOST`) non listé dans `CORS_ORIGINS` (qui ne contenait que l'origine externe).
- **Fix**: Remplacé `cb(new Error(...), false)` par `cb(new ForbiddenError("Origin not allowed by CORS policy"), false)` → le `globalErrorHandler` mappe l'`AppError` sur un **403** (code `FORBIDDEN`). Ajout de 2 tests d'intégration `app.inject` (preflight OPTIONS : origine non listée → 403 ; allow-list séparée par virgule → 204 + en-tête `access-control-allow-origin`). Clarifié la doc multi-origines (`.env.docker.example`, `docker-compose.yaml`) : `CORS_ORIGINS` accepte une liste séparée par virgule et doit lister **tous** les hostnames servis (interne ET externe).
- **Status**: Resolved (branch `claude/nice-brown-gr9vp1`)

### B-26: TOCTOU race condition on invite token single-use enforcement — RESOLVED

- **Severity**: Medium
- **File**: `apps/server/src/modules/invite/service.ts`
- **Description**: `validateInviteToken` checked `usedAt` is null, then the `$transaction` did an unconditional `inviteToken.update({ data: { usedAt } })`. Two concurrent requests with the same valid token could both pass validation and both create users before either set `usedAt` — the single-use guarantee was not enforced atomically.
- **Fix**: Token consumption is now atomic inside the transaction via `updateMany({ where: { token, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: new Date() } })`; if `count === 0` the request re-reads the row and throws the precise structured error (`INVITE_TOKEN_USED` / `INVITE_TOKEN_EXPIRED` / `NOT_FOUND`) without creating a user. A fast-fail pre-flight check (before the bcrypt hash) is retained for friendly errors. Extracted pure `evaluateInviteToken()` (shared with the GET validate route) + `invalidInviteTokenError()`. Added 3 lost-race `app.inject` integration tests asserting no user is created when the claim matches 0 rows.
- **Status**: Resolved (branch `claude/project-onboarding-debt-oJkhn`)

### B-27: Container boot skips DB seeding → empty config → crash loop — RESOLVED

- **Severity**: Critical (server unbootable on a fresh volume)
- **Files**: `infra/server-start.sh`, `Dockerfile`, `knip.json`; deleted `infra/check-missing.js` / `infra/configs.json` / `infra/providers.json`; `apps/server/prisma/seed.js` (thin runner) + new `apps/server/src/db/seed-data.ts` (extracted, added to `package.json` `files`) + `apps/server/src/__tests__/seed.integration.test.ts`
- **Introduced by**: TD-48 (`abeff4c`) — reworked the boot to route ALL seeding through a `NEEDS_SEEDING` gate, removing the previous unconditional fresh-DB seed.
- **Description**: `server-start.sh` seeded only when `NEEDS_SEEDING=$(... check-missing.js check-seeding 2>/dev/null || echo "true")` equalled `"true"`. `check-missing.js` calls `dotenv.config()`, and dotenv v17 prints a banner to **stdout**, so the capture became `"<banner>\ntrue"` and the exact `= "true"` match failed → seed skipped → `app_configs` empty → server crash-loops on the first missing config key (`passwordMinLength`, `auditRetentionDays`, `autoCleanupEnabled`, …). Caught by the release-validation gate (`e2e.yml`) only at tag time, so it sat undetected on `main` between releases. Two latent issues compounded it: the seed/check scripts importing `../src/...` (only resolvable via tsx + shipped `src/`), and `infra/configs.json` (the check's hand-maintained key checklist) having silently drifted 26 keys behind `seed.js`.
- **Fix**: Seeding is idempotent ("protected mode"), so `server-start.sh` now runs it **unconditionally** on every boot (backfills new keys, self-heals partial seeds, fails loudly instead of silently). Removed the `check-missing.js` gate + the hand-maintained `configs.json`/`providers.json` checklists entirely. Extracted seed data/logic into `src/db/seed-data.ts` (typed, side-effect-free) with `prisma/seed.js` a thin `dotenv({ quiet: true })` runner. Added `seed.integration.test.ts` (completeness + idempotency) so the boot contract is covered in fast PR CI.
- **Status**: Resolved (branch `claude/fix-docker-seed-boot`)
