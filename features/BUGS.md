# Bug Report

> Bugs discovered during testing and development.
> Archived bugs: see `features/archive/BUGS-2026-05.md` (B-1 through B-20, all resolved).
> B-21 through B-23 resolved — see below.

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

## B-24 — Suppression de dossier : pas de vérification des partages contenant le dossier ou ses fichiers

**Symptôme :** `DELETE /folders/:id` supprime le dossier et tous ses fichiers sans vérifier si
le dossier (via `_ShareFolders`) ou ses fichiers (via `_ShareFiles`) appartiennent à des partages
actifs. La suppression cascade silencieusement.

**Cause :** `folder/routes.ts` — aucun check sur les relations `shares` du dossier ni sur les
`shares` des fichiers contenus.

**Fix attendu :**
- Backend : lors de `DELETE /folders/:id`, vérifier si le dossier a des shares ET si ses fichiers
  ont des shares (requête récursive nécessaire)
- Retourner 409 avec le compte total si des shares sont impactées
- Frontend : même pattern que B-21 (warning dialog + force-delete)

**Sévérité :** Medium — même perte silencieuse que B-21, mais via le chemin dossier

**Découvert lors de :** Review de B-21 (2026-05-22)
