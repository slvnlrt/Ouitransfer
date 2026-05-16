# Rapport d'Audit #2 : Backend (apps/server)

**Projet** : Ouitransfer v3.3.2-beta
**Date** : 2026-04-20
**Stack** : Fastify 5 + Prisma + SQLite + S3-compatible storage
**Scope** : API, securite serveur, data layer, validation, gestion d'erreurs

---

## Resume Executif

Le backend presente **5 vulnerabilites critiques** dont des routes S3 sans authentification, la desactivation de la protection contre le prototype pollution, et une limite de body a 1 PB. L'architecture modulaire est coherente (15 feature modules) mais souffre d'une absence totale de tests, d'un error handling inconsistant et de multiples instances PrismaClient. L'inventaire complet revele **70+ endpoints API**.

---

## 1. Bootstrap & Configuration Serveur

**Fichiers** : `src/server.ts` (entrypoint), `src/app.ts` (factory)

### Sequence de demarrage

1. Polyfill `globalThis.crypto` pour anciennes versions Node
2. `buildApp()` -- creation instance Fastify avec Zod type provider
3. Recuperation JWT secret depuis DB (`AppConfig.jwtSecret`), fallback sur random bytes
4. Enregistrement plugins : CORS, cookies, JWT, Swagger, Scalar API docs
5. `ensureDirectories()` -- creation `uploads/` et `temp-uploads/`
6. Enregistrement `@fastify/multipart`
7. Enregistrement des 13 modules de routes
8. Auto-migration (filesystem -> S3)
9. Ecoute sur `0.0.0.0:3333`

### Constats

| Severite | Constat | Localisation |
|----------|---------|-------------|
| **CRITIQUE** | `onProtoPoisoning: "ignore"` et `onConstructorPoisoning: "ignore"` -- desactive la protection contre le prototype pollution. Fastify utilise `"error"` par defaut pour une bonne raison. | `app.ts:36-37` |
| **CRITIQUE** | `bodyLimit: 1PB` (1024^5 bytes) -- effectivement illimite. Vecteur DoS trivial. | `app.ts:30`, `server.ts:58` |
| **WARN** | CORS `origin: true` reflete n'importe quelle origine. Tout site peut effectuer des requetes authentifiees avec cookies. | `app.ts:71-74` |
| **WARN** | Tous les timeouts desactives : `connectionTimeout: 0`, `requestTimeout: 0`, `keepAliveTimeout: 20h`. Concu pour les gros transferts mais permet le slowloris DoS. | `app.ts:31-33` |
| **WARN** | Cookie JWT `signed: false` -- pas de verification d'integrite par Fastify. | `app.ts:81` |
| **INFO** | Port 3333 hardcode -- pas de variable d'env. | `server.ts:87` |
| **INFO** | `trustProxy: true` sans restriction -- fait confiance a tous les headers proxy. | `app.ts:34` |

---

## 2. Inventaire Complet des Routes API

### Routes sans authentification (surface d'attaque)

| Method | Path | Risque |
|--------|------|--------|
| POST | `/s3/upload-url` | **CRITIQUE** -- generation d'URL d'upload arbitraire |
| GET | `/s3/download-url` | **CRITIQUE** -- telechargement de tout objet |
| DELETE | `/s3/object/:objectName` | **CRITIQUE** -- suppression de tout objet |
| GET | `/s3/exists` | **CRITIQUE** -- enumeration de fichiers |
| GET | `/embed/:id` | **CRITIQUE** -- acces fichier sans auth |
| GET | `/shares/alias/:alias` | Public par design (avec password optionnel) |
| GET | `/shares/alias/:alias/metadata` | Public par design |
| GET | `/invite-tokens/:token` | Consultation token d'invitation |
| POST | `/auth/login`, `/auth/2fa/login` | Connexion |
| POST | `/auth/forgot-password`, `/auth/reset-password` | Reset password |
| GET | `/app/info`, `/app/system-info`, `/app/configs/public` | Info publique |
| GET | `/health` | Health check |

### Routes authentifiees par domaine

**Auth** : 10 endpoints (login, logout, 2FA, password reset, trusted devices)
**Users** : 10 endpoints (CRUD, avatar, activation/desactivation)
**Files** : 14 endpoints (CRUD, presigned URLs, multipart upload, download, embed)
**Folders** : 6 endpoints (CRUD, move)
**Shares** : 14 endpoints (CRUD, alias, recipients, password, files/folders)
**Reverse Shares** : ~20 endpoints (upload reception, multipart, alias, password, metadata)
**Invites** : 3 endpoints (creation, consultation, inscription)
**Storage** : 2 endpoints (disk space, upload check)
**App Config** : 9 endpoints (configs CRUD, SMTP test, logo)
**Auth Providers** : 8 endpoints (CRUD, authorize, callback)

### Constats Routes

| Severite | Constat | Localisation |
|----------|---------|-------------|
| **CRITIQUE** | Routes `/s3/*` entierement sans authentification. N'importe qui peut generer des URLs d'upload, telecharger tout objet, supprimer tout objet, ou enumerer le stockage. | `modules/s3-storage/routes.ts` |
| **WARN** | `DELETE /shares/:id` sans `preValidation` hook -- JWT verifie dans le controller, inconsistant et fragile. | `modules/share/routes.ts:119-139` |
| **WARN** | `POST /files` et `POST /folders` authentifient dans le handler au lieu du `preValidation` hook. | `modules/file/controller.ts:60`, `modules/folder/controller.ts:21` |
| **WARN** | Mot de passe de partage envoye en **query parameter** (`?password=xxx`) -- visible dans les logs, l'historique navigateur, les logs proxy. | `modules/share/routes.ts:82`, `modules/file/routes.ts:118` |

---

## 3. Data Layer

### ORM & Base de donnees

- **ORM** : Prisma Client (`@prisma/client` v6.11)
- **BDD** : SQLite (`file:./ouitransfer.db`)
- **Modeles** (17) : User, File, Folder, Share, ShareSecurity, ShareRecipient, ShareAlias, AppConfig, LoginAttempt, PasswordReset, AuthProvider, UserAuthProvider, ReverseShare, ReverseShareFile, ReverseShareAlias, TrustedDevice, InviteToken

### Patterns

- Pattern repository pour User et Share (interface + implementation Prisma)
- Appels directs `prisma` dans les controllers File et Folder (inconsistant)
- **Deux instances PrismaClient separees** : `src/shared/prisma.ts` (singleton) vs `UserService` et `StorageService` (new instances)

| Severite | Constat | Localisation |
|----------|---------|-------------|
| **WARN** | Multiples instances `PrismaClient` -- gaspillage de connexions, problemes potentiels avec le single-writer lock de SQLite. | `modules/user/service.ts:16`, `modules/storage/service.ts:11` |
| **WARN** | Pas de migrations database -- uniquement schema push. Pas d'historique de migrations pour rollback. | Repertoire `prisma/` |
| **INFO** | SQLite adequat pour petits/moyens deploiements, deviendra goulot d'etranglement sous charge d'ecritures concurrentes. | `prisma/schema.prisma:6-8` |

---

## 4. Stockage Fichiers

### Architecture

- Tout le stockage passe par l'API S3-compatible (MinIO interne ou AWS/S3 externe)
- Interface `StorageProvider` avec une seule implementation : `S3StorageProvider`
- URLs presignees pour upload/download -- les fichiers ne transitent pas par Node (sauf embed/download proxy)

### Flux d'upload

1. Client demande URL presignee -> `GET /files/presigned-url`
2. Client upload directement vers S3 via URL PUT presignee
3. Client enregistre les metadonnees -> `POST /files`
4. Pour les gros fichiers (>=100MB) : multipart via `POST /files/multipart/create` -> part URLs -> complete

| Severite | Constat | Localisation |
|----------|---------|-------------|
| **CRITIQUE** | Taille fichier verifiee uniquement a l'enregistrement (`POST /files`), pas a l'upload. Un utilisateur peut uploader 100GB vers S3 via URL presignee, puis l'enregistrement echoue, laissant des donnees orphelines dans S3. | `server.ts:58`, `modules/file/controller.ts:68-74` |
| **WARN** | `STORAGE_URL` obligatoire pour les URLs presignees internes mais pas valide au demarrage. | `config/storage.config.ts:123-127` |
| **WARN** | `NODE_TLS_REJECT_UNAUTHORIZED=0` defini globalement quand `S3_REJECT_UNAUTHORIZED=false` -- desactive la verification TLS pour **tout le processus**. | `config/storage.config.ts:65-71` |

---

## 5. Authentification & Autorisation

- **JWT** via `@fastify/jwt` -- token signe dans cookie httpOnly, expire en 1 jour
- **Password** : bcrypt cost factor 10
- **Brute-force** : max tentatives configurable (defaut 5) avec blocage (defaut 10 min)
- **2FA** : TOTP via `speakeasy` avec backup codes
- **Trusted devices** : hash de `userAgent + ipAddress`, expiration 30 jours
- **OAuth/OIDC** : 9 providers (Google, Discord, GitHub, Auth0, Kinde, Zitadel, Authentik, Frontegg, Pocket ID)
- **Invitations** : tokens admin pour l'inscription

| Severite | Constat | Localisation |
|----------|---------|-------------|
| **CRITIQUE** | Zero rate limiting sur tous les endpoints. La protection brute-force est par-utilisateur, pas par-IP. | Global |
| **WARN** | Risque de regeneration du JWT secret -- si `jwtSecret` absent de la DB au premier boot, un secret random est genere. Le prochain boot utilisera le secret DB, invalidant silencieusement tous les tokens. | `app.ts:15-19` |
| **WARN** | Detection admin basee uniquement sur le count utilisateurs (`usersCount === 0`). | `modules/user/service.ts:33-34` |
| **WARN** | `adminPreValidation` dans `app/routes.ts` autorise l'acces complet quand `usersCount <= 1`. | `modules/app/routes.ts:11-32` |

---

## 6. Validation

- **Schemas Zod** via `fastify-type-provider-zod` -- `validatorCompiler` et `serializerCompiler` enregistres
- Schemas definis dans les fichiers `dto.ts` par module

| Severite | Constat | Localisation |
|----------|---------|-------------|
| **WARN** | `PUT /auth/providers/:id` body schema est `z.any()` -- aucune validation sur la mise a jour de provider. | `modules/auth-providers/routes.ts:188` |
| **WARN** | `removeAdditional: false` -- les champs supplementaires ne sont pas retires. Combine avec `onProtoPoisoning: "ignore"`, cela elargit la surface d'attaque. | `app.ts:22-24` |
| **WARN** | Validation password dynamique inconsistante -- `LoginSchema` hardcode `min(6)` alors que la validation dynamique peut exiger plus. | `modules/auth/dto.ts:14` vs `:8` |

---

## 7. Gestion d'Erreurs

| Severite | Constat | Localisation |
|----------|---------|-------------|
| **WARN** | Pas de global error handler -- le handler 500 par defaut de Fastify est utilise. | `app.ts` |
| **WARN** | Messages d'erreur Prisma renvoyes aux clients -- fuite de details schema. | Tous les `catch` blocks |
| **WARN** | `console.error(err)` dans les hooks JWT loggue les details complets du token. | `modules/auth/routes.ts:212` |
| **INFO** | Codes status inconsistants -- certains modules utilisent 401 pour des echecs d'autorisation (devrait etre 403). | `modules/share/controller.ts:186` |

---

## 8. Tests

| Severite | Constat |
|----------|---------|
| **CRITIQUE** | **ZERO fichiers de test.** Pas de `.test.ts`, `.spec.ts`, pas de repertoire test. Pas de framework de test configure. Pas de script `test`. |

---

## 9. Tableau Recapitulatif

| # | Severite | Constat | Effort |
|---|----------|---------|--------|
| 1 | **CRITIQUE** | Routes `/s3/*` sans authentification | Faible |
| 2 | **CRITIQUE** | Protection prototype pollution desactivee | Faible |
| 3 | **CRITIQUE** | Body limit 1 PB -- DoS trivial | Faible |
| 4 | **CRITIQUE** | Zero tests | Eleve |
| 5 | **CRITIQUE** | Zero rate limiting | Moyen |
| 6 | **CRITIQUE** | Taille fichier validee apres upload seulement | Moyen |
| 7 | **WARN** | `NODE_TLS_REJECT_UNAUTHORIZED=0` global | Faible |
| 8 | **WARN** | Pas de global error handler ; fuite erreurs Prisma | Faible |
| 9 | **WARN** | CORS reflete toute origine | Faible |
| 10 | **WARN** | Multiples instances PrismaClient | Faible |
| 11 | **WARN** | Mots de passe de partage en query params | Moyen |
| 12 | **WARN** | Schema `z.any()` sur update provider | Faible |
| 13 | **WARN** | Validation password inconsistante | Faible |

---

## 10. Recommandations Prioritaires

1. **Securiser les routes `/s3/*`** -- Ajouter `preValidation` JWT sur toutes les routes S3.
2. **Reactiver la protection prototype pollution** -- `onProtoPoisoning: "error"`, `onConstructorPoisoning: "error"`.
3. **Installer `@fastify/rate-limit`** -- Limites strictes sur auth (5/min), moderees sur upload (30/min), globales (100/min).
4. **Definir un body limit raisonnable** -- 50MB pour les requetes API (les uploads utilisent des URLs presignees S3).
5. **Centraliser le error handling** -- `app.setErrorHandler()` avec sanitization des erreurs Prisma.
6. **Mettre en place un framework de test** -- Vitest recommande, commencer par les services critiques (auth, share, file).
7. **Unifier les instances PrismaClient** -- Utiliser le singleton de `src/shared/prisma.ts` partout.
8. **Restreindre CORS** -- Origine(s) frontend specifique(s) via variable d'env.
