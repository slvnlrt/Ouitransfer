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

## TD-3 — 2FA brute-force gap: no per-account rate limiting on TOTP verification

**Context:** `apps/server/src/modules/auth/service.ts` — `completeTwoFactorLogin()` throws
`UnauthorizedError` on invalid TOTP/backup codes but does NOT call `recordLoginAttempt()`
from `login-attempts.service.ts`. This means the per-account lockout mechanism (10 failed
attempts → 15-minute lock) is bypassed for the 2FA step.

The route-level `rateLimit: { max: 5, timeWindow: "1 minute" }` on `/auth/2fa/login`
(`apps/server/src/modules/auth/routes.ts`) is per-IP only, trivially defeated by rotating IPs.

An attacker who obtains valid credentials (email + password) receives a `challengeToken` and
can then brute-force the 6-digit TOTP code without triggering account lockout.

**Fix:**
1. Call `recordLoginAttempt(emailOrUsername, clientIp)` in `completeTwoFactorLogin()` on
   TOTP/backup code failure (before throwing `UnauthorizedError`)
2. Check `isAccountLocked()` at the start of `completeTwoFactorLogin()` — same pattern as
   the password login path
3. Add integration test verifying that failed 2FA attempts trigger lockout after threshold

**Found during:** B-7/TD session final review (finding I-5)
**Severity:** Medium — security gap, but requires valid credentials as prerequisite

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

## TD-7 — Turborepo minor update: 2.9.6 → 2.9.14

**Context:** `just dev` shows `Update available v2.9.6 ≫ v2.9.14`. This is a patch/minor
update (not a major), so it should be safe to apply directly.

**Fix:**
```
pnpm dlx @turbo/codemod@latest update
```
or manually bump `turbo` in the root `package.json` / workspace.

**Found during:** local dev session (May 2026)
**Severity:** Very low — patch update, no breaking changes expected

---

## ~~TD-9 — 4 unused exported types in `file/dto.ts` (knip)~~ ✅ RESOLVED

After TD-4, `RegisterFileInput`, `CheckFileInput`, `MoveFileInput`, `ListFilesInput` in
`apps/server/src/modules/file/dto.ts` became dead exports (were only used by deleted
`FileController`). Resolved by deleting the 4 `export type` lines — schemas are still used
directly in `file/routes.ts`.

---

## TD-8 — Group API quota fields lack validation (no upper bound, no integer check)

**Context:** The Quota module (`apps/server/src/modules/quota/dto.ts`) validates
`maxFileSizeOverride` and `maxTotalStorageOverride` with:
- Upper bound of 1 PB (`ONE_PB = 1125899906842624n`)
- Integer check (must be a valid BigInt-parseable value)
- Explicit null/0/positive semantics

However, the Group routes (`apps/server/src/modules/group/routes.ts:99-106,133-134`)
use a bare `z.union([z.number(), z.string(), z.null()])` with **no upper bound and no
integer validation**. An admin can `POST /groups` with
`"maxFileSizeOverride": "99999999999999999999"` and the schema accepts it.

**Fix:**
1. Extract a shared Zod schema for BigInt quota fields (used in both Quota and Group modules)
2. Apply the same 1 PB cap and integer validation to Group routes
3. Add a test verifying that oversized values are rejected

**Found during:** Documentation quality review (docs-update session)
**Severity:** Low — no data corruption (Prisma stores as BigInt), but inconsistent
validation between two APIs that manage the same concept

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

## TD-12 — Images background WetTransfer : provenance inconnue

**Context:** Le mode "WetTransfer" des reverse shares affiche une image de fond aléatoire
parmi 8 JPG dans `apps/web/public/assets/wetransfer-bgs/1-8.jpg`. L'origine et la licence
de ces images sont inconnues (potentiellement sous copyright).

**Fix:**
1. Documenter la provenance des images actuelles
2. Remplacer par des images créées en propre ou libres de droits (Unsplash, etc.)
3. Optionnel : permettre à l'admin de configurer ses propres images de fond

**Found during:** Revue manuelle (session audit, mai 2026)
**Severity:** Low — risque légal potentiel si images sous copyright

---

## TD-13 — Pattern i18n fragile : concaténation de clés t() au lieu d'interpolation

**Context:** Dans `reverse-share-card.tsx:467`, le tooltip est composé par concaténation :
```ts
title={`${t("common.click")} ${t("reverseShares.modals.details.activate")}`}
```

Ce pattern suppose que toutes les langues utilisent le même ordre de mots et le même
espacement. Il devrait utiliser l'interpolation next-intl :
```
"clickToAction": "Cliquez pour {action}"
```

**Fix:**
1. Auditer le codebase pour d'autres instances de concaténation `${t()} ${t()}`
2. Remplacer par des clés avec interpolation `{variable}`
3. Mettre à jour les 23 locales

**Found during:** Investigation B-10 (contamination PT, mai 2026)
**Severity:** Low — fonctionne tant que l'ordre des mots est identique, mais fragile pour les langues à ordre inversé (arabe, japonais, etc.)

---

## TD-14 — Footer non configurable (hardcodé)

**Context:** Le footer "Propulsé par Burger&Cie" est hardcodé dans 2 fichiers :
- `apps/web/src/components/ui/default-footer.tsx`
- `apps/web/src/app/(shares)/r/[alias]/components/transparent-footer.tsx`

L'URL, le nom de la société, et l'affichage ne sont pas configurables par l'admin.

**Fix:**
1. Ajouter 3 settings dans la config : `footerEnabled` (bool), `footerText` (string), `footerUrl` (string)
2. Seeder avec les valeurs par défaut (Burger&Cie + burgeretcie.fr)
3. Exposer dans la page settings/general
4. Modifier les 2 composants footer pour lire la config
5. Ajouter les clés i18n pour les labels des settings

**Found during:** Revue manuelle (session audit, mai 2026)
**Severity:** Low — configurable est préférable, mais le hardcodé fonctionne

---

## TD-15 — Description par défaut de l'application à améliorer

**Context:** Le seed (`prisma/seed.js:27-31`) initialise `appDescription` avec
"Secure and simple file sharing - Your personal cloud". Ce texte est générique et peu
descriptif du produit.

**Fix:** Changer la description seedée vers quelque chose de plus pertinent et professionnel.
Suggestion : "Self-hosted file transfer solution" ou "Plateforme de transfert de fichiers auto-hébergée".

**Found during:** Revue manuelle (session audit, mai 2026)
**Severity:** Very low — modifiable par l'admin dans settings, le seed est juste le défaut initial
