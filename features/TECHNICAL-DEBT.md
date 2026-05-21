# Technical Debt — Items to Fix in Future Sessions

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

## TD-6 — Prisma major version upgrade: 6.x → 7.x

**Context:** Prisma CLI reports `Update available 6.19.3 -> 7.8.0` (major version).
Prisma 7 introduces breaking changes to imports, the generated client structure, and
potentially migration behaviour. Requires reading the official migration guide at
`https://pris.ly/d/major-version-upgrade`.

**Packages to update** (in `apps/server/package.json` and `pnpm-workspace.yaml` catalogs):
- `prisma` (devDependency)
- `@prisma/client` (dependency)

**Likely changes:**
- Import paths for `PrismaClient` and generated types may change
- CLI command behaviour / config API may differ
- `prisma.config.ts` API may have additions

**Fix:**
1. Read the Prisma v7 migration guide
2. Update `prisma` + `@prisma/client` in the workspace
3. Adapt imports and any config that changed
4. Run full test suite and `tsc --noEmit`

**Found during:** local dev session (May 2026)
**Severity:** Low (no runtime impact today) — but staying far behind on Prisma majors
accumulates risk and misses bug fixes / performance improvements

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

## TD-11 — Next.js 15 → 16 upgrade

**Context:** Le projet utilise Next.js 15.5.18 (pinned dans `pnpm-workspace.yaml` catalogs).
Next.js 16 est stable (16.2.x au moment de l'écriture). L'upgrade est un changement majeur
qui nécessite une analyse d'impact dédiée.

**Points d'attention :**
- Compatibilité next-intl (actuellement ^4.3.1)
- Changements App Router / middleware
- Dépendances peer (React 19 → ?)
- Turborepo compatibility

**Fix:**
1. Lire le guide de migration Next.js 15 → 16
2. Tester la compatibilité next-intl, shadcn/ui, et autres dépendances critiques
3. Appliquer l'upgrade + corriger les breaking changes
4. Full test suite + type-check + E2E

**Found during:** Revue manuelle (session audit, mai 2026)
**Severity:** Medium — rester sur une version majeure antérieure accumule du retard

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
- `footerUrl` (string, défaut: "https://burgeretcie.fr") — URL du lien

Les deux composants footer (`default-footer.tsx` et `transparent-footer.tsx`) lisent ces configs
via `useSecureConfigValue()`. Les settings apparaissent dans le groupe "general" de la page admin.

Spec: `features/specs/td-14-td-12-footer-backgrounds.md`

---

## ~~TD-15 — Description par défaut de l'application à améliorer~~ ✅ RESOLVED

Resolved in TD session (mai 2026). `appDescription` dans `prisma/seed.js` changé en
"Self-hosted file transfer platform". Fallback `app-info.ts` mis à jour en cohérence.

Commit: `chore(monorepo): update default app description`

---

## TD-16 — Traductions B-17/B-19 perdues dans 22 locales (placeholders EN)

**Context:** Les corrections B-17 (description "Show Home Page") et B-19 (messages stockage)
ont remplacé les traductions existantes dans 22 locales (toutes sauf en-US et fr-FR) par des
placeholders en anglais. Les anciennes traductions étaient certes incorrectes/incomplètes,
mais elles étaient dans la bonne langue. L'anglais est une régression pour les utilisateurs non-EN/FR.

**Fix:** Faire une passe de traduction sur les 22 locales pour les 4 clés modifiées :
- `settings.fields.showHomePage.title`
- `settings.fields.showHomePage.description`
- `settings.fields.maxFileSize.description`
- `settings.fields.maxTotalStoragePerUser.description`

Option : utiliser un outil de traduction automatique ou restaurer les anciens titres depuis git
et n'ajouter que la phrase supplémentaire.

**Found during:** Code review session bugfixes B-8 à B-19 (mai 2026)
**Severity:** Low — app pas en production, les 22 locales ont un placeholder fonctionnel

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
