# Technical Debt — Items to Fix in Future Sessions

> **Voir aussi :** [`SECURITY.md`](SECURITY.md) — findings sécurité (Aikido SAST/SCA) · [`BUGS.md`](BUGS.md) — bugs
> **Archive :** [`TECHNICAL-DEBT-resolved.md`](archive/TECHNICAL-DEBT-resolved.md) — resolved & superseded items

Items discovered during feature work that are out of scope for the current session
but must be addressed. Each item includes context and the fix needed.

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

## TD-52 — 8.3 reverse-share upload tracking : items mineurs reportés

**Context:** Deux items mineurs identifiés pendant l'implémentation de 8.3 lot D (reverse share
upload tracking par destinataire) ont été délibérément reportés plutôt que livrés :

1. **`uploadCount` exposé en API mais non affiché.** Le champ `ReverseShareRecipient.uploadCount`
   est sérialisé dans le DTO et les types web (`reverse-shares/types.ts`), mais l'UI ne montre
   que le badge « A uploadé / En attente » dérivé de `uploadedAt` (booléen). Le compteur n'est
   visible que via l'API. Symétrique au `downloadCount` côté share (également non affiché). À
   surfacer si un besoin d'UI émerge (info-bulle « N fichiers uploadés »).
2. **Pas de test live-DB pour la liaison upload→destinataire.** La couverture actuelle est en
   `app.inject()` (matched / absent / second-upload / spoofed). Le reviewer du plan a noté qu'un
   test contre une vraie base (et non le mock Prisma) renforcerait la confiance sur l'incrément
   atomique `{ increment: 1 }` et le `updateMany({ where: { uploadedAt: null } })` conditionnel.
   Nice-to-have, non bloquant.
3. **Double résolution du destinataire sur le chemin de download (micro-efficience).** Identifié
   par la revue globale Opus (lot C/F). Dans `apps/server/src/modules/file/routes.ts`, les sites
   d'émission de l'audit `FILE_DOWNLOAD` (`:1080-1082`, `:1205-1207`) appellent
   `resolveDownloadRecipientFromRequest` pour enrichir les métadonnées, puis `trackShareDownload`
   (`:200-216`) re-parse le cookie et rappelle `resolveDownloadRecipient` — deux allers-retours
   résolveur indépendants (alias lookup + recipient lookup) pour le même download. Fonctionnellement
   correct, best-effort des deux côtés. Si un jour consolidé : résoudre une seule fois dans le
   handler et passer le résultat à `trackShareDownload`. Aucun changement requis (perf négligeable
   sur un chemin déjà best-effort + fire-and-forget).

**Fix:** (1) ajouter l'affichage du compteur dans `reverse-share-recipient-selector.tsx` si
demandé ; (2) ajouter un test d'intégration live-DB si l'on en met en place un harnais pour
d'autres flux ; (3) consolider la résolution du destinataire en un seul appel par requête de
download si le hot path devient un point chaud.

**Found during:** 8.3 Batch 4 / Batch 5 + revue globale Opus (juin 2026)
**Severity:** Very low — best-effort feature, comportement couvert par les tests `app.inject()`,
aucun bug connu ; les items sont des optimisations/polish, pas des défauts.

---
