# Bug Report — Session 3 (post 6.x overhaul testing)

> Bugs découverts lors du premier test de `just dev` après la session de refactor 6.x.
> Certains préexistaient à cette session (jamais testés avant).
> **Aucune correction effectuée ici — ce fichier prépare la session de correction.**

---

## B-1 — Health check : 503 en dev (stockage non joignable)

**Symptôme :** Dashboard affiche _"Health status unavailable / Unable to retrieve system health information"_. Le endpoint `/health` retourne 503.

**Analyse :**
Le contrôleur (`apps/server/src/modules/health/controller.ts`) retourne 503 dès que le champ `storage` vaut `"error"` (et non `"ok"` ou `"not_configured"`). En dev avec `just dev`, le service de stockage RustFS n'est pas démarré automatiquement — le `HeadBucketCommand` S3 échoue donc → `storage = "error"` → statut global `"degraded"` → 503.

**Pistes de correction :**
- Option A (recommandée) : Traiter le cas où le stockage n'est pas joignable en dev comme `not_configured` plutôt que `error` lorsque S3 est configuré mais inaccessible. Ou bien : ajouter un flag dans `just dev` pour démarrer RustFS.
- Option B : La page d'accueil du dashboard devrait tolérer une santé dégradée et afficher les infos partielles plutôt qu'un message d'erreur total.
- Option C : Documenter dans le README dev que RustFS doit tourner pour un dev complet.

**Fichiers concernés :**
- `apps/server/src/modules/health/controller.ts`
- `apps/web/src/app/dashboard/components/system-health.tsx`
- Potentiellement `Justfile` (recette `dev`)

---

## B-2 — i18n manquant : `settings.fields.embedSecret.title` / `.description`

**Symptôme :** Erreur Next.js dans la page `/settings` :
```
MISSING_MESSAGE: Could not resolve `settings.fields.embedSecret.description`
  in messages for locale `fr-FR`.
```
Idem pour `.title`.

**Analyse :**
Le champ `embedSecret` est un vrai paramètre en base (généré dans `prisma/seed.js:59` via `crypto.randomBytes(32).toString("hex")`). Il est affiché dans les Settings via `settings-group.tsx` qui cherche dynamiquement `settings.fields.${config.key}.title` et `settings.fields.${config.key}.description`.

Le problème : `settings.fields.embedSecret` n'existe pas du tout dans `en-US.json` (la section `settings.fields` s'arrête à `passwordAuthEnabled` ligne 1426). La clé est absente de toutes les locales. Le `defaultValue` dans le code empêche le crash dans `description`, mais `title` n'a pas de fallback → erreur visible.

**Correction :**
Ajouter dans `en-US.json` sous `settings.fields` :
```json
"embedSecret": {
  "title": "Embed Token Secret",
  "description": "Secret key used to sign embed tokens for public file previews. Change this to invalidate all existing embed links."
}
```
Puis propager aux 22 autres locales (valeurs anglaises en attendant traduction).

**Fichiers concernés :**
- `apps/web/messages/en-US.json` (+ 22 autres locales)
- `apps/web/src/app/settings/components/settings-group.tsx` (vérifier la gestion du fallback pour `title`)

---

## B-3 — Upload de fichier cassé : "Unknown error" Uppy

**Symptôme :** L'upload échoue avec `[Uppy] "Unknown error"` dans la console. Logs serveur :
```
POST /api/files/check → 201 ✓
GET  /api/files/presigned-url?... → 200 ✓
```
Le PUT vers S3 (direct depuis le navigateur) échoue silencieusement.

**Analyse :**
Les deux étapes côté serveur réussissent. L'échec se passe lors du PUT Uppy → RustFS directement (upload multipart signé S3). En dev :
- Si RustFS n'est pas démarré : le PUT vers `localhost:<port-rustfs>` échoue → Uppy reçoit `net::ERR_CONNECTION_REFUSED` ou une réponse vide → `"Unknown error"`.
- Si RustFS est démarré mais le bucket n'est pas créé, ou si l'URL presignée pointe vers le mauvais host : même symptôme.
- Le log `[Upload] Upload failed {}` avec un objet vide confirme qu'Uppy ne reçoit pas de message d'erreur structuré du serveur S3.

**Pistes :**
- Vérifier que `just dev` démarre (ou nécessite) RustFS.
- Vérifier la configuration de l'URL S3 dans les env dev (le presigned URL doit pointer vers une adresse joignable depuis le navigateur, pas uniquement depuis le serveur).
- Améliorer la gestion d'erreur dans `use-uppy-upload.ts` pour afficher un message explicite quand la connexion au stockage échoue (plutôt que `{}`).

**Fichiers concernés :**
- `apps/web/src/hooks/use-uppy-upload.ts` (autour de la ligne 504 — `handleError`)
- Configuration S3 dev (`.env.local` ou équivalent)
- `Justfile` (recette `dev`)

---

## B-4 — UI/Grid : fond gris dans les cards du dashboard

**Symptôme 1 (Quick Access Cards) :** Les trois cards de la section "accès rapide" du dashboard ont un "container gris" en fond à l'intérieur des cards qui s'adapte à la taille du texte, au lieu de remplir la hauteur totale de la card.

**Symptôme 2 (System Health en erreur) :** La card System Health en état d'erreur devient très haute (car `ErrorDisplay` est verbeux). La card `StorageUsage` adjacente (sur la même ligne de grid) s'étire à la même hauteur mais son contenu ne remplit pas, laissant un fond vide/visible.

**Analyse :**
- Le grid `md:grid-cols-2` aligne StorageUsage et SystemHealth sur la même ligne. Le CSS grid aligne les items en `align-items: stretch` par défaut → les deux cards s'étendent à la hauteur maximale. Le contenu intérieur de `StorageUsage` (progress bar + 2 lignes) ne remplit pas verticalement la card étirée → fond de card visible.
- Pour les Quick Access Cards : le `CardContent className="h-full"` avec inner `div h-full flex items-center` devrait centrer verticalement, mais la carte elle-même n'a peut-être pas `h-full` sur le wrapper. Le `bg-primary/5 dark:bg-accent/60` (icon container) est fixe `w-12 h-12` et ne devrait pas poser problème — à investiguer ce qui cause le fond gris visible.

**Pistes :**
- Pour StorageUsage/SystemHealth grid : utiliser `items-start` sur le grid parent (les cards ne s'étirent plus), OU rendre le contenu de chaque card flexible verticalement avec `flex-1`.
- Pour Quick Access Cards : investiguer le wrapper de `CardContent` et si la card a `h-full` au bon niveau.

**Fichiers concernés :**
- `apps/web/src/app/dashboard/page.tsx` (grid alignment)
- `apps/web/src/app/dashboard/components/quick-access-cards.tsx`
- `apps/web/src/app/dashboard/components/storage-usage.tsx`
- `apps/web/src/components/ui/card.tsx` (vérifier styles post-6.3)

---

## B-5 — UI/Grid : problèmes de layout sur la page /Settings

**Symptôme :** Problèmes de grid/remplissage et padding des containers grids sur `/settings`.

**Analyse :**
Pas d'investigation approfondie effectuée. La page settings utilise `PageLayout` (ajouté en Task 7) puis `SettingsForm` qui rend des `SettingsGroup` en colonnes. Potentiellement lié au padding du `PageLayout` ou à des classes de grid dans `settings-form.tsx`.

**À investiguer :**
- Inspecter le rendu de `/settings` en dev
- Comparer le layout avec les autres pages utilisant `PageLayout`
- Vérifier `apps/web/src/app/settings/components/settings-form.tsx`

**Fichiers probables :**
- `apps/web/src/app/settings/components/settings-form.tsx`
- `apps/web/src/components/layout/page-layout.tsx`

---

## B-6 — Logo applicatif cassé (image brisée sans fallback)

**Symptôme :** L'image "App Logo" par défaut est cassée. La page de garde affiche l'icône d'image brisée au lieu d'un fallback propre. Potentiellement pareil pour le favicon.

**Analyse :**
- Le seed (`prisma/seed.js:33`) initialise `appLogo` avec `""` (chaîne vide).
- Dans la navbar home (`apps/web/src/app/(home)/components/navbar.tsx:18`) : `{appLogo && <Image src={appLogo} ... />}` — si `appLogo` est `""`, l'expression est falsy et l'image ne s'affiche pas. Pas de broken image attendu dans ce cas.
- **Hypothèse principale** : soit la DB existante contient une valeur d'`appLogo` non vide mais invalide (URL d'un fichier qui n'existe plus), soit le context `useAppInfo` retourne une valeur par défaut non-vide. À vérifier dans `apps/web/src/contexts/app-info-context.tsx`.
- **Fallback manquant** : même si la valeur est invalide, Next.js `<Image>` avec `unoptimized` ne gère pas nativement le fallback. La navbar authentifiée (`navbar.tsx`) utilise `<img>` (pas Next Image) — même absence de fallback `onError`.

**Pistes :**
- Vérifier la valeur réelle de `appLogo` dans la DB de dev (`just db-studio`).
- Vérifier `apps/web/src/contexts/app-info-context.tsx` — y a-t-il une valeur par défaut non-vide ?
- Ajouter un `onError` handler sur les deux balises image de logo pour basculer vers un fallback (icône SVG inline ou `null`).
- Vérifier le favicon : probablement `apps/web/src/app/layout.tsx` — si le favicon pointe vers une URL dynamique.

**Fichiers concernés :**
- `apps/web/src/contexts/app-info-context.tsx`
- `apps/web/src/app/(home)/components/navbar.tsx`
- `apps/web/src/components/layout/navbar.tsx`
- `apps/web/src/app/layout.tsx` (favicon)

---

## Priorité de correction

| Bug | Sévérité | Impact | Statut |
|-----|----------|--------|--------|
| B-3 Upload cassé | **Critique** | Fonctionnalité principale inopérante | **Corrigé** (7.1) |
| B-2 i18n embedSecret | **Haute** | Erreur visible dans settings (toutes locales non-EN) | **Corrigé** (7.1) |
| B-1 Health 503 | **Moyenne** | Dashboard dégradé en dev (RustFS non démarré) | **Corrigé** (7.1) |
| B-6 Logo cassé | **Moyenne** | UX dégradée, image brisée visible | **Corrigé** (7.1) |
| B-4 Grid dashboard | **Basse** | Visuel, pas fonctionnel | **Corrigé** (7.1) |
| B-5 Grid settings | **Basse** | Visuel, pas fonctionnel | **Corrigé** (7.1) |

---

## B-7 — Login : "Erreur inattendue" quand mot de passe < 8 caractères

**Symptôme :** Sur la page `/login`, saisir un mot de passe de moins de 8 caractères et soumettre affiche "Erreur inattendue" (ou équivalent i18n). Le serveur retourne un 400 Bad Request (mot de passe trop court — validation Zod côté route).

**Analyse :**
Le schéma Zod de la route `/auth/login` exige un `password` avec `min(passwordMinLength)` (8 par défaut via AppConfig). Quand le mot de passe est trop court, Fastify retourne une 400 avec `VALIDATION_ERROR`. Le hook `use-login.ts` ne gérait que `UNAUTHORIZED` dans son catch — `VALIDATION_ERROR` tombait dans le `else` et affichait "erreur inattendue".

**Correction :** Ajout de `|| apiError.code === ErrorCodes.VALIDATION_ERROR` dans la condition qui affiche "identifiants invalides". Le formulaire de login ne doit JAMAIS divulguer d'information sur la politique de mot de passe (pas de min-length côté client, pas de message distinct) — c'est une mesure de sécurité.

**Fichiers modifiés :**
- `apps/web/src/app/login/hooks/use-login.ts` (ligne 156-158)

---

## Priorité de correction

| Bug | Sévérité | Impact | Statut |
|-----|----------|--------|--------|
| B-3 Upload cassé | **Critique** | Fonctionnalité principale inopérante | **Corrigé** (7.1) |
| B-2 i18n embedSecret | **Haute** | Erreur visible dans settings (toutes locales non-EN) | **Corrigé** (7.1) |
| B-1 Health 503 | **Moyenne** | Dashboard dégradé en dev (RustFS non démarré) | **Corrigé** (7.1) |
| B-6 Logo cassé | **Moyenne** | UX dégradée, image brisée visible | **Corrigé** (7.1) |
| B-7 Login validation | **Moyenne** | UX dégradée, message d'erreur non informatif | **Corrigé** (B-7/TD) |
| B-4 Grid dashboard | **Basse** | Visuel, pas fonctionnel | **Corrigé** (7.1) |
| B-5 Grid settings | **Basse** | Visuel, pas fonctionnel | **Corrigé** (7.1) |

---

## B-8 — `ldapDn` non settable sur les Groups (ni UI, ni API)

**Symptôme :** Le spec 5.3 (lignes 191-193) prévoit que les admins puissent éditer le champ `ldapDn` d'un groupe dans le formulaire Groups Management ("set LDAP DNs in group management"). Le champ `ldapDn` existe bien sur le modèle `Group` dans le schema Prisma, mais :

1. **L'UI** ne l'expose pas — `group-form-modal.tsx` n'inclut pas de champ LDAP DN
2. **L'API** ne l'accepte pas — le body schema de `POST /groups` et `PUT /groups/:id` dans `routes.ts:96-107,130-135` n'inclut pas `ldapDn`
3. La page LDAP (`ldap-group-mapping.tsx:61`) affiche le `ldapDn` en read-only

Le seul moyen actuel de configurer le mapping groupe→AD est un accès direct à la base de données.

**Correction (phase 1 — saisie manuelle) :**
1. Ajouter `ldapDn` au body schema des routes `POST /groups` et `PUT /groups/:id` (nullable string, optionnel)
2. Propager dans le controller/service
3. Ajouter un champ texte `ldapDn` dans `group-form-modal.tsx` (saisie manuelle du DN)
4. Tests : intégration `app.inject()` + test unitaire service

**Évolution future (phase 2) :** Remplacer le champ texte par un dropdown qui interroge le serveur LDAP configuré pour lister les groupes AD disponibles. Nécessite une connexion LDAP active.

**Fichiers concernés :**
- `apps/server/src/modules/group/routes.ts` (body schemas)
- `apps/server/src/modules/group/controller.ts`
- `apps/server/src/modules/group/service.ts`
- `apps/web/src/app/groups-management/components/group-form-modal.tsx`

**Découvert pendant :** Review qualité des docs (session docs-update)
**Sévérité :** Moyenne — la feature LDAP group mapping est documentée mais non fonctionnelle via l'UI

---

> Tous les bugs B-1 à B-6 ont été résolus dans le cadre de la feature 7.1 (Error Handling & Dashboard Redesign).
> B-1/B-4 résolus par le remplacement de SystemHealth+StorageUsage par le composant unifié SystemStatus.
> B-3 résolu par l'intégration de parseApiError dans use-uppy-upload (détection réseau + stockage) + détection des erreurs XHR réseau Uppy (error.source.status === 0).
> B-2 résolu par ajout des clés i18n manquantes dans les 23 locales.
> B-5 résolu par ajout de breakpoints responsive aux grids des formulaires auth-provider.
> B-6 résolu par ajout d'un handler onError sur l'image logo dans la navbar.
> B-7 résolu dans la session B-7/TD : VALIDATION_ERROR traité comme "identifiants invalides" (pas de divulgation de politique mdp).

---

## B-9 — `GET /auth/providers/all` → 500 ResponseSerializationError (clientId null)

**Symptôme :** La page `/settings` déclenche une erreur 500 au chargement. Le serveur log un `ResponseSerializationError` : le champ `clientId` est `null` dans la DB mais le schema Zod de réponse exige `z.string()` (non-nullable).

**Analyse :**
- Prisma schema : `clientId String?` (nullable) — correct, les providers seedés n'ont pas de clientId configuré.
- Les 9 providers officiels sont seedés sans `clientId` (`prisma/seed.js:170-336`).
- `AuthProviderResponseSchema` dans `routes.ts:202` déclare `clientId: z.string()` au lieu de `z.string().nullable()`.
- Problème secondaire : le service `getAllProviders()` ajoute un champ `isOfficial` qui est absent du schema de réponse → silencieusement strippé par la sérialisation Zod.

**Correction :**
1. Changer `clientId: z.string()` → `clientId: z.string().nullable()` dans `AuthProviderResponseSchema`
2. Ajouter `isOfficial: z.boolean()` au schema si le frontend en a besoin

**Fichiers concernés :**
- `apps/server/src/modules/auth-providers/routes.ts` (ligne 202)

**Sévérité :** Haute — bloque le chargement de la page settings pour tous les admins

---

## B-10 — Contamination portugaise dans `fr-FR.json` (6 clés)

**Symptôme :** Textes en portugais affichés quand la locale est française. Exemples : "Clique para Activer" (tooltip), "Criando..." (bouton de création), "Processando autenticação..." (login SSO).

**Analyse :** 6 clés dans `apps/web/messages/fr-FR.json` contiennent des valeurs copiées de `pt-BR.json` :

| Ligne (fr-FR) | Clé | Valeur actuelle (PT) | Correction (FR) |
|----------------|-----|----------------------|-----------------|
| 165 | `common.click` | `Clique para` | `Cliquez pour` |
| 166 | `common.creating` | `Criando...` | `Création en cours...` |
| 621 | `login.continueWithSSO` | `Continuar com SSO` | `Continuer avec SSO` |
| 622 | `login.processing` | `Processando autenticação...` | `Traitement de l'authentification...` |
| 2142 | `validation.nameRequired` | `Nome é obrigatório` | `Le nom est requis` |
| 2143 | `validation.required` | `Este campo é obrigatório` | `Ce champ est requis` |

De plus, la section `ldap.*` (lignes 2210-2296) est entièrement en anglais (non traduite).

**Contamination cross-locale :** Les clés SSO sont contaminées dans d'autres locales aussi :

| Clé | Locales contaminées (hors pt-BR) |
|-----|----------------------------------|
| `login.continueWithSSO` (`Continuar com SSO`) | fr-FR, tr-TR, nl-NL, hi-IN, es-ES |
| `login.processing` (`Processando autenticação...`) | fr-FR, tr-TR, nl-NL, hi-IN, es-ES |

→ Lors de la correction, vérifier systématiquement les 23 locales pour chacune des 6 phrases PT (grep chaque phrase dans tous les .json).

**Correction :** Remplacer les 6 valeurs PT par les traductions correctes dans toutes les locales affectées. Traduire la section LDAP en FR.

**Fichiers concernés :**
- `apps/web/messages/fr-FR.json` (6 clés + section LDAP)
- `apps/web/messages/tr-TR.json` (2 clés SSO)
- `apps/web/messages/nl-NL.json` (2 clés SSO)
- `apps/web/messages/hi-IN.json` (2 clés SSO)
- `apps/web/messages/es-ES.json` (2 clés SSO)

**Sévérité :** Moyenne — UX dégradée pour les utilisateurs de 5 locales

---

## B-11 — Traduction FR incorrecte : "Exigences sur le terrain" pour "Field Requirements"

**Symptôme :** Dans la modale de création de reverse share et les cartes, "Field Requirements" est traduit "Exigences sur le terrain" (terrain physique) au lieu de "Exigences de champs" (champs de formulaire). Même problème pour "Exigence de champ de messagerie" (confus — devrait être "Adresse email").

**Clés concernées dans `fr-FR.json` :**
- Ligne 885 : `reverseShares.card.fieldRequirements` → "Exigences sur le terrain"
- Ligne 1138 : `reverseShares.form.fieldRequirements.title` → "Exigences sur le terrain"
- Ligne 1146 : `reverseShares.form.nameFieldRequired.label` → "Exigence de champ de nom"
- Ligne 1134 : `reverseShares.form.emailFieldRequired.label` → "Exigence de champ de messagerie"

**Correction :**
- "Exigences sur le terrain" → "Exigences de champs"
- "Exigence de champ de nom" → "Champ nom"
- "Exigence de champ de messagerie" → "Champ email"
- Ajouter des descriptions explicatives (ex: "Rendre le champ nom obligatoire, optionnel, ou masqué")

**Fichiers concernés :**
- `apps/web/messages/fr-FR.json`

**Sévérité :** Basse — cosmétique mais confus pour les utilisateurs FR

---

## B-12 — Couleur thème par défaut = vert au lieu d'indigo

**Symptôme :** La page `/customization` affiche Emerald (vert, hue 142) comme couleur sélectionnée par défaut. Le bouton "Réinitialiser par défaut" remet en vert. Or le design system de l'app a été migré vers indigo (hue 265) lors du redesign 6.3.

**Analyse :**
- `apps/web/src/app/customization/components/color-picker-form.tsx:14` : `PREDEFINED_COLORS[0]` = Emerald
- `resetToDefault()` (ligne 82) remet à `PREDEFINED_COLORS[0]` → Emerald
- L'enregistrement force le CSS custom property `--primary` à la couleur sélectionnée

**Correction :**
1. Réordonner `PREDEFINED_COLORS` pour mettre Indigo en premier position
2. Ou ajouter une constante `DEFAULT_COLOR` séparée pointant vers Indigo
3. Vérifier que la valeur CSS par défaut dans `globals.css` correspond

**Fichiers concernés :**
- `apps/web/src/app/customization/components/color-picker-form.tsx`
- `apps/web/src/app/globals.css` (vérification)

**Sévérité :** Moyenne — un admin qui clique "Enregistrer" ou "Réinitialiser" change le thème de toute l'app vers une couleur obsolète

---

## B-13 — Lien footer incorrect + hardcodé

**Symptôme :** Le footer affiche "Propulsé par Burger&Cie" avec un lien vers `https://burger-cie.com/` au lieu de `https://burgeretcie.fr/`.

**Analyse :**
- URL et nom hardcodés dans 2 fichiers :
  - `apps/web/src/components/ui/default-footer.tsx:22`
  - `apps/web/src/app/(shares)/r/[alias]/components/transparent-footer.tsx:22`
- Le texte "Propulsé par" est traduit via i18n (`footer.poweredBy`), mais l'URL et le nom de la société ne le sont pas.

**Correction immédiate :**
1. Changer l'URL vers `https://burgeretcie.fr/`
2. Changer la traduction FR `footer.poweredBy` : "Propulsé par" → formulation plus sobre (ex: "Par", "Développé par", ou autre)

**Amélioration future :** Rendre le footer configurable (voir TD-14).

**Fichiers concernés :**
- `apps/web/src/components/ui/default-footer.tsx`
- `apps/web/src/app/(shares)/r/[alias]/components/transparent-footer.tsx`

**Sévérité :** Basse — lien de renvoi incorrect

---

## B-14 — String hardcodée en anglais dans received-files-modal.tsx

**Symptôme :** Le toast d'erreur de suppression en masse de fichiers reçus affiche "Error deleting selected files" en anglais quelle que soit la locale.

**Analyse :**
- `apps/web/src/app/(shares)/reverse-shares/components/received-files-modal.tsx:370` : string passée directement à `toast.promise()` au lieu de `t()`.

**Correction :** Remplacer par `t("reverseShares.modals.receivedFiles.bulkDeleteError")` et ajouter la clé dans les 23 locales.

**Fichiers concernés :**
- `apps/web/src/app/(shares)/reverse-shares/components/received-files-modal.tsx`
- `apps/web/messages/*.json` (23 locales)

**Sévérité :** Basse — anglais affiché au lieu de la langue sélectionnée

---

## B-15 — Modale détails reverse share : champs manquants

**Symptôme :** La modale de détails d'un reverse share ne montre pas les champs `nameFieldRequired` et `emailFieldRequired`, alors qu'ils sont éditables dans la modale de création/édition.

**Analyse :**
- `reverse-share-details-modal.tsx` n'inclut pas ces deux champs
- Le `UpdateReverseShareSchema` côté serveur les accepte bien
- Tous les autres champs (name, description, pageLayout, expiration, password, maxFiles, maxFileSize, allowedFileTypes, isActive) sont présents

**Correction :**
1. Ajouter deux `EditableField` pour `nameFieldRequired` et `emailFieldRequired` (select : HIDDEN / OPTIONAL / REQUIRED) dans la modale de détails
2. Supprimer le bouton "Modifier" (crayon) de la carte reverse share et du menu dropdown — la modale de détails couvre désormais tous les champs, le doublon est inutile
3. Supprimer la modale de création utilisée en mode édition (ou la conserver uniquement pour la création)

**Fichiers concernés :**
- `apps/web/src/app/(shares)/reverse-shares/components/reverse-share-details-modal.tsx` (ajout champs)
- `apps/web/src/app/(shares)/reverse-shares/components/reverse-share-card.tsx` (suppression bouton Edit)
- `apps/web/src/app/(shares)/reverse-shares/components/reverse-shares-modals.tsx` (suppression logique Edit)

**Sévérité :** Basse — doublon UX, pas de bug fonctionnel

---

## B-16 — Modales 2FA trop étroites

**Symptôme :** Les 5 modales 2FA (setup, backup codes, disable, remove device, remove all) utilisent `max-w-md` (448px) alors que le défaut de l'app est 576px et les modales comparables utilisent 600-832px. La modale backup codes en particulier ne s'adapte pas bien au contenu.

**Analyse :**
- `apps/web/src/app/profile/components/two-factor-form.tsx` lignes 333, 412, 482, 529, 570 : toutes utilisent `max-w-md`
- Le composant Dialog de base définit `--dialog-max-w: 36rem` (576px) par défaut
- Les modales comparables (share details, upload, LDAP sync) utilisent 600px-832px

**Correction :** Remplacer `max-w-md` par une largeur appropriée. Au minimum retirer le override pour utiliser le défaut 576px, ou utiliser `sm:max-w-[600px]` pour la modale backup codes.

**Fichiers concernés :**
- `apps/web/src/app/profile/components/two-factor-form.tsx`

**Sévérité :** Basse — visuel, le contenu est fonctionnel mais contraint

---

## B-17 — Description du setting "Afficher la page d'accueil" trompeuse

**Symptôme :** Le label dit "Afficher la page d'accueil après l'installation" ce qui laisse penser que c'est un setting ponctuel. En réalité : quand activé, `/` affiche la landing page publique ; quand désactivé, `/` redirige vers `/login`.

**Correction :** Changer la description dans les 23 locales. Ex FR : "Afficher la page d'accueil publique (sinon, redirection vers la page de connexion)".

**Fichiers concernés :**
- `apps/web/messages/*.json` (23 locales, clé `settings.fields.showHomePage.description`)

**Sévérité :** Basse — description confuse mais pas de bug fonctionnel

---

## B-18 — Dashboard : "Disponibilité" devrait être "Uptime"

**Symptôme :** Dans l'état du système du dashboard, la traduction FR utilise "Disponibilité" qui est trop vague. "Uptime" est compris universellement même en français.

**Correction :** Changer la traduction FR de "Disponibilité" à "Uptime".

**Fichiers concernés :**
- `apps/web/messages/fr-FR.json` (clé à identifier — probablement `dashboard.systemStatus.uptime` ou similaire)

**Sévérité :** Très basse — cosmétique

---

## B-19 — Messages de la page Settings > Stockage incomplets

**Symptôme :** Les messages de configuration du stockage (limites de taille de fichier, quota total)
ne mentionnent pas qu'il est possible d'override ces valeurs par utilisateur et par groupe.

**Correction :** Ajouter une note explicative sous les champs de quota dans les 23 locales,
par exemple : "Ces valeurs sont les paramètres par défaut. Elles peuvent être surchargées
individuellement pour chaque utilisateur ou groupe."

**Fichiers concernés :**
- `apps/web/messages/*.json` (23 locales)
- Potentiellement le composant de la page settings/stockage

**Sévérité :** Très basse — info manquante mais pas de bug fonctionnel

---

## Priorité de correction (B-8 à B-19)

| Bug | Sévérité | Impact | Statut |
|-----|----------|--------|--------|
| B-9 Auth providers 500 | **Haute** | Page settings cassée pour tous les admins | ✅ Résolu |
| B-8 ldapDn non settable | **Moyenne** | Feature LDAP group mapping non fonctionnelle via UI | À corriger |
| B-10 Contamination PT fr-FR | **Moyenne** | Textes portugais visibles en locale FR | ✅ Résolu |
| B-12 Couleur thème défaut | **Moyenne** | Reset/save change le thème vers couleur obsolète | ✅ Résolu |
| B-11 Traduction "terrain" | **Basse** | Confus mais pas bloquant | ✅ Résolu |
| B-13 Lien footer incorrect | **Basse** | Lien vers mauvais domaine | ✅ Résolu |
| B-14 String hardcodée EN | **Basse** | Anglais affiché en locale non-EN | ✅ Résolu |
| B-15 Détails RS incomplets | **Basse** | Champs manquants dans vue détails | À corriger |
| B-16 Modales 2FA étroites | **Basse** | Visuel contraint | ✅ Résolu |
| B-17 Description setting | **Basse** | Description confuse | À corriger |
| B-18 "Disponibilité" → "Uptime" | **Très basse** | Cosmétique | ✅ Résolu |
| B-19 Messages stockage incomplets | **Très basse** | Info manquante | À corriger |
