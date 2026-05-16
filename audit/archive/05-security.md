# Rapport d'Audit #5 : Securite

**Projet** : Ouitransfer v3.3.2-beta
**Date** : 2026-04-20
**Stack** : Fastify + Prisma (SQLite) + Next.js + S3-compatible storage
**Scope** : Authentification, autorisation, uploads, injections, CORS, CSRF, transport

---

## Resume Executif

L'audit de securite revele **5 vulnerabilites critiques** exploitables immediatement, **6 vulnerabilites hautes** necessitant une remediation rapide, et **7 vulnerabilites moyennes**. Les problemes les plus graves sont : CORS ouvert a toute origine avec credentials, protection prototype pollution desactivee, endpoint embed sans authentification, body limit a 1 PB (DoS), et execution de commandes shell dans le StorageService. La combinaison de ces vulnerabilites rend l'application **non deployable en production dans son etat actuel**.

---

## 1. Vulnerabilites CRITIQUES

### C1. CORS ouvert a toute origine avec credentials

**Fichier** : `apps/server/src/app.ts:71-74`

```typescript
app.register(fastifyCors, {
  origin: true,       // Autorise TOUTES les origines
  credentials: true,  // Envoie les cookies
});
```

**Vecteur d'attaque** : N'importe quel site web peut effectuer des requetes cross-origin authentifiees vers l'API. Un attaquant heberge `evil.com`, attire un utilisateur connecte, et le JavaScript de l'attaquant peut appeler tout endpoint en tant que cet utilisateur -- creer des partages, supprimer des fichiers, exfiltrer des donnees.

**Remediation** : Restreindre `origin` aux domaines frontend reels via une allowlist ou variable d'environnement.

---

### C2. Protection prototype pollution desactivee

**Fichier** : `apps/server/src/app.ts:36-37`

```typescript
onProtoPoisoning: "ignore",
onConstructorPoisoning: "ignore",
```

**Vecteur d'attaque** : Un attaquant peut envoyer des payloads JSON avec des proprietes `__proto__` ou `constructor` pour polluer les prototypes d'objets, pouvant potentiellement aboutir a un RCE ou un contournement d'authentification selon le code en aval.

**Remediation** : Definir les deux a `"error"` (le defaut securise de Fastify). Il n'existe aucune raison legitime de les mettre a `"ignore"`.

---

### C3. Endpoint Embed -- Acces fichier sans authentification

**Fichier** : `apps/server/src/modules/file/controller.ts:583-625`, `routes.ts:134-155`

L'endpoint `/embed/:id` sert tout fichier media (images, video, audio) a quiconque possede l'ID du fichier, avec **zero authentification**. Pas de verification de partage, pas de verification de proprietaire, pas de verification de mot de passe.

**Vecteur d'attaque** : Les CUIDs ne sont pas cryptographiquement suffisamment aleatoires pour etre indevinables (ils sont bases sur le temps + partiellement aleatoires). Un attaquant connaissant le pattern CUID peut enumerer les IDs de fichiers et telecharger les fichiers media de tout utilisateur sans authentification.

**Remediation** : Exiger une authentification ou un acces base sur un partage actif. Au minimum, valider que le fichier fait partie d'un partage actif et accessible.

---

### C4. Body limit 1 PB -- Deni de service

**Fichier** : `apps/server/src/app.ts:30`

```typescript
bodyLimit: 1024 * 1024 * 1024 * 1024 * 1024  // 1 PB
```

Egalement dans `server.ts:58` (multipart `fileSize`) et `reverse-share/routes.ts:389`.

**Vecteur d'attaque** : Un attaquant peut envoyer un body arbitrairement volumineux a tout endpoint, consommant toute la memoire et le disque du serveur.

**Remediation** : Definir des limites raisonnables (ex. 50MB pour les requetes API). Les uploads de fichiers utilisent des URLs presignees S3, donc la limite body du serveur devrait etre petite.

---

### C5. Injection de commande via exec() shell dans StorageService

**Fichier** : `apps/server/src/modules/storage/service.ts:1, 49-51`

```typescript
import { exec } from "child_process";
const execAsync = promisify(exec);
```

La methode `_getFileSystemInfo` utilise `targetPath` derive de `env.CUSTOM_PATH`. Si `CUSTOM_PATH` contient des metacaracteres shell, ou si ce code est un jour refactore pour utiliser des chemins fournis par l'utilisateur, cela devient une injection de commande directe.

**Remediation** : Utiliser `execFile` au lieu de `exec` pour eviter l'interpretation shell. Ou mieux, utiliser l'API Node.js `fs` (`statfs`) pour les requetes d'espace disque.

---

## 2. Vulnerabilites HAUTES

### H1. Zero rate limiting sur tous les endpoints

**Scope** : Global

Aucun rate limiting sur : login, password reset (email bombing), verification 2FA (brute-force codes 6 digits), generation URLs presignees, endpoints publics reverse-share.

**Remediation** : Installer `@fastify/rate-limit`. Limites strictes sur auth (5/min), moderees sur upload (30/min), globales (100/min).

### H2. Mots de passe de partage en query parameters

**Fichiers** : `file/routes.ts:117-118`, `share/routes.ts:82`, `reverse-share/routes.ts:188`

Les mots de passe dans les URLs sont logues dans les access logs, l'historique navigateur, les logs proxy, et les headers Referer.

**Remediation** : Deplacer les mots de passe dans le body (POST) ou un header custom.

### H3. Cookie `secure` desactive par defaut

**Fichier** : `modules/auth/controller.ts:43-48`

`SECURE_SITE` est a `"false"` par defaut. Les cookies auth sont envoyes en clair HTTP, vulnerables au MITM.

**Remediation** : Default `SECURE_SITE` a `"true"`. N'autoriser `false` qu'avec un opt-out explicite.

### H4. Aucune validation de contenu fichier

**Scope** : `modules/file/controller.ts`, `file/dto.ts`, `reverse-share/service.ts`

Zero validation cote serveur du contenu des fichiers :
- Pas de verification MIME type
- Pas de verification magic bytes
- Pas de scan malware
- Pas de protection zip bomb
- L'extension est acceptee telle quelle

**Remediation** : Valider les magic bytes a l'enregistrement. Implementer une allowlist/blocklist d'extensions. Ajouter optionnellement ClamAV.

### H5. Contournement 2FA -- userId accepte du client

**Fichier** : `modules/auth/dto.ts:41-42`, `auth/controller.ts:56-84`

L'endpoint de completion 2FA accepte `userId` directement du client. Pas de liaison de session serveur entre l'etape password et l'etape 2FA.

**Vecteur d'attaque** : Un attaquant connaissant un userId valide peut sauter l'etape mot de passe et n'a qu'a brute-forcer le code TOTP a 6 chiffres (1M possibilites). Sans rate limiting, c'est trivial.

**Remediation** : Utiliser un token challenge temporaire signe cote serveur a l'etape password, qui doit etre presente avec le code 2FA. Ne jamais accepter un userId brut dans l'etape 2FA.

### H6. objectName controle par l'utilisateur dans les URLs presignees

**Fichiers** : `file/controller.ts:202-270`, `reverse-share/controller.ts:190-214`

L'`objectName` est controle par l'utilisateur et passe directement a `getPresignedPutUrl()` pour les reverse shares sans validation contre le reverse share.

**Vecteur d'attaque** : Un utilisateur authentifie avec acces a un reverse share peut demander des URLs PUT presignees pour des noms d'objets S3 arbitraires, ecrasant potentiellement les fichiers d'autres utilisateurs.

**Remediation** : Generer l'`objectName` cote serveur. Ne jamais l'accepter du client pour les operations d'ecriture.

---

## 3. Vulnerabilites MOYENNES

| # | Constat | Fichier | Description |
|---|---------|---------|-------------|
| M1 | Swagger/docs API publiquement exposes | `app.ts:92-102` | Documentation complete sans auth a `/swagger` et `/docs` |
| M2 | Bypass admin avec <=1 utilisateurs | `app/routes.ts:11-32` | Endpoints config accessibles sans auth admin |
| M3 | Pas de protection CSRF | Global | Avec `credentials: true` et auth par cookie, attaques CSRF possibles |
| M4 | Cookie JWT non signe | `app.ts:79-81` | `signed: false` -- pas de verification d'integrite |
| M5 | Fuite d'info systeme | `storage/service.ts:317-375` | `/storage/disk-space` expose tailles disque et chemins filesystem |
| M6 | Next.js image proxy SSRF | `next.config.ts:7-16` | Wildcard `hostname: "**"` permet de fetcher toute URL via `/_next/image` |
| M7 | `NODE_TLS_REJECT_UNAUTHORIZED=0` global | `storage.config.ts:65-71` | Desactive la verification TLS pour **tout le processus** |

---

## 4. Vulnerabilites BASSES

| # | Constat | Fichier |
|---|---------|---------|
| L1 | Filename non sanitise pour caracteres de chemin | `file/controller.ts:46` |
| L2 | Messages d'erreur exposent les details d'implementation | Multiples controllers |
| L3 | `Math.random()` utilise pour la generation de noms d'objets | `file/controller.ts:46,667` |
| L4 | Credentials SMTP placeholder dans le seed | `prisma/seed.js:106-112` |

---

## 5. Points Positifs

| Aspect | Evaluation |
|--------|-----------|
| SQL Injection | **Protege** -- Prisma utilise exclusivement des requetes parametrees. Pas de raw SQL. |
| XSS via innerHTML | **Protege** -- Zero `dangerouslySetInnerHTML` dans le frontend. |
| Password handling | **Solide** -- bcrypt cost 10, lockout configurable, tokens reset 128 bytes crypto. |
| Password reset tokens | **Solide** -- `crypto.randomBytes(128)`. |
| Database layer | **Solide** -- Prisma avec SQLite, pas de requetes raw, transactions la ou necessaire. |

---

## 6. Matrice de Risque

```
Impact
  ^
  |  C1 C2   C3       C5
  |  C4       H5  H6
  |      H1       H4
  |  H2  H3       M6  M7
  |      M1  M2   M3  M4  M5
  |  L1  L2  L3   L4
  +-----------------------------> Probabilite
     Faible  Moyenne  Elevee
```

---

## 7. Actions Prioritaires

### Immediat (exploitable aujourd'hui)

1. **C1** -- Restreindre CORS aux origines frontend connues
2. **C2** -- Reactiver la protection prototype pollution (`"error"`)
3. **C3** -- Ajouter authentification sur `/embed/:id`
4. **C4** -- Definir body limit a ~50MB
5. **Routes /s3/*** -- Ajouter authentification (couvert dans rapport backend)

### Cette semaine

6. **H1** -- Ajouter rate limiting global + renforce sur auth
7. **H5** -- Corriger le flux 2FA (token challenge server-side)
8. **H6** -- Generer objectName cote serveur

### Sprint suivant

9. **H2** -- Deplacer passwords des query params vers body/header
10. **H3** -- Defaulter cookie secure a true
11. **H4** -- Ajouter validation contenu fichier (magic bytes)
12. **M3** -- Implementer CSRF (double-submit cookie)
13. **M6** -- Restreindre les hostnames d'images Next.js
14. **M7** -- Limiter TLS bypass au seul client S3
