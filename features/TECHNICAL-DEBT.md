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

## TD-50 — Le site Fumadocs n'est pas déployable via Docker

Le stack Docker n'embarque que 3 services — `storage` (RustFS, 9000), `server`
(Fastify, 3333), `web` (Next.js, 5487). Il n'y a **pas de service `docs`** ni de
cible `docs-runner` dans le `Dockerfile` ; `apps/docs` n'est copié que pour la
validation du workspace pnpm (server-builder) et tourne en autonome (dev port 3001),
absent de `docker-compose.yaml`.

**Fix :** décider comment livrer le site Fumadocs pour l'auto-hébergement — soit
ajouter une cible `docs-runner` au Dockerfile + un service `docs` au compose (avec
route Traefik / port dédié), soit documenter un export statique hébergé ailleurs.
Choisir une option et la câbler.

**Found during:** fix boot-seed B-27 (juin 2026)
**Severity:** Low — la doc est dispo en ligne ; n'impacte que la doc auto-hébergée.

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
