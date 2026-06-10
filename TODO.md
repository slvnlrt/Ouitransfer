# TODO — À vérifier en priorité

---

## Parcours de création de partage — incohérences UX majeures

### Contexte général
Il existe plusieurs points d'entrée pour créer un partage, et le comportement / les options disponibles **diffèrent selon le chemin emprunté**. L'objectif est d'aligner tous les parcours pour que l'utilisateur ait toujours la même expérience, les mêmes options, et le même comportement — quel que soit le point d'entrée.

---

### Parcours 1 : via Fichier > Actions > Partager

**Ce qui est bien :**
- Section dépliable Confidentialité & Notifications présente et complète

**Problèmes identifiés :**
1. **Labels incomplets** : Les dropdowns "Exiger le nom du visiteur" et "Exiger l'email du visiteur" n'ont pas de texte explicatif à droite (contrairement à la même section dans d'autres modales). Ajouter une courte description à droite de chaque dropdown pour expliquer l'impact du choix.
2. **Modale trop étroite** : Cette modale est plus étroite que les autres modales de création/détails. À aligner avec `sm:max-w-3xl` (standard actuel post-redesign).
3. **Bug de flux "Créer un partage" → modal lien** :
   - Le bouton "Créer un partage" **crée immédiatement le partage** en base.
   - Ensuite, la modale de création du lien de partage s'ouvre, avec seulement les boutons "Créer" et "Retour".
   - **Il manque le bouton "Plus tard"** (présent dans les autres versions de cette modale).
   - Si l'utilisateur clique "Retour", il revient à la modale précédente — **mais le partage a déjà été créé**. L'état est incohérent : un partage existe sans lien.
   - **Options possibles** : (a) ajouter "Plus tard" pour fermer proprement, (b) ne créer le partage qu'au moment de la confirmation finale, (c) supprimer le partage si l'utilisateur abandonne via "Retour".

---

### Parcours 2 : via le bouton "Créer un partage" (bouton principal)

**Problèmes identifiés :**
1. **Options manquantes** : Pas de section Confidentialité / Mot de passe disponible dans cette modale, alors qu'elle est présente dans le parcours 1.
2. **Structure en onglets** : La modale a deux onglets ("Détails du partage", "Sélectionner les fichiers") mais **pas d'onglet "Créer le lien de partage"** — cette étape arrive dans une nouvelle modale séparée après la création.
3. **Flux en deux étapes distinctes** vs une seule modale multi-onglets dans d'autres parcours.

---

### Recommandation d'architecture UX

Refactoriser pour avoir des **composants modaux atomiques et réutilisables** :
- Un seul composant `ShareCreationModal` (ou workflow unifié) appelé depuis tous les points d'entrée
- Toutes les options disponibles partout (confidentialité, mot de passe, notifications, destinataires)
- Un seul flux de création : remplir les détails → sélectionner les fichiers → créer le lien (ou "plus tard") — en une modale multi-étapes ou multi-onglets
- Le partage ne doit être créé en base **qu'au moment de la confirmation finale** (pas avant)

**Fichiers à auditer en priorité :**
- `apps/web/src/components/modals/create-share-modal.tsx` — modal "Créer un partage" principal
- `apps/web/src/components/modals/share-item-modal.tsx` (ou équivalent) — modal via Fichier > Partager
- `apps/web/src/components/modals/generate-share-link-modal.tsx` — modal création du lien
- `apps/web/src/components/modals/share-actions-modals.tsx` — autres modales de partage

---

## CORS / Variables d'environnement en déploiement pré-prod

### Symptôme observé
- Accès depuis l'URL interne (`http://ouitransfer.burger.lan`) → login échoue avec HTTP 500
- Logs Docker : `"message":"Not allowed by CORS"` → statusCode 500
- Accès depuis l'URL externe (`https://ouitransfer.grad-system.com`) → fonctionne
- Bug B-30 tracé dans `features/BUGS.md` : le rejet CORS retourne 500 au lieu de 403 (code bug à fixer séparément)

### Variables d'env du déploiement (préfixe `OUITRANSFER_`)
```
OUITRANSFER_EXTERNAL_HOST=ouitransfer.grad-system.com
OUITRANSFER_FRONTEND_ORIGIN=https://ouitransfer.grad-system.com
OUITRANSFER_INTERNAL_HOST=ouitransfer.burger.lan
OUITRANSFER_SECURE_SITE=true
OUITRANSFER_SERVER_DATA_PATH=/mnt/docker-data/ouitransfer/server
OUITRANSFER_SERVER_TAG=latest
OUITRANSFER_STORAGE_DATA_PATH=/mnt/docker-data/ouitransfer/storage
OUITRANSFER_STORAGE_PUBLIC_URL=https://ouitransfer.grad-system.com
OUITRANSFER_STORAGE_TAG=latest
OUITRANSFER_UID=1001
OUITRANSFER_GID=1001
OUITRANSFER_WEB_TAG=latest
```

### Ce qu'on sait côté code
- `apps/server/src/app.ts:86-88` : `CORS_ORIGINS` détermine les origines autorisées, défaut `http://localhost:5487`
- `apps/server/src/app.ts:90-95` : si `NODE_ENV=production` et `CORS_ORIGINS` non défini → le serveur crashe au démarrage (donc il y a forcément une valeur)
- `docker-compose.yaml:79` : `CORS_ORIGINS: "${FRONTEND_ORIGIN:-http://localhost:5487}"` — utilise la variable `FRONTEND_ORIGIN` (sans préfixe)
- `.env.docker.example:23` : la variable attendue est `FRONTEND_ORIGIN=`

### Questions ouvertes (à investiguer)
1. **Comment les variables `OUITRANSFER_*` sont-elles mappées ?** Y a-t-il un script de déploiement, un Makefile, ou un wrapper qui traduit `OUITRANSFER_FRONTEND_ORIGIN` → `FRONTEND_ORIGIN` ? Le prochain agent doit chercher ce mécanisme avant de tirer des conclusions.
2. **Pourquoi l'URL externe fonctionne mais pas l'interne ?** Les deux devraient être same-origin (pas d'en-tête `Origin` envoyé). À investiguer : est-ce que l'accès interne passe par un chemin différent (port direct, proxy différent) ?
3. **Quelle est la valeur réelle de `CORS_ORIGINS` dans le container en prod ?** Lancer `docker exec <container> printenv CORS_ORIGINS` pour confirmer.

### Actions suggérées pour la prochaine session
1. Investiguer le mécanisme de mapping des variables `OUITRANSFER_*` avant de proposer un fix
2. Confirmer la valeur de `CORS_ORIGINS` dans le container en cours
3. Fixer B-30 (retourner 403 au lieu de 500 sur rejet CORS) indépendamment du problème de config

---

## Destinataires non éditables dans la modal détails d'un share

### Symptôme
Dans `share-details-modal.tsx`, les destinataires (`recipients`) sont affichés en lecture seule : on voit la liste mais on ne peut ni ajouter ni supprimer de destinataire. Or toutes les autres sections de la modal (nom, description, sécurité, expiration, etc.) sont éditables in-place.

### Contexte
- Le composant `RecipientSelector` (ou équivalent) existe déjà dans la codebase — il est utilisé dans la modal de création du share (`create-share-modal.tsx`)
- Les endpoints API existent : `POST /shares/:id/recipients` et `DELETE /shares/:id/recipients`
- La modal affiche déjà la liste des destinataires avec leur statut (downloaded/pending)

### Action
Brancher l'ajout/suppression de destinataires dans `share-details-modal.tsx`, en s'inspirant du composant utilisé à la création. Vérifier si le `RecipientSelector` peut être réutilisé tel quel ou s'il faut un sous-composant dédié pour l'édition in-place.
