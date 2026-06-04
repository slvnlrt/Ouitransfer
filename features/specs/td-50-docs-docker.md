# TD-50 — Déployer le site Fumadocs via Docker

> **Statut :** Done
> **Type :** Infrastructure (Docker / self-hosting)
> **Origine :** TECHNICAL-DEBT.md TD-50

---

## Problème

Le stack Docker n'embarquait que 3 services (`storage`, `server`, `web`). `apps/docs`
(site Fumadocs : landing marketing + doc versionnée) n'existait ni dans le `Dockerfile`
(aucune cible `docs-runner`) ni dans `docker-compose.yaml`. Il ne tournait qu'en dev
autonome (`just dev`, port 3001). Impossible de servir la doc sur une instance
auto-hébergée.

## Décisions (validées avec l'utilisateur)

| Sujet | Décision |
|-------|----------|
| **URL** | Préfixe de chemin `/docs` sur le domaine principal (`https://host/docs`). |
| **Routage prod** | Via **Traefik** (`PathPrefix(/docs)`, **sans StripPrefix**). Le compose nu du repo expose aussi le port 5488 en direct pour le self-host sans Traefik. |
| **Landing** | Conservée telle quelle. Conséquence assumée : la doc vit sous `/docs/docs/v1-beta` (double `/docs`), car l'app sert déjà sa doc sous `/docs` en interne. Zéro changement de contenu, risque minimal. |
| **Mécanisme** | `basePath` Next.js, figé dans l'image au build via l'ARG `NEXT_PUBLIC_DOCS_BASE_PATH` (défaut `/docs`). Vide ⇒ pas de préfixe (cas sous-domaine, nécessite un rebuild). |

## Pourquoi `basePath` (et pas StripPrefix)

`basePath` fait suivre automatiquement **tout** : assets `_next`, route de recherche
Fumadocs (`/docs/api/search`), liens `next/link`, optimisation d'images. Traefik n'a
donc qu'un simple `PathPrefix(/docs)` à router vers le conteneur, **sans rien stripper**.
Un `StripPrefix` casserait au contraire les assets (`/_next/*` re-routés à la racine →
conteneur `web`).

### Piège traité : les `fetch` client n'héritent pas du basePath

Next.js applique `basePath` à `next/link`, `next/image` et au routing serveur, mais
**pas** aux `fetch()` côté client. Deux appels concernés, corrigés via le helper
`withBasePath` (`apps/docs/src/lib/base-path.ts`) :

1. **Recherche Fumadocs** — `RootProvider search.options.api` pointé sur
   `withBasePath("/api/search")`.
2. **`KeyGenerator`** — `fetch(withBasePath("/api/generate-key"))`.

En dev (env non défini) `withBasePath` est un no-op ⇒ comportement identique à aujourd'hui.

## Périmètre des modifications

**App docs**
- `apps/docs/next.config.mjs` — `output: "standalone"`, `outputFileTracingRoot` (racine
  monorepo, requis pnpm), `basePath` depuis `NEXT_PUBLIC_DOCS_BASE_PATH`.
- `apps/docs/src/lib/base-path.ts` (nouveau) — `DOCS_BASE_PATH` + `withBasePath`.
- `apps/docs/src/app/[lang]/layout.tsx` — `RootProvider search` avec api basePath-aware.
- `apps/docs/src/components/KeyGenerator.tsx` — fetch basePath-aware.

**Infra**
- `Dockerfile` — stages `docs-deps`, `docs-builder`, `docs-runner` (port 5488).
- `docker-compose.yaml` — service `docs` (image ghcr, port 5488, healthcheck, exemple de
  labels Traefik en commentaire).
- `docker-compose.ci.yml` — override build `target: docs-runner`.
- `.github/workflows/e2e.yml` — boucle de publication `server web docs` + logs.
- `Justfile` — `docker-push` build/push de l'image docs.
- `.env.docker.example` — note sur le service docs / port 5488.

## Routage Traefik en production (repo IaC séparé)

Service à ajouter au `docker-compose.yml` de prod (réseau `traefik-net`) :

```yaml
  docs:
    image: ghcr.io/slvnlrt/ouitransfer-docs:${OUITRANSFER_DOCS_TAG:-latest}
    container_name: ouitransfer-docs
    restart: unless-stopped
    networks: [traefik-net]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5488/docs"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 20s
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.ouitransfer-docs.rule=(Host(`${OUITRANSFER_INTERNAL_HOST}`) || Host(`${OUITRANSFER_EXTERNAL_HOST}`)) && PathPrefix(`/docs`)"
      - "traefik.http.routers.ouitransfer-docs.entrypoints=websecure"
      - "traefik.http.routers.ouitransfer-docs.tls=true"
      - "traefik.http.routers.ouitransfer-docs.priority=20"   # > web (catch-all)
      - "traefik.http.routers.ouitransfer-docs.service=ouitransfer-docs-svc"
      - "traefik.http.services.ouitransfer-docs-svc.loadbalancer.server.port=5488"
```

`priority=20` (comme le routeur storage) garantit que `/docs` est capturé avant le
catch-all `web`. Pas de `StripPrefix`. Pas de DNS/cert supplémentaire (même hôte).

## Validation

- `pnpm --filter ouitransfer-docs type-check` ✓ — clean
- `pnpm --filter ouitransfer-docs lint` ✓ — clean
- `pnpm --filter ouitransfer-docs build` avec `NEXT_PUBLIC_DOCS_BASE_PATH=/docs` ✓ — 83 pages,
  `/docs/_next` et `/docs/api/search` correctement bakés dans le HTML.
- Smoke-test du serveur standalone (layout Docker reproduit) ✓ pour tout ce qui est testable
  dans le sandbox : pages locale `fr` (`/docs/fr`, `/docs/fr/docs/v1-beta` → 200), assets
  `/docs/_next/...` → 200, recherche `/docs/api/search` → 200, `/docs/api/generate-key` → 200.
- `docker compose -f docker-compose.yaml -f docker-compose.ci.yml config` ✓ — valide.

### Réserve de validation — routing de la locale par défaut (en)

Le sandbox tourne en **Node 22** ; le projet et l'image Docker exigent **Node 24** (`.node-version`).
Sur Node 22, le middleware i18n Fumadocs (`hideLocale: "default-locale"`) **boucle déjà sur la
locale par défaut au baseline** — code d'origine, **sans** `basePath` : `/` → 308 en boucle,
`/docs/v1-beta` → 307 non résolu, alors que la locale `fr` (préfixée) répond 200. Ce
comportement est donc **antérieur et indépendant** de TD-50 (reproductible sans aucune
modification et sans `basePath`) — un artefact de version de Node, pas un bug introduit ici.

Conséquence : le routing de la locale `en` **sous `basePath`** n'a pas pu être vérifié dans le
sandbox. Le site public (même config Fumadocs, sans `basePath`, sous Node 24) fonctionne en
production, et `DefaultFormatter` de Fumadocs gère explicitement `url.basePath`. À **confirmer
sur l'image Node 24** (ou l'instance auto-hébergée). Repli si jamais la combinaison
`basePath` + `default-locale` posait problème en prod : déployer la doc sur un sous-domaine
(`NEXT_PUBLIC_DOCS_BASE_PATH=""`, pas de préfixe).
