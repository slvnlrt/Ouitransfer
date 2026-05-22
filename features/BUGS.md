# Bug Report

> Bugs discovered during testing and development.
> Archived bugs: see `features/archive/BUGS-2026-05.md` (B-1 through B-20, all resolved).

---

## B-21 — Suppression de fichier dans un partage : pas d'avertissement

**Symptôme :** `DELETE /files/:id` supprime le fichier sans vérifier s'il appartient à un share actif. Le fichier disparaît silencieusement du partage.

**Cause :** `file/routes.ts:720-762` — aucun check sur les relations `_ShareFiles`. Pas de confirmation côté frontend non plus.

**Fix attendu :**
- Backend : vérifier si le fichier est dans un ou plusieurs shares avant suppression
- Frontend : afficher un avertissement "Ce fichier est inclus dans X partage(s). Le supprimer le retirera de ces partages."
- L'utilisateur doit confirmer explicitement

**Sévérité :** Medium — perte de données silencieuse dans les partages

---

## B-22 — Footer affiche "Propulsé par" en dur devant le texte configuré

**Symptôme :** Le setting `footerText` = "Burger&Cie" affiche "Propulsé par Burger&Cie" au lieu de juste "Burger&Cie".

**Cause :** `default-footer.tsx:38` et `transparent-footer.tsx:38` — `{t("footer.poweredBy")}` est hardcodé avant `{displayText}`. La clé `footer.poweredBy` existe dans les 23 locales.

**Fix attendu :**
- Supprimer le `{t("footer.poweredBy")}` des deux composants footer
- Afficher uniquement `{displayText}`
- Supprimer la clé `footer.poweredBy` des 23 fichiers de traduction
- Optionnel : ajouter un setting `footerPrefix` si on veut rendre le préfixe configurable

**Sévérité :** Low — cosmétique

---

## B-23 — Nom d'app par défaut "OUITRANSFER. " avec point et espace trailing

**Symptôme :** Le seed génère `appName` = `"OUITRANSFER. "` (avec point et espace).

**Cause :** `prisma/seed.js:13` — valeur hardcodée avec point stylistique et espace trailing.

**Fix attendu :**
- Changer la valeur dans `seed.js` en `"Ouitransfer"` (ou la valeur souhaitée, sans point ni espace)
- Note : les instances existantes conservent l'ancienne valeur — changement via Settings ou re-seed

**Sévérité :** Very low — cosmétique, corrigeable manuellement dans les settings
