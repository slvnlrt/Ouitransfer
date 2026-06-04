# Technical Debt — Resolved & Superseded Items

> Archived from [`TECHNICAL-DEBT.md`](../TECHNICAL-DEBT.md).
> These items are fully resolved or superseded. Kept for historical reference.

---

## ~~TD-1 — API endpoint return types are type-unsafe (I-7 from 7.1 review)~~ ✅ RESOLVED

Resolved in B-7/TD session. Commits `fe94cef`, `1e1f508`, `7ea7cfa`, `ae0b451`.
Removed unsafe `<TData>` generic from 88 endpoint functions across 10 files.
Normalized two-factor and invite patterns. All endpoint functions now use concrete return types.

---

## ~~TD-2 — Account lockout throws ForbiddenError without specific error code~~ ✅ RESOLVED

Resolved in B-7/TD session. Commits `564cb42`, `fba3c43`, `dd02dce`.
Added `ACCOUNT_LOCKED` error code, frontend lockout message with `{minutes}` placeholder
in all 23 locales, `app.inject()` integration test, `LOGIN_LOCKED` audit action,
and 401/403 response schemas on auth routes.

---

## ~~TD-3 — 2FA brute-force gap: no per-account rate limiting on TOTP verification~~ ✅ RESOLVED

Resolved in TD session (mai 2026). `login()` restructured to defer success recording when 2FA
is required. `completeTwoFactorLogin()` now calls `isAccountLocked()` at entry and
`recordLoginAttempt()` on failure/success. Audit logging (`LOGIN_FAILURE`/`LOGIN_LOCKED`) added
to `POST /auth/2fa/login` route. Integration test added at
`src/__tests__/auth-2fa-lockout.integration.test.ts` (4 `app.inject()` tests).

Commits: `fix(server): close 2FA brute-force gap`, `fix: address review findings I-1/I-2/...`

---

## ~~TD-4 — Zod type provider configured but not leveraged — 104 type assertions across all controllers~~ ✅ RESOLVED

Resolved in TD-4 session (May 2026). Branch `refactor/td4-zod-type-provider`.

All 18 controller classes deleted. All 18 route files migrated to `FastifyPluginAsyncZod`
with `.route()` + inline handlers. All `as` casts on `request.body/params/query` eliminated
(1 intentional widening cast retained with comment). Cookie utilities centralized in
`utils/auth-cookies.ts` (`setAuthCookies`, `clearAuthCookies`, `signAndSetCookies`,
`getClientInfo`). `createJwtPreValidation()` factory extracted to
`middleware/jwt-prevalidation.ts`. Full test suite: 372 tests passing, zero type errors.

Commits: `57c96ff`, `7a25254`, `f2d73ed`, `66215a5`, `3e1aa28`, `ae2e66e`, `1559181`, `0416e89`.

---

## ~~TD-6 — Prisma major version upgrade: 6.x → 7.x~~ ✅ RESOLVED

Resolved in TD-6 session (mai 2026). Full migration from Prisma 6.11 to 7.8.0.

**Key changes:**
- Generator: `prisma-client-js` → `prisma-client`, output to `src/generated/prisma/`
- Driver adapter: `@prisma/adapter-better-sqlite3` + `better-sqlite3` native bindings
- All imports updated from `@prisma/client` to generated client paths (9 files)
- `prisma.config.ts` expanded with `datasource.url`, `migrations` config
- `reset-password.ts` refactored to use shared prisma instance
- `seed.js` updated to adapter pattern, runs via `tsx` (Prisma 7 generates .ts only)
- `--skip-generate` flags removed from Justfile and server-start.sh
- Docker: build tools for native bindings, `check-missing.js` rewritten for ESM/adapter pattern
- `prisma` and `tsx` moved to runtime dependencies (needed in Docker deploy stage)

Spec: `features/specs/td-6-prisma-7-upgrade.md`
Plan: `features/plans/td-6-prisma-7-migration.md`

Commits: `925b677` through `45eb0bb` (8 commits)

---

## ~~TD-7 — Turborepo minor update: 2.9.6 → 2.9.14~~ ✅ RESOLVED

Resolved in TD session (mai 2026). `turbo` bumped to `^2.9.14` in root `package.json`.
Commit: `chore(deps): update turbo 2.9.6 -> 2.9.14`

---

## ~~TD-9 — 4 unused exported types in `file/dto.ts` (knip)~~ ✅ RESOLVED

After TD-4, `RegisterFileInput`, `CheckFileInput`, `MoveFileInput`, `ListFilesInput` in
`apps/server/src/modules/file/dto.ts` became dead exports (were only used by deleted
`FileController`). Resolved by deleting the 4 `export type` lines — schemas are still used
directly in `file/routes.ts`.

---

## ~~TD-8 — Group API quota fields lack validation (no upper bound, no integer check)~~ ✅ RESOLVED

Resolved in TD session (mai 2026). Extracted shared `quotaOverrideField` schema to
`apps/server/src/shared/quota-schema.ts`. Both `quota/dto.ts` and `group/dto.ts` now import
from this shared module. 13 unit tests added in `shared/__tests__/quota-schema.test.ts`
covering null, 0, 1GB, 1PB, overflow, negative, decimal, non-numeric inputs.

Commits: `refactor(server): extract shared quotaOverrideField schema`, `fix: address review findings...`

---

## ~~TD-29 — No CI guard against UTF-8 BOM in locale files~~ ✅ RESOLVED

Resolved: already implemented. `apps/web/src/__tests__/locale-keys.test.ts` (lines 61-74)
explicitly tests every locale file for BOM presence (`\uFEFF` prefix). The test runs in CI
via `turbo test` in `.github/workflows/ci.yml`. No additional work needed.

---

## ~~TD-11 — Next.js 15 → 16 upgrade~~ ✅ RESOLVED

Resolved in TD-11 session (mai 2026). Full migration from Next.js 15.5.18 to 16.2.6.

**Key changes:**
- `next` 15.5.18 → 16.2.6, `react`/`react-dom` 19.1 → 19.2.5 (exact pins in catalog)
- `@next/bundle-analyzer` ^15.3.3 → 16.2.6
- `fumadocs-core`/`fumadocs-ui` 15.2.7 → 16.4.3, `fumadocs-mdx` 11.6.10 → 13.0.8
- `next-intl` auto-updated 4.3.1 → 4.9.1
- `middleware.ts` → `proxy.ts` (Next.js 16 convention), export renamed `middleware` → `proxy`
- `cookies()` consolidated to inline `await cookies()` in `i18n/request.ts`
- Fumadocs API migration: `fumadocs-ui/provider` → `fumadocs-ui/provider/next`,
  `createFromSource` callback → `{ buildIndex }` object API, type cast for upstream
  typing bug (fuma-nama/fumadocs#3027)
- Task 3 (serverActions promotion) correctly SKIPPED — `NextConfig` type in 16.2.6
  still requires `experimental.serverActions`

Spec: `features/specs/td-11-nextjs-16-upgrade.md`
Plan: `features/plans/td-11-nextjs-16-upgrade.md`

Commits: `66e6c17` through `31e7e06` (6 commits)

---

## ~~TD-12 — Images background WetTransfer : provenance inconnue~~ ✅ RESOLVED

Resolved in TD-12/TD-14 session (mai 2026). Les 8 JPGs hardcodés ont été supprimés et remplacés
par un système complet de gestion d'images de fond :
- Nouveau modèle Prisma `BackgroundImage` (S3, WebP, thumbnails)
- Module serveur `background-image/` avec 6 endpoints (CRUD admin + accès public)
- Image manager dans les settings admin (upload, suppression)
- Image picker dans le formulaire de création ET le modal de détails des reverse shares
- Layout WeTransfer dynamique : image spécifique, aléatoire, ou fallback gradient indigo

Spec: `features/specs/td-14-td-12-footer-backgrounds.md`
Plan: `features/plans/td-14-td-12-footer-backgrounds.md`

---

## ~~TD-13 — Pattern i18n fragile : concaténation de clés t() au lieu d'interpolation~~ ✅ RESOLVED

Resolved in TD session (mai 2026). Two occurrences fixed:
- `reverse-share-card.tsx:450` — remplacé par `common.clickToActivate` / `common.clickToDeactivate`
- `move-items-modal.tsx:218` — remplacé par `moveItems.movingToFolder` avec interpolation `{folder}`
Les 23 locales mises à jour. Clé `common.click` supprimée.

Commits: `fix(web): replace fragile i18n concatenation with dedicated keys`, `fix: address review findings...`

---

## ~~TD-14 — Footer non configurable (hardcodé)~~ ✅ RESOLVED

Resolved in TD-12/TD-14 session (mai 2026). Le footer est maintenant configurable via 3 settings :
- `footerEnabled` (bool, défaut: true) — masque entièrement le footer si false
- `footerText` (string, défaut: "Burger&Cie") — texte du lien
- `footerUrl` (string, défaut: "https://example.com") — URL du lien

Les deux composants footer (`default-footer.tsx` et `transparent-footer.tsx`) lisent ces configs
via `useSecureConfigValue()`. Les settings apparaissent dans le groupe "general" de la page admin.

Spec: `features/specs/td-14-td-12-footer-backgrounds.md`

---

## ~~TD-15 — Description par défaut de l'application à améliorer~~ ✅ RESOLVED

Resolved in TD session (mai 2026). `appDescription` dans `prisma/seed.js` changé en
"Self-hosted file transfer platform". Fallback `app-info.ts` mis à jour en cohérence.

Commit: `chore(monorepo): update default app description`

---

## ~~TD-16 — Traductions B-17/B-19 perdues dans 22 locales (placeholders EN)~~ SUPERSEDED

Superseded by TD-36 (strings non traduites — scope élargi). TD-16 was a subset of the broader issue.

---

## ~~TD-17 — S3 orphan risk: partial delete in background-image operation~~ ✅ RESOLVED

Resolved in 5.2 Phase A (Batch 5, juin 2026) via option 4 (idempotent best-effort delete +
recoverable orphans) combined with option 2 (cleanup job). The background-image delete still
logs partial-delete failures, but the abandoned S3 object is now reclaimable: the new
bidirectional orphan sweep (`sweepOrphans` in `modules/cleanup/service.ts`, axis A9) lists the
bucket and deletes any object older than the min-age guard whose key matches no `File` nor
`ReverseShareFile` row. A background-image thumbnail left behind by a partial delete has no DB
row referencing it, so it is swept on the next run. The sweep is opt-in
(`autoCleanupOrphansEnabled`, off by default) and protected by `autoCleanupOrphanMinAgeHours`.

**Context (archived):** The `DELETE /admin/background-images/:id` endpoint (handler at
`apps/server/src/modules/background-image/routes.ts`) uses `Promise.allSettled` to delete
two S3 objects (main image + thumbnail). If one `DeleteObjectCommand` fails and the other
succeeds, the database row is deleted but one S3 object remains orphaned.

**Current state:** The operation logs a warning with image ID and error details, making
orphans discoverable in logs. However, there is no automated sweeper, dead-letter queue,
or retry mechanism to clean up abandoned S3 objects.

**Risk level:** Low-Medium — requires manual S3 inspection/cleanup and assumes operational
monitoring of logs. No customer data loss, but wastes storage quota.

**Options to fix:**
1. **Atomic approach:** Use S3 transactions (if available) or a transactional saga pattern
2. **Cleanup job:** Add a periodic background job that lists all S3 objects and finds orphans by comparing to DB
3. **Dead-letter queue:** Log failures to a DLQ and process asynchronously
4. **Idempotent delete:** Make S3 deletes best-effort (ignore 404 on missing object), accept orphans as recoverable via cleanup job

**Found during:** TD-14 background-image feature implementation (mai 2026)
**Severity:** Low — impacts storage utilization, not functionality or data integrity

---

## ~~TD-18 — Client-side alias generation: no server-side minting or reserved-word validation~~ ✅ RESOLVED

Resolved (juin 2026). Charset/length validation already existed (added in TD-4) but had
**drifted**: share aliases allowed `[a-z0-9]` min 3, reverse-share aliases allowed
`[a-z0-9-]` min 3, and the reverse-share **frontend** modal allowed underscores up to 50
chars — values the server rejected.

Introduced a single source of truth (`apps/server/src/shared/alias-schema.ts`): **5–30
chars, alphanumerics with single internal hyphens** (no leading/trailing/double hyphen).
Both alias endpoints now use it. The web mirrors it in `utils/alias.ts` and wires inline
validation into all four alias inputs (generate-share-link, share-item,
share-multiple-items, reverse-share generate-alias), consolidating messages under
`common.aliasValidation` (old `reverseShares.modals.alias.validation.*` keys pruned from
all 23 locales).

**Decisions (user):** min length **5** (compromise vs the TD's suggested 8);
**no reserved-word blocklist** (aliases are namespaced under `/s/` and `/r/`, no route
collision); charset **unified to allow hyphens** everywhere. Server-side minting
(`generateAlias` flag) was **not** done — the security gap is closed by validation;
single-call minting remains a possible future ergonomics improvement.

Tests: 16 unit (`aliasSchema`) + 20 `app.inject` integration tests across both endpoints.

Commit: `feat(monorepo): TD-18 — unify and harden share/reverse-share alias validation`

---

## ~~TD-21 — Quickshare i18n: 21 locales have English fallback translations~~ SUPERSEDED

Superseded by TD-36 (strings non traduites — scope élargi). TD-21 was a subset of the broader issue.

---

## ~~TD-22 — BFS in `getDescendantFolderIds` should use a recursive SQL CTE~~ ✅ RESOLVED

Resolved in TD-22/TD-23 session (mai 2026). Replaced N-level BFS loop with a single
recursive SQL CTE via `prisma.$queryRaw`. SQLite table name `"folders"` (from `@@map`).
Integration test updated to mock `$queryRaw` instead of chained `findMany` calls.

---

## ~~TD-23 — S3 delete before DB delete creates orphan risk~~ ✅ RESOLVED

Resolved in TD-22/TD-23 session (mai 2026). Swapped delete order in both
`DELETE /files/:id` and `DELETE /folders/:id`: DB delete now runs first,
S3 delete second. If DB fails, S3 object remains valid (safe). If S3 fails
after DB delete, orphaned S3 object is acceptable (GC can clean).

---

## ~~TD-24 — No server-side validation on `auditRetentionDays` (min: 0, if > 0 then >= 7)~~ ✅ RESOLVED

Resolved (juin 2026). Introduced a centralized per-config-key validation registry
(`apps/server/src/modules/config/config-validation.ts`) applied in **both**
`updateConfig` and `bulkUpdateConfigs` so the single and bulk paths never drift.
`auditRetentionDays` must be an integer that is either 0 (keep forever) or >= 7;
invalid values throw a 400 `ValidationError` carrying the offending key in `details`.

The settings form's zod resolver gained a `superRefine` mirroring the rule (inline
field error), with a server-error backstop mapping `VALIDATION_ERROR` (via
`details.key`) to the same localized message. i18n key added to all 23 locales.

Tests: 16 unit (`validateConfigValue`) + 10 `app.inject` integration tests.

Commit: `feat(monorepo): TD-24 — validate auditRetentionDays (0 or >= 7 days)`

---

## ~~TD-25A — Scripts Python de traduction à auditer~~ ✅ RESOLVED

**Audit réalisé en mai 2026.** Tous les scripts fonctionnent correctement avec le repo actuel :

- [x] Les chemins vers `messages/` sont corrects (auto-détectés via `Path(__file__).parent`)
- [x] La structure des namespaces imbriqués est bien gérée (quickShare, audit, ldap... OK)
- [x] `prune_translations.py --dry-run` : 0 clés orphelines, aucune clé en trop dans les 22 fichiers
- [x] `sync_translations.py --dry-run` : 0 clés manquantes, les 22 langues ont exactement les mêmes 2285 paths que en-US.json
- [x] `check_translations.py` : 0 marqueur `[TO_TRANSLATE]` dans les 22 langues (1958 leaf strings)
- [x] `--dry-run` fiable et sûr sur tous les scripts
- [x] Python 3.6+ suffisant, aucune dépendance externe

**Découverte adjacente :** Le "100% completeness" rapporté par `check` ne signifie pas que les valeurs
sont traduites — il signifie uniquement qu'il n'y a pas de marqueur `[TO_TRANSLATE]`. En pratique,
~140-155 strings par langue (hors fr-FR : ~50) sont identiques à l'anglais sans être du vrai anglais
technique. Les namespaces affectés : voir TD-26 ci-dessous.

**Discrepance 1958 vs 2285 :** `check` compte les feuilles (strings réelles = 1958) ;
`sync` compte tous les noeuds JSON y compris les objets intermédiaires (= 2285). Normal.

---

## ~~TD-25 — `apps/server/src/scripts/cleanup-orphan-files.ts`~~ ✅ RESOLVED

Resolved in 5.2 Phase A (Batch 5, juin 2026). The one-shot DB→S3-only script has been replaced
by the bidirectional orphan sweep (`sweepOrphans`, axis A9), which covers **both** directions —
DB rows pointing at missing S3 objects *and* S3 objects with no DB row (the partial-delete case
the old script could not see) — across both object-owning tables (`File` and `ReverseShareFile`).
It no longer hard-codes credentials in an ad-hoc provider instance: it reuses the shared
`S3StorageProvider` and runtime storage config like the rest of the app, and applies a min-age
guard so in-flight uploads are protected.

`scripts/cleanup-orphan-files.ts` was rewritten as a thin CLI wrapper that calls `sweepOrphans`
(dry-run by default, `--confirm` to act, optional `--min-age-hours=N`), preserving the
`cleanup:orphan-files` / `cleanup:orphan-files:confirm` package.json scripts as a manual
maintenance entry point. The stale `node dist/scripts/...` invocation hint (line 64 in the old
file, flagged here) is gone — the wrapper documents the `pnpm --filter` invocation instead.

**Context (archived):** Ce script date du commit initial (pré-refactor). Il nécessitait une réécriture :

- **Ligne 14** : `new S3StorageProvider()` — instanciation directe qui hard-code les credentials
  S3 depuis les env vars sans passer par la configuration runtime de l'app. Fonctionnel en soi
  (le seul provider est S3-compatible depuis le refactor vers l'archi 3-containers), mais fragile.
- **Ligne 64** : référence `node dist/scripts/cleanup-orphan-files.js` — à vérifier avec ESM
- Ne gère que les orphelins DB→S3 (fichiers présents en DB mais absents du storage). L'inverse
  (objets S3 sans entrée DB — le cas le plus probable après une suppression partielle) n'est pas couvert.

**Note :** Ce script a vocation à devenir une fonctionnalité de maintenance UI/API dans la feature
"maintenance" planifiée. Il ne s'agit pas d'accepter les orphelins comme état permanent — c'est un
vrai problème de nettoyage qui sera traité dans cette feature. Ce script one-shot sera probablement
remplacé ou intégré à ce moment-là.

**Fix :** À revoir dans le contexte de la feature "maintenance" — soit réécrire en standalone
correct (DB→S3 + S3→DB), soit supprimer et intégrer directement dans la future feature.

**Found during:** Documentation update session (mai 2026) — découvert en cherchant des scripts pre-refactor
**Severity:** Low — script utilitaire off-path ; le vrai fix arrive avec la feature "maintenance"

---

## ~~TD-19 — Hardcoded QR code element ID prevents multiple instances~~ ✅ RESOLVED

Resolved (juin 2026). The hazard turned out to span **7 components** with three
divergent QR-download implementations. Instead of `useId()`, all were consolidated
onto a single `useQrDownload` hook + `downloadQrCodeAsPng(svg, filename)` util that
operates on an **SVG element reference** (via a container `ref` + `querySelector`),
so there are no global DOM ids at all — multiple instances are inherently safe.

Three broken download paths were fixed along the way:
- `share-item-modal`: cast the QR `<svg>` to `HTMLCanvasElement` and called
  `toDataURL()` on it (threw at runtime).
- `share-multiple-items-modal`: queried for a non-existent `<canvas>` child → silent no-op.
- inline `btoa()` paths broke on non-Latin1 payloads (util now serializes via a Blob URL).

Unit tests added for `generateQrFilename` and the hook (null-container / success / failure).

Commit: `fix(web): TD-19 — consolidate QR download into shared hook, drop global ids`

---

## ~~TD-26 — Next.js API Rewrite & CORS en Docker Dev (Standalone)~~ ✅ RESOLVED

**Problème :**
Le routage local des requêtes `/api/*` vers Fastify via `rewrites()` dans `next.config.ts` causait des erreurs 404 avec `just docker-start`.
*Cause :* `next.config.ts` est évalué au build time. En mode Docker standalone (`NODE_ENV=production`), les rewrites sont sérialisés statiquement dans `routes-manifest.json`, rendant impossible l'injection d'une URL dynamique (`API_BASE_URL`) au runtime.

**Résolution Architecturale :**
Le routage API de dev a été migré de la configuration de build (`next.config.ts`) vers le runtime (middleware Next.js `proxy.ts`).
1. **Routage :** Le middleware intercepte `/api/*` et utilise `NextResponse.rewrite()` pour transférer la requête (headers, body, cookies) vers `env.API_BASE_URL`.
2. **Sécurité Prod :** En production (Traefik), ce code est inactif car Traefik intercepte et route `/api` en amont. La pureté de l'infrastructure est préservée.
3. **CORS :** `NextResponse.rewrite()` transfère le header `Origin` de manière transparente. Les erreurs CORS sont gérées proprement en configurant `CORS_ORIGINS` dans `apps/server/.env.development`, évitant tout hardcoding dans `app.ts`.

**Found during:** Migration proxy Traefik (mai 2026)
**Severity:** Resolved — Redirection runtime et sécurité finalisées.

---

## ~~TD-31 — Audit PII sweep: `deleteUser` doesn't clean `AuditLog.metadata.emails`~~ ✅ RESOLVED

Resolved (juin 2026) via option 2 (redaction). Added `redactEmailFromAuditLogs(email)` to the
audit service: it narrows candidates with a substring `contains` filter on the JSON `metadata`
string, then deep-walks each parsed payload and replaces **every exact occurrence** of the email
— in arrays (`metadata.emails`) or scalar fields (`metadata.email`) — with `[deleted]`,
preserving counts/actions/ids. `deleteUser` invokes it as a best-effort step (a failure is
logged but does not turn the already-completed deletion into an error). The `USER_DELETE` event
no longer logs the deleted email (`targetId` already identifies the user), so the erasure is not
immediately undone.

Tests: 7 unit (array/scalar redaction, exact-vs-substring, unparseable metadata, change counting)
+ 3 `app.inject` integration tests on `DELETE /users/:id`.

Commit: `feat(server): TD-31 — redact deleted user's email from audit metadata (GDPR)`

---

## ~~TD-35 — `checkFileAccess` doesn't recognize folder-nested files (share download tracking gap)~~ ✅ RESOLVED

Resolved in session 19 (mai 2026). Root-cause fix: added `getAncestorFolderIds()` helper
(recursive CTE walking UP the folder tree) and refactored both `checkFileAccess` and
`trackShareDownload` to use it. Now handles files at any depth of folder nesting within a share.
Previously, `checkFileAccess` checked only direct files, and `trackShareDownload` checked only
one level of folder nesting. Both now correctly resolve the full ancestor chain and match any
shared folder in the hierarchy. 7 integration tests added (`file-access-folder-nested.integration.test.ts`).

---

## ~~TD-37 — Register-with-invite error handling relies on English string matching~~ ✅ RESOLVED

Resolved in session 19 (mai 2026). Added 4 structured error codes to `@ouitransfer/shared/error-codes`:
`INVITE_TOKEN_USED`, `INVITE_TOKEN_EXPIRED`, `USERNAME_EXISTS`, `EMAIL_EXISTS`. Server
`invite/service.ts` now throws `AppError` with specific codes instead of generic `ConflictError`/`GoneError`.
Frontend `register-form.tsx` uses `parseApiError()` + `ErrorCodes.*` comparisons (same pattern as
`use-login.ts`, `use-public-share.ts`). Route schema updated with 404/409/410 response codes.
6 integration tests added (`register-with-invite.integration.test.ts`).

---

## ~~TD-38 — Notification unsubscribe page only supports English and French~~ ✅ RESOLVED

Resolved (juin 2026). The hardcoded inline `PAGE_STRINGS` map (`UnsubscribePageStrings`
interface + `getPageStrings`) was removed from `notification/routes.ts`. The unsubscribe
confirmation/success/error pages now render through the **email i18n system**
(`createTranslationFn`/`TranslationFn` from `email/i18n/loader.ts`) under a new
`unsubscribe.*` namespace in `email/i18n/messages/en.json` + `fr.json`. This gives the
pages a single source of truth and the **same locale-resolution and fallback rules as the
notification emails themselves** (requested locale → English) — adding a new email locale
file now extends the unsubscribe pages automatically, with no separate map to maintain.

The HTML-escaping `tr` function escapes the interpolated `{type}` value while preserving
template markup; the `lang` attribute mirrors the requested locale exactly as the email
base layout does. `getUserLocale` now returns `"en"` (not `null`) on a missing user, and
the error page (rendered when no user/locale is known) always renders in English.

Tests: 2 new `app.inject` integration tests in `notification/__tests__/routes.test.ts`
assert French rendering of the confirm and success pages (and `lang="fr"`); `beforeEach`
now resets `user.findUnique` to prevent locale leaking between tests.

**Note:** The email i18n subsystem itself currently ships only `en.json`/`fr.json`, so
effective language coverage is en/fr (other locales fall back to English) — identical to
before, but now consolidated and consistent. Broadening email/unsubscribe language coverage
is the separate, larger translation effort tracked under TD-36.

**Found during:** Deferred work audit (mai 2026, AR-2)

---

## TD-39 — ~~Password reset tokens stored in plaintext~~ DONE

**Status:** DONE (2026-05-31)
**Commits:** `dfc59fc`, `c260239`, `7ffc041`
**Changes:** Created `hashToken` utility (`utils/token-hash.ts`, SHA-256). Updated
`auth/service.ts` and `ldap/sync.service.ts` to hash before storage and hash on lookup.
Normalized token entropy to 32 bytes (256 bits) in both code paths. Removed plaintext
tech debt comment from LDAP sync.

---

## ~~TD-44 — Modale notifications: libellé "Alerter si aucun téléchargements après (jours)" confus~~ ✅ RESOLVED

Resolved in TD-44 session (mai 2026). `share-privacy-section.tsx` : label épuré (suppression
du `(jours)` / `(days)` en fin de chaîne), input enveloppé dans un `<div className="relative">`
avec un `<span>` absolu affichant `{t("common.days")}` en suffix (padding `pe-14` / position
`end-3` pour la compatibilité RTL). 23 locales mises à jour : `createShare.inactivityAlertDays`
épuré + nouvelle clé `common.days` avec traductions.

Commits: `fix(web): TD-44 — clarify inactivity alert field with inline unit`,
`fix(web): TD-44 RTL — use logical end-3/pe-14 instead of right-3/pr-14`

---

**Context:** Dans la modale de création/détails, l'option "Alerter si aucun téléchargements
après (jours)" avec un champ numérique en dessous n'est pas claire. Le "(jours)" accolé au
label est ambigu — on ne comprend pas immédiatement que le champ en dessous est un nombre
de jours. Le wording et le layout doivent être revus.

**Fix:** Reformuler le label (ex: "Envoyer une alerte si le partage n'a reçu aucun
téléchargement après N jours") et intégrer l'unité directement dans le champ input
(suffix "jours" / "days" dans le placeholder ou comme addon). Mettre à jour les clés i18n.

**Found during:** Revue utilisateur (mai 2026)
**Severity:** Low — UX clarity issue, pas de bug fonctionnel

---

## ~~TD-45 — Fastify deprecation warning: router options access pattern (FSTDEP022)~~ ✅ RESOLVED

Resolved in session 19 (mai 2026). Moved `ignoreTrailingSlash` and `maxParamLength` from
top-level `fastify({...})` into `routerOptions: { ignoreTrailingSlash: true, maxParamLength: 500 }`
in `apps/server/src/app.ts`. FSTDEP022 warning no longer emitted at boot.

Commit: `fix(server): TD-45 routerOptions + TD-46 enable SQLite WAL mode on boot`

---

## ~~TD-46 — SQLite WAL mode not enabled — audit write contention risk~~ ✅ RESOLVED

Resolved in session 19 (mai 2026). Changed `PRAGMA journal_mode` (read-only check) to
`PRAGMA journal_mode=WAL` (idempotent set) in `initAuditRetentionOnBoot` in
`apps/server/src/modules/audit/retention.scheduler.ts`. WAL mode is now enabled at every
boot (persists across restarts). If WAL cannot be set (read-only filesystem), a warn is
logged. Test updated accordingly.

Commit: `fix(server): TD-45 routerOptions + TD-46 enable SQLite WAL mode on boot`

---

## ~~TD-47 — pnpm version outdated: 10.6.0 → 11+~~ ✅ RESOLVED

Resolved in TD-47 session (mai 2026). Bumped `packageManager` to `pnpm@11.5.0` in root and
3 app `package.json` files. `Dockerfile` updated (`corepack prepare pnpm@11.5.0 --activate`).
`pnpm-workspace.yaml`: migrated `onlyBuiltDependencies` → `allowBuilds` map (9 packages);
migrated `pnpm.overrides` from `package.json` → `pnpm-workspace.yaml overrides:`. `.npmrc`
deleted — project settings migrated to `pnpm-workspace.yaml`; only `autoInstallPeers: true`
differs from pnpm 11 defaults (others matched defaults and were dropped). Lockfile regenerated
(lockfileVersion 9.0). `apps/docs` prerequisites table updated to 11.5.0. Tests: 1086 server +
274 web — all pass.

⚠️ **Note:** `allowBuilds` map is load-bearing for CI — `pnpm install --frozen-lockfile` will
hard-fail if a new package with a build script is added without updating `allowBuilds` in
`pnpm-workspace.yaml`.

Commit: `99ca0bf`

---

**Context (archived):** `package.json` (`packageManager: "pnpm@10.6.0"`) and `Dockerfile`
(`corepack prepare pnpm@10.6.0 --activate`) both pinned pnpm 10.6.0. pnpm is now at
version 11+, a major version bump. Corepack may print "newer version available"
warnings during Docker builds.

**Found during:** Docker build logs review + user observation, session 18 (mai 2026)
**Severity:** Low — no current breakage; pnpm 10 still supported; worthwhile to stay current

---

## ~~TD-41 — Optional per-reverse-share cooldown bypass toggle~~ ✅ RESOLVED

Resolved (juin 2026). Added `bypassUploadCooldown Boolean @default(false)` to the ReverseShare
model. `resolveFrequency` Step 3b now returns `overridden: bypassUploadCooldown`, so the 300s
cooldown is bypassed only when the owner explicitly opts in (and only while `notifyOnUpload` is
on). DTOs, response schema, and service mapping carry the field through create/update.

A second toggle appears under "Notify on each upload" in both the create and details modals,
visible only when notifications are enabled; turning notifications off clears the bypass (the
details modal's single-field update helper was generalized to a multi-field variant for the
atomic reset). i18n keys added to all 23 locales.

Tests: 3 `resolveFrequency` cases (bypass true/false, ignored when notify off) + 2 `app.inject`
integration tests (create round-trip + default).

Commit: `feat(monorepo): TD-41 — optional per-reverse-share upload cooldown bypass`

---

## ~~TD-48 — `prisma/migrations/` is stale relative to `schema.prisma`~~ ✅ RESOLVED

Resolved in TD-48 session (juin 2026).

Migration history reset to a single clean baseline (`20260602091201_init`) covering the full
current schema. The container boot now runs `prisma migrate deploy` with a WAL-safe pre-migrate
backup (`apps/server/src/scripts/db-backup.ts`, keeps last 3 copies, uses better-sqlite3
online backup + `wal_checkpoint(TRUNCATE)`). Dev workflow: `just db-migrate-dev` to author new
migrations, `just db-dev-init` to create a local DB. A CI `prisma migrate diff --exit-code`
drift guard was added (`.github/workflows/ci.yml`) to fail on any schema↔migrations divergence.
Additionally, a turbo `db:generate` guard now regenerates the Prisma client before
`type-check`/`build`/`test`, fixing a stale-client root cause discovered during the work
(missing `bypassUploadCooldown` in gitignored generated client).

---

## ~~TD-49 — Couverture de tests manquante : services `user` et `reverse-share`~~ ✅ RESOLVED

Resolved in 5.2 Phase A (Batch 4, juin 2026). The account-lifecycle work added meaningful
service + integration coverage for both modules. The shared `purgeUserContent` helper and
`cleanupDeactivatedAccounts` (in `modules/cleanup/service.ts`) are unit-tested against a mocked
repository and storage provider, exercising `deleteUser`'s full cascade and the deactivated-account
file purge — including S3 best-effort ordering and count reporting. An `app.inject()` integration
test on `DELETE /users/:id` (axis A8) asserts the cascade removes shares, reverse shares, and S3
objects, and the A6 access tests cover the deactivated-owner read-time block on both `getShare`
and the reverse-share access path. These exercise the create/update/delete and response-formatting
paths (strict Zod parsing) that previously had no service/route tests, so a regression on them now
fails the suite.

**Context (archived):** Découvert pendant TD-31/TD-41. Les modules `user` et `reverse-share` n'avaient
**aucun** fichier de test de service/route avant cette session (seul `email-service.test.ts`
référençait `notifyOnUpload`). `deleteUser`, `createReverseShare`, `updateReverseShare`,
`formatReverseShareResponse`, etc. n'étaient pas couverts — c'est pourquoi l'ajout d'un champ
requis à `ReverseShareResponseSchema` n'a fait échouer aucun test existant.

Des tests d'intégration ciblés ont été ajoutés pour les flux touchés
(`alias-validation`, `reverse-share-bypass-cooldown`, `user-delete-pii-redaction`), mais la
couverture de base de ces deux modules reste lacunaire.

**Fix :** Ajouter des tests de service (repository mocké) pour `user/service.ts` et
`reverse-share/service.ts` couvrant create/update/delete + le formatage des réponses
(parsing strict des schémas Zod).

**Found during:** TD-31 / TD-41 (juin 2026)
**Severity:** Low — pas de bug connu, mais une régression sur ces chemins passerait inaperçue.

---

## ~~TD-51 — Surfaces du thème clair en blanc pur (trop agressif)~~ ✅ RESOLVED

Resolved (juin 2026). `--card` et `--popover` adoucis de `oklch(1 0 0)` (blanc pur) vers
`oklch(0.99 0.004 265)` ; `--background` vers `oklch(0.975 0.007 265)`. Thème sombre inchangé.

Commit: `e2cbd46 fix(web): TD-51 — soften harsh pure-white light-theme surfaces`
