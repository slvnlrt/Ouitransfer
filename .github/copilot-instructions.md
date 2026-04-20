# Instructions pour GitHub Copilot - Ouitransfer

Ce fichier contient des instructions pour GitHub Copilot afin d'aider au développement du projet Ouitransfer (Burger&Cie).

## Vue d'ensemble du projet

Ouitransfer est une solution de transfert de fichiers auto-hébergée pour Burger&Cie, construite avec :

- **Backend** : Fastify (Node.js) avec TypeScript, base SQLite, stockage filesystem/S3
- **Frontend** : Next.js 15 + React + TypeScript + Shadcn/ui
- **Documentation** : Next.js + Fumadocs + MDX
- **Package Manager** : pnpm (v10.6.0)
- **Structure Monorepo** : Trois apps (web, server, docs) dans le répertoire `apps/`

## Architecture

```
apps/
├── docs/       # Site de documentation (Next.js + Fumadocs)
├── server/     # API Backend (Fastify + TypeScript)
└── web/        # Application Frontend (Next.js 15)
```

## Technologies clés

- **TypeScript** : Langage principal pour toutes les applications
- **Base de données** : Prisma ORM avec SQLite (stockage S3-compatible optionnel)
- **Authentification** : Multiple providers OAuth (Google, GitHub, Discord, etc.)
- **Internationalisation** : Support multi-langues avec scripts de traduction
- **Validation** : Hooks Husky pre-push pour linting et vérification des types

## Workflow de développement

### Convention de commits

Utiliser le format Conventional Commits :

```
<type>(<scope>): <description>

Types :
- feat: Nouvelle fonctionnalité
- fix: Correction de bug
- docs: Modifications de documentation
- test: Ajout ou mise à jour de tests
- refactor: Refactoring de code
- style: Formatage de code
- chore: Tâches de maintenance
```

### Qualité de code

1. **Linting** : Toutes les apps utilisent ESLint. Lancer `pnpm lint` avant de commiter
2. **Formatage** : Utiliser Prettier. Lancer `pnpm format`
3. **Vérification de types** : Lancer `pnpm type-check`
4. **Validation** : Lancer `pnpm validate` pour linting + vérification de types

## Commandes utiles

### Racine

```bash
pnpm install          # Installer toutes les dépendances
```

### Par app (web/server/docs)

```bash
pnpm dev              # Démarrer le serveur de développement
pnpm build            # Build pour la production
pnpm lint             # Lancer ESLint
pnpm format           # Formater le code avec Prettier
pnpm type-check       # Vérification des types TypeScript
pnpm validate         # lint + type-check
```

### Docker

```bash
docker compose up     # Démarrer tous les services
docker compose down   # Arrêter tous les services
```

## Licence

Apache-2.0
