# Technical Debt — Items to Fix in Future Sessions

> **Voir aussi :** [`SECURITY.md`](SECURITY.md) — findings sécurité (Aikido SAST/SCA) · [`BUGS.md`](BUGS.md) — bugs
> **Archive :** [`TECHNICAL-DEBT-resolved.md`](archive/TECHNICAL-DEBT-resolved.md) — resolved & superseded items

Items discovered during feature work that are out of scope for the current session
but must be addressed. Each item includes context and the fix needed.

---

## TD-53 — Email health: stalled-queue blind spot (processing/pending false-negative) ✅ DONE

**Resolved:** 2026-06-16

**Context:** The cheap, queue-counter-based `evaluateEmailHealth` (TD-42) derived its status from
recent failures + recent sends only. A genuine stall where SMTP hangs and jobs pile up in
`processing` (until `recoverStuckJobs` times them out), or a large `pending` backlog with zero
outright failures, both still reported **`ok`**.

**Fix applied (`apps/server/src/modules/email/health.ts`):** Added an oldest-unsent-job stall
signal to the `degraded` derivation, keyed off the insight that the worker drains the queue
**oldest-first** — while it is running the oldest *ready* job stays young, so a ready job that ages
past a window means the worker is not draining (not merely a large backlog). Two cheap DB counts
feed the signal:
- `pending` jobs with `nextAttemptAt <= now − 15min` (ready to send but never picked up), and
- `processing` jobs with `lockedAt <= now − 15min` (locked for delivery on a hung/frozen worker).

Either trips `degraded`. The 15-minute window sits well above the queue's 5-minute
stuck-`processing` recovery window and several poll intervals, so it only fires on a genuinely
frozen worker and never flaps under bursty load or a slow poll interval. Still **no live SMTP
probe** (the `/health` endpoints stay public/cheap). The public `EmailHealth` interface and
`lastError` semantics are unchanged; `down` keeps precedence over a concurrent stall. Self-heals to
`ok` once the worker resumes and the backlog clears. 6 new unit tests in `health.test.ts`.

**Found during:** TD-42 Opus second-pass review (juin 2026, finding #3). Findings #1 (stale
`lastError`) and #2 (retention-window `failed` false-positive) were fixed in the same session by
windowing the failure signals to a recent 24h period; #4 (public enum exposure) accepted per spec.

**Severity:** Low — a bounded false-negative (stuck jobs self-recover via the timeout); less harmful
than the false-positives already fixed.

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

## TD-20 — Docs : section Developers à réécrire ✅ DONE

**Resolved:** 2026-06-16

**Note de contexte :** le TD pointait `apps/docs/content/docs/v3-beta/` (chemin inexistant) ; les
pages vivent en réalité sous `v1-beta/`, en EN + FR. Une vérification page par page contre le code
a montré que les pages avaient déjà été largement maintenues entre-temps (session i18n docs +
réconciliation red-team), et non « toutes obsolètes ». La résolution a donc consisté à **vérifier
chaque page contre la vérité terrain et corriger les inexactitudes réelles**, plutôt qu'à réécrire
du contenu correct.

**Vérification + corrections :**
- `architecture.mdx` — corrigé : passage de **3 à 4 conteneurs** (ajout du conteneur `docs` de
  TD-50 : diagramme mermaid, prose, table, ordre de démarrage indépendant), noms d'images réels
  (`ghcr.io/slvnlrt/ouitransfer-*`), description `/health` alignée (liveness grossier + détail par
  sous-système sur `/health/status` authentifié), `fastify-type-provider-zod` →
  `@fastify/type-provider-zod` (post-TD-28).
- `github-architecture.mdx` — corrigé : liste des modules (`s3-storage` inexistant retiré ;
  `cleanup` + `notification` ajoutés ; note sur les modules sans route HTTP), ajout de l'étape CI
  **Prisma migration drift check** (TD-48), conteneur **docs** intégré au pipeline de release
  (stack 4 conteneurs, health-check `/docs`, publication GHCR `ouitransfer-docs`).
- `api.mdx` — **vérifié à jour** : la couverture des routes correspond aux modules enregistrés dans
  `server.ts` (quickshare réutilise `/shares`, aucune route dédiée), références récentes correctes
  (`authenticated_user`/B-29, enum email health, `/health/status` authentifié). Aucune correction
  nécessaire.
- `translation-management.mdx` — **vérifié à jour** : scripts Python (`run_translations.py`,
  `sync`/`check`/`prune`) et scripts `pnpm run translations:*` conformes ; 23 fichiers de langue
  présents (22 cibles + `en-US` de référence). Aucune correction nécessaire.

Corrections appliquées en EN + FR (4 fichiers modifiés). Build docs vert (83 pages) ; aucun em-dash
introduit.

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

## TD-42 — Dashboard System Status: afficher l'état SMTP/notifications ✅ DONE

**Resolved:** 2026-06-13

**Implemented** the Email / Notifications subsystem in the System Status bar, with the two
audience tiers used elsewhere (spec + plan + review: `features/{specs,plans,reviews}/td-42-system-status-email.md`):

- **Health model** — `EmailHealthStatus = "ok" | "disabled" | "degraded" | "down"`, derived purely
  from cheap queue counters + the `smtpEnabled` config flag (no live SMTP probe, since `/health`
  and `/health/status` are public/unauthenticated). `disabled` = SMTP off; `down` = enabled with
  failed jobs and nothing sent in 24h; `degraded` = enabled with failed jobs but mail still going
  out; `ok` otherwise.
- **Server** — new `apps/server/src/modules/email/health.ts` (`evaluateEmailHealth()`); `/health`
  (`checks.email`) and `/health/status` expose ONLY the coarse enum (no counters leak); the
  aggregate `status` stays DB+storage-only (the core product works even when email is down).
  `GET /admin/email/stats` enriched with `status` + `smtpConfigured` + `lastError` (admin-gated).
- **User view** — a single line, shown only on a problem: "Notifications disrupted" (degraded) /
  "Notifications offline" (down); nothing when ok/disabled. The status dot is bumped to `degraded`
  (never `unhealthy`) client-side so the user notices even when collapsed.
- **Admin view** — full "Email / Notifications" section: SMTP/status indicator, queue counters
  (pending / failed / sent 24h), and the last send error (tooltip).
- **i18n** — `dashboard.systemStatus.email.*` across all 23 locales, fully translated (TD-36 not
  reopened).
- **Tests** — `evaluateEmailHealth` (4 states + lastError), health endpoints `email` field,
  enriched `/admin/email/stats`, and the two views + dot-bump (incl. loading-suppression and
  no-downgrade-of-unhealthy cases). Server 1631 / web 359, all green.
- **Review** — 0 Critical / 0 Important / 3 Minor, all fixed (dead i18n keys removed, `aria-hidden`
  on decorative status icons, `tabular-nums` dropped from the free-form error text).

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

**Addendum (5.5 LDAP Directory Browser, juin 2026) :** la feature 5.5 a ajouté le namespace
`ldap.browse.*` (20 clés) dans les 23 locales. `en-US` et `fr-FR` sont traduits ; les 21 autres
locales portent les valeurs anglaises en placeholder, suivant le même pattern que ci-dessus (parité
structurelle assurée par `locale-keys.test.ts`). Ces 21 placeholders rejoignent le périmètre TD-36 —
à traduire dans la même passe que le reste.

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
