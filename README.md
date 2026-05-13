# Ouitransfer

**Ouitransfer** est une solution de transfert de fichiers auto-hébergée, alternative à WeTransfer, SendGB et Files.fm.

> Distribué sous licence Apache-2.0. Voir [LICENSE](LICENSE) pour le texte complet.

## Fonctionnalités

- **Auto-hébergé** — Déployé sur vos propres serveurs, aucune dépendance tierce.
- **Contrôle total** — Confidentialité et sécurité garanties, données chez vous.
- **Organisation en dossiers** — Créez des dossiers pour organiser vos fichiers.
- **Stockage S3-compatible** — RustFS intégré (zéro configuration) ou S3 externe (AWS, Backblaze…).
- **Authentification sécurisée** — JWT httpOnly, 2FA TOTP, protection CSRF.
- **Interface multilingue** — 23 langues supportées (dont RTL).

## Stack technique

### Backend
- **Fastify 5** — API haute performance, validation Zod, ESM natif
- **Prisma + SQLite** — Base de données légère, zéro configuration
- **RustFS** — Stockage objet S3-compatible intégré (ou S3 externe)

### Frontend
- **Next.js 15 + React 19** — App Router, rendu serveur
- **Tailwind CSS 4 + shadcn/ui** — Interface moderne
- **TanStack Query v5** — Gestion du cache et des requêtes

### Infrastructure
- **Docker Compose** — 3 services séparés : stockage, API, web
- **pnpm 10 + Turborepo** — Monorepo workspace

## Architecture

```
apps/
├── docs/       # Documentation (Next.js + Fumadocs)
├── server/     # API Backend (Fastify + TypeScript)
└── web/        # Frontend (Next.js 15)
packages/
├── shared/     # Utilitaires partagés (@ouitransfer/shared)
└── config/     # Configs TypeScript partagées (@ouitransfer/config)
infra/          # Scripts de déploiement
```

## Démarrage rapide (Docker)

```bash
# 1. Copier et configurer l'environnement
cp .env.example .env
# Renseigner les secrets obligatoires dans .env

# 2. Lancer les 3 services
docker compose up -d
```

Les services exposés :
- `http://localhost:3333` — API (Fastify)
- `http://localhost:5487` — Interface web (Next.js)
- `http://localhost:9000` — Stockage S3 (RustFS)

## Développement

### Prérequis
- Node.js 24+
- pnpm 10.6+
- [`just`](https://github.com/casey/just) (task runner)

### Installation

```bash
pnpm install
just setup         # Configure la base de données et les variables d'env
just dev           # Lance tous les services en mode développement
```

### Commandes utiles

```bash
just              # Lister toutes les commandes disponibles
just dev          # Dev (server + web + docs en parallèle)
just test         # Tests unitaires (Vitest)
just lint         # Lint + format (Biome)
just validate     # Type-check + lint + tests
just db-studio    # Ouvrir Prisma Studio
just db-seed      # Alimenter la base avec des données de test
just docker-start # Lancer la stack Docker
```

## Outillage

| Outil | Usage |
|-------|-------|
| [Biome](https://biomejs.dev) | Lint + formatage (remplace ESLint + Prettier) |
| [Vitest](https://vitest.dev) | Tests unitaires |
| [Playwright](https://playwright.dev) | Tests E2E |
| [Lefthook](https://github.com/evilmartians/lefthook) | Hooks Git (pre-commit, commit-msg) |
| [commitlint](https://commitlint.js.org) | Validation des messages de commit |
| [Renovate](https://docs.renovatebot.com) | Mise à jour automatique des dépendances |
| [Knip](https://knip.dev) | Détection du code mort |

## Licence

Apache-2.0 — voir [LICENSE](LICENSE).
