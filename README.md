# Ouitransfer - Transfert de Fichiers

**Ouitransfer** est une solution de transfert de fichiers auto-hébergée, alternative à WeTransfer, SendGB, Send Anywhere et Files.fm.

> Ce projet est distribué sous licence Apache-2.0. Voir [LICENSE](LICENSE) pour le texte complet.

## Fonctionnalités

- **Auto-hébergé** – Déployé sur vos propres serveurs.
- **Contrôle total** – Aucune dépendance tierce, confidentialité et sécurité garanties.
- **Sans limites artificielles** – Partage de fichiers sans restrictions cachées.
- **Organisation en dossiers** – Créez des dossiers pour organiser vos fichiers.
- **Déploiement simple** – Base SQLite et stockage filesystem.
- **Stockage scalable** – Support du stockage S3-compatible optionnel.

## Stack technique

### Backend & API
- **Fastify (Node.js)** – Framework API haute performance avec validation de schéma.
- **SQLite** – Base de données légère, zéro configuration.
- **Filesystem Storage** – Stockage direct avec option S3-compatible.

### Frontend
- **NextJS 15 + TypeScript + Shadcn/ui** – Interface web moderne et rapide.

## Architecture

```
apps/
├── docs/       # Site de documentation (Next.js + Fumadocs)
├── server/     # API Backend (Fastify + TypeScript)
└── web/        # Application Frontend (Next.js 15)
```

## Lancement rapide (Docker)

```bash
docker compose up -d
```

## Développement

```bash
pnpm install
# Dans chaque app :
pnpm dev
```

## Licence

Apache-2.0 – voir [LICENSE](LICENSE).
