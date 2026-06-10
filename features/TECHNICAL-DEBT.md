# Technical Debt — Items to Fix in Future Sessions

> **Voir aussi :** [`SECURITY.md`](SECURITY.md) — findings sécurité (Aikido SAST/SCA) · [`BUGS.md`](BUGS.md) — bugs
> **Archive :** [`TECHNICAL-DEBT-resolved.md`](archive/TECHNICAL-DEBT-resolved.md) — resolved & superseded items

Items discovered during feature work that are out of scope for the current session
but must be addressed. Each item includes context and the fix needed.

---

## TD-5 — Audit needed: other "infrastructure set up but not used" patterns ✅ DONE

**Resolved:** 2026-06-10

**Audit completed — all 6 checklist items reviewed:**
- [x] TypeScript type-safety gaps where `as` casts mask schema drift — **61 casts found**, 2 dangerous + 18 suspicious. Fixed 7 highest-priority ones.
- [x] Fastify lifecycle hooks properly typed — **No issues found**. All hooks use correct `FastifyRequest`/`FastifyReply` types.
- [x] Prisma client type inference — **1 issue**: `share.deactivationReason as DeactivationReason` (String? → union cast). Deferred to separate TD — requires Prisma enum migration.
- [x] Zod schemas shared vs duplicated — **No duplication found**. Routes consistently import from `dto.ts`.
- [x] Middleware/plugins losing type information — **1 issue**: CSRF `getToken` dropped `string[]` possibility. Fixed.
- [x] Review all `as` casts — **Full audit** of 61 casts across production code.

**Fixes applied (commit `0f37724`):**
1. CSRF `getToken` — handle `string | string[]` header properly (`app.ts`)
2. Challenge token `userId` — add runtime type guard instead of `as string` (`auth/challenge.ts`)
3. Header string casts — `headerString()` utility handles `string[]` (`auth-cookies.ts`)
4. Created `isNotificationKey()` type guard — eliminates 4 `as NotificationKey` casts (`email/catalog.ts`)
5. Used `isNotificationKey()` in `notification/service.ts` (2 sites) and `notification/routes.ts` (1 site)
6. Used `isNotificationKey()` in `email/service.ts` (1 site)
7. Removed redundant body/query casts in `notification/routes.ts` (Zod type provider already types them)

**Remaining items — ALL RESOLVED (2026-06-10 afternoon):**
- ~~`share.deactivationReason as DeactivationReason`~~ — Done: Prisma enum migration + cast removed
- ~~`email/catalog.ts` `payloadSchema: z.ZodType` erases generic type~~ — Done: `defineNotification<T>()` builder + `NotificationTypeConfig<T>` generic
- ~~`error-handler.ts:172` double-escape `as unknown as`~~ — Done: imported `ZodFastifySchemaValidationError` from FTPZ
- ~~`s3-storage.provider.ts:190` `response.Body as NodeJS.ReadableStream`~~ — Done: `Readable.from()` + `AsyncIterable<Uint8Array>`

**Found during:** 5.3 LDAP post-fix review remediation
**Severity:** Low-Medium — architectural hygiene, no runtime bugs

---

## TD-10 — Routes admin inconsistantes (/users-management vs /admin/ldap) ✅ DONE

**Resolved:** 2026-06-10

**Changes:**
- Moved `users-management/` → `admin/users/`, `groups-management/` → `admin/groups/`, `settings/` → `admin/settings/`
- Simplified `adminPaths` to single `/admin` wildcard entry (prefix matching covers all sub-routes)
- Fixed missing `/admin/audit` in admin path list (was relying solely on client-side `<ProtectedRoute>`)
- Updated navbar hrefs, LDAP group mapping link, cross-directory imports, proxy tests
- All 334 web tests passing, type-check + lint clean

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

## TD-28 — Migration globale Zod v3 → v4 ✅ DONE

**Resolved:** 2026-06-10

**Migration completed:**
- Upgraded `zod` from `3.25.76` to `4.4.3` (unified across all apps — removed the `zod@^4.0.0` override)
- Switched from `fastify-type-provider-zod@4.0.2` to `@fastify/type-provider-zod@1.0.0` (official Fastify org package)
- Updated all 26 import sites (22 source + 4 test files) from `"fastify-type-provider-zod"` to `"@fastify/type-provider-zod"`
- Fixed Zod v4 breaking changes: `z.NEVER` → `undefined as never`, `z.ZodIssueCode.custom` → `"custom"` (14 uses), `z.record(z.string())` → `z.record(z.string(), z.string())`, `required_error`/`invalid_type_error` → `error` function, `z.coerce.number()` pipe → `.transform(Number).pipe(z.number())`
- Updated error handler (`error-handler.ts`) for new FTPZ v1 validation shape (instancePath-based paths, flat message)
- Fixed test that relied on Zod v3's lenient `min(NaN)` behavior (`auth-lockout.integration.test.ts`)
- All 1947 tests passing (1599 server + 334 web + 14 shared), lint clean, type-check clean
- `.describe()` (620 uses) left as-is — deprecated but functional in v4, not a breaking change

**Commits:** `b983e8d`, `3b5983b`, `a91bc90`
**Plan:** `features/plans/td-28-zod-v4-migration.md`

---

---

## TD-32 — Sender locale used for external recipient invitation emails ✅ CLOSED (accepted)

**Resolved:** 2026-06-10

**Decision:** Accepted as current behavior (option 3). Sender locale is the best available
heuristic — external recipients have no account and thus no locale preference. Same-organization
sharing typically shares a common language. If per-recipient locale override is needed in the
future, add an optional `locale` field to `ShareRecipient` at that time.

**Found during:** 8.2 review pass 5 (mai 2026)
**Severity:** Low — sender locale is a reasonable heuristic for same-organization sharing

---

## TD-33 — Email subject frozen at enqueue time — admin `appName` changes invisible on queued jobs ✅ CLOSED (accepted)

**Resolved:** 2026-06-10

**Decision:** Accepted as inherent design trade-off (option 3). The queue processes quickly
and `appName` changes are rare admin events. The window where stale subjects could be sent
is negligible. Deferring `appName` lookup to send time would add complexity with no practical
benefit.

**Found during:** 8.2 review pass 5 (mai 2026)
**Severity:** Very low — cosmetic edge case with negligible real-world impact

---


## TD-40 — Global error boundary hardcoded in English — no i18n possible — Done

**Status:** Done (juin 2026)

Added a static inline translation map to `apps/web/src/app/global-error.tsx` covering all
23 supported locales (4 strings each: title, description, tryAgain, goHome). Locale is
detected from the `NEXT_LOCALE` cookie or `navigator.language`, with English fallback.
RTL `dir` attribute set for ar/fa/he.

No runtime i18n provider dependency — the translations are fully inlined.

**Found during:** Deferred work audit (mai 2026, AR-5)
**Severity:** Very Low — resolved

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

## TD-43 — Descriptions manquantes pour les types de notifications activables ✅ DONE

**Resolved:** 2026-06-10

**Changes:**
- Added `descriptions` sub-namespace under `notificationPreferences` in all 23 locale files
- Each of the 18 configurable notification types now has a description explaining when it triggers
- `en-US.json`: English descriptions, `fr-FR.json`: French translations, 21 other locales: English placeholders
- Updated `notification-preferences-table.tsx` to render descriptions as muted secondary text below each type label
- All 334 web tests passing, type-check + lint clean

**Found during:** Revue utilisateur (mai 2026)
**Severity:** Low — UX improvement, fonctionnellement correct

---

## TD-36 — Strings non traduites dans 21 locales (scope élargi) ✅ DONE

**Resolved:** 2026-06-10

**Changes:** Translated all 196 untranslated keys across 21 locales (3 batches: EU, MENA/EE, Asia/RU). Plus 18 notification description keys (TD-43 overlap). Total: ~4500 translations. Also migrated 25 `z.string().email()/url()` → `z.email()/z.url()` (Zod v4 modernization).

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
| `share.identification.privacyNotice`, `reverseShares.upload.form.privacyNotice` | 2 | 8.3 Download Tracking (RGPD) |
| **Total**        | **~149 / 1960**    | ~7.5% du total    |

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

## TD-52 — 8.3 reverse-share upload tracking : items mineurs reportés ✅ CLOSED (accepted)

**Resolved:** 2026-06-10

**Decision:** All three items accepted as current behavior — all are very low severity
optimizations/polish with no bugs:
1. `uploadCount` visible via API but not in UI — symmetric with `downloadCount`. Surface in UI
   only if a user need emerges.
2. No live-DB test for upload→recipient linking — covered by `app.inject()` integration tests.
   Add live-DB test only if a test harness is set up for other flows.
3. Double recipient resolution on download path — functionally correct, negligible perf impact
   on a best-effort fire-and-forget path.

**Found during:** 8.3 Batch 4 / Batch 5 + revue globale Opus (juin 2026)
**Severity:** Very low — all items are optimizations/polish, not defects

---
