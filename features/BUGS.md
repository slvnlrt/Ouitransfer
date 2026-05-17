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

| Bug | Sévérité | Impact |
|-----|----------|--------|
| B-3 Upload cassé | **Critique** | Fonctionnalité principale inopérante |
| B-2 i18n embedSecret | **Haute** | Erreur visible dans settings (toutes locales non-EN) |
| B-1 Health 503 | **Moyenne** | Dashboard dégradé en dev (RustFS non démarré) |
| B-6 Logo cassé | **Moyenne** | UX dégradée, image brisée visible |
| B-4 Grid dashboard | **Basse** | Visuel, pas fonctionnel |
| B-5 Grid settings | **Basse** | Visuel, pas fonctionnel |
