# TODO — À vérifier en priorité

---

## ✅ Parcours de création de partage — RÉSOLU (2026-06-10)

Unifié dans `apps/web/src/components/modals/share-creation-modal.tsx` (remplace
`create-share-modal`, `share-item-modal`, `share-multiple-items-modal`). Flux
unique en 3 étapes (Détails → Fichiers → Lien), toutes les options partout,
bouton « Plus tard », création différée à l'action terminale (plus d'état
incohérent via « Retour »), descriptions sous les dropdowns, largeur
`sm:max-w-3xl`. Bonus livrés : badge « Sans lien » sur la table des partages, et
fix du bouton « Enregistrer » grisé dans « Gérer les fichiers » sur partage vidé.
Détails dans `features/SESSIONS.md`.

---

## ✅ CORS / Variables d'environnement en déploiement pré-prod — RÉSOLU (2026-06-11)

**Cause** : `CORS_ORIGINS` (alimenté par `OUITRANSFER_FRONTEND_ORIGIN`) ne listait
que l'origine externe ; le host interne (`internal.lan`) absent de la liste → le
login (POST, donc en-tête `Origin` envoyé) tombait en rejet CORS. Le code
supportant déjà les listes séparées par virgule, le fix déploiement est de mettre
les deux hosts : `OUITRANSFER_FRONTEND_ORIGIN="https://...grad-system.com,https://...internal.lan"`.
**B-30 fixé** côté code (`app.ts` : `ForbiddenError` → 403 au lieu de 500, + tests
preflight) et doc multi-origines clarifiée (`.env.docker.example`, `docker-compose.yaml`).
Confirmé fonctionnel en prod. Détails ci-dessous (archive).

### Symptôme observé
- Accès depuis l'URL interne (`http://ouitransfer.internal.lan`) → login échoue avec HTTP 500
- Logs Docker : `"message":"Not allowed by CORS"` → statusCode 500
- Accès depuis l'URL externe (`https://ouitransfer.grad-system.com`) → fonctionne
- Bug B-30 tracé dans `features/BUGS.md` : le rejet CORS retourne 500 au lieu de 403 (code bug à fixer séparément)

### Variables d'env du déploiement (préfixe `OUITRANSFER_`)
```
OUITRANSFER_EXTERNAL_HOST=ouitransfer.grad-system.com
OUITRANSFER_FRONTEND_ORIGIN=https://ouitransfer.grad-system.com
OUITRANSFER_INTERNAL_HOST=ouitransfer.internal.lan
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

## ✅ Destinataires éditables dans la modal détails d'un share — RÉSOLU (2026-06-11)

La section destinataires de `share-details-modal.tsx` (jusque-là en lecture seule)
expose maintenant un bouton « gérer » (crayon), exactement comme la section
fichiers. Rendu extrait dans un sous-composant `ShareDetailsRecipientsList`
(cohérent avec `ShareDetailsFilesList`) ; le bouton ouvre la modal « Gérer les
destinataires » existante (`RecipientSelector`, déjà câblée via
`setShareToManageRecipients`) — ajout/suppression/notification. La section
s'affiche aussi pour les propriétaires sans destinataire (pour pouvoir ajouter le
premier). Câblé dans les deux hosts (`shares-modals.tsx`, `dashboard-modals.tsx`).
