# Rapport d'Audit #4 : Infrastructure & DevOps

**Projet** : Ouitransfer v3.3.2-beta
**Date** : 2026-04-20
**Scope** : Dockerfile, Docker Compose, scripts infra, CI/CD, MinIO, Supervisor, Git hooks

---

## Resume Executif

L'infrastructure de build et deploiement est **fonctionnelle mais fragile**. Le Dockerfile multi-stage est bien concu (5 stages, Alpine, non-root, chown caching), mais l'absence totale de CI/CD (zero GitHub Actions) est un bloqueur critique. Les scripts d'infrastructure contiennent des problemes de securite (credentials world-readable, pas de checksums sur binaires telecharges) et des inconsistances (UID/GID 1000 vs 1001).

---

## 1. Dockerfile

**Fichier** : `Dockerfile` (263 lignes)

| Aspect | Detail |
|--------|--------|
| Image de base | `node:24-alpine` |
| Multi-stage | 5 stages : base, server-deps, server-builder, web-deps, web-builder, runner |
| Process manager | supervisord |
| S3 interne | MinIO telecharge au build |
| Ports exposes | 3333 (API), 5487 (Web), 9379 (MinIO S3), 9378 (MinIO Console) |
| Health check | `curl -f http://localhost:5487` toutes les 30s |

### Points forts

- Multi-stage build bien structure
- `pnpm install --frozen-lockfile` pour reproductibilite
- Telemetrie Next.js desactivee
- Utilisateur non-root cree avec UID/GID configurables
- Smart chown caching avec fichier marqueur UID/GID

### Constats

| Severite | Constat | Localisation |
|----------|---------|-------------|
| **WARN** | MinIO installe dans le stage `base` -- present dans les stages de build malgre qu'il ne soit necessaire qu'au runtime. Gonfle les layers intermediaires (+100MB). | `Dockerfile:16-21` |
| **WARN** | Script de demarrage inline de 100 lignes en heredoc dans le Dockerfile. Difficile a lire et tester independamment. | `Dockerfile:145-248` |
| **WARN** | `VOLUME ["/app/server"]` declare -- cree un volume anonyme si non mappe explicitement, risque de perte de donnees. | `Dockerfile:253` |
| **INFO** | Le container demarre en root (necessaire pour chown), puis delegue a supervisord qui utilise `su-exec` pour drop les privileges. | `Dockerfile:247` |

---

## 2. Docker Compose

**Fichier** : `docker-compose.yaml` (55 lignes)

| Aspect | Detail |
|--------|--------|
| Services | 1 (`ouitransfer`) |
| Image | `slvnlrt/ouitransfer:latest` |
| Volumes | Volume nomme `ouitransfer_data` mappe sur `/app/server` |
| Ports | 9379, 5487, 3333 |
| Restart | `unless-stopped` |

### Constats

| Severite | Constat | Localisation |
|----------|---------|-------------|
| **CRITIQUE** | `STORAGE_URL: "https://ouitransfer-demo:9379"` -- placeholder hostname qui ne fonctionnera pas. Le scheme `https` est incoherent avec `S3_USE_SSL=false` en interne. | `docker-compose.yaml:35` |
| **INFO** | Variables d'environnement bien documentees avec commentaires. Pas de secrets dans le fichier compose. |
| **INFO** | Port 9378 (console MinIO) expose dans Dockerfile mais pas mappe dans compose (securite par defaut). |

---

## 3. Scripts d'Infrastructure

### `infra/build-docker.sh` (39 lignes) -- Build multi-platform

| Severite | Constat |
|----------|---------|
| **WARN** | Interactif (`read -p`) -- inutilisable en CI/CD. |
| **WARN** | `--push` hardcode -- pas d'option de build local sans push. |
| **INFO** | Utilise `docker buildx` pour builds multi-platform (amd64 + arm64). |

### `infra/server-start.sh` (147 lignes) -- Entrypoint serveur

| Severite | Constat |
|----------|---------|
| **WARN** | Default UID/GID `1000` ici vs `1001` dans Dockerfile et `start-minio.sh`. Inconsistance de permissions. |
| **INFO** | Bonne boucle d'attente des credentials MinIO (60s timeout). |
| **INFO** | Bon drop de privileges via `su-exec`. |
| **INFO** | Detection premier lancement + migrations Prisma + seed automatique. |

### `infra/install-minio.sh` (60 lignes) -- Installation MinIO

| Severite | Constat |
|----------|---------|
| **WARN** | Pas de verification checksum SHA256 sur le binaire telecharge. |
| **INFO** | Version MinIO epinglee (`RELEASE.2024-10-13T13-34-11Z`). |
| **INFO** | Sortie gracieuse (exit 0) en cas d'echec -- l'app peut fonctionner avec un S3 externe. |

### `infra/install-mc.sh` (56 lignes) -- Installation client MinIO

| Severite | Constat |
|----------|---------|
| **WARN** | **Pas d'epinglage de version** -- telecharge la derniere version `mc`. Builds non reproductibles. |
| **WARN** | Pas de verification checksum SHA256. |
| **WARN** | Exit 1 en cas d'echec (inconsistant avec `install-minio.sh` qui exit 0). |

### `infra/minio-setup.sh` (118 lignes) -- Configuration post-start

| Severite | Constat |
|----------|---------|
| **WARN** | `chmod 644` sur le fichier credentials -- world-readable. Devrait etre 600. |
| **WARN** | Les credentials root MinIO sont utilisees comme credentials applicatives (pas de service account dedie). L'app a un acces admin complet a MinIO. |
| **INFO** | Politique bucket correctement definie sur "private" (pas d'acces anonyme). |

### `infra/start-minio.sh` (82 lignes) -- Demarrage MinIO

| Severite | Constat |
|----------|---------|
| **WARN** | `.minio.sys` supprime a chaque demarrage -- force la regeneration des metadonnees internes. Peut causer des problemes avec les politiques IAM persistees. |
| **INFO** | Mot de passe genere via `openssl rand -hex 16`. Fichier password en chmod 600. |
| **INFO** | Drop de privileges via `su-exec`. |

### `infra/supervisord.conf` (63 lignes) -- Gestionnaire de processus

| Programme | Commande | User | Priorite | Autorestart |
|-----------|----------|------|----------|-------------|
| `minio` | `/app/start-minio.sh` | root (drop via su-exec) | 50 | always |
| `minio-setup` | `/app/minio-setup.sh` | root (drop via su-exec) | 60 | on unexpected exit |
| `server` | `/app/server-start.sh` | root (drop via su-exec) | 100 | always |
| `web` | Attente health API + `node server.js` | `ouitransfer` | 200 | always |

**Ordre de demarrage garanti** par priorites : MinIO (50) -> Setup (60) -> Server (100) -> Web (200).

| Severite | Constat |
|----------|---------|
| **INFO** | Logs vers stdout/stderr -- compatible avec les log drivers Docker. |
| **INFO** | `minio-setup` configure en run-once (autorestart=unexpected, exitcodes=0). |

---

## 4. CI/CD

### [CRITIQUE] Aucun pipeline CI/CD

**Zero** workflows GitHub Actions. Le repertoire `.github/` contient uniquement :
- `FUNDING.yml` -- placeholder
- `pull_request_template.md` -- template PR
- `copilot-instructions.md` -- instructions AI

**Consequences** :
- Pas de tests automatises sur les PRs
- Pas de builds/publication d'images automatiques
- Pas d'enforcement lint/type-check
- Builds manuels via `make build` / `infra/build-docker.sh`
- Deploiement entierement manuel

---

## 5. Git Hooks

**Fichier** : `.husky/pre-push` (12 lignes)

Un seul hook `pre-push` qui lance `pnpm validate` sur les 3 apps.

| Severite | Constat |
|----------|---------|
| **WARN** | Pas de hook pre-commit (pas de lint-staged, pas de formatting, pas de validation commit message). |
| **WARN** | Enchainement `cd` fragile (`cd ../docs`, `cd ../server`) qui depend du succes des `cd` precedents. |

---

## 6. Tableau Recapitulatif

| # | Severite | Constat | Localisation |
|---|----------|---------|-------------|
| 1 | **CRITIQUE** | Aucun pipeline CI/CD | `.github/workflows/` (absent) |
| 2 | **CRITIQUE** | STORAGE_URL placeholder non fonctionnel | `docker-compose.yaml:35` |
| 3 | **WARN** | Credentials MinIO world-readable (644) | `minio-setup.sh:109` |
| 4 | **WARN** | Credentials root MinIO utilisees par l'app | `minio-setup.sh:93-95` |
| 5 | **WARN** | Pas de checksum sur binaires telecharges | `install-minio.sh`, `install-mc.sh` |
| 6 | **WARN** | Client `mc` non versionne | `install-mc.sh:25` |
| 7 | **WARN** | UID/GID defaults inconsistants (1000 vs 1001) | `server-start.sh:34` vs `Dockerfile:87` |
| 8 | **WARN** | `.minio.sys` supprime a chaque demarrage | `start-minio.sh:25-28` |
| 9 | **WARN** | MinIO dans le stage base (gonfle layers build) | `Dockerfile:16-21` |
| 10 | **WARN** | Heredoc 100 lignes inline dans Dockerfile | `Dockerfile:145-248` |
| 11 | **WARN** | Build script interactif + push obligatoire | `build-docker.sh` |
| 12 | **WARN** | Hook pre-push avec cd fragile | `.husky/pre-push` |

---

## 7. Recommandations Prioritaires

1. **Mettre en place GitHub Actions** -- Au minimum : lint + typecheck sur PRs, build d'image Docker automatise sur tags.
2. **Creer un service account MinIO dedie** au lieu d'utiliser les credentials root.
3. **Fixer les permissions credentials** a 600.
4. **Ajouter la verification SHA256** sur les binaires telecharges (MinIO server et client).
5. **Epingler la version du client `mc`** comme le serveur MinIO.
6. **Harmoniser les UID/GID par defaut** -- choisir 1001 partout.
7. **Extraire le heredoc** `start.sh` du Dockerfile dans `infra/start.sh`.
8. **Deplacer l'installation MinIO** dans un stage dedie ou uniquement dans le stage runner.
9. **Ajouter l'option `--no-push`** au script de build Docker.
10. **Ajouter un hook pre-commit** avec lint-staged pour le formatting.
