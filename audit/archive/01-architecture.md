# Rapport d'Audit #1 : Architecture & Structure

**Projet** : Ouitransfer v3.3.2-beta
**Date** : 2026-04-20
**Scope** : Structure monorepo, organisation des apps, systeme de build, configuration

---

## Resume Executif

L'architecture de Ouitransfer repose sur un **faux monorepo** : la structure `apps/` existe mais sans `pnpm-workspace.yaml`, chaque application maintient son propre lockfile et ses dependances independantes. Le projet compte **508 fichiers TS/TSX** pour environ **55K lignes de code** reparties sur 3 applications (server Fastify, web Next.js 15, docs Fumadocs). L'absence d'orchestration de build, de packages partages et de configs mutualisees constitue la dette architecturale principale.

---

## 1. Configuration du Workspace

| Attribut | Valeur |
|----------|--------|
| Nom racine | `ouitransfer-monorepo` |
| Version | `3.3.2-beta` |
| Package manager | `pnpm@10.6.0` |
| Private | `true` |

### [CRITIQUE] Pas de `pnpm-workspace.yaml`

Malgre la structure `apps/`, **ce n'est pas un vrai monorepo pnpm**. Chaque app a son propre `pnpm-lock.yaml` :

- `./pnpm-lock.yaml` (racine -- uniquement husky)
- `apps/server/pnpm-lock.yaml`
- `apps/web/pnpm-lock.yaml`
- `apps/docs/pnpm-lock.yaml`

**Consequences** :
- Les dependances ne sont ni hoistees ni deduplicees entre apps
- Chaque app installe l'integralite de son arbre de dependances
- Aucun `node_modules` partage -- l'espace disque est multiplie x3
- Le drift de versions entre apps est incontrolable

Le `package.json` racine ne contient que `husky` en devDependency. Aucun script workspace-level pour builder, linter ou lancer toutes les apps.

### Zero reference `workspace:`

Aucune reference inter-packages. Pas de packages partages. Chaque app est totalement independante.

---

## 2. Arborescence

```
D:\Code\Ouitransfer\
+-- .dockerignore, .gitignore
+-- .github/                        # FUNDING, PR template, copilot-instructions
+-- .husky/pre-push                 # pnpm validate sur les 3 apps
+-- apps/
|   +-- server/                     # Fastify API (Node.js backend)
|   +-- web/                        # Next.js 15 frontend
|   +-- docs/                       # Fumadocs documentation site
+-- infra/                          # Docker + deployment scripts (13 fichiers)
+-- docker-compose.yaml
+-- Dockerfile                      # Multi-stage unified image
+-- Makefile
+-- package.json
+-- pnpm-lock.yaml
+-- README.md, CONTRIBUTING.md
```

### Metriques

| App | Fichiers TS/TSX | Lignes de code | Modules |
|-----|-----------------|----------------|---------|
| **server** | 74 | ~15 092 | 15 modules feature-based |
| **web** | 403 | ~37 743 | 17 pages, 33 shadcn/ui, 101 proxy routes |
| **docs** | 31 | ~2 122 | 32 pages MDX |
| **Total** | **508** | **~54 957** | |

---

## 3. Architecture Applicative

### Server (apps/server) -- Feature-based Modular

15 modules sous `src/modules/`, chacun suivant un pattern MVC coherent :

| Module | Fichiers | Pattern |
|--------|----------|---------|
| `app` | 5 | controller, service, routes, dto, logo.service |
| `auth` | 5 | controller, service, routes, dto, trusted-device.service |
| `auth-providers` | 6 | controller, service, routes, dto, types, providers.config |
| `file` | 4 | controller, service, routes, dto |
| `folder` | 4 | controller, service, routes, dto |
| `share` | 5 | controller, service, routes, dto, repository |
| `reverse-share` | 5 | controller, service, routes, dto, repository |
| `user` | 7 | controller, service, routes, dto, repository, middleware, avatar.service |
| `config`, `email`, `health`, `invite`, `s3-storage`, `storage`, `two-factor` | 1-4 | Variable |

DTOs via schemas Zod (fastify-type-provider-zod). Pattern repository inconsistent : uniquement user, share, reverse-share.

### Web (apps/web) -- Hybrid App Router

**Organisation duale** :
- **Pages co-localisees** sous `src/app/` : chaque route a ses propres `components/`, `hooks/`, `types/`, `modals/`
- **Composants partages** sous `src/components/` : ui (33 shadcn), modals (17), tables (4), layout (4), etc.
- **Couche proxy** sous `src/app/api/(proxy)/` : **101 route handlers** proxifiant vers le backend Fastify

### Docs (apps/docs) -- Simple

31 fichiers source, principalement du contenu MDX avec quelques composants custom (magicui animations, OIDC cards, key generator).

---

## 4. Communication Inter-Apps

### Web -> Server : Pattern BFF Proxy

```
Browser --> Next.js API Routes (/api/(proxy)/**) --> Backend Fastify (http://127.0.0.1:3333)
```

- **101 fichiers proxy** dans `src/app/api/(proxy)/`
- Chaque fichier proxifie un seul appel API vers le backend
- Client HTTP : Axios avec `withCredentials: true`, timeout 2min
- Layer API typee : `src/http/endpoints/` avec fonctions par domaine

### [WARN] URL mal-formee dans `.env.example`

`API_BASE_URL=http:localhost:3333` -- il manque `//` apres `http:`.

---

## 5. Duplication de Code

### [WARN] `mime-types.ts` duplique

- `apps/server/src/utils/mime-types.ts` -- 378 lignes
- `apps/web/src/utils/mime-types.ts` -- 435 lignes (version "adaptee du serveur")

Cas d'ecole pour un package partage.

### Dependances dupliquees entre apps

| Package | server | web | docs | Drift |
|---------|--------|-----|------|-------|
| `zod` | ^3.25.67 | ^3.25.67 | - | Non |
| `typescript` | ^5.7.3 | 5.8.3 | ^5.8.3 | **Oui** |
| `eslint` | 9.30.0 | 9.30.0 | 9.30.0 | Non |
| `@radix-ui/react-dialog` | - | ^1.1.6 | ^1.1.15 | **Oui** |
| `tailwind-merge` | - | ^3.3.1 | ^3.2.0 | **Oui** |

---

## 6. Systeme de Build

### Par app -- Aucune orchestration

| App | Framework | Build | Dev | Output |
|-----|-----------|-------|-----|--------|
| server | Fastify + tsc | `tsc -p tsconfig.json` -> `dist/` | `tsx watch src/server.ts` | CommonJS |
| web | Next.js 15.3.6 | `next build` (standalone) | `next dev -p 3000` | `.next/standalone/` |
| docs | Next.js 15.3.6 + Fumadocs | `next build` | `next dev -p 3001` | `.next/` |

**Pas de turborepo, nx, ou scripts workspace.** Le Dockerfile build chaque app independamment dans des stages separees. Le hook pre-push lance `pnpm validate` sequentiellement sur chaque app.

### Configuration dupliquee x3

| Config | server | web | docs |
|--------|--------|-----|------|
| `tsconfig.json` | ES2022/node16 | ES2017/bundler | ESNext/bundler |
| `eslint.config.mjs` | TS only | TS + Next.js | TS + Next.js |
| `.prettierrc.json` | Quasi-identique | Quasi-identique | Quasi-identique |
| `pnpm-lock.yaml` | Independant | Independant | Independant |

**31 fichiers de configuration au total** (4 racine + 7 server + 10 web + 10 docs).

---

## 7. Gestion de Versions

- Version actuelle : `3.3.2-beta` (synchronisee dans les 4 `package.json`)
- Mise a jour via `infra/update-versions.sh` (sed) / `make update-version`
- Tag Docker coordonne manuellement -- pas d'automatisation version <-> tag

---

## 8. Decisions Architecturales Notables

| Decision | Impact |
|----------|--------|
| **Image Docker unique** (MinIO + API + Web via Supervisor) | Simplifie le deploiement self-hosted, viole le principe 1 process/container |
| **SQLite via Prisma** | Adequat pour self-hosted, limite le scaling horizontal |
| **101 routes proxy** | Necessaire pour les cookies, mais enorme surface de maintenance |
| **11 Google Fonts preloades** dans le root layout | Impact LCP et poids page |
| **Docs supprime les erreurs TS/ESLint** au build | `ignoreDuringBuilds: true` + `ignoreBuildErrors: true` |
| **`bodyLimit: 1PB`** dans Fastify | Effectivement illimite, vecteur DoS |

---

## 9. Tableau des Constats

| # | Severite | Constat | Localisation |
|---|----------|---------|-------------|
| 1 | **CRITIQUE** | Pas de `pnpm-workspace.yaml` -- faux monorepo | Racine |
| 2 | **WARN** | 101 routes proxy manuelles | `apps/web/src/app/api/(proxy)/` |
| 3 | **WARN** | `mime-types.ts` duplique (378 + 435 LOC) | `src/utils/mime-types.ts` x2 |
| 4 | **WARN** | Configs dupliquees x3 (ESLint, Prettier, TSConfig) | Toutes les apps |
| 5 | **WARN** | URL mal-formee `.env.example` : `http:localhost:3333` | `apps/web/.env.example` |
| 6 | **WARN** | Docs build ignore erreurs TS/ESLint | `apps/docs/next.config.mjs` |
| 7 | **WARN** | 11 Google Fonts chargees dans le root layout | `apps/web/src/app/layout.tsx` |
| 8 | **WARN** | Aucune orchestration de build | Racine |
| 9 | **WARN** | Drift TypeScript : ^5.7.3 vs 5.8.3 | `package.json` |
| 10 | **INFO** | Image Docker multi-process (Supervisor) | `Dockerfile`, `supervisord.conf` |
| 11 | **INFO** | SQLite (limite scaling horizontal) | `prisma/schema.prisma` |

---

## 10. Recommandations Prioritaires

1. **Creer `pnpm-workspace.yaml`** -- Impact le plus eleve. Definir les workspaces, deduplicer les lockfiles, activer `pnpm -r`.
2. **Extraire des packages partages** -- Au minimum `packages/shared` pour `mime-types.ts`, types communs, utilitaires.
3. **Consolider les configs** -- `tsconfig.base.json` racine, config ESLint partagee, config Prettier partagee.
4. **Ajouter Turborepo** -- Pour le caching et l'orchestration de build.
5. **Corriger le `.env.example`** -- `http:localhost` -> `http://localhost`.
6. **Evaluer la couche proxy** -- Considerer un reverse proxy (nginx/caddy) dans Docker pour eliminer les 101 routes boilerplate.
7. **Corriger le build docs** -- Retirer `ignoreDuringBuilds` et `ignoreBuildErrors` apres correction des erreurs.
8. **Auditer le chargement de fonts** -- Charger a la demande ou reduire a 2-3 familles.
