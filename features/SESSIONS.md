# Session Log

## 2026-06-10 (morning — code reviews, TODO updates)

- Launched 3 sequential code reviews for all overnight work (violating workflow to skip reviews was caught by user)
- **Review 1 — TD-28 Zod v4:** 2 Important + 2 Minor. Key finding: `z.coerce.boolean()` on `?force` query param silently inverts `force=false` → `true` on destructive delete routes (`file/routes.ts:943`, `folder/routes.ts:609`). Fix required + integration test.
- **Review 2 — TD-5 + TD-40:** 1 Important + 4 Minor. Key finding: hydration mismatch in `global-error.tsx` — `useMemo` runs during SSR (no `document` → `"en"`), client sees real locale → React warning + RTL layout flip. Fix: `useState`/`useEffect` pattern.
- **Review 3 — TD-10 + TD-43:** 0 Important + 5 Minor only (security, correctness verified clean). `["/admin"]` wildcard proven sound, all description keys verified against `NotificationType` union.
- Reports written to `features/reviews/` (3 files, each finding as checkbox per workflow).
- Updated `features/TODO-DEFERRED-FIXES.md` with review table, links, and all 17 findings (3 Important, 14 Minor) — all marked as must-fix.

## 2026-06-10 (overnight batch — TD-28, TD-10, TD-5, TD-32/33/52, TD-43, TD-40)

### TD-40 — Global error boundary i18n
- Added inline static translation map to `global-error.tsx` covering all 23 locales (4 strings each)
- Locale detection from `NEXT_LOCALE` cookie or `navigator.language`, English fallback
- RTL `dir` attribute for ar/fa/he locales
- Removed TODO comment about hardcoded English

### TD-43 — Notification type descriptions
- Added `descriptions` sub-namespace under `notificationPreferences` in all 23 locale files (18 configurable notification types)
- Updated `notification-preferences-table.tsx` to render description as muted text below each type label
- `en-US.json`: English descriptions, `fr-FR.json`: French translations, 21 others: English placeholders

### TD-32, TD-33, TD-52 — Closed as accepted design trade-offs
- TD-32 (sender locale for external recipients): accepted — sender locale is best available heuristic
- TD-33 (email subject frozen at enqueue): accepted — negligible real-world impact
- TD-52 (reverse-share upload tracking minor items): accepted — all very low severity polish items

## 2026-06-10 (TD-28, TD-10, TD-5 — Zod v4 Migration + Admin Routes + Type Safety Audit)

**Completed full Zod v3→v4 migration across the entire monorepo.**

- **Phase 1 (packages):** Upgraded catalog `zod` from `^3.25.76` to `^4.4.3`, removed `zod@^4.0.0` override (was for fumadocs), switched `fastify-type-provider-zod@4.0.2` → `@fastify/type-provider-zod@1.0.0` (official Fastify org package).
- **Phase 2 (imports):** Updated all 26 files importing from `"fastify-type-provider-zod"` → `"@fastify/type-provider-zod"` (22 source + 4 test files). API names unchanged.
- **Phase 3 (breaking changes):** Fixed `z.NEVER` → `undefined as never` (3 uses in quota-schema), `z.ZodIssueCode.custom` → `"custom"` (14 uses across 4 files), `z.record(z.string())` → `z.record(z.string(), z.string())` (1 use), `required_error`/`invalid_type_error` → `error` function (2 uses), `.pipe(z.coerce.number())` → `.transform(Number).pipe(z.number())` (1 use in config-validation).
- **Phase 4 (error handler):** Updated `handleZodValidationError` for new FTPZ v1 validation shape — `params.issue.path/message` → `instancePath` + top-level `message`. Fixed test helper to match. Fixed `auth-lockout.integration.test.ts` mock (Zod v3 silently accepted `min(NaN)`, v4 rejects it).
- **`.describe()` (620 uses):** Left as-is — deprecated but functional, no warnings. Deferred to future TD.
- **Result:** 1947 tests passing (1599 server + 334 web + 14 shared), lint clean, type-check clean.
- Marked TD-28 as resolved.

**TD-10 — Consolidated admin routes under `/admin/`:**
- Moved 3 top-level admin pages: `users-management/` → `admin/users/`, `groups-management/` → `admin/groups/`, `settings/` → `admin/settings/`
- Simplified `adminPaths` config from 4 explicit entries to single `/admin` wildcard (prefix matching)
- Fixed pre-existing bug: `/admin/audit` was missing from `adminPaths` (only protected by client-side guard)
- Updated all hrefs (navbar, LDAP group mapping link), cross-directory imports (FileSizeInput), proxy tests
- All 334 web tests passing, type-check + lint clean
- Marked TD-10 as resolved.

**TD-5 — Type safety audit of `apps/server/src/`:**
- Audited all 61 `as` casts in production code — classified as 35 safe, 18 suspicious, 2 dangerous.
- Confirmed no Zod schema duplication (routes import from `dto.ts` consistently).
- Confirmed Fastify lifecycle hooks properly typed (no issues).
- Found 1 Prisma type gap (`deactivationReason` String? → union cast) — deferred to separate TD (needs Prisma enum migration).
- **Fixed 7 issues:** CSRF getToken header array handling, challenge token userId type guard, auth-cookies headerString utility, `isNotificationKey()` type guard (eliminates 4 cast sites), removed redundant body/query casts in notification routes.
- Documented 4 remaining items for future work (email catalog generic erasure, error handler double-escape, S3 stream type, Prisma enum).
- All 1947 tests passing, type-check + lint clean.
- Marked TD-5 as resolved.

---

## 2026-06-09 (8.3 — Download Tracking, full feature)

**Implemented 8.3 Download Tracking end-to-end: spec → plan → plan-review → 5 batches (each
with implementer + reviews), lots A/B/C/D/F. Lot E (per-invitee password) explicitly dropped.**

- **Premise (recorded in spec):** a June-2026 codebase audit found 8.2 had already delivered most
  of the original 8.3 scope (tracking tokens, personalized links, `ShareVisit` download rows,
  `share_downloaded` notif, visitor identification, activity view, per-recipient access stats).
  Only 5 lots remained. This is a **comfort feature, not a security control** — a self-declared
  identity is spoofable and that is accepted; we **label the source** rather than harden it.
- **Batch 1 (schema + identity bridge + lot F enrich):** added `ShareRecipient.downloadCount` /
  `lastDownloadedAt`, `ReverseShareRecipient.uploadCount` / `uploadedAt`,
  `ShareVisit.identificationSource` (migration `download_tracking`). The tracking token never
  reaches the download request, so the verified `recipientId` is carried via the **signed visitor
  cookie** (written server-side only after a token is verified); self-declared email match is the
  fallback. The two existing `FILE_DOWNLOAD` audit emits were **enriched** with
  `recipientId` + `identificationSource` (no second emit — double-log guarded by test). `/visits`
  maps stored source `token`→`tracking_token`, `self_declared`→`cookie`.
- **Batch 2 (recipient badge):** Downloaded/Pending badge keyed off `lastDownloadedAt != null`,
  plus a self-declared source hint in the activity view. DTO/types round-trip asserted via
  `app.inject()`.
- **Batch 3 (manual reminders):** `POST /shares/:id/remind` targeting non-downloaders only
  (`notifiedAt != null && lastDownloadedAt == null`); new non-configurable `share_download_reminder`
  email type (no `userId`), `SHARE_RECIPIENT_REMIND` audit action, "Remind (N)" button. **No
  scheduler** (manual only).
- **Batch 4 (reverse upload tracking, best-effort):** match optional self-declared `uploaderEmail`
  against `ReverseShareRecipient`; atomic `uploadCount { increment: 1 }` + conditional
  `updateMany({ where: { uploadedAt: null } })` first-upload timestamp. Uploaded/Pending badge with
  an "approximate when email not required" caveat.
- **Batch 5 (this session — GDPR + docs + tracking):**
  - **GDPR notice:** wired the pre-existing `share.identification.privacyNotice` and
    `reverseShares.upload.form.privacyNotice` i18n keys (already authored en/fr + EN replicas in
    21 locales) into the visitor identification dialog and the reverse-share upload form. Added a
    parallel notice on the reverse-share form because an uploader's self-declared identity is shown
    to the owner — symmetric and consistent. Shown only when an identification field is visible.
  - **Docs:** extended Shares + Reverse Shares Fumadocs pages (EN + FR) — per-recipient
    Downloaded/Pending status, the verified-vs-self-declared distinction (comfort feature, not
    security), manual reminders (no scheduler), reverse best-effort upload tracking, and the privacy
    note. Corrected the now-stale "no per-recipient tracking" reverse-share callout.
  - **Tracking:** README 8.3 → Done, test counts refreshed, spec status → Done. TD-36 namespace
    table updated (+2 privacyNotice keys). New **TD-52** records two deferred minor items
    (`uploadCount` API-only / not displayed; no live-DB test for reverse upload linkage).
- **Final state:** server 99 files / **1596 tests**, web 34 files / **334 tests**, shared 2 / 14 =
  **1944 total**, all green. Web + server type-checks clean. Docs build OK (83 pages). Locale-parity
  test green. **Final review pass on 8.3 is handled separately** (`features/reviews/8.3-…`).

## 2026-06-04 (TD-50 — Fumadocs site deployable via Docker)

**Made the Fumadocs documentation site self-hostable as a Docker service, mounted under `/docs`.**

- **Decisions (with user):** path-prefix `/docs` on the main domain; routed by the user's
  Traefik via `PathPrefix(/docs)` **without StripPrefix**; marketing landing kept as-is (the
  doc therefore lives at `/docs/docs/v1-beta` — accepted). Mechanism: Next.js `basePath` baked
  at build time. Spec: `features/specs/td-50-docs-docker.md`.
- **Docs app:** `next.config.mjs` → `output: "standalone"`, `outputFileTracingRoot` (monorepo
  root), `basePath` from `NEXT_PUBLIC_DOCS_BASE_PATH`. New `src/lib/base-path.ts` (`withBasePath`)
  to fix client `fetch` calls that don't inherit `basePath`: fumadocs search
  (`RootProvider search.options.api`) and `KeyGenerator` (`/api/generate-key`).
- **Infra:** `Dockerfile` gains `docs-deps`/`docs-builder`/`docs-runner` (port 5488, build arg
  `NEXT_PUBLIC_DOCS_BASE_PATH=/docs`). `docker-compose.yaml` gains a `docs` service (+ Traefik
  example in comments); `docker-compose.ci.yml` adds the build override. `e2e.yml` builds,
  health-checks (`:5488/docs`), and publishes `ghcr.io/slvnlrt/ouitransfer-docs` (loop
  `server web docs`); `Justfile docker-push` mirrors it. `.env.docker.example` documents the service.
- **Middleware matcher fix (`proxy.ts`):** Next.js prefixes middleware `matcher` patterns with
  `basePath`, so the catch-all `/((?!…).*)` becomes `/docs/(…)+` and never matches the bare
  `/docs` root → the default-locale landing 404s while every sub-page works. Fixed by adding
  `"/"` to the matcher. Upstream `createI18nMiddleware` otherwise unchanged; harmless without basePath.
- **Validation:** docs type-check + lint clean; production build (with and without `basePath=/docs`,
  83 pages, `/docs/_next` + `/docs/api/search` baked); merged `docker compose config` valid.
  Faithful runtime test via `next start` — **all routes 200** in both modes: basePath `/docs`
  (landing, `/docs/docs/v1-beta`, `/docs/en` 307→200, `fr` pages, search, generate-key, assets)
  and no-basePath (`/`, `/docs/v1-beta`, `/en`, `fr`, search). A first (wrong) diagnosis of a
  "default-locale loop" was an artifact of a hand-assembled standalone test, not real.
- **Tracking:** TD-50 moved to resolved archive; README open-debt list updated.

## 2026-06-04 (TD-30 — Reverse share invitation feature)

**Implemented the reverse share invitation feature (VERSION LIGHT).**

- **Prisma schema:** Added `ReverseShareRecipient` model (email, name?, notifiedAt, cascade delete, unique `[reverseShareId, email]`). Hand-authored migration `20260604095354_reverse_share_recipients`.
- **Email infrastructure:** Added `buildReverseShareUploadLink(alias)` to URL builder. Removed DEFERRED comment from catalog entry. Existing template + i18n keys now fully wired.
- **Server module:** Extended `reverse-share/repository.ts` with `addRecipients`/`removeRecipients` (email normalization, P2002 handling). Added 4 Zod schemas to `dto.ts`. Added 3 service methods: `addRecipients` (with ConflictError on duplicate), `removeRecipients`, `notifyRecipients` (ownership check, alias guard, per-recipient email send, notifiedAt tracking, partial failure tolerance). 3 new routes + 3 audit actions.
- **Tests:** 11 unit tests for `notifyRecipients` (all pass). Server total: 266 tests. Web total: 318 tests. Both type-checks clean.
- **Frontend:** Types + 3 endpoint functions in `reverse-shares/`. New `ReverseShareRecipientSelector` component (SMTP-gated + alias-gated notify, per-recipient and bulk operations). Integrated into `reverse-share-details-modal.tsx`. Reuses existing `recipientSelector.*` i18n keys — no new keys needed.
- **Documentation:** Added "Email invitations" section to Fumadocs reverse-shares docs (en + fr).
- **Tracking:** TD-30 moved to resolved archive.

**State:** server 266 tests pass, web 318 tests pass, both type-checks clean, knip clean.

## 2026-06-03 (Autonomous debt sweep — B-26, TD-51, TD-38)

**Three bounded, fully-tested fixes picked from open bugs/tech-debt.**

- **B-26 — invite token single-use TOCTOU (security).** `registerWithInvite` validated the
  token then ran an unconditional `inviteToken.update` inside the transaction, so two
  concurrent requests with the same token could both create a user. Replaced with an atomic
  conditional claim (`updateMany where usedAt: null AND not expired`); the loser gets
  `count === 0`, re-reads the row, and surfaces the precise reason without creating an account.
  Extracted pure `evaluateInviteToken()` (shared with the GET validate route) +
  `invalidInviteTokenError()`. 3 new lost-race integration tests. `apps/server/src/modules/invite/service.ts`.
- **TD-51 — harsh pure-white light-theme surfaces.** `--card`/`--popover` were `oklch(1 0 0)`;
  softened to off-white indigo-tinted (`0.99 0.004 265`) and `--background` to `0.975 0.007 265`,
  keeping surfaces brighter than the page. Dark theme untouched. `apps/web/src/app/globals.css`.
- **TD-38 — unsubscribe pages migrated to the email i18n system.** Removed the hardcoded inline
  `PAGE_STRINGS` map; the confirm/success/error pages now render via `createTranslationFn` under a
  new `unsubscribe.*` namespace in `email/i18n/messages/{en,fr}.json`, sharing one source of truth
  and the same locale fallback as the notification emails. 2 new French-rendering integration tests;
  `beforeEach` resets `user.findUnique` to prevent locale leak. (Effective coverage stays en/fr —
  broadening the email subsystem's languages remains TD-36.)

**State:** server 1486 tests pass, type-check clean, Biome + knip clean. Commits on
`claude/project-onboarding-debt-oJkhn` (pushed).

## 2026-06-03 (5.2 Auto-cleanup — Phase B: quota overage policy)

**Aggressive quota-overage policy delivered across 5 sequential batches — feature now complete**

- **Owner decisions.** Smart deletion is **included but opt-in, off by default**, with a strict
  safe deletion order; reverse-share external uploads use **soft enforcement, on by default**.
  Conservative defaults throughout. Reuses the Phase A cleanup scheduler, the existing
  `quota_warning` / `quota_exceeded` / `admin_quota_alert` / `files_auto_deleted` notifications,
  and 8.1 audit.
- **Batch 1 — schema + config + helpers.** Additive migration `quota_overage`:
  `User.quotaLastWarnedThreshold`, `User.quotaExceededSince` (state tracking). Seeded + validated
  the 7 Phase B config keys in the **Storage** group (CSV thresholds 1–99, grace ≥ 0, inactive-share
  ≥ 1, overage factor ≥ 1, absolute cap ≥ 0). Pure `QuotaService` helpers: `parseThresholds`,
  `crossedThreshold`, `isReverseUploadAllowed`, `pickDeletionCandidates`.
- **Batch 2 — B1 warnings + B3 soft enforcement.** Event-driven `evaluateAndNotifyQuota` on direct
  and reverse-share file register: emails the owner the first time usage crosses a threshold upward
  (`quota_warning` / `quota_exceeded` at ≥100%), deduped via `quotaLastWarnedThreshold` and re-armed
  when usage drops below the lowest threshold; set/clear `quotaExceededSince` at the 100% boundary.
  Reverse uploads switched to `isReverseUploadAllowed` (soft) when the toggle is on, blocked at
  `min(limit × factor, cap)`; the owner's own direct uploads keep the hard block. **Fixed a
  pre-existing bug** where `quota_exceeded` was coupled to the configured warning thresholds — it
  now fires purely on the 100% boundary, independent of the threshold list.
- **Batch 3 — B2 smart-deletion sweep (opt-in).** `enforceQuotaOverage` in `cleanup/service.ts`:
  for users over 100% past the grace period, deletes files (DB before S3, failure-tolerant) in the
  safe order — orphan uploads oldest-first, then inactive-share files — stopping at the limit; if
  nothing safe remains (everything in active shares), deletes **nothing** and counts the user as
  `blocked`. Emits `QUOTA_FILES_DELETED` audit + `files_auto_deleted` notice; clears
  `quotaExceededSince` when back under. Emptied shares left as-is (§7). Scheduler gates the sweep on
  `quotaSmartDeletionEnabled` and feeds it into the aggregated run summary.
- **Batch 4 — admin UI + i18n.** Surfaced the 7 keys in the Storage settings group (Switches +
  number/text/bytes inputs) with client-side validation mirroring the server (CSV thresholds, factor
  ≥ 1, BigInt-safe non-negative bytes); reassuring copy (smart deletion off by default). i18n in 23
  locales + the `audit.actions.QUOTA_FILES_DELETED` label.
- **Batch 5 — docs + tracking.** Extended the docs "Automatic Cleanup" page (EN + FR) with a
  "Storage quota policy" section: threshold warnings, grace + opt-in smart deletion (safe order,
  never touches active-share files, off by default), reverse-share soft enforcement (factor/cap,
  external vs the owner's own direct uploads, on by default), and a table of all 7 config keys.
- **Tests:** server 1453 (91 files), web 321 (33 files), shared 14 (2) = **1788 total**, all green.
  Docs build green (EN/FR parity); Biome + knip clean.

---

## 2026-06-03 (5.2 Auto-cleanup — Phase A.1: explicit lifecycle + manual pause)

**Reworked the share/reverse-share cleanup into an explicit two-phase lifecycle across 5 sequential batches**

- **Owner decision.** Replace Phase A's implicit "expired/maxViews → 410 at read time → hard-delete
  after grace" with an **explicit, persisted, two-phase lifecycle**:
  `active → deactivated (expired | max_views | manual pause) → deleted`, uniform across triggers,
  with a single grace measured from `deactivatedAt`, manual pause/resume, and **manual pauses never
  auto-deleted**. Applies equally to shares and reverse shares. Reuses Phase A's delete helpers +
  notification types.
- **Batch 1 — schema.** Additive migration `share_lifecycle`: `Share.isActive` / `deactivatedAt` /
  `deactivationReason`; `ReverseShare.deactivatedAt` / `deactivationReason` (already had `isActive`).
  Shared `DeactivationReason = "expired" | "max_views" | "manual"`.
- **Batch 2 — read-time gating + transitions.** `getShare` gates on `isActive` first (with defensive
  expiry/maxViews checks); maxViews increment sets deactivation inline; manual `pauseShare`/
  `resumeShare`; extending expiration / raising maxViews reactivates and resets notified flags.
  Reverse-share `isActive` toggle aligned to set/clear `deactivatedAt`/reason.
- **Batch 3 — scheduler sweeps.** Split the three old cleanup functions into a **deactivation sweep**
  (`deactivateEndedShares`/`…ReverseShares` — persist `expired`/`max_views`, upgrade stale `manual`
  pauses to `expired`, notify once) and a **deletion sweep** (`deleteDeactivatedShares`/`…ReverseShares`
  — delete where reason ∈ {expired, max_views} AND `deactivatedAt < now − grace`, manual excluded,
  warn once). Scheduler now drops the `maxViewsCleanupDays` read.
- **Batch 4 — endpoint + UI.** Owner-only pause/resume endpoint; share card/list shows a
  deactivated/paused state with a reason badge (`expired` / view limit / paused), resume + renew/extend
  affordances, mirroring the reverse-share toggle; API client + query invalidation; i18n in 23 locales.
- **Batch 5 — config retirement + docs + tracking.** **Retired `maxViewsCleanupDays`** everywhere
  (seed, server validation, web settings group + 23-locale i18n, tests, docs) — superseded by the
  single uniform `autoCleanupGracePeriodDays` from `deactivatedAt`. Reworded the grace-period docs/i18n
  to "days after deactivation". New audit actions `SHARE_DEACTIVATED`/`SHARE_REACTIVATED` +
  reverse-share variants documented; retired `REVERSE_SHARE_ACTIVATE`/`REVERSE_SHARE_DEACTIVATE`.
  Rewrote the docs "Automatic Cleanup" page (EN + FR) around the two-phase lifecycle + manual pause.
- **Tests:** server 1344 (89 files), web 310 (32 files), shared 14 (2) = **1668 total**, all green.
  Docs build green (EN/FR parity); Biome + knip clean; zero `maxViewsCleanupDays` references in `apps/`.

---

## 2026-06-03 (5.2 Auto-cleanup — Phase A complete)

**Lifecycle management & automatic cleanup — Phase A shipped across 8 sequential batches**

- **Scope & design.** Phased delivery: Phase A is safe, mostly non-destructive-by-default
  lifecycle management; Phase B (aggressive quota-overage policy) remains. Binding decisions:
  auto-deletion is **opt-in and off by default**; **conservative defaults** (long grace,
  warn-before-delete, never touch content inside an active share); every automated deletion
  emits an audit event; warnings reuse the 8.2 notification catalog/queue/preferences.
- **Batch 1 — schema + config.** Additive migration `cleanup_lifecycle`: `User.deactivatedAt`,
  `Share.notifiedForPendingDeletion`, `ReverseShare.notifiedForPendingDeletion`. Seeded the
  9-key `cleanup` config group (conservative defaults) with per-key bounds validation in both
  single + bulk update paths.
- **Batch 2 — email.** New notification types `share_pending_deletion`,
  `reverse_share_pending_deletion`, `reverse_share_auto_deleted` (catalog + Zod payloads +
  Outlook-safe indigo templates + en/fr keys), reusing existing `share_auto_deleted` /
  `files_auto_deleted` where present.
- **Batch 3 — expired/maxViews cleanup (A2–A5).** New `modules/cleanup/service.ts`:
  **share-link-only** deletion for expired + maxViews regular shares (never the owner's
  File/Folder/S3 — files live in the file manager and can be in multiple shares), storage-
  reclaiming deletion for expired reverse shares + their S3 objects, warn-once pending-deletion
  emails, all wrapped failure-tolerant with `{ warned, deleted, errors }` summaries.
- **Batch 4 — account lifecycle (A6–A8).** Read-time **reversible** block on shares/reverse
  shares of a deactivated owner (derived from `creator.isActive`, ungated); `purgeUserContent`
  helper; **full deletion cascade** on `deleteUser` (files, shares, reverse shares, S3) fixing
  the old `SetNull` orphaning; opt-in `cleanupDeactivatedAccounts`. This landed meaningful
  `user` + `reverse-share` service/integration coverage → **TD-49 resolved**.
- **Batch 5 — orphan sweep (A9).** Paginated `listObjects` on the S3 provider; bidirectional
  `sweepOrphans` (DB→missing-S3 and S3→no-DB-row) with a min-age guard; retired the one-shot
  `cleanup-orphan-files.ts` into a thin CLI wrapper → **TD-17 and TD-25 resolved**.
- **Batch 6 — scheduler (A1).** In-process chained-`setTimeout` scheduler modeled on the audit
  retention scheduler; reads config live each run; registered in `server.ts` boot + `onClose`.
- **Batch 7 — admin UI (A10).** Rendered the `cleanup` settings group with client-side bounds
  validation mirroring the server; labels/descriptions across all 23 locales.
- **Batch 8 — docs + tracking.** New "Automatic Cleanup" Configuration page (EN + FR) in the
  docs site; this tracking update.
- **Tests:** server 1300 (83 files), web 291 (30 files), shared 14 (2) = **1605 total**, all green.

---

## 2026-06-02 (Code hygiene — remove TD-xx ticket references from code)

**Stripped all internal tech-debt ticket citations (`TD-N`) from source code files and test labels**

- Surveyed entire repo via grep; left `features/`, `audit/`, and all `*.md`/`*.mdx` untouched (those are the legitimate tracking system).
- Removed 9 citations from comments in `.ts`, `.yml`, and `.tsx` files (`21c0b30`).
- Removed 5 `(TD-N)` suffixes from `describe(...)` test-suite labels across `apps/server` and `apps/web` (follow-up commit).
- Zero `TD-[0-9]+` remaining in `apps/`, `infra/`, `.github/`, `packages/`.

---

## 2026-06-02 (TD-48 — Adopt Prisma Migrate)

**Adopted incremental Prisma Migrate workflow; replaced `db push` throughout**

- **Clean baseline**: reset migration history to a single `20260602091201_init` migration
  covering the full current schema (all columns, tables, indices).
- **WAL-safe backup script**: `apps/server/src/scripts/db-backup.ts` — checkpoints WAL,
  uses better-sqlite3 online `.backup()`, rotates to last 3 copies.
- **Container boot**: `infra/server-start.sh` runs `prisma migrate deploy` at startup,
  preceded by a WAL-safe backup when an existing DB file is found.
- **Dev workflow**: `just db-migrate-dev` to author new migrations; `just db-dev-init`
  now runs `migrate deploy` + seed (replaced `db push`).
- **CI drift guard**: `.github/workflows/ci.yml` step runs `prisma migrate diff
  --exit-code`; fails the build if `schema.prisma` was changed without a matching migration.
- **Turbo `db:generate` guard**: `type-check`/`build`/`test` now depend on `db:generate`
  (regenerates Prisma client from schema). Root-cause fix for a stale gitignored client
  (`apps/server/src/generated/prisma`) that broke local type-check (missing
  `bypassUploadCooldown`/`notifyOnUpload`).
- **CLAUDE.md**: replaced "No incremental migrations" bullet with "Migrations are the workflow".
- **TD-48 closed**: resolved in `features/TECHNICAL-DEBT.md`.

---

## 2026-06-02 (Technical-debt sweep — TD-19, TD-24, TD-18, TD-41, TD-31)

**Self-contained tech-debt items from `TECHNICAL-DEBT.md` — perfect/zero-debt bar**

- **TD-19 (QR download)**: consolidated 7 components with 3 divergent QR-download
  implementations onto a single `useQrDownload` hook + SVG-ref-based
  `downloadQrCodeAsPng` util — no global DOM ids left. Fixed 3 broken download paths
  (SVG→`HTMLCanvasElement` cast, `querySelector("canvas")` on an SVG, `btoa` on
  non-Latin1). Unit tests for the util + hook.
- **TD-24 (`auditRetentionDays`)**: centralized per-config-key validation registry
  applied in both single + bulk update paths (0 or ≥ 7). Client `superRefine` +
  inline error + server backstop; i18n in 23 locales. 16 unit + 10 integration tests.
- **TD-18 (alias validation)**: single source of truth `shared/alias-schema.ts`
  (5–30, alphanumerics + single internal hyphens) for both share + reverse-share
  endpoints; fixed pre-existing charset/length drift and a frontend/server mismatch
  (underscore, max 50). Inline validation in all 4 alias inputs. **User decisions:**
  min 5, no reserved-word blocklist (namespaced `/s/` `/r/`), hyphens unified.
  16 unit + 20 integration tests.
- **TD-41 (cooldown bypass)**: `bypassUploadCooldown` on ReverseShare;
  `resolveFrequency` step 3b returns `overridden: bypassUploadCooldown`. Conditional
  toggle in create + details modals. 3 resolveFrequency + 2 integration tests.
- **TD-31 (audit PII)**: `redactEmailFromAuditLogs` deep-redacts a deleted user's
  email (arrays + scalars) from `AuditLog.metadata` on `deleteUser` (best-effort);
  `USER_DELETE` no longer re-logs the email. 7 unit + 3 integration tests.
- **Discovered & logged**: TD-48 (stale `prisma/migrations/` vs schema — `db push`
  workflow), TD-49 (missing user/reverse-share service test coverage).
- **Quality**: all suites green (server 1163, web 284); type-check, biome, knip clean
  on every commit. 5 commits, one per TD.

---

## 2026-06-01 (Docs i18n — French translation system)

**Documentation site — internationalization (English + French)**

- **Infrastructure**: set up Fumadocs i18n on `apps/docs` (`fumadocs-core` `defineI18n`, `en` default + `fr`, `hideLocale: "default-locale"` so existing English URLs stay at `/docs/...` and French lives under `/fr/docs/...`). Enabled i18n on the source loader, added the i18n proxy (`src/proxy.ts`, Next.js 16 convention), and restructured the app router under a `[lang]` segment.
- **UI chrome**: localized Fumadocs UI strings (search, TOC, theme, language selector, page actions…) via the non-deprecated translations API (`i18n.translations().extend(uiTranslations()).add("ui", { fr })`) + `i18nProvider` in the root layout.
- **Marketing surfaces**: localized the home page, beta modal, banner, and OIDC provider cards through a typed content dictionary (`src/lib/content-i18n.ts`) and a pathname-aware `OIDCProviderCards`. Added a locale-aware MDX link override so absolute `/docs/...` links keep users in their language.
- **Content**: translated all 37 MDX pages to French (`*.fr.mdx`) plus navigation metadata (`meta.fr.json`), coordinated across 8 sequential translation subagents with a shared glossary. Code blocks, imports, JSX prop names, env vars, URLs, and frontmatter keys preserved byte-for-byte.
- **Review**: verified EN/FR parity (code-fence, import, heading, and link-target counts), fixed 2 broken in-page anchors (translated headings) and 1 untranslated title. Lint + type-check clean; production build green (80 static pages, both locales).
- **Commits**: i18n infrastructure, locale link override, navigation metadata, 8 translation batches, review fixes.

---

## 2026-06-01 (Documentation update — shares, reverse-shares, notifications)

**Documentation — Filling gaps for features added since session 10**

- **Analysis**: audited all docs vs. implemented features; identified 3 missing pages and 5 pages needing updates (8.2 Email Notifications, TD-34 notifyOnUpload, 10.1 System Status Bar undocumented)
- **`shares.mdx`** (new, Usage): creation from file manager, all share options, recipients & invitation emails with tracking tokens, visitor identification (3 mechanisms: token / form / anonymous), activity tracking tab with filters, per-share notification overrides (notifyOnDownload, inactivityAlertDays), share lifecycle
- **`reverse-shares.mdx`** (new, Usage): concept, all form options (basic info, page layout, expiration, password, file limits, visitor identification fields, notifyOnUpload), managing uploaded files, uploader experience
- **`notification-preferences.mdx`** (new, Usage): 15 configurable notification types in 4 categories (shares, reverse shares, quota, admin), 7 non-configurable critical types, per-share overrides, cooldown periods, unsubscribe mechanism, API reference
- **`configuring-smtp.mdx`** (updated): expanded "Why configure SMTP" section; added email delivery system section (async queue, retry, cooldowns), admin monitoring section (queue stats dashboard), test email button explanation
- **`api.mdx`** (updated): added share visits endpoint, share identify endpoint, tracking token `?t=` parameter, Notifications section (4 endpoints), Admin email queue section (2 endpoints)
- **`meta.json`** (updated): added shares, reverse-shares, notification-preferences in Usage section
- **`index.mdx`** (updated): added "Email notifications" and "System Status Bar" feature sections
- **`quick-share.mdx`** (updated): cross-references to shares page and SMTP page, recipients section enriched with tracking token info
- **Build**: clean (42 pages, no errors)
- **Commit**: `docs: add shares, reverse-shares, notification-preferences; update api and smtp`

---

## 2026-05-31 (TD-44 + TD-47)

**TD-44 — Fix inactivity alert field label (UX + i18n)**

- `share-privacy-section.tsx`: wrapped input in `relative` div, added `end-3` absolute span `{t("common.days")}`, `pe-14` padding on input
- All 23 locale files: removed parenthesized unit from `createShare.inactivityAlertDays`, added `common.days` key with translations
- RTL fix (post-review): `right-3`/`pr-14` → `end-3`/`pe-14` (logical CSS for Arabic/Persian/Hebrew)
- **Commits**: `fix(web): TD-44 — clarify inactivity alert field with inline unit`, `fix(web): TD-44 RTL — use logical end-3/pe-14 instead of right-3/pr-14`

**TD-47 — pnpm 10.6.0 → 11.5.0**

- Bumped `packageManager` in root + 3 app `package.json` files
- `Dockerfile`: `corepack prepare pnpm@11.5.0 --activate`
- `pnpm-workspace.yaml`: `onlyBuiltDependencies` → `allowBuilds` map (9 packages), `pnpm.overrides` migrated from `package.json`
- `.npmrc`: deleted (project settings migrated to `pnpm-workspace.yaml`; only `autoInstallPeers: true` differs from pnpm 11 defaults)
- Lockfile regenerated (lockfileVersion 9.0)
- `apps/docs`: prerequisites table updated to 11.5.0
- Tests: 1086 server + 274 web — all pass
- **Commit**: `99ca0bf` (`chore(deps): upgrade pnpm 10.6.0 → 11.5.0`)

---

## 2026-05-31 (session 19 continued — review + CI fix)

**Code Review + Fixes + CI**

- **Review pass** sur le travail de la session (security + TD-45/46 + TD-37/35) — 0 Critical, 2 Important, 5 Minor
- **I-1 (Important)** : TS7022 circulaire dans `folder-ancestors.test.ts:136` (boucle `let parentId` + `folder.id` réassigné) → annotation `const folder: { id: string }`. Type-check CI était cassé.
- **I-2 (Important)** : `trackShareDownload` zéro couverture sur le chemin folder-nested → ajout test 7 dans `file-access-folder-nested.integration.test.ts` : vérifie `share.findFirst` avec branche `OR folders`, et `shareVisit.create` appelé
- **M-1** : Commentaire header "LIMIT 100 cycle would be caught" → corrigé ("terminates unbounded recursion")
- **M-2** : Mock mort `file.findUnique` dans `visitor-tracking.test.ts` supprimé
- **M-3** : Branche `isNetworkError` redondante dans `register-form.tsx` supprimée (même toast que `else`)
- **M-5 (pre-existing)** : TOCTOU sur invite token single-use → tracké en **B-26** dans `BUGS.md`
- **Tests** : 1086 server (73 fichiers) + 274 web — tous passent. Type-check OK.
- **Commit** : `fix(server): review fixes — TS7022, trackShareDownload test, dead mock, B-26 tracked`

**CI lockfile fix**

- Root cause : lors du T-3 (session 18/19), `pnpm update @aws-sdk` a modifié les specifiers dans `apps/server/package.json` et `apps/web/package.json`, mais l'orchestrateur a **reseté ces fichiers** au lieu de les commiter avec le reste → lockfile avait `^3.1057.0` / `^4.13.0`, les `package.json` disaient `^3.817.0` / `^4.3.1` → `ERR_PNPM_OUTDATED_LOCKFILE` en CI depuis 6 runs
- Fix : `pnpm install` pour réaligner les specifiers lockfile sur les `package.json`. Versions résolues inchangées.
- 6 PRs Devin (tentatives de fix stale) fermées, 8 branches remote supprimées
- **Commit** : `fix(deps): align lockfile specifiers with package.json (fixes CI frozen-lockfile)`
- **CI verte** : 2 runs consécutifs ✅

**CLAUDE.md rule 1b**

- Ajout de la règle 1b : "NEVER discard uncommitted changes without understanding them" — suite au bug ci-dessus où l'orchestrateur a effacé des changements légitimes non-commités d'un agent worker
- **Commit** : `docs: add rule 1b — never discard uncommitted changes without understanding them`

---

## 2026-05-31 (session 19 continued)

**Technical Debt — TD-37, TD-35, TD-29**

- **TD-37 — Structured error codes for register-with-invite** : Remplacement du string matching fragile (`includes("already been used")` etc.) par des `ErrorCodes` structurés. 4 nouveaux codes (`INVITE_TOKEN_USED`, `INVITE_TOKEN_EXPIRED`, `USERNAME_EXISTS`, `EMAIL_EXISTS`) ajoutés dans `@ouitransfer/shared/error-codes`. Service `invite/service.ts` utilise `AppError(409/410, ..., code)`. Frontend `register-form.tsx` utilise `parseApiError()` + comparaison de codes. Route schema mise à jour (404/409/410). 6 tests integration ajoutés. Total: 1071 tests serveur (71 fichiers).
- **TD-35 — checkFileAccess + trackShareDownload gèrent les fichiers en sous-dossiers** : Bug fonctionnel — les fichiers dans des dossiers partagés étaient inaccessibles en téléchargement individuel (401). Root-cause fix: helper `getAncestorFolderIds()` (CTE récursive ascendante), utilisé par `checkFileAccess` et `trackShareDownload`. Gère toute profondeur de nesting. 7 tests integration ajoutés. Total: 1078 tests serveur (72 fichiers).
- **TD-29 — Marqué comme résolu** : Le guard BOM existait déjà dans `locale-keys.test.ts` (lignes 61-74), exécuté en CI via `turbo test`. Aucun travail supplémentaire.
- **3 commits** sur `main`

---

## 2026-05-31 (session 19)

**Security Remediation — PR #2 Aikido CVEs**

- Exécution du plan `features/plans/security-pr2-remediation.md` (écrit en session 18)
- **T-1 — `@fastify/cors` 10→11** : bump `^10.0.2`→`^11.0.0` + `methods` explicites (`GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS`) dans `app.ts`. Commit: `fix(server): bump @fastify/cors 10→11 + add explicit methods`
- **T-5 — `axios`** : bump `^1.15.2`→`^1.16.1` (AIKIDO-2026-10823 Proxy Cleartext Leak, AIKIDO-2026-10822 Prototype Pollution). Commit: `fix(web): bump axios ^1.15.2→^1.16.1`
- **T-2+T-3+T-4 groupés** : `pnpm update next-intl` (GHSA-4c35-wcg5-mm9h), `pnpm update @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` (→ fast-xml-parser 5.7.3), pnpm overrides `fast-xml-parser >=5.7.2` + `zod@^4.0.0 → 4.4.3`. Commit: `fix(deps): security lockfile updates — next-intl, AWS SDK, zod v4 override`
- **Vérification complète** : 1065 tests serveur + 274 tests web — tous passent. Type-check serveur + web OK. Build complet (4 packages) OK.
- **SECURITY.md** : S-5 et S-6 marqués ✅ Fixé. Commit: `docs: update SECURITY.md — mark S-5, S-6 as fixed`
- **PR #2** : fermée avec commentaire (CVEs couverts manuellement, 1339 tests vérifiés)
- **Poussé sur `main`** : 4 commits (`466028c`..`47a6334`)

---

## 2026-05-31 (session 18)

**CI Playwright hang fix + PR #2 security analysis + Docker server crash + housekeeping**

- **CI Playwright hang (root cause + fix)**:
  - Hang root cause: Node.js 24.16+ régression `duplexPair` dans `extract-zip`/`yauzl` — extraction ZIP chromium se suspend silencieusement
  - Fix: `@playwright/test` bumped `^1.59.1` → `^1.60.0` (contient `yauzl` patché) — tag v0.8.3
  - Autres améliorations préalables (v0.8.2): `--only-shell` flag, actions @v5/@v6, exclusion firefox/webkit en CI
  - `playwright.config.ts`: Firefox et WebKit exclus en CI via spread conditionnel
  - `ci.yml` + `e2e.yml`: `actions/checkout@v5`, `pnpm/action-setup@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v5`

- **PR #2 — Aikido Security analysis**:
  - `@fastify/cors` 10→11 (CRITICAL): default methods réduits — 41 routes PUT/PATCH/DELETE bloquées. Fix: ajouter `methods: [...]` explicite dans `app.ts`. Un seul fichier, une ligne.
  - `zod` v4.3.6→v4.4.0: impact nul — seul `fumadocs-mdx` utilise zod v4, notre code reste sur v3
  - `next-intl` 4.9.1→4.9.2: impact nul — CVE nécessite `experimental.messages.precompile` non utilisé
  - `fast-xml-parser` 5.5.8→5.7.2: impact très faible — dep transitive AWS SDK, ne traite que les réponses S3
  - Plan écrit dans `features/plans/security-pr2-remediation.md` (T-1 à T-6)

- **Docker CI server crash (root cause + fix)** — tag v0.8.5:
  - Root cause: `tsc` ne copie pas les fichiers non-TS → `dist/modules/email/i18n/messages/{en,fr}.json` absents en Docker → `validateI18nKeys` throw → server crash-loop
  - Fix 1: build script étendu avec `cpSync` pour copier les JSON après `tsc`
  - Fix 2: `initEmailQueueOnBoot` passe de `throw err` à `return` (graceful degradation)
  - Fix test: `rejects.toThrow` → `resolves.not.toThrow`
  - Précédent (v0.8.4): `docker-compose.ci.yml` override `depends_on` → `service_started` + step "Dump Docker logs on failure" ajouté dans `e2e.yml`

- **Infra / housekeeping**:
  - `just docker-start-published`: nouvelle recipe pour tester avec les images GHCR (sans build local)
  - `proxy.ts`: suppression de la condition `NODE_ENV === "development" || process.env.API_BASE_URL` (toujours true, no-op)
  - TD-42/43/44 ajoutés (System Status SMTP, descriptions notifications, libellé jours confus)

- **Tags**: v0.8.2 (Playwright fixes), v0.8.3 (bump 1.60.0), v0.8.4 (Docker CI), v0.8.5 (i18n JSON copy)
- **CI**: v0.8.5 all green

---

## 2026-05-31 (session 17)

**TD-34 + TD-39 Remediation — Token Hashing + notifyOnUpload**

- **Backlog consolidation**: Archived BUGS.md, consolidated deferred-work-audit findings into TECHNICAL-DEBT.md (TD-37..TD-40), marked TD-16/TD-21 SUPERSEDED by TD-36.
- **TD-39 — Password reset token hashing (3 tasks)**:
  - T1: `hashToken` utility (`utils/token-hash.ts`) + 4 unit tests
  - T2: Auth service — `randomBytes(128)→randomBytes(32)`, hash before store + lookup
  - T3: LDAP sync service — hash before store, removed plaintext tech debt comment
- **TD-34 — notifyOnUpload per-reverse-share (7 tasks)**:
  - T4: Prisma `notifyOnUpload Boolean @default(false)` on ReverseShare + DTOs + service
  - T5: TDD — `resolveFrequency` Step 3b for `reverse_share_uploaded` + 6 tests
  - T6: Frontend types + create modal Switch toggle
  - T7: Details modal Switch toggle (widened `handleUpdateField` for booleans)
  - T8: i18n keys across all 23 locales
  - T9: SQLite dev DB recreated
  - T10: Verification — 1065 tests pass, both type-checks clean
- **Design fix**: Changed `reverse_share_uploaded` catalog default from `"immediate"` to `"disabled"` so the toggle means "enable/disable notifications" (not "bypass cooldown"). `overridden: false` preserves the 300s cooldown.
- **Review** (full range `53e8668..c015c9a`): 0C, 1I, 4M — all fixed:
  - I-1: Added token-hashing assertions in auth + LDAP tests
  - M-2: Fixed stale `as any` biome-ignore comment in reverse-share service
  - M-4: Aligned details modal notify toggle styling to match create modal
  - Removed TD-39 ticket-reference comments from test files
- **TD-41 added**: Optional per-reverse-share cooldown bypass toggle (Very Low, future)
- **Tests**: Server 1065/1065, Web type-check clean
- **Commits**: 12 commits (`dfc59fc`..`c015c9a` + review fixes + docs)

---

## 2026-05-31 (session 16)

**8.2 Email Notifications — TODO cleanup + Review Passes 6-7**

- **TODO-2026-05-30.md cleanup**: Triaged 8 items + B-26 from previous session's deferred work.
  - B-26 (updateShare clears expiration): Fixed — conditional spread in `share/service.ts`
  - Item 1 (visitor identity in download notifications): Fixed — extracted `parseVisitorCookie` to `share/visitor-cookie.ts`, wired into `trackShareDownload`
  - Item 2 (getShare by ID visitor cookie parsing): Fixed — alias lookup + cookie parse in GET/POST share routes
  - Items 3, 5, 6, 7: Tracked as TD-31 through TD-34 in TECHNICAL-DEBT.md
  - Item 4 (admin_user_registered includes acting admin): Accepted as design decision
  - Item 8 (date formatting): Already fixed (`Intl.DateTimeFormat` in `email/service.ts`)
- **Deferred work scan**: Created `scripts/scan-deferred-work.ps1` (ripgrep-based, 11 pattern categories). Installed ripgrep via winget. Scan found 50 raw matches → 21 meaningful items. Audit report written to `features/reviews/deferred-work-audit-2026-05-30.md`.

- **Pass 6 review** (3 agents — server-core, server-integration, frontend):
  - Server Core: 0C/3I/4M — SC-I-1 dates raw in email body, SC-I-2 notifyOnDownload throttled by cooldown, SC-I-3 visit/notification ordering
  - Server Integration: 0C/3I/4M (SI-I-1 dup of SC-I-2) — SI-I-2 reverse_share_uploaded skips deactivated, SI-I-3 admin_user_registered missing for OIDC/invite
  - Frontend: 0C/2I/3M — FE-I-1 activity filter client-side, FE-I-2 activity not gated by isOwner
  - All findings fixed in 4 batches:
    - Batch 2a: `formatDataForRendering` for email bodies + cooldown bypass for notifyOnDownload override
    - Batch 2b: Visit-before-notify ordering, isActive guard, admin_user_registered coverage (OIDC + invite)
    - Batch 3: Server-side identity filter (`identified` query param), isOwner gate
    - Batch 4a: Server minors (dead config, "Someone" sentinel, notifyShareCreator helper, stale comment)
    - Batch 4b: Frontend minors (disabled Select during save, beforeunload returnValue, frequency fallback)
    - SC-M-1: i18n placeholder consistency test (196 tests, 2 locales × 22 types)
  - TD-35 added (folder-nested files access gap)
  - All 19 findings checked off

- **Pass 7 review** (3 agents — server-core, server-integration, frontend):
  - Server Core: 0C/0I/5M — send() no-throw, appUrl read twice, hardcoded fallback, loose Zod, hand-rolled JWT
  - Server Integration: 0C/0I/2M — cooldown drop awareness (both documented design decisions)
  - Frontend: 0C/0I/3M — write-side frequency type, layout translator, load more label
  - **Stop criterion met**: 0 Critical + 0 Important across all scopes
  - 6 minors fixed (send() no-throw contract, appUrl read-once-pass-down, DEFAULT_APP_NAME constant, Zod enum tightening, write-side frequency union type, layout translator scope)
  - 4 no-action (acknowledged TD, documented design decisions, cosmetic)
  - All 10 findings checked off

- **Integration test fix**: 8 "pre-existing" failures in `share-audit.integration.test.ts` and `share-error-codes.integration.test.ts` were actually caused by our Item 2 fix (missing `shareAlias` mock). Fixed — added `shareAlias: { findUnique: vi.fn().mockResolvedValue(null) }` to both test files.

- **Final test counts**: Server 1055/1055 (zero failures), Web 274/274. Both type-checks clean.
- **Commits**: 10 commits (B-26 fix, Items 1+2 fix, scan script, audit report, TODO status, pass 6 reviews, 4 remediation batches, pass 7 reviews, test fix, pass 7 remediation, check-offs)

---

## 2026-05-30 (session 15)

**8.2 Email Notifications — Review Passes 3-5**

- Third through fifth review passes with escalating rigor
- Details in pass 3-5 review files (`features/reviews/8.2-review-{3,4,5}-*.md`)
- Multiple batches of fixes per pass
- Deferred items captured in `features/TODO-2026-05-30.md` for next session

---

## 2026-05-29 (session 14)

**8.2 Email Notifications — Review Fixes (2 rounds)**

- **First review round**: 3 reviewer agents (server-core, server-integration, frontend) produced 73 findings (11C, 28I, 34M). All fixed in 5 batches:
  - Batch 1: Schema + scheduler (split notification flags, reentrant guard, stuck job recovery)
  - Batch 2: Email i18n + templates + transport (XSS protection, List-Unsubscribe RFC 8058, connection pooling, footer i18n)
  - Batch 3: Share access security (tracking token leak, cross-share bypass, cookie re-validation, download dedup)
  - Batch 4: Frontend critical + important (password+identification flow, cache key, SharePrivacySection extraction, types, validation, error states)
  - Batch 5: All remaining minors (server + frontend, 23 locale files updated)
- **Second review round**: Fresh re-reviews (no prior findings shared). 71 new findings (4C, 28I, 39M). All fixed in 5 batches:
  - Batch 1: Criticals (HTML newline rendering, appName default params, unsubscribe flow end-to-end fix with @fastify/formbody, owner-only metadata leak)
  - Batch 2: Server security + queue (wake signal, cooldown, SMTP header injection, unsubscribe token module, lock recovery, subject sanitization, shareLink server-side, email normalization, identify validation)
  - Batch 3: Server remaining important (cooldown docs, XSS tests, scheduler comment, DB index, locale cache, recipient locale, hoisted lookup, race-safe backfill)
  - Batch 4: Frontend important (type drift, loader states, metadata error handling, password validation, rate limit UX, activity error state, modal cleanup, IPv6 truncation, i18n)
  - Batch 5: All remaining minors (server docs/comments/types + frontend UX polish, 23 locale files)
- **Post-review fix**: Added missing i18n keys for 5 email settings fields (appUrl, emailDigestHour, emailJobRetentionDays, emailQueueIntervalSeconds, emailQueueMaxRetries) across all 23 locales.
- **Final validation**: Server 786 tests pass, web 255 tests pass, both type-checks clean.
- **Review files**: `features/reviews/8.2-review-*.md` (round 1) + `features/reviews/8.2-re-review-*.md` (round 2)

---

## 2026-05-28 (session 13)

**8.2 Email Notifications — Full Implementation**

- **Scope**: Complete email notification system — 22 notification types, SQLite-backed queue, type-safe templates, visitor tracking, user preferences, admin dashboard.
- **Brainstorming**: Designed template engine (homemade TS), queue (SQLite EmailJob table with retry), i18n (server-side JSON), preferences (per-type + per-share overrides), visitor tracking (3 mechanisms: tracking tokens, identification form, IP/UA), unsubscribe (two-step JWT). 5.2 decisions captured in spec.
- **Spec**: Rewrote `features/specs/8.2-email-notifications.md` (~1020 lines). Two review rounds (first: 4C/8I/9M, second: 5C/9I/10M). All findings resolved. Key decisions: httpOnly cookie for visitor ID, HMAC-derived unsubscribe key, notification cooldown, recipient upsert sync.
- **Plan**: 12 sequential batches in `features/plans/8.2-email-notifications/` (index + 12 batch files, ~2390 lines total). Reviewed (7C/15I/8M), all fixes applied.
- **Implementation** (12 batches, all done):
  - **Batch 1**: Prisma schema (EmailJob, NotificationPreference, ShareVisit + extensions to Share, ShareRecipient, User) + config seed
  - **Batch 2**: SmtpTransport (pooled nodemailer, config-hash-aware reconnection)
  - **Batch 3**: i18n loader (fs-cached JSON, `{key}` interpolation, fallback chain) + base HTML email layout (indigo, Outlook-safe table layout)
  - **Batch 4**: Notification catalog (22 types, Zod schemas, type-safe `EmailPayloads`) + EmailService orchestrator (preference cascade, cooldown, unsubscribe JWT)
  - **Batch 5**: Email queue scheduler (chained setTimeout, exponential backoff, stuck job recovery, wake-up EventEmitter)
  - **Batch 6**: 22 template functions (en + fr i18n keys, `asRender<T>()` for TypeScript contravariance)
  - **Batch 7**: Migration (5 callers migrated, old EmailService deleted), recipient upsert (transactional, preserves tokens/stats), 5 MVP bug fixes
  - **Batch 8**: Visitor tracking (ShareVisit on access/download), download tracking (shareId in presigned URL endpoints), recipient stats
  - **Batch 9**: Visitor identification endpoint (httpOnly cookie `sv_{alias}`), notification scheduler (expiring/expired/inactive shares + reverse shares)
  - **Batch 10**: Notification preferences CRUD + two-step unsubscribe (GET=confirmation, POST=action)
  - **Batch 11**: Admin endpoints (queue stats, test email)
  - **Batch 12A-E**: Frontend — API clients + types, notification preferences page, share form extensions (privacy/notifications section), visitor identification form, share activity section, RecipientSelector enhancements (notify bug fix, notified indicator), admin email section, i18n (23 locales)
- **Test counts**: 64 server test files (752 tests), all passing. Web type-check clean.
- **Commits**: ~20 commits on feature branch (schema → transport → i18n → catalog → queue → templates → migration → tracking → identification → preferences → admin → frontend×5)

---

## 2026-05-27 (session 12)

**Docs overhaul & i18n completion**

- **Docs fixes**: Hydration error in `V1BetaModal.tsx` (`DialogDescription asChild`). Rewrote `quick-start.mdx` as 5-step happy path. Added `## URL Configuration` to `reverse-proxy-configuration.mdx`. Replaced old Palmr `architecture.png` with client-side Mermaid diagram (`remarkMdxMermaid` + `mermaid.tsx` component). Rewrote `github-architecture.mdx` as Repository Structure (repo layout, module structure, tooling, pre-commit hooks, commit format, CI/CD). Created `Pipeline` JSX component for CI/CD diagrams. Fixed all `burger-cie` → `slvnlrt` GitHub URLs, Next.js 15 → 16. Frosted glass banner + click-to-open modal wiring (`BannerModalTrigger`). Fixed `translation-management.mdx` (prune command, file structure, completeness caveats).
- **i18n**: Diagnosed ~140–155 untranslated strings per locale (`audit.*`, `ldap.*`, `quickShare.*`, `backgroundImages.*`, etc.). Translated all 21 locales via parallel worker-fast agents (4 passes). Improved `check_translations.py` with `SUSPECTED EN` column, case-insensitive exclusions, length-threshold for technical terms, cognate note in output.
- **Result**: 19/21 locales at ✅ 0 suspects; 3 false positives (de-DE, fr-FR, sv-SE: "Position {position}" — cognate).
- Commits: `feat(web): translate 21 locales`, `feat(web): improve check`, `fix(web): refine exclusions`, `docs: overhaul docs site`, `docs(monorepo): TECHNICAL-DEBT.md`, `feat(web): complete translations for all 21 locales`

---

## 2026-05-26 (session 11)

**Traefik Proxy Migration & Route Alignment**

- **Goal**: Migrate proxy layer from custom Next.js proxy to direct infrastructure routing (Traefik in production, Next.js native rewrites in dev).
- **Backend Refactoring**:
  - Created `apps/server/src/utils/redirect-validation.ts` for secure SSO redirect validation (Fix S-2).
  - Configured Zod environment validation for `OAUTH_ALLOWED_REDIRECT_HOSTS`.
  - Fixed Host Header Injection (Fix S-1) in `buildRequestContext` (`apps/server/src/modules/auth-providers/routes.ts`) by reading `request.protocol` and `request.hostname` natively instead of raw headers.
- **Frontend Refactoring**:
  - Aligned all API client endpoints (`apps/web/src/http/endpoints/`) directly to Fastify REST endpoints, bypassing legacy proxy mapping.
  - Deleted ~960 lines of obsolete proxy code, utility libraries, schemas, and test specs.
- **Docker Standalone Resolution**:
  - Migrated dev-mode rewrite logic to Next.js Edge Middleware (`apps/web/src/proxy.ts`) using dynamic `NextResponse.rewrite()`. This resolves the static serialization limitation of build-time configurations (`next.config.ts`) when deploying standalone containers.
  - Configured local dev CORS whitelisting (`CORS_ORIGINS`) inside `apps/server/.env.development`.
- **Verification**: 499/499 server tests passing, Next.js build and type check completed successfully.

---

## 2026-05-26

**CI Fix — prisma-v7 integration tests failed in CI (500 vs 409/404)**

- **Bug**: `prisma-v7.integration.test.ts` returned 500 instead of 409 (P2002) / 404 (P2025) in CI
- **Root cause**: Test uses the real database (only file that does) — in CI no `prisma migrate deploy` runs, so the DB is empty → Prisma throws unrecognized errors → falls to 500 catch-all in `globalErrorHandler`
- **Fix**: Added `prisma db push --accept-data-loss` in a file-level `beforeAll` at `apps/server/src/__tests__/prisma-v7.integration.test.ts` to ensure schema exists
- **Verification**: All 490 server tests pass, type-check + lint clean
- Commit: (pending)

---

## 2026-05-24 (session 10)

**Documentation Update — Full audit and update of apps/docs**

- **Task 1 — Activity Log page**: Created `activity-log.mdx` (new), updated `meta.json` (moved to `---Configuration---`). Review fixes: removed nonexistent UI User filter, changed "7-day floor enforced" to recommended minimum, corrected action category list (10 categories), added UTC day boundary note, count ~77 actions, added TECHNICAL-DEBT item for server-side validation
- **Task 2 — API reference**: Full rewrite of `api.mdx` covering ~146 routes across 19 modules. Review fixes: corrected error response shape (`{ error, code, statusCode, timestamp, details? }`), removed fabricated 202 status, fixed 413→400 for quota violations, added CSRF-on-public-POST callout, fixed refresh response (cookies only, no body), added rate-limit shape divergence note, fixed account lockout (time-based not admin-reset), added 24h embed token expiry
- **Task 3 — Feature pages**: `quotas.mdx` updated (removed nonexistent "persistent banner", corrected system status bar description). `ldap-configuration.mdx`: fixed two OUITRANSFER formatting typos. `groups.mdx` and `quick-share.mdx` were accurate — no changes needed
- **Task 4 — OIDC pages**: Added Pocket ID to official providers list in `index.mdx` (was in cards/meta but missing from text)
- **Task 5 — Configuration pages**: Fixed `uid-gid-configuration.mdx` (UID/GID default is 1001 not 1000). Fixed `reverse-proxy-configuration.mdx` (CSP var name: `CSP_STORAGE_ORIGINS` not `CSP_CONNECT_SOURCES`). Other config pages accurate
- **Task 6 — Getting started pages**: Fixed `quick-start.mdx` (UID/GID defaults 1001). Fixed `manual-installation.mdx` (git URL typo, DB filename `ouitransfer.db`)
- **Task 7 — Architecture/remaining pages**: All accurate — `architecture.mdx`, `github-architecture.mdx`, `available-languages.mdx` (23 languages confirmed), `translation-management.mdx`, `index.mdx` verified correct

**Commits**: `a22a84e`, `95ad9c7`, `c6482d1`, `651cc57`, `ba359fe`, `15d9ae9`, `3a76030`, `1bc9fa4`, `60e0f69`

---

## 2026-05-24 (session 9)

**8.1 — Audit Trail / Activity Log — Review Fixes**

- **Spec compliance review** (`features/reviews/8.1-auditing-spec.md`): 1 Critical, 10 Important, 9 Minor — all fixed
- **Code quality review** (`features/reviews/8.1-auditing-quality.md`): 4 Critical, 12 Important, 13 Minor — all fixed
- **Critical fixes**: Date filter (ISO datetime), invite token ID (not secret), real batch deletion (raw SQL LIMIT), retention scheduler boot run, maxViews atomic enforcement
- **Event metadata enrichments**: Recipient emails, changed fields, hasPassword/expiration, consistent targetId, ErrorCodes constants, first-user attribution, background image fileName
- **Export quality**: RFC 4180 CSV quoting, UTF-8 BOM, compound cursor pagination, streaming error handling, backpressure, truncation warning
- **Frontend**: Action category coloring, user category in filters, responsive columns, quota metadata alignment, hardcoded English → i18n, Intl.ListFormat for arrays
- **Tests**: maxViews concurrency test (10 parallel, 5 succeed), retention scheduler tests (13), racy setTimeout → setImmediate, share access double-fetch eliminated
- **Additional fixes (post-review)**: User name resolution in audit table (userId → firstName+lastName), `setInterval` → chained `setTimeout` with guard for login-attempts and refresh-token cleanups in `server.ts` (pre-existing but part of 8.1 review), SQL column name confirmed correct
- **Test totals**: 49 server test files (490 tests) + 26 web test files (321 tests) + 2 shared (14 tests) = **825 total**

---

## 2026-05-23 (session 8)

**8.1 — Audit Trail / Activity Log**

- **Schema**: Added `targetType`/`targetId` to `AuditLog`, moved `maxViews` from `ShareSecurity` to `Share`, added `auditRetentionDays` config (365 days default)
- **Audit service**: Expanded from 12 to 67 actions, 14 target types, metadata denylist, userAgent cap (512), `exportAuditLogs` async generator (CSV/JSON, 100k ceiling), `deleteOldAuditLogs` batch loop
- **Audit routes**: Enriched `GET /admin/audit-logs` with `targetType`/`targetId`/`dateFrom`/`dateTo`/`search` filters; new `GET /admin/audit-logs/export` streaming route
- **Retention scheduler**: Chained `setTimeout` pattern (matches LDAP), WAL mode check on boot, registered in `server.ts`
- **maxViews migration**: Updated `share/service.ts`, `share/dto.ts`, `share/repository.ts`, `file/routes.ts` — all use `share.maxViews` directly
- **Audit events**: Added ~55 new `logAuditEvent` calls across all 21 modules (auth, 2FA, user, invite, quota, share, file, folder, reverse-share, group, LDAP, app, background-image, auth-providers)
- **Integration tests**: Enhanced `audit-logs.integration.test.ts` (6 new tests), new `share-audit.integration.test.ts` (3 tests)
- **Frontend**: API client (`endpoints/audit/`), proxy route, query keys, admin audit page (table+filters+export+metadata display), Activity Log nav item, share type maxViews migration
- **i18n**: Added `audit` section (77 actions, 14 target types, 37 metadata labels) + `navbar.activityLog` + `settings.fields.auditRetentionDays` to all 23 locale files
- **Frontend tests**: 26 tests for AuditLogTable, AuditLogExport, AuditMetadataDisplay
- **Test totals**: 48 server test files (476 tests) + 26 web test files (319 tests) + 2 shared (14 tests) = **809 total**

---

## 2026-05-23 (session 7)

**B-25 — Quota precision bug + system status bar polish**

- **B-25** : `diskUsedGB` retournait `0` malgré des fichiers uploadés — `toFixed(2)` en GB écrasait tout < ~5 MB
  - `storage/service.ts` : `toFixed(2)` → `toFixed(6)` sur les 6 valeurs GB (admin + user)
  - `quota/service.ts` : `Math.max(1, Math.round(raw))` quand `used > 0n` — jamais 0% avec usage non-nul
- **SystemStatusBar polish** : `cursor-pointer` ajouté sur le bouton collapse (chevron-up)

---

## 2026-05-23 (session 6)

**10.1 — System Status Bar**

- **10.1 System Status Bar** — Implemented collapsible glassmorphism status bar below navbar
  - Moved `formatStorageSize` to `utils/format-storage-size.ts` and `useSystemStatus` to `hooks/use-system-status.ts` (global locations)
  - Created `DashboardMetricsContext` for dashboard-specific metrics (`fileCount`, `activeShareCount`)
  - Built `SystemStatusBar` component with collapsed tab and expanded panel (user + admin views)
  - Integrated into both `FileManagerLayout` and `PageLayout`
  - Deleted old `SystemStatus` card component (608 lines) and `dashboard/utils/` directory
  - Added 45 unit tests (291 total web tests)
  - Added i18n keys to all 23 locale files
  - Fixed test type errors: `UseSystemStatusResult` annotation on mock, `CheckHealth200`/`AdminStats200` shape alignment

---

## 2026-05-22 (session 5)

**B-24 — Folder deletion share check**

- **B-24** : `DELETE /folders/:id` retourne 409 avec `{ error: "FOLDER_IN_SHARES", shareCount: N }` si le dossier (ou ses fichiers récursivement) appartient à des partages et que `force` n'est pas activé
  - Backend : `getDescendantFolderIds()` helper BFS récursif, `querystring: { force: z.coerce.boolean() }`, schéma 409 + 403 ajoutés, Pino logging quand force-delete
  - Frontend single-delete : optimistic update déplacé APRÈS la confirmation serveur ; dialog de warning secondaire avec nom, shareCount, bouton "Delete anyway"
  - Frontend bulk-delete : `Promise.allSettled` pour folders aussi (comme files), collecte des 409, dialog de batch pour force-delete des dossiers en partage
  - Proxy routes : `{ query: true }` ajouté pour `DELETE folders/:id`
  - i18n : 5 nouvelles clés `folderActions.*` (inSharesWarningTitle, inSharesWarningBody, bulkInSharesWarningTitle, bulkInSharesWarningBody, deleteAnyway) dans 23 locales
  - Tests : 6 integration tests server (47 fichiers / 454 tests) + 238 tests web (22 fichiers) — tous passants
  - Type-check server + web : OK

---

## 2026-05-22 (session 4)

**B-21, B-22, B-23 — Bug fixes**

- **B-23** : `appName` par défaut dans `seed.js` corrigé (`"OUITRANSFER. "` → `"Ouitransfer"`)
- **B-22** : `{t("footer.poweredBy")}` supprimé des 2 composants footer (`default-footer.tsx`, `transparent-footer.tsx`) + clé `poweredBy` supprimée des 23 locales
- **Fix TypeScript pré-existant** : `onAfterUpload` dans `file-upload-section.tsx` retourne maintenant l'ID du fichier enregistré (`response.data.file.id`) — type-check web était cassé
- **B-21** : `DELETE /files/:id` retourne 409 avec `{ error: "FILE_IN_SHARES", shareCount: N }` si le fichier appartient à des partages et que `force` n'est pas activé
  - Backend : `force` query param (coerce boolean), include shares in findUnique, logging Pino quand force-delete
  - Frontend single-delete : optimistic update déplacé APRÈS la confirmation serveur (correction UX) ; dialog de warning secondaire avec filename, shareCount, bouton "Supprimer quand même"
  - Frontend bulk-delete : `Promise.allSettled` + collecte des 409, dialog de batch pour les fichiers en partage, `force=true` uniquement sur confirmation utilisateur
  - i18n : 3 nouvelles clés `fileActions.*` (single + bulk warnings + deleteAnyway) dans 23 locales (en-US + fr-FR natifs, 21 autres en fallback EN)
  - Tests : 6 integration tests server (no-shares→200, 1-share-no-force→409, force→200, 403, 404, multiple-shares) + 4 unit tests web (hook use-file-crud)
  - **B-24 identifié** : même absence de vérification pour `DELETE /folders/:id` — tracké dans BUGS.md
- Tests : 448 server (46 fichiers) + 238 web (22 fichiers) — tous passants. Type-check web : OK.
- Commits : `1783e85`, `2c702d0`, `14baed8`, `7638f50`, `07a98c4`, `095f2c2`

---

## 2026-05-22 (session 3)

**9.1 — Quickshare**

Implémentation complète du composant QuickShare sur le dashboard :

- **i18n** : 35 clés `quickShare.*` ajoutées à `en-US.json` et `fr-FR.json` (traductions natives), puis en fallback anglais aux 21 autres locales
- **Hooks upload** : `registeredFileId` ajouté à `FileUploadState`, `onAfterUpload` retourne maintenant l'ID du fichier enregistré
- **useQuickShare** : hook orchestrateur à 3 états (dropzone → upload+options → confirmation), auto-naming, création de share automatique quand uploads terminés, auto-reset, validation email — 9 tests
- **UI composants** : `QuickShareDropzone` (drag/drop + click), `QuickShareUpload` (liste fichiers, options nom/expiration/mot de passe/destinataires, bouton partager), `QuickShareConfirmation` (QR code, lien+copie, téléchargement QR)
- **Intégration** : composant `QuickShare` orchestrateur, `GlobalDropZone` retiré du dashboard (reste sur la page fichiers), `smtpEnabled` passé comme prop
- **Fix pré-existant** : `onAfterUpload` return type dans `file-upload-section.tsx` (reverse-share)
- **Review finale** : 1 Critical + 6 Important + 10 Minor findings — tous corrigés
  - C1 : multi-batch upload (second drop ne déclenchait pas l'upload) → useEffect réactif
  - I1 : accessibilité clavier sur la dropzone (role=button, tabIndex, onKeyDown)
  - I2 : aria-label manquant sur le bouton copier
  - I3 : pendingShare non réinitialisé sur certains early returns de performShare
  - I4 : boutons remove/retry non désactivés pendant la soumission
  - I5 : share orphelin si createShareAlias échoue → retry loop + cleanup
  - I6 : setTimeout sans cleanup (résolu par C1)
  - M1-M8 : clé i18n morte, type `string|void`, guards x-move-item, aria-hidden, dropToAdd, prop inutilisée, shareAlias inutilisé
- Tests : 690 (442 serveur + 234 web + 14 shared) — tous passent. Type-check web + serveur OK.
- Commits : 9 commits (`7377af7` through `25b8dd6`)
- Tech debt ajouté : TD-21 (quickShare i18n fallback dans 21 locales)

---

## 2026-05-22 (session 2)

**TD-11 — Next.js 15 → 16 upgrade**

Migration complète de Next.js 15.5.18 vers 16.2.6 :

- **Versions** : `next` 15.5.18 → 16.2.6, `react`/`react-dom` 19.1 → 19.2.5, `@next/bundle-analyzer` 15 → 16.2.6
- **Fumadocs** : `fumadocs-core`/`fumadocs-ui` 15.2.7 → 16.4.3, `fumadocs-mdx` 11.6.10 → 13.0.8
- **next-intl** : auto-updated 4.3.1 → 4.9.1
- **Proxy rename** : `middleware.ts` → `proxy.ts`, export `middleware` → `proxy`, test file renamed
- **cookies() fix** : consolidated two-step await to inline `await cookies()` in `i18n/request.ts`
- **Fumadocs API** : `fumadocs-ui/provider` → `fumadocs-ui/provider/next`, `createFromSource` callback → `{ buildIndex }` object, type cast for upstream bug (#3027)
- **serverActions** : promotion out of `experimental` SKIPPED — `NextConfig` type in 16.2.6 still requires it
- **Docs** : all `middleware.ts` references updated in README.md, CONTRIBUTING.md, proxy.ts comments
- **Review fixes** : exact version pinning (was caret), `middleware` → `proxy` rename in test describe/variables
- Tests : 664 (442 serveur + 222 web) — tous passent. Builds web + docs OK.
- Commits : 6 commits (`66e6c17` through `31e7e06`)

---

## 2026-05-22

**Docker CSP fixes + BackgroundLights unification**

- **B-CSP fix (server)** : `background-image/service.ts` — presigned URLs générées avec `s3Client` interne (hostname Docker `storage:9000`) → remplacé par `createPublicS3Client()`. Navigateurs pouvaient pas charger les images de fond.
- **B-CSP fix (infra)** : `CSP_CONNECT_SOURCES` ajouté à `img-src` (en plus de `connect-src`) dans `middleware.ts`. `docker-compose.yaml` : `CSP_CONNECT_SOURCES: ""` sur le service `web`. `docker-compose.ci.yml` : fallback `http://localhost:9000` pour `just docker-start`. `.env.example` et `quick-start.mdx` documentés.
- **B-20 résolu** : `BackgroundLights` unifié en Server Component (suppression `motion.div`). `StaticBackgroundLights` supprimé. 4 pages mises à jour (login, register-with-invite, reset-password, forgot-password).
- **BUGS.md archivé** : B-1 à B-20 tous résolus → `features/archive/BUGS-2026-05.md`.
- Tests : 678 (442 serveur + 222 web + 14 shared) — tous passent.
- Commits : 2 commits (fix CSP/infra, refactor BackgroundLights)

---

## 2026-05-21 (session 2)

**TD-6 — Prisma 6 → 7 upgrade**

Migration complète de Prisma 6.11.0 vers 7.8.0 :

- **Schema** : `prisma-client-js` → `prisma-client`, output vers `src/generated/prisma/`
- **Driver adapter** : `@prisma/adapter-better-sqlite3` + bindings natifs `better-sqlite3`
- **Imports** : 9 fichiers migrés de `@prisma/client` vers les chemins du client généré
- **Config** : `prisma.config.ts` étendu (datasource.url, migrations, seed via tsx)
- **Scripts** : `--skip-generate` supprimé du Justfile et server-start.sh
- **Seed** : adapter pattern + exécution via `tsx` (Prisma 7 génère .ts uniquement)
- **Docker** : build tools Alpine pour bindings natifs, `npm rebuild better-sqlite3`,
  `check-missing.js` réécrit en ESM avec adapter, `prisma`+`tsx` en dependencies
- **Tests** : 678 (442 serveur + 222 web + 14 shared) — tous passent
- Review : spec compliance + code quality, 1 Critical + 7 Important + 13 Minor — **tous fixés**
- Factory `prisma-factory.ts` pour dédupliquer l'init adapter (4 sites → 1)
- 3 tests d'intégration Prisma v7 (smoke, P2002→409, P2025→404)
- Spec : `features/specs/td-6-prisma-7-upgrade.md`
- Plan : `features/plans/td-6-prisma-7-migration.md`
- Reviews : `features/reviews/td-6-prisma-7-upgrade.md`, `features/reviews/td-6-prisma-7-quality.md`
- Commits : `925b677` à `1434d80` (15 commits)

---

## 2026-05-21

**TD-14 (Footer configurable) + TD-12 (Background Images)**

Implémentation complète des deux tech debt items en une seule session :

- **TD-14** : Footer configurable via 3 settings admin (`footerEnabled`, `footerText`, `footerUrl`).
  Les 2 composants footer lissent les configs dynamiquement. i18n ajoutée dans 23 locales.
- **TD-12** : Remplacement des 8 JPGs hardcodés par un système complet :
  - Nouveau modèle Prisma `BackgroundImage` avec stockage S3 (WebP full + thumbnail)
  - Module serveur `background-image/` : 6 endpoints (list public, image redirect, upload/rename/reorder/delete admin)
  - Image manager dans les settings admin (upload, preview thumbnails, suppression)
  - Image picker dans le formulaire de création ET le modal de détails des reverse shares
  - Layout WeTransfer dynamique : image spécifique, aléatoire parmi la galerie, ou fallback gradient indigo
  - 21 nouveaux tests (9 unit + 12 intégration)
- **Total tests** : 662 (426 server + 222 web + 14 shared)
- Spec : `features/specs/td-14-td-12-footer-backgrounds.md`
- Plan : `features/plans/td-14-td-12-footer-backgrounds.md`

---

## 2026-05-20 (session 2)

**Audit UI et suivi des bugs/tech debt/features**

Revue manuelle complète de l'application. Résultats :
- Ajout de 11 bugs : B-9 (auth providers 500), B-10 (contamination PT fr-FR + cross-locale),
  B-11 (traduction "terrain"), B-12 (couleur thème défaut vert), B-13 (lien footer),
  B-14 (string hardcodée EN), B-15 (champs RS manquants), B-16 (modales 2FA étroites),
  B-17 (description setting trompeuse), B-18 (Disponibilité → Uptime), B-19 (messages stockage)
- Ajout de 6 tech debt items : TD-10 (routes admin), TD-11 (Next.js 16), TD-12 (images WetTransfer),
  TD-13 (i18n concaténation), TD-14 (footer non configurable), TD-15 (description par défaut)
- Création des specs de 3 nouvelles features : 8.1 Auditing, 8.2 Email Notifications, 8.3 Download Tracking
- Mise à jour de features/README.md (workstream 8.x, current focus)
- Cross-check complet : complété B-8 (note dropdown LDAP futur), B-15 (suppression bouton Edit),
  B-13 (traduction "Propulsé" à changer)

---

## 2026-05-20

**TD-4 — Zod type provider migration** (branch `refactor/td4-zod-type-provider`)

Goal: migrate all Fastify routes from controller classes + bare `FastifyInstance` to
`FastifyPluginAsyncZod` + `.route()` + inline handlers, eliminating ~75 `as` casts.

Implementation (7 batches):
- Batch 0: Extracted `setAuthCookies`, `clearAuthCookies`, `signAndSetCookies`, `getClientInfo`
  into `utils/auth-cookies.ts` (14 tests)
- Batch 1 (TRIVIAL): audit, admin/stats, health, health/status, quota, storage, invite,
  reverse-share/multipart — 8 controllers deleted
- Batch 2 (LOW-A): group, two-factor, s3-storage, file/multipart — 4 controllers deleted;
  3 pre-existing type errors fixed (`as const`, `.nullable()`)
- Batch 3 (LOW-B): share (16 routes), reverse-share (22 routes), ldap (7 routes), app (8 routes)
  — 4 controllers deleted; password threading improved; LDAP config logic preserved
- Batch 4 (MEDIUM): file (7 routes), file/download (2), file/embed (2), folder (6), user (10)
  — 5 controllers deleted; extracted `checkFileAccess()` helper; fixed `updateUserImage` bug
- Batch 5 (HIGH): auth (10 handlers + inline refresh), auth-providers (8 handlers + 6 helpers)
  — 2 controllers deleted; extracted `signAndSetCookies`, `jwtPreValidation` factory
- Batch 6 (Cleanup): zero controllers remain, all 18 route files use `FastifyPluginAsyncZod`
  zero shorthand `.get()/.post()` calls, dead types removed, Biome-clean

Review findings (4 Important + 7 Minor) — all addressed:
- I-1: Register handler now uses `signAndSetCookies` (was inline duplicate)
- I-2: `signAndSetCookies` moved to `utils/auth-cookies.ts`, fixed docstring
- I-3: Local `adminPreValidation` in user/routes replaced with `createAdminPreValidation` factory
- I-4: `isAdmin` added to register route schema, redundant `.parse()` removed
- M-1: `createJwtPreValidation()` factory extracted to `middleware/jwt-prevalidation.ts`
- M-2: Comment added explaining widening cast in auth-providers `updateProvider`
- M-3: Stale `(from *.controller.ts)` comments removed from file/routes.ts
- M-4: README.md updated — controller pattern removed, cookie name fixed, new-feature guide updated
- M-5: Test fixture cookie name fixed (`access_token` → `token`, `signed: false` → `signed: true`)
- M-6: `runHealthChecks()` helper extracted in health/routes.ts
- M-7: `RequestContextService` unified with `Pick<RequestContext, "protocol" | "host">`

**Final state:** 372 tests (38 files), zero type errors, lint clean
Commits: `57c96ff`, `7a25254`, `f2d73ed`, `66215a5`, `3e1aa28`, `ae2e66e`, `1559181`, `0416e89`

New tech debt identified and immediately resolved:
- TD-9: 4 unused exported types in `file/dto.ts` (knip) — deleted inline

---

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

## 2026-05-19 — 5.4 Groups

- Completed 5.4 Groups (spec → plan → implementation → review per task)
  - Schema: new `Group` model (name unique, description, maxFileSizeOverride BigInt?, maxTotalStorageOverride BigInt?, ldapDn String?), User gets `groupId String?` with `onDelete: SetNull`
  - New `modules/group/` (dto, repository, service, controller, routes) — 7 admin-only endpoints (CRUD + member management)
  - Quota resolution: `user override ?? group override ?? (admin ? unlimited : global)` with `sources` tracking
  - User responses enriched with `groupId` + `groupName` across all 9 user routes
  - Frontend API layer: types, 7 endpoints, 7 proxy routes, query keys
  - Groups management page (`/groups-management`): table, form modal (with quota tri-state), detail modal (member management with "already in group" warning), delete modal
  - Navbar: Groups link in admin dropdown
  - User form modal: group assignment Select + quota source badges
  - i18n: 70+ new keys translated in all 23 locales
  - Shared `formatBytes` utility extracted (DRY on 3rd occurrence)
  - Tests: 289 server (18 group unit + 7 quota group + 9 integration) + web type-check clean
  - Two-stage review per task (spec compliance + code quality), all findings resolved
  - 10 commits (d20484d..b3bd82d)
- Next: 5.3 LDAP/AD sync (depends on 5.4) or 5.2 Auto-cleanup (independent)

## 2026-05-19 / 2026-05-20
- Completed 5.3 LDAP / Active Directory Sync:
  - **Brainstorming**: Explored auth provider system, decided on Option B (LDAP as import source, not auth bind), auto invite email + self-service password reset, direct group membership only, skip on conflict, deactivate-never-delete
  - **Spec**: Written to `features/specs/5.3-ldap.md` — schema (LdapConfig, LdapSyncLog, User.ldapDn), 7 admin-only endpoints, sync engine, scheduler, encryption, frontend admin page, i18n
  - **Plan**: 4-part plan (`features/plans/5.3-ldap-part{1-4}-*.md`) — 12 tasks across foundation, core, API, and frontend
  - **Implementation** (12 tasks, subagent-driven):
    - T1: Foundation — ldapts dependency, Prisma schema (LdapConfig/LdapSyncLog/User.ldapDn), ENCRYPTION_SECRET env, 3 error codes
    - T2: AES-256-GCM encryption utility (TDD, 7 tests)
    - T3: Config + Sync Log repositories (TDD, 9 tests)
    - T4: LDAP client wrapper (ldapts, structured filters, case-insensitive attribute lookup)
    - T5: Sync service (TDD, 11 tests) — create/update/deactivate/reactivate/skip, group mapping, welcome email
    - T6: Email (sendLdapWelcomeEmail) + setInterval→setTimeout scheduler
    - T7: DTOs (Zod) + Controller (7 handlers) + Routes (admin-only) + server.ts registration
    - T8: Integration tests (33 tests, all 7 endpoints, auth guards, edge cases)
    - T9: Frontend types, endpoints, proxy routes, query keys
    - T10: Admin LDAP page (/admin/ldap) — config form, group mapping, sync operations, detail modal
    - T11: Navbar link, admin paths fix, settings banner, users table LDAP badge, sync indicator
    - T12: i18n keys (~50 keys across 23 locales)
  - **Review** (2 parallel agents — server + frontend):
    - Server: 27 findings (7C, 10I, 10M) in `features/reviews/5.3-ldap-server.md`
    - Frontend: 18 findings (2C, 7I, 9M) in `features/reviews/5.3-ldap-frontend.md`
  - **Verification**: 31 confirmed, 12 partially confirmed, 2 false
  - **All findings fixed** (4 fix commits):
    - `b6d84e0` fix(server): security — TLS strict, LDAP filter escaping, welcome email wiring, LDAP password reset bypass, atomic user+token, encryption secret validation, batch deactivation, etc.
    - `dfefb49` fix(server): architecture — setTimeout chain, fire-and-forget boot, route schemas, stale log cleanup, test fixes
    - `b2f3083` fix(web): critical — Zod form validation, masked password fix, tlsSkipVerify support
    - `bcbe77b` fix(web): important+minor — breadcrumb header, i18n relative time, sync polling, ARIA, navbar style, modal animation, etc.
  - **Pre-existing bug fixed**: `/groups-management` added to admin paths
  - Tests: 349 server (36 files) + web type-check clean + lint clean
  - 19 commits on `feat/5.3-ldap` branch (be7fc51..bcbe77b)
- Next: 5.2 Auto-cleanup (independent), or merge 5.3 branch

## 2026-05-20 — 5.3 Post-Fix Review Remediation

- Second review of 5.3 LDAP fix commits (`b6d84e0`, `dfefb49`, `b2f3083`, `bcbe77b`)
- Postfix review files cross-checked against full reviews — 9 missing items added
- All 23 findings fixed across 5 parallel agents:

**Server (12 items — 3 Important + 9 Minor):**
- PF-S-I-1: `requestPasswordReset` now allows LDAP users even when `passwordAuthEnabled=false`
- PF-S-I-2: Scheduler race condition fixed — handle comparison guards against stale timers
- PF-S-I-3: `getSyncLogs` route uses `SyncLogsQuerySchema` from dto (was inline with no bounds)
- PF-S-M-1: All error paths tagged with meaningful `phase` strings (connect/search/create-user/etc.)
- PF-S-M-2: Boot stale-log cleanup marks ALL `running` logs as error (removed 5-min cutoff)
- PF-S-M-3: Welcome email URL built with `new URL()` + `searchParams.set()` (was string interpolation)
- PF-S-M-4: LDAP-vs-LDAP collision check tightened (`conflict.ldapDn !== adUser.dn`)
- PF-S-M-5: `schedulerNextSyncAt` set to `null` during active sync, updated post-run
- PF-S-M-6: O(n·m) deactivation lookup → O(n) via captured object array
- PF-S-M-7: Tautological `else if (Object.keys(changes).length > 0)` → `else`
- PF-S-M-8: 9 new unit tests for LDAP filter injection (RFC 4515 special chars)
- PF-S-M-9: Boot stale-log cleanup detail includes `phase: "boot-recovery"`

**Frontend (11 items — 4 Important + 7 Minor):**
- PF-F-I-1: Server security `warnings` displayed as amber banner on LDAP admin page
- PF-F-I-2: Shared `useSyncPolling` hook extracted — removed ~40-line duplicate in 2 files
- PF-F-I-3: 9 missing LDAP i18n keys added to all 22 non-English locale files
- PF-F-I-4: UTF-8 BOM stripped from all 22 non-English locale files; locale parity test enhanced
- PF-F-M-1: `closeTimerRef` stored and cleared on `handleViewDetail` and unmount
- PF-F-M-2: `pt-6` TLS alignment hack replaced with invisible `<Label>` placeholder
- PF-F-M-3: `appUrl` required-when-enabled validation in form schema
- PF-F-M-4: `bindPassword` required-when-new validation in form schema
- PF-F-M-5: `formatRelativeTime` guards against NaN with `Number.isFinite`
- PF-F-M-6: `isPolling` ref guard prevents stale in-flight poll callbacks
- PF-F-M-7: Pre-existing typo `"userr"` → `"userRole"` in all 23 locales + code reference updated

**Tech debt:**
- TD-4 tracked: Zod type provider configured but not leveraged — 104 `as` casts across 15 controllers, 131 routes using `.get()/.post()` without type inference
- TD-5 tracked: audit needed for other "infrastructure set up but not used" patterns

**Final state:** Server 358 tests (37 files) + Web 222 tests (19 files), both type-checks clean
- 3 commits on `feat/5.3-ldap`: `b256cd6`, `786e5af`, `e261ded`
- Merged into `main`
