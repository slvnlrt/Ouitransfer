# Session Log

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
