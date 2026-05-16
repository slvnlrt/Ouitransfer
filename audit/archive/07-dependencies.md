# Rapport d'Audit #7 : Dependances & Supply Chain

**Projet** : Ouitransfer v3.3.2-beta
**Date** : 2026-04-20
**Scope** : Versions, vulnerabilites, licences, duplication, freshness

---

## Resume Executif

Le stack technique principal est **a jour** (Next.js 15.3.6, React 19.1, Fastify 5, Tailwind 4.1). Les problemes sont concentres sur **3 packages abandonnes/vulnerables** (`crypto-js`, `speakeasy`, `react-qr-reader`) et l'absence de workspace pnpm qui cause une installation triple des dependances. Le surpoids lie a 3 librairies d'icones et au `node-fetch` desormais inutile merite aussi attention.

---

## 1. Configuration Package Manager

| Aspect | Constat | Severite |
|--------|---------|----------|
| Package manager | pnpm@10.6.0 | info |
| Lockfile version | 9.0 | info |
| Workspace config | **Absent (`pnpm-workspace.yaml`)** | **CRITIQUE** |
| Lock files | Chaque app a son propre `pnpm-lock.yaml` | **WARN** |
| `.npmrc` | Absent | info |
| `.nvmrc` | Absent | info |

Sans `pnpm-workspace.yaml`, chaque app installe sa propre arborescence de dependances. Les versions peuvent deriver entre apps (ex. `@radix-ui/react-dialog` ^1.1.6 vs ^1.1.15). L'espace disque est multiplie.

---

## 2. Dependances Serveur (`apps/server`)

### Production -- Packages critiques

| Package | Version | Statut | Risque |
|---------|---------|--------|--------|
| `fastify` | ^5.4.0 | A jour | - |
| `@prisma/client` | ^6.11.0 | A jour | - |
| `@aws-sdk/client-s3` | ^3.817.0 | A jour | - |
| `bcryptjs` | ^2.4.3 | Stable | - |
| `zod` | ^3.25.67 | A jour | - |
| `jose` | ^5.10.0 | A jour | - |
| `sharp` | ^0.34.2 | A jour | Surface native |
| **`crypto-js`** | **^4.2.0** | **Abandonne** | **CRITIQUE** -- CVE-2023-46233 |
| **`speakeasy`** | **^2.0.0** | **Abandonne (2017)** | **CRITIQUE** |
| `node-fetch` | ^3.3.2 | Supersede | **WARN** -- inutile avec Node 18+ |
| `@types/crypto-js` | ^4.2.2 | Mal place | **WARN** -- devrait etre devDep |

### Dev -- Probleme notable

| Package | Version | Probleme |
|---------|---------|----------|
| `prisma` | ^6.3.1 | **WARN** -- diverge de `@prisma/client` ^6.11.0 |
| `ts-node` + `tsx` | ^10.9.2 / ^4.19.2 | Redondant -- garder tsx |
| `typescript` | ^5.7.3 | Desynchro avec web/docs (5.8.3) |

---

## 3. Dependances Web (`apps/web`)

### Production -- Packages critiques

| Package | Version | Statut | Risque |
|---------|---------|--------|--------|
| `next` | 15.3.6 | A jour | - |
| `react` | ^19.1.0 | A jour | - |
| `@uppy/core` | ^4.5.2 | A jour | - |
| `axios` | ^1.10.0 | A jour | Bypass fetch Next.js |
| `next-intl` | ^4.3.1 | A jour | - |
| `zustand` | ^5.0.6 | A jour | - |
| **`react-qr-reader`** | **3.0.0-beta-1** | **Archive** | **CRITIQUE** -- beta abandonnee, acces camera |
| **`@tabler/icons-react`** | **^3.34.0** | A jour | **WARN** -- 1 des 3 librairies icones |
| **`lucide-react`** | **^0.525.0** | A jour | **WARN** -- doublon |
| **`react-icons`** | **^5.5.0** | A jour | **WARN** -- troisieme doublon |
| `nookies` | ^2.5.2 | Stale (2022) | **WARN** -- concu pour Pages Router |
| `framer-motion` | ^12.20.1 | Renomme | **WARN** -- devrait etre `motion` |
| `@types/react-dropzone` | ^5.1.0 | Mal place | **WARN** -- devrait etre devDep |

---

## 4. Dependances Docs (`apps/docs`)

Le docs app est **propre et a jour**. Pas de probleme notable.

| Package | Version | Statut |
|---------|---------|--------|
| `fumadocs-core` | 15.2.7 | A jour |
| `next` | 15.3.6 | A jour |
| `react` | ^19.1.0 | A jour |
| `motion` | ^12.23.0 | A jour (nom correct) |
| `lucide-react` | ^0.525.0 | A jour |

---

## 5. Vulnerabilites de Securite

### CRITIQUES

| Package | CVE/Probleme | Details |
|---------|-------------|---------|
| **`crypto-js`** | CVE-2023-46233 | PBKDF2 utilise 1 seule iteration par defaut. PRNG faible. Pas de mise a jour depuis 2023. |
| **`speakeasy`** | Abandonne depuis 2017 | 9 ans sans mises a jour. Multiples issues non-patchees. Gere les secrets TOTP. |
| **`react-qr-reader`** | Repository archive | Version beta en production. Pas de patchs securite. Acces a la camera. |

### Remplacements recommandes

| Actuel | Remplacement | Justification |
|--------|-------------|---------------|
| `crypto-js` | Module `crypto` natif Node.js | Natif, zero dependance, maintenu |
| `speakeasy` | `otpauth` | Activement maintenu, TypeScript natif |
| `react-qr-reader` | `@yudiel/react-qr-scanner` ou `html5-qrcode` | Maintenus, versions stables |

---

## 6. Duplication Inter-Apps

| Package | server | web | docs | Action |
|---------|--------|-----|------|--------|
| `zod` | ^3.25.67 | ^3.25.67 | - | Hoist racine |
| `react` | - | ^19.1.0 | ^19.1.0 | Hoist racine |
| `next` | - | 15.3.6 | 15.3.6 | Hoist racine |
| `lucide-react` | - | ^0.525.0 | ^0.525.0 | Hoist racine |
| `clsx` | - | ^2.1.1 | ^2.1.1 | Hoist racine |
| `class-variance-authority` | - | ^0.7.1 | ^0.7.1 | Hoist racine |
| `tailwind-merge` | - | ^3.3.1 | ^3.2.0 | **Drift** -- aligner |
| `@radix-ui/react-dialog` | - | ^1.1.6 | ^1.1.15 | **Drift** -- aligner |
| ESLint toolchain (7 pkgs) | exact | exact | exact | Hoist racine |
| Prettier toolchain (3 pkgs) | exact | exact | exact | Hoist racine |
| TypeScript | ^5.7.3 | 5.8.3 | ^5.8.3 | **Drift** -- aligner |

---

## 7. Freshness

| Categorie | Statut |
|-----------|--------|
| Frameworks principaux (Next.js, React, Fastify, Tailwind) | **A jour** |
| ORM (Prisma) | **A jour** (mais mismatch CLI/client) |
| Validation (Zod) | **A jour** |
| Build tools (ESLint, Prettier, TypeScript) | **A jour** |
| Packages abandonnes | **3 critiques** |
| Packages stales | 2 (nookies, node-fetch) |

---

## 8. Conformite Licences

**Licence du projet** : Apache-2.0 (declaree dans les `package.json`, mais **pas de fichier LICENSE a la racine**).

| Verification | Resultat |
|-------------|----------|
| Risque GPL/AGPL | **Aucun** -- toutes les dependances sont MIT ou Apache-2.0 |
| Incompatibilites | **Aucune detectee** |
| Fichier LICENSE racine | **ABSENT** |

---

## 9. Separation Dev/Prod

| Probleme | App | Severite |
|----------|-----|----------|
| `@types/crypto-js` dans `dependencies` | server | **WARN** |
| `@types/react-dropzone` dans `dependencies` | web | **WARN** |
| `tw-animate-css` dans `dependencies` (web) vs `devDependencies` (docs) | web/docs | info |

La separation dev/prod est generalement correcte par ailleurs.

---

## 10. Tableau Recapitulatif

| # | Severite | Constat |
|---|----------|---------|
| 1 | **CRITIQUE** | `crypto-js` -- CVE-2023-46233, abandonne |
| 2 | **CRITIQUE** | `speakeasy` -- abandonne depuis 2017, gere les secrets TOTP |
| 3 | **CRITIQUE** | `react-qr-reader` -- beta archivee, acces camera |
| 4 | **WARN** | Pas de `pnpm-workspace.yaml` -- 3 lockfiles independants |
| 5 | **WARN** | Mismatch Prisma CLI (^6.3.1) vs Client (^6.11.0) |
| 6 | **WARN** | 3 librairies d'icones (tabler + lucide + react-icons) |
| 7 | **WARN** | `node-fetch` inutile avec Node.js 18+ natif |
| 8 | **WARN** | `nookies` stale, concu pour Pages Router |
| 9 | **WARN** | `framer-motion` vs `motion` (renomme) -- inconsistance |
| 10 | **WARN** | `@types/*` dans production dependencies |
| 11 | **WARN** | Drift TypeScript : ^5.7.3 vs 5.8.3 |
| 12 | **WARN** | Fichier LICENSE racine absent |

---

## 11. Actions Prioritaires

1. **Remplacer `speakeasy`** par `otpauth` -- securite critique, package abandonne gerant des secrets
2. **Supprimer `crypto-js`**, utiliser le module `crypto` natif Node.js -- CVE connue
3. **Remplacer `react-qr-reader`** -- beta archivee avec acces camera
4. **Creer `pnpm-workspace.yaml`** et consolider en un seul lockfile
5. **Aligner versions Prisma** CLI et client
6. **Ajouter un fichier LICENSE** a la racine du repo
7. **Consolider les librairies d'icones** sur `lucide-react`
8. **Supprimer `node-fetch`**, utiliser fetch natif
9. **Deplacer `@types/*`** hors des dependencies de production
