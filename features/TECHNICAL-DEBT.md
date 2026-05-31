# Technical Debt — Items to Fix in Future Sessions

> **Voir aussi :** [`SECURITY.md`](SECURITY.md) — findings sécurité (Aikido SAST/SCA) · [`BUGS.md`](BUGS.md) — bugs

Items discovered during feature work that are out of scope for the current session
but must be addressed. Each item includes context and the fix needed.

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

## TD-5 — Audit needed: other "infrastructure set up but not used" patterns

**Context:** TD-4 revealed that a core piece of infrastructure (Zod type provider) was
configured but never actually leveraged across any route. This pattern — where refactoring
sets up the right tool but existing code isn't migrated to use it — may exist elsewhere.

**Items to audit:**
- [ ] Are there other TypeScript type-safety gaps where `as` casts mask schema drift?
- [ ] Are Fastify lifecycle hooks (onRequest, preHandler, etc.) properly typed?
- [ ] Is the Prisma client used with full type inference or are there `as unknown as X` casts?
- [ ] Are Zod schemas shared between route definitions and service layer, or duplicated?
- [ ] Are there middleware/plugins that lose type information at boundaries?
- [ ] Review all `as` casts in `apps/server/src/` — each one is a potential type-safety hole

**Found during:** 5.3 LDAP post-fix review remediation
**Severity:** Low-Medium — architectural hygiene, no runtime bugs, but undermines the
value of TypeScript strict mode

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

## TD-29 — No CI guard against UTF-8 BOM in locale files

**Context:** `apps/web/messages/*.json` locale files must not have a UTF-8 BOM
(Byte Order Mark, `0xEF 0xBB 0xBF`). A BOM causes JSON.parse to fail at runtime,
breaking all i18n for the affected locale. This has happened at least once during
the project (introduced by a text editor that adds BOM by default).

**Currently:** There is no automated CI check to catch BOM insertion. The issue
is only caught at runtime when the locale fails to load.

**Fix:** Add a CI step (e.g., a `grep -rP '\xEF\xBB\xBF'` pre-commit hook or
a Vitest test in `locale-keys.test.ts`) that scans all `apps/web/messages/*.json`
files for BOM bytes and fails the build if any are found.

**Found during:** Post-review audit (8.2 batch 5b, mai 2026)
**Severity:** Low — no current BOM in any locale file; risk is from future editor misconfiguration

---

## TD-10 — Routes admin inconsistantes (/users-management vs /admin/ldap)

**Context:** Les anciennes pages admin (`/users-management`, `/groups-management`, `/settings`)
sont au top-level, tandis que les nouvelles (`/admin/ldap`) sont sous `/admin/`. Tous les chemins
sont protégés par les mêmes mécanismes (middleware `adminPaths` + `<ProtectedRoute requireAdmin>`),
donc pas de risque de sécurité. C'est purement cosmétique/organisationnel.

**Fix:**
1. Migrer toutes les pages admin sous `/admin/` : `/admin/users`, `/admin/groups`, `/admin/settings`, `/admin/ldap`
2. Mettre à jour `admin-paths.ts`, la navbar, et tous les liens internes
3. Optionnel : ajouter un wildcard `/admin/*` dans le middleware au lieu de lister chaque chemin

**Found during:** Revue manuelle (session audit UI, mai 2026)
**Severity:** Very low — cosmétique, aucun impact fonctionnel ou sécurité

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

## TD-20 — Docs : section Developers à réécrire pour v3-beta

**Context:** Les pages de la section "Developers" dans `apps/docs/content/docs/v3-beta/` sont
obsolètes et ne correspondent plus à l'architecture actuelle du projet.

**Pages à réécrire :**
- `architecture.mdx` — Architecture of OUITRANSFER. (monorepo, Fastify 5, Prisma 7, RustFS…)
- `github-architecture.mdx` — GitHub Architecture (CI pipeline, Docker, workflows actuels)
- `api.mdx` — API Endpoints (toutes les routes ont changé depuis les refactors TD-4+)
- `translation-management.mdx` — Translation Management (next-intl v4, 23 langues, nouveau workflow)

**Found during:** Revue du site docs post-upgrade Next.js 16 (mai 2026)
**Severity:** Low — le site docs n'est pas encore public, pas d'impact utilisateur immédiat

---

## ~~TD-16 — Traductions B-17/B-19 perdues dans 22 locales (placeholders EN)~~ SUPERSEDED

Superseded by TD-36 (strings non traduites — scope élargi). TD-16 was a subset of the broader issue.

---

## TD-17 — S3 orphan risk: partial delete in background-image operation

**Context:** The `DELETE /admin/background-images/:id` endpoint (handler at
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

## TD-18 — Client-side alias generation: no server-side minting or reserved-word validation

**Context:** Share aliases are generated client-side via `customNanoid(10, alphanumeric)`
and sent to `POST /api/shares/alias/create/:shareId`. The server validates uniqueness
(collision → 409) but does not enforce minimum length, charset, or reject reserved words
(e.g., `admin`, `login`, `api`). A malicious client could squat on short or memorable aliases.

**Used in:**
- `apps/web/src/components/modals/generate-share-link-modal.tsx:29-30`
- `apps/web/src/app/dashboard/hooks/use-quick-share.ts` (Quickshare 9.1)

**Risk:** Low for auto-generated aliases (62^10 ≈ 8.4×10¹⁷ entropy). Medium if users
are ever allowed to pick custom aliases. No data loss or security impact.

**Fix:**
1. Server: validate alias length ≥ 8, charset `[a-zA-Z0-9]`, reject reserved words list
2. Ideally: add `generateAlias: true` flag to `createShare` and let server mint the alias
   in the same transaction (1 API call instead of 2)

**Found during:** Quickshare 9.1 spec review (mai 2026)
**Severity:** Low — defense-in-depth, no current exploit path

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

## TD-24 — No server-side validation on `auditRetentionDays` (min: 0, if > 0 then >= 7)

**Context:** The admin UI shows a help text suggesting 7 days as a minimum retention period,
but neither the client nor the server enforces this. The `auditRetentionDays` setting accepts
any integer (including negative values) without rejection.

**Fix:**
- Add Zod validation on the `auditRetentionDays` config setting: `z.number().int().min(0)`
- Add a refinement: if the value is > 0, it must be >= 7 (i.e., values 1–6 are rejected)
- Return a clear validation error message explaining the constraint
- Update the admin UI to show an inline validation error rather than just help text

**Found during:** 8.1 Activity Log docs quality review (mai 2026)
**Severity:** Low — the scheduler uses the value as-is (a value of 1 would delete logs older
than 1 day), but an admin setting this intentionally low is unlikely in practice

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

## TD-25 — `apps/server/src/scripts/cleanup-orphan-files.ts`

### Sous-tâche B — `apps/server/src/scripts/cleanup-orphan-files.ts`

**Context:** Ce script date du commit initial (pré-refactor). Il nécessite une réécriture :

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

## TD-19 — Hardcoded QR code element ID prevents multiple instances

**Context:** Both `generate-share-link-modal.tsx` and `quick-share-confirmation.tsx`
use `id="quickshare-qr-code"` / `id="share-qr-code"` to locate the SVG element for
PNG export (`document.getElementById(...)`). If two instances mount simultaneously
(e.g., modal + dashboard block), the second getElementById finds the first DOM element.

**Used in:**
- `apps/web/src/components/modals/generate-share-link-modal.tsx`
- `apps/web/src/app/dashboard/components/quick-share/quick-share-confirmation.tsx`

**Fix:** Use `React.useId()` to generate a unique ID per instance and pass it to both
the `LazyQRCode` `id` prop and the `getElementById` call in the download function.

**Found during:** Quickshare 9.1 spec review (mai 2026)
**Severity:** Very low — no current scenario where both mount at the same time

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

## TD-27 — Assymétrie du préfixe /api entre le Frontend et Fastify

**Context:**
Actuellement, le frontend envoie ses requêtes vers `/api/*` (ex: `/api/shares`). Or, les routes Fastify sont enregistrées à la racine (ex: `POST /shares`).
Cette asymétrie oblige à avoir une couche intermédiaire qui "strip" le préfixe `/api` :
- En production : Traefik gère cela via `StripPrefix(/api)`.
- En développement local : Le middleware Next.js (`proxy.ts`) s'en charge via un `.replace(/^\/api/, "")`.

**Fix:**
Il serait plus sain (Niveau 2 de résolution architecturale) de configurer Fastify pour qu'il adopte nativement le préfixe `/api` globalement (`app.register(routes, { prefix: "/api" })`).
Cela permettrait :
- Au frontend et au backend de partager les *mêmes* chemins (symétrie totale).
- De supprimer la couche de traduction de `StripPrefix` dans Traefik (un simple `PathPrefix` suffira).
- De simplifier encore le middleware de dev (transfert direct du `pathname`).
- De standardiser les endpoints dans les tests serveurs (qui injecteraient `/api/shares` au lieu de `/shares`).

**Found during:** Analyse post-mortem du proxy (mai 2026)
**Severity:** Low — L'asymétrie est parfaitement compensée par l'infrastructure (Traefik/Middleware), mais c'est une dette architecturale à moyen terme.

---

## TD-28 — Migration globale Zod v3 → v4

**Context:**
L'application utilise actuellement `zod@3.25.76` dans tout son code source (46 fichiers). Zod v4 est uniquement présent de manière transitive via le module de documentation `fumadocs`. Aikido SAST/SCA a levé deux alertes de sécurité moyennes (Prototype Pollution et validation manquante) sur cette version transitive v4. Bien que l'application ne soit pas vulnérable directement, cela crée un flag de sécurité et une asymétrie de versions.

**Migration & Blockers :**
Une évaluation complète et exhaustive a été rédigée dans [zod-v4-migration.md](file:///d:/Code/Ouitransfer/features/zod-v4-migration.md). La migration est estimée d'effort moyen-élevé avec les principaux chantiers suivants :
1. **Critical Blockers :** Upgrade de `fastify-type-provider-zod` vers la v5+ (compatible Zod v4), renommage de tous les imports `"zod"` vers `"zod/v4"` (requis par le type provider), correction de la signature `z.record(z.string())` (requiert 2 arguments en v4), adaptation du handler d'erreur Zod dans `error-handler.ts`.
2. **Semantic Changes :** Le comportement des `.default()` dans les champs optionnels change (les valeurs par défaut seront appliquées, contrairement à la v3), et le type d'entrée de `z.coerce` devient `unknown`.

**Fix:**
Planifier la migration complète en s'appuyant sur l'assessment détaillé disponible dans `features/zod-v4-migration.md`.

**Found during:** Analyse de sécurité Aikido (S-6, mai 2026)
**Severity:** Low — Aucun exploit direct de sécurité n'est possible via l'application, mais l'asymétrie v3/v4 et le flag de sécurité incitent à cette mise à niveau à moyen terme.

---

## TD-36 — Strings non traduites dans 21 locales (scope élargi)

**Context:** Audit de mai 2026 (TD-25A). Anciennement TD-16 (4 clés settings) et TD-21
(35 clés quickShare), désormais consolidés ici. L'audit complet révèle que le problème est plus
large : plusieurs namespaces ajoutés pendant le refactor n'ont jamais été traduits dans les
21 locales non-FR (toutes sauf en-US et fr-FR).

**Scope par namespace (exemple ja-JP, représentatif des autres) :**

| Namespace        | Strings en anglais | Feature d'origine |
| ---------------- | ------------------:| ----------------- |
| `audit.*`        | 61                 | 7.1 Activity Log  |
| `ldap.*`         | 29                 | 5.3 LDAP          |
| `quickShare.*`   | 13                 | 9.1 QuickShare (TD-21) |
| `settings.*`     | 12                 | divers (incl. TD-16) |
| `backgroundImages.*` | 9             | 10.1 Background Images |
| `errors.*`       | 8                  | divers            |
| `fileActions.*`, `folderActions.*`, etc. | ~15 | divers |
| **Total**        | **~147 / 1958**    | ~7.5% du total    |

fr-FR est nettement mieux loti (~50 strings identiques, dont beaucoup de termes techniques
légitimement en anglais), probablement car c'est la seule langue traduite manuellement.

**Mécanisme :** Les clés ont été ajoutées à en-US.json directement avec les valeurs anglaises
dans tous les fichiers locale (sans marqueur `[TO_TRANSLATE]`). Le script `check` ne les détecte
pas comme incomplètes. Le test `locale-keys.test.ts` ne vérifie que la structure (bonne), pas
les valeurs.

**Fix :** Pour chaque namespace manquant, utiliser un outil de traduction automatique
(DeepL, Google Translate) pour les 21 locales, puis vérifier manuellement les termes techniques.
Priorité : `errors.*` (UX critique), `audit.*` (grand nombre), `quickShare.*` (TD-21).

**Référence :** Anciens TD-16 (4 clés settings) et TD-21 (35 clés quickShare) sont désormais
marqués SUPERSEDED et consolidés dans ce TD-36.

**Found during:** Audit scripts traduction (mai 2026)
**Severity:** Low — app pas en production ; les valeurs anglaises sont fonctionnelles mais dégradent
l'expérience pour les utilisateurs non-EN/FR.

---

## TD-30 — `reverse_share_invitation` notification type: catalog + template exist but no trigger

**Context:** During 8.2 email notifications implementation, 22 notification types were defined
in the catalog (`apps/server/src/modules/email/catalog.ts`). Review pass 4 flagged that 5 types
had no trigger code (C-3). Four of the five were wired (account_deactivated, account_reactivated,
share_max_views_reached, admin_user_registered). The fifth — `reverse_share_invitation` (type 6) —
was explicitly deferred because reverse shares do not have a recipient model. There is no
`ShareRecipient` equivalent on reverse shares, so there is no one to "invite."

**Current state:**
- Catalog entry exists with `configurable: false, hasUnsubscribe: false`
- Template file exists: `apps/server/src/modules/email/templates/reverse-share-invitation.ts`
- i18n keys exist in `apps/server/src/modules/email/i18n/messages/en.json` (and fr.json)
- Comment in catalog: `// DEFERRED: Reverse shares do not have a recipient model.`
- Spec `features/specs/8.2-email-notifications.md` updated to note the deferral

**Fix:** Implement when reverse shares gain a recipient/invitation model (if ever). Options:
1. Add a `ReverseShareRecipient` model and a `POST /reverse-shares/:id/notify` endpoint
2. Or remove the catalog entry, template, and i18n keys entirely if the feature is dropped

**Found during:** 8.2 review pass 4 remediation (mai 2026)
**Severity:** Low — dead code with no runtime impact; explicitly documented as deferred

---

## TD-31 — Audit PII sweep: `deleteUser` doesn't clean `AuditLog.metadata.emails`

**Context:** `POST /shares/:shareId/recipients` logs recipient emails in `AuditLog.metadata.emails`
as plaintext for forensics (see `apps/server/src/modules/share/routes.ts:512-519`). When a user
is deleted via `deleteUser`, these audit log rows are not swept or redacted. This means a deleted
user's email can persist in audit metadata indefinitely (subject to `auditRetentionDays`).

**Impact:** GDPR data-subject deletion compliance gap. No impact today (app not in production,
no real users). The audit retention mechanism partially mitigates this (rows are auto-deleted
after `auditRetentionDays`), but a request for immediate erasure would not be honored.

**Fix:** When `deleteUser` runs, either:
1. Delete `AuditLog` rows where `metadata` contains the deleted user's email
2. Or redact the email in `metadata` (replace with `[deleted]`)

Option 2 preserves audit trail structure while removing PII.

**Depends on:** No external dependencies — can be implemented independently.

**Found during:** 8.2 review pass 5 (mai 2026)
**Severity:** Low — no current users; mitigated by audit retention policy

---

## TD-32 — Sender locale used for external recipient invitation emails

**Context:** External share recipients (people without an account) receive invitation emails
in the *sender's* locale, not their own (see `apps/server/src/modules/share/service.ts:781-785`).
A French user sharing files with a German colleague sends a French email. This is the best
available heuristic today since external recipients have no account and thus no locale preference.

**Fix:** Add an optional `locale` field to the `ShareRecipient` Prisma model. Options:
1. Let the sender pick per-recipient locale in the UI (adds complexity)
2. Default to sender locale but allow override
3. Accept current behavior with documentation (least effort)

**Found during:** 8.2 review pass 5 (mai 2026)
**Severity:** Low — sender locale is a reasonable heuristic for same-organization sharing

---

## TD-33 — Email subject frozen at enqueue time — admin `appName` changes invisible on queued jobs

**Context:** The email system resolves the subject line (including `appName` from config) at
enqueue time. If an admin changes `appName` in settings while there are pending email jobs in
the queue, those jobs will be sent with the old app name.

**Impact:** Extremely minor. Only affects the short window between an `appName` config change
and queue flush. In practice, the queue processes quickly and `appName` changes are rare events.

**Fix options:**
1. Resolve subject at send time instead of enqueue time (defers `appName` lookup)
2. Show a warning in admin email settings UI when there are pending jobs
3. Accept as inherent design trade-off (recommended)

**Found during:** 8.2 review pass 5 (mai 2026)
**Severity:** Very low — cosmetic edge case with negligible real-world impact

---

## TD-34 — ~~No `notifyOnUpload` per-reverse-share override (asymmetry with shares)~~ DONE

**Status:** DONE (2026-05-31)
**Commits:** `17ac636`, `592d8cb`, `248c733`, `8f6c8fb`, `0c3f36d`, `c015c9a`
**Changes:** Added `notifyOnUpload` boolean to ReverseShare model + DTOs + service.
Added Step 3b in `resolveFrequency` for `reverse_share_uploaded` (TDD, 6 tests).
Added Switch toggle in create modal + details modal. i18n keys in all 23 locales.
Changed `reverse_share_uploaded` catalog default from `"immediate"` to `"disabled"` so
the toggle means "enable/disable per-reverse-share upload notifications" (not cooldown
bypass). `overridden: false` ensures the 300s cooldown always applies.

---

## TD-35 — `checkFileAccess` doesn't recognize folder-nested files (share download tracking gap)

**Context:** `trackShareDownload` in `apps/server/src/modules/file/routes.ts` handles files
nested inside shared folders (line ~157), but `checkFileAccess` — which gates the download
before tracking runs — only recognizes files directly attached to a share (`files: { some: { id: fileId } }`),
not folder-nested ones. For an anonymous visitor downloading a folder-nested file, access is
denied at `checkFileAccess` before tracking is ever reached, making the folder branch in
`trackShareDownload` effectively dead for the anonymous case.

This is a pre-existing access-model inconsistency surfaced (not introduced) by 8.2's tracking code.

**Fix options:**
1. Extend `checkFileAccess` to traverse `folders → files` (recursive check)
2. Or remove the unreachable folder branch in `trackShareDownload` to avoid implying support
   that doesn't exist

**Found during:** 8.2 review pass 6 (mai 2026)
**Severity:** Low — pre-existing gap, no regression from 8.2

---

## TD-37 — Register-with-invite error handling relies on English string matching

**Context:** The catch block in `apps/web/src/app/register-with-invite/[token]/components/register-form.tsx:69`
detects specific error conditions by `includes()`-matching English strings from the server response
body (`"already been used"`, `"expired"`, `"Username already exists"`, `"Email already exists"`).
If any server message changes wording (e.g., during a refactor or locale change), the error
detection silently breaks and the user sees the generic "createFailed" toast.

**Fix:** Add structured `AppError` error codes to the server-side registration handler
(e.g., `INVITE_TOKEN_USED`, `INVITE_TOKEN_EXPIRED`, `USERNAME_EXISTS`, `EMAIL_EXISTS`) and
replace the string matching with code comparisons on the frontend. Low-effort, high-reliability
improvement consistent with how other endpoints return structured codes.

**Found during:** Deferred work audit (mai 2026, AR-1)
**Severity:** Medium — fragile error detection, silent degradation on server message changes

---

## TD-38 — Notification unsubscribe page only supports English and French

**Context:** The unsubscribe confirmation and result pages (served as HTML by the server at
`apps/server/src/modules/notification/routes.ts:46`) use a hardcoded inline map with only
`en` and `fr` locale strings. All other 21 supported locales fall back to English.
The i18n infrastructure (`loader.ts`, email message files) already exists to support all locales.

**Fix:** Migrate the unsubscribe page strings to the email i18n system. Add corresponding
keys to `apps/server/src/modules/email/i18n/messages/en.json` (and `fr.json`). Use
`createTranslationFn(userLocale)` to render the page. Medium effort, clear path.

**Found during:** Deferred work audit (mai 2026, AR-2)
**Severity:** Low — moderate UX degradation for non-EN/FR users clicking unsubscribe links

---

## TD-39 — ~~Password reset tokens stored in plaintext~~ DONE

**Status:** DONE (2026-05-31)
**Commits:** `dfc59fc`, `c260239`, `7ffc041`
**Changes:** Created `hashToken` utility (`utils/token-hash.ts`, SHA-256). Updated
`auth/service.ts` and `ldap/sync.service.ts` to hash before storage and hash on lookup.
Normalized token entropy to 32 bytes (256 bits) in both code paths. Removed plaintext
tech debt comment from LDAP sync.

---

## TD-40 — Global error boundary hardcoded in English — no i18n possible

**Context:** `apps/web/src/app/global-error.tsx:12` catches root layout crashes where all
providers (i18n, theme, auth) are unavailable, so `useTranslations()` cannot be called.
The component renders hardcoded English strings ("Something went wrong", "An unexpected
error occurred", "Try again", "Go to home page").

This is a known, correct trade-off — root layout crashes are rare, and loading provider
infrastructure into the error boundary would introduce its own failure modes. The fix is
non-trivial (would require inlining pre-translated strings for each locale via some other
mechanism, e.g., a static translation map similar to the unsubscribe page pattern in TD-38).

**Fix:** Optionally, inline a small static translation map covering the handful of strings
in the most common supported locales. Best done alongside TD-38 if the same inline-map
pattern is adopted.

**Found during:** Deferred work audit (mai 2026, AR-5)
**Severity:** Very Low — the error boundary exists precisely for catastrophic failures
where UX perfection is secondary to recovery

---

## TD-42 — Dashboard System Status: afficher l'état SMTP/notifications

**Context:** Le System Status du dashboard admin affiche l'état des services (DB, S3, etc.)
mais pas l'état du sous-système email/notifications. Or on a déjà des stats de queue
disponibles côté serveur (email queue metrics). Un administrateur devrait pouvoir voir
d'un coup d'œil si le SMTP est configuré/fonctionnel et combien de messages sont en queue.

**Fix:** Ajouter une section "Email / Notifications" au System Status avec :
- État SMTP (configuré / non configuré / erreur de connexion)
- Taille de la queue (pending, failed, total envoyés)
- Dernière erreur d'envoi (si applicable)

**Found during:** Revue utilisateur (mai 2026)
**Severity:** Low — informatif, pas de bug fonctionnel

---

## TD-43 — Descriptions manquantes pour les types de notifications activables

**Context:** Dans les préférences de notifications utilisateur, les différents types de
notifications (share_downloaded, reverse_share_uploaded, etc.) sont listés avec juste un
label court. Il n'y a pas de description expliquant quand chaque notification est déclenchée,
ce qui rend le choix peu intuitif pour l'utilisateur.

**Fix:** Ajouter un texte descriptif sous chaque type de notification dans la modale de
préférences. Ajouter les clés i18n correspondantes dans les 23 locales.

**Found during:** Revue utilisateur (mai 2026)
**Severity:** Low — UX improvement, fonctionnellement correct

---

## TD-44 — Modale notifications: libellé "Alerter si aucun téléchargements après (jours)" confus

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

## TD-41 — Optional per-reverse-share cooldown bypass toggle

**Context:** `reverse_share_uploaded` notifications have a 300-second cooldown
(`cooldownSeconds: 300` in `email/catalog.ts`) to prevent spam from rapid upload sessions.
The `notifyOnUpload` toggle (TD-34) enables/disables notifications per reverse share but
intentionally preserves the cooldown (`overridden: false`).

Some power users (e.g., receiving batch uploads from automated systems) may want to receive
a notification for every upload session without the 5-minute throttle. This would require
a second toggle (e.g., `bypassUploadCooldown`) that only appears when `notifyOnUpload` is
enabled, and returns `overridden: true` from `resolveFrequency` Step 3b.

**Fix:** Add `bypassUploadCooldown` boolean to ReverseShare model (default: `false`).
In `resolveFrequency` Step 3b, return `overridden: bypassUploadCooldown` instead of
`overridden: false`. Add conditional toggle in create/details modals (visible only when
`notifyOnUpload` is on). ~20 lines backend + ~20 lines frontend.

**Found during:** TD-34 implementation review (mai 2026)
**Severity:** Very Low — the default cooldown is sensible; bypass is a niche power-user need
