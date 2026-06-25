# Bug Report

> Bugs discovered during testing and development.
> Archived bugs: see `features/archive/BUGS-2026-05.md` (B-1 through B-20, all resolved).
> B-21 through B-25 resolved — see below.

---

## ~~B-21 — Suppression de fichier dans un partage : pas d'avertissement~~ ✅ RESOLVED

Résolu en session 2026-05-22. Backend retourne 409 avec `shareCount` si le fichier appartient à
un ou plusieurs partages et que `force` n'est pas activé. Frontend affiche un dialog de
confirmation secondaire (fichier unique) ou un dialog de batch (suppression multiple). Le
`force=true` est requis pour supprimer un fichier appartenant à des partages.

**Note :** La suppression de dossiers contenant des fichiers dans des partages reste sans
vérification — trackée comme B-24.

Commits : `7638f50`, `07a98c4`, `095f2c2`

---

## ~~B-22 — Footer affiche "Propulsé par" en dur devant le texte configuré~~ ✅ RESOLVED

Résolu en session 2026-05-22. Suppression du `{t("footer.poweredBy")}` des deux composants
footer (`default-footer.tsx`, `transparent-footer.tsx`) et suppression de la clé `poweredBy`
des 23 fichiers de traduction. Le footer affiche maintenant uniquement `{displayText}`.

Commit : `2c702d0`

---

## ~~B-23 — Nom d'app par défaut "OUITRANSFER. " avec point et espace trailing~~ ✅ RESOLVED

Résolu en session 2026-05-22. Valeur changée en `"Ouitransfer"` dans `prisma/seed.js`.

Commit : `1783e85`

---

## ~~B-24 — Suppression de dossier : pas de vérification des partages contenant le dossier ou ses fichiers~~ ✅ RESOLVED

Résolu en session 2026-05-22. Backend `DELETE /folders/:id` collecte récursivement tous les
dossiers descendants, puis vérifie si le dossier ou ses fichiers (via `_ShareFolders` et
`_ShareFiles`) appartiennent à des partages actifs. Retourne 409 avec `{ error: "FOLDER_IN_SHARES",
shareCount: N }` si des partages sont impactés et que `force` n'est pas activé. Frontend affiche
un dialog de confirmation secondaire (dossier unique) ou un dialog de batch (suppression multiple
de dossiers). Le `force=true` est requis pour supprimer un dossier appartenant à des partages.

- Backend : `getDescendantFolderIds()` helper récursif, `querystring: { force }`, 409 response schema
- Frontend single-delete : dialog de warning avec nom du dossier + shareCount + bouton "Delete anyway"
- Frontend bulk-delete : `Promise.allSettled` + collecte des 409, dialog de batch pour les dossiers en partage
- i18n : 5 nouvelles clés `folderActions.*` dans 23 locales (en-US + fr-FR natifs, 21 autres en fallback EN)
- Tests : 6 integration tests server (no-shares→200, 1-share-no-force→409, force→200, 403, 404, deduplication→3)

**Découvert lors de :** Review de B-21 (2026-05-22)

---

## ~~B-25 — Quota user : diskUsedGB arrondi à 0, percentage affiché 0% avec des fichiers~~ ✅ RESOLVED

Résolu en session 2026-05-23. Le service de stockage utilisait `toFixed(2)` pour convertir les bytes en GB, ce qui
écrasait toute valeur inférieure à ~5 MB à `0.00`. Conséquence : `diskUsedGB: 0` même avec des fichiers uploadés,
et `percentage: 0` pour tout usage < 1% du quota (ex. quelques MB sur 10 GB).

**Fix :**
- `storage/service.ts` : `toFixed(2)` → `toFixed(6)` sur les 6 valeurs GB (chemins admin + user). Précision ~1 KB,
  la fonction `formatStorageSize` côté frontend gère déjà la conversion en MB/KB/B selon l'échelle.
- `quota/service.ts` : `Math.max(1, Math.round(raw))` quand `used > 0n` — non-zero usage affiche toujours au moins 1%.
- Également corrigé : `cursor-pointer` manquant sur le bouton collapse de `SystemStatusBar`.

Commits : voir session 2026-05-23
