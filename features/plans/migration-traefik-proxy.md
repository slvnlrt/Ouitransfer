# Migration du Proxy Applicatif vers Traefik (Routage Direct)

> **Statut :** 📋 Planifié
> **Impact :** Performances, Sécurité, Architecture
> **Breaking changes :** Oui (docker-compose de production, variables d'environnement serveur)

---

## Contexte et Motivation

### Problème actuel

L'application Ouitransfer utilise un **proxy HTTP custom en TypeScript** dans le frontend Next.js pour relayer toutes les requêtes `/api/*` vers le backend Fastify. Ce proxy est composé de 3 fichiers totalisant **~960 lignes** de code applicatif :

| Fichier | Lignes | Rôle |
|---------|--------|------|
| `apps/web/src/lib/proxy.ts` | 463 | Handler principal, headers, streaming, sécurité |
| `apps/web/src/lib/proxy-routes.ts` | 440 | Table de routage (~100+ routes manuelles) |
| `apps/web/src/lib/proxy-utils.ts` | 47 | Extraction IP client, headers forwarding |
| `apps/web/src/app/api/[...proxy]/route.ts` | 40 | Catch-all Next.js API route |

### Pourquoi c'est un problème

1. **Performance** : Tout le trafic API (y compris le streaming de fichiers volumineux via `body: "duplex"`) transite par le conteneur Next.js → surcharge CPU/RAM inutile.
2. **Couplage** : Chaque nouvelle route Fastify nécessite un ajout manuel dans `proxy-routes.ts`.
3. **Dette technique** : ~960 lignes de code de proxy à maintenir, avec des transformations de headers, de cookies, et de body spécifiques par route.
4. **Surface d'attaque** : Le proxy implémente sa propre logique de sécurité (redirect validation, CSRF forwarding) au lieu de laisser le backend gérer ses responsabilités.

### Solution retenue : Architecture Hybride

| Environnement | Mécanisme | Détail |
|---------------|-----------|--------|
| **Développement local** | `rewrites()` natifs de Next.js | Proxy transparent vers `localhost:3333`, zéro config, zéro dépendance à Traefik |
| **Production (Docker)** | Traefik `PathPrefix` + `StripPrefix` | Routage direct en Go vers Fastify, Next.js ne voit jamais le trafic API |

**Principe fondamental :** L'application reste 100% fonctionnelle sans Traefik (dev local). L'infrastructure (Traefik) optimise le routage en production sans que l'application n'en dépende.

---

## Risques Identifiés par l'Audit Architectural

### 🚨 R-1 — Préfixe `/api` et 404 Fastify (Critique)

**Problème :** Fastify enregistre ses routes sans préfixe `/api` (ex: `/auth/login`, `/files`, `/health`). Si Traefik forwarde `/api/auth/login` tel quel, Fastify retourne **404 Not Found**.

**Solution :** Middleware Traefik `StripPrefix` pour supprimer `/api` avant de transmettre à Fastify.

### 🛡️ R-2 — Open Redirect sur le flow OIDC (Sécurité)

**Problème :** La validation de redirection post-OAuth (`isAllowedRedirectUrl`) n'existe que dans le proxy Next.js (`apps/web/src/lib/proxy.ts` L78-104). En supprimant le proxy, cette protection de sécurité disparaît.

**Fichier source :** [`proxy.ts` L78-104](file:///D:/Code/Ouitransfer/apps/web/src/lib/proxy.ts#L78-L104)

**Solution :** Porter la logique de validation dans le handler callback Fastify (`apps/server/src/modules/auth-providers/routes.ts`).

### ⚡ R-3 — Rate Limiter et IP réelle (Performance/Sécurité)

**Problème :** Le rate limiter Fastify (`apps/server/src/app.ts` L140-150) utilise `request.ip`. Derrière Traefik, `request.ip` retourne l'IP du conteneur Traefik (pas celle du client) si `TRUST_PROXY` n'est pas configuré.

**Fichier source :** [`app.ts` L39](file:///D:/Code/Ouitransfer/apps/server/src/app.ts#L39) — `trustProxy: parseTrustProxy(env.TRUST_PROXY)`

**Solution :** Configurer `TRUST_PROXY=true` dans l'environnement de production du serveur.

### 🔐 R-4 — Host Header Injection dans `buildRequestContext` (Sécurité — S-1)

**Problème :** Le handler OAuth lit les headers `x-forwarded-host` et `x-forwarded-proto` directement au lieu d'utiliser le mécanisme `trustProxy` de Fastify.

**Fichier source :** [`routes.ts` L42-48](file:///D:/Code/Ouitransfer/apps/server/src/modules/auth-providers/routes.ts#L42-L48)

**Solution :** Utiliser `request.hostname` et `request.protocol` (qui respectent `trustProxy`) au lieu des headers bruts. Cf. [SECURITY.md S-1](file:///D:/Code/Ouitransfer/features/SECURITY.md).

---

## Plan d'Implémentation

### Phase 1 — Préparation Applicative (Serveur)

#### 1.1 — Fix S-1 : `buildRequestContext` → utiliser `trustProxy`

**Fichier :** [`apps/server/src/modules/auth-providers/routes.ts`](file:///D:/Code/Ouitransfer/apps/server/src/modules/auth-providers/routes.ts#L42-L48)

Remplacer :

```diff
 function buildRequestContext(request: FastifyRequest): RequestContext {
   return {
-    protocol: (request.headers["x-forwarded-proto"] as string) || request.protocol,
-    host: (request.headers["x-forwarded-host"] as string) || (request.headers.host as string),
+    protocol: request.protocol,
+    host: request.hostname,
     headers: request.headers,
   };
 }
```

> [!IMPORTANT]
> Ce fix est un prérequis : sans lui, un attaquant pourrait injecter un `X-Forwarded-Host` malveillant et détourner les redirections OAuth (cf. SECURITY.md S-1).

---

#### 1.2 — Porter `isAllowedRedirectUrl` dans le serveur Fastify

**Créer :** `apps/server/src/utils/redirect-validation.ts`

```typescript
import { env } from "../env.js";

/**
 * Well-known OAuth provider hostnames.
 * Extended at runtime by OAUTH_ALLOWED_REDIRECT_HOSTS env var
 * for custom OIDC providers (e.g. Keycloak, Auth0).
 */
const BUILTIN_OAUTH_HOSTS = new Set([
  "accounts.google.com",
  "github.com",
  "gitlab.com",
  "login.microsoftonline.com",
  "discord.com",
  "accounts.spotify.com",
]);

let _allowedRedirectHosts: Set<string> | null = null;

function getAllowedRedirectHosts(): Set<string> {
  if (_allowedRedirectHosts !== null) return _allowedRedirectHosts;

  const hosts = new Set(BUILTIN_OAUTH_HOSTS);
  const envHosts = env.OAUTH_ALLOWED_REDIRECT_HOSTS;
  if (envHosts) {
    for (const h of envHosts.split(",")) {
      const trimmed = h.trim().toLowerCase();
      if (trimmed) hosts.add(trimmed);
    }
  }
  _allowedRedirectHosts = hosts;
  return hosts;
}

/**
 * Validate that a redirect URL is safe:
 * - Relative URLs (starting with "/" but not "//") are always allowed
 * - Same-origin URLs (matching the request's origin) are allowed
 * - Known OAuth provider hostnames are allowed
 * - Everything else is blocked
 */
export function isAllowedRedirectUrl(location: string, requestOrigin: string): boolean {
  // Relative URLs are safe (same-origin implied by browser)
  if (location.startsWith("/") && !location.startsWith("//")) {
    return true;
  }

  try {
    const locationUrl = new URL(location);
    const reqUrl = new URL(requestOrigin);

    // Same-origin check
    if (locationUrl.origin === reqUrl.origin) {
      return true;
    }

    // Known OAuth provider
    const allowedHosts = getAllowedRedirectHosts();
    if (allowedHosts.has(locationUrl.hostname.toLowerCase())) {
      return true;
    }

    return false;
  } catch {
    return false; // Malformed URL
  }
}
```

**Modifier :** [`apps/server/src/modules/auth-providers/routes.ts`](file:///D:/Code/Ouitransfer/apps/server/src/modules/auth-providers/routes.ts#L607-L613)

Dans le handler du callback OAuth (L607-613), ajouter la validation avant la redirection :

```diff
+ import { isAllowedRedirectUrl } from "../../utils/redirect-validation.js";

  // ... dans le handler callback (L607+) :

  const redirectUrl = result.redirectUrl || "/dashboard";
  const fullRedirectUrl = redirectUrl.startsWith("http")
    ? redirectUrl
    : `${baseUrl}${redirectUrl}`;

+ // Validate redirect URL to prevent open redirect attacks (S-2)
+ const requestOrigin = `${requestContext.protocol}://${requestContext.host}`;
+ if (!isAllowedRedirectUrl(fullRedirectUrl, requestOrigin)) {
+   request.log.warn({ redirectUrl: fullRedirectUrl }, "Blocked unsafe redirect URL");
+   return reply.redirect(`${baseUrl}/dashboard`);
+ }

  return reply.redirect(fullRedirectUrl);
```

**Ajouter** la variable d'environnement `OAUTH_ALLOWED_REDIRECT_HOSTS` au schéma de validation d'env du serveur (optionnelle, type `string`).

---

#### 1.3 — Ajouter `OAUTH_ALLOWED_REDIRECT_HOSTS` au schéma d'env du serveur

**Fichier :** `apps/server/src/env.ts` (ou équivalent)

Ajouter :

```typescript
OAUTH_ALLOWED_REDIRECT_HOSTS: z.string().optional(),
```

---

### Phase 2 — Préparation Applicative (Frontend)

#### 2.1 — Configurer les `rewrites` Next.js pour le développement

**Fichier :** [`apps/web/next.config.ts`](file:///D:/Code/Ouitransfer/apps/web/next.config.ts)

Ajouter la configuration de rewrites :

```typescript
const nextConfig: NextConfig = {
  output: "standalone",
  // ... config existante ...

  async rewrites() {
    // En développement local, Next.js proxifie /api/* vers Fastify.
    // En production (Docker/Traefik), le reverse proxy gère ce routage
    // directement → les rewrites ne sont jamais déclenchées.
    if (process.env.NODE_ENV === "development") {
      return [
        {
          source: "/api/:path*",
          destination: `${process.env.API_BASE_URL || "http://localhost:3333"}/:path*`,
        },
      ];
    }
    return [];
  },
};
```

> [!NOTE]
> Les rewrites de Next.js ne se déclenchent que si aucun fichier ou route API locale ne match le chemin. En production via Traefik, les requêtes `/api/*` n'atteignent jamais le conteneur Next.js.

---

### Phase 3 — Configuration Infrastructure (Traefik)

#### 3.1 — Mise à jour du `docker-compose.yaml` de production

**Fichier :** [`docker-compose.yaml`](file:///D:/Code/Ouitransfer/docker-compose.yaml)

> [!IMPORTANT]
> Ces modifications concernent le `docker-compose.yml` du **dépôt IaC** (`d:\Code\IaC\docker-compose\ouitransfer\docker-compose.yml`) en priorité (production Dockhand). Le `docker-compose.yaml` racine du repo Ouitransfer reste orienté développement local.

**Modifications IaC — Service `server` :**

```yaml
services:
  server:
    # ... config existante ...
    environment:
      # ... vars existantes ...
      TRUST_PROXY: "true"                     # ← NOUVEAU : Fastify lit l'IP réelle depuis X-Forwarded-For
      SECURE_SITE: "true"                     # ← NOUVEAU : cookies Secure=true derrière HTTPS
      # OAUTH_ALLOWED_REDIRECT_HOSTS: ""      # ← NOUVEAU : optionnel, pour OIDC custom (Keycloak, Auth0...)
    labels:
      # Routeur API : intercepte /api/* et le forwarde à Fastify (port 3333)
      - "traefik.enable=true"
      - "traefik.http.routers.ouitransfer-api.rule=(Host(`${INTERNAL_HOST}`) || Host(`${EXTERNAL_HOST}`)) && PathPrefix(`/api`)"
      - "traefik.http.routers.ouitransfer-api.entrypoints=websecure"
      - "traefik.http.routers.ouitransfer-api.tls=true"
      - "traefik.http.routers.ouitransfer-api.priority=20"
      - "traefik.http.services.ouitransfer-api.loadbalancer.server.port=3333"
      # Middleware StripPrefix : supprime /api avant de transmettre à Fastify
      - "traefik.http.middlewares.ouitransfer-api-strip.stripprefix.prefixes=/api"
      - "traefik.http.routers.ouitransfer-api.middlewares=ouitransfer-api-strip"
```

**Modifications IaC — Service `web` :**

```yaml
services:
  web:
    # ... config existante ...
    # Supprimer API_BASE_URL — plus nécessaire car web ne proxifie plus
    # environment:
    #   API_BASE_URL: "http://server:3333"  # ← SUPPRIMER
    labels:
      # Routeur Web : tout le reste du trafic
      - "traefik.enable=true"
      - "traefik.http.routers.ouitransfer-web.rule=Host(`${INTERNAL_HOST}`) || Host(`${EXTERNAL_HOST}`)"
      - "traefik.http.routers.ouitransfer-web.entrypoints=websecure"
      - "traefik.http.routers.ouitransfer-web.tls=true"
      - "traefik.http.routers.ouitransfer-web.priority=10"
      - "traefik.http.services.ouitransfer-web.loadbalancer.server.port=5487"
```

> [!WARNING]
> **Priorité des routeurs :** `ouitransfer-api` doit avoir une priorité **supérieure** à `ouitransfer-web` pour que le PathPrefix `/api` soit capturé avant le catch-all.

**Service `storage` :** Déjà configuré via `PathPrefix(/ouitransfer-files)` dans le docker-compose IaC existant. Aucune modification nécessaire.

---

### Phase 4 — Nettoyage

#### 4.1 — Supprimer le proxy applicatif

**Fichiers à supprimer :**

| Fichier | Raison |
|---------|--------|
| `apps/web/src/app/api/[...proxy]/route.ts` | Catch-all proxy route |
| `apps/web/src/lib/proxy.ts` | Handler proxy principal |
| `apps/web/src/lib/proxy-routes.ts` | Table de routage manuelle |
| `apps/web/src/lib/proxy-utils.ts` | Utilitaires proxy (IP, headers) |
| `apps/web/src/lib/__tests__/proxy-oauth-redirect.test.ts` | Tests du proxy OAuth |
| `apps/web/src/lib/__tests__/proxy-routes.test.ts` | Tests de la table de routage |

**Fichiers à CONSERVER :**

| Fichier | Raison |
|---------|--------|
| `apps/web/src/proxy.ts` | **Ce n'est PAS le proxy API** — c'est le middleware Next.js (auth JWT, headers de sécurité, protection de routes). Il doit rester. |

#### 4.2 — Nettoyer les variables d'environnement Web

**Fichier :** `apps/web/src/env.ts`

- Supprimer `API_BASE_URL` du schéma de validation d'env **de production** (il reste nécessaire en dev pour les rewrites, mais peut être optionnel).
- Supprimer `OAUTH_ALLOWED_REDIRECT_HOSTS` du schéma web (migré vers le serveur).

**Fichiers :** `.env.example`, `.env.docker.example`

- Marquer `API_BASE_URL` comme variable de développement uniquement.
- Ajouter `OAUTH_ALLOWED_REDIRECT_HOSTS` dans la section serveur.

#### 4.3 — Configurer CORS côté Fastify

**Problème potentiel :** Avec le proxy, les appels API étaient same-origin (le proxy relayait). Avec le routage Traefik, les appels API sont **toujours same-origin** (même domaine, même port 443 via Traefik).

**Conclusion :** Aucune modification de CORS nécessaire en production. `CORS_ORIGINS` doit rester configuré pour le développement local (ports différents 5487 vs 3333).

---

### Phase 5 — Mise à jour du `docker-compose.yaml` du repo (Dev Docker)

Le `docker-compose.yaml` racine du repo Ouitransfer est utilisé pour le développement Docker local (sans Traefik). Modifications minimales :

```diff
  web:
    # ...
    environment:
-     API_BASE_URL: "http://server:3333"
+     API_BASE_URL: "http://server:3333"   # Conservé pour les rewrites Next.js en mode Docker dev
```

Aucun changement ici — `API_BASE_URL` reste nécessaire pour que les rewrites Next.js fonctionnent dans le contexte Docker (le conteneur web proxifie vers `server:3333` via les rewrites au lieu du proxy custom).

> [!TIP]
> En mode Docker dev, les rewrites Next.js prennent automatiquement le relais du proxy custom supprimé. Le comportement est identique, mais avec 0 lignes de code à maintenir.

---

## Flux de Données — Avant / Après

### Avant (Proxy Applicatif)

```
Navigateur → Next.js (:5487)
                ├── Page HTML/JS → rendu direct
                └── /api/* → proxy.ts → Fastify (:3333) → réponse
                                  ↑
                         960 lignes de code custom
                         Streaming duplex (RAM)
                         Headers manuels
                         Redirect validation
```

### Après — Dev Local (Rewrites Next.js)

```
Navigateur → Next.js (:5487)
                ├── Page HTML/JS → rendu direct
                └── /api/* → rewrite natif → Fastify (:3333) → réponse
                                  ↑
                         0 lignes de code custom
                         Géré par Next.js core
```

### Après — Production (Traefik)

```
Navigateur → Traefik (:443)
                ├── /api/* → StripPrefix(/api) → Fastify (:3333) → réponse directe
                ├── /ouitransfer-files/* → RustFS (:9000) → streaming S3
                └── /* → Next.js (:5487) → page HTML/JS
                                  ↑
                         Next.js libéré de TOUT trafic API et fichiers
                         Streaming natif Go (Traefik) au lieu de Node.js
```

---

## Checklist de Vérification

### Tests automatisés

- [ ] Tests unitaires pour `isAllowedRedirectUrl` côté serveur (porter les tests existants de `proxy-oauth-redirect.test.ts`)
- [ ] Vérifier que `buildRequestContext` utilise bien `request.hostname` / `request.protocol`
- [ ] Tests e2e : login OAuth (si mockable) → vérifier la redirection post-callback
- [ ] `docker compose config --quiet` sur le docker-compose IaC mis à jour

### Tests manuels

- [ ] **Dev local** (`pnpm dev`) : vérifier que les appels `/api/*` sont proxifiés correctement via les rewrites
- [ ] **Dev Docker** (`docker compose up`) : vérifier que les rewrites fonctionnent via `API_BASE_URL=http://server:3333`
- [ ] **Production** : vérifier le routage Traefik (`/api/*` → Fastify, `/*` → Next.js)
- [ ] **Upload de fichiers** : tester un upload volumineux (>100 Mo) et vérifier qu'il ne transite plus par Next.js
- [ ] **OAuth login** : tester un login Google/GitHub et vérifier la redirection correcte
- [ ] **CSRF** : vérifier que le token CSRF est bien obtenu et transmis via `/api/csrf-token`
- [ ] **Rate limiting** : vérifier que le rate limiter voit l'IP réelle du client (pas celle de Traefik)

---

## Impact sur les Variables d'Environnement

### Nouvelles (Serveur)

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `TRUST_PROXY` | ✅ en prod | `"true"` — Fastify lit l'IP réelle depuis `X-Forwarded-For` |
| `SECURE_SITE` | ✅ en prod | `"true"` — cookies avec `Secure=true` derrière HTTPS |
| `OAUTH_ALLOWED_REDIRECT_HOSTS` | ❌ | Hosts OIDC custom supplémentaires (Keycloak, Auth0...) |

### Supprimées (Web — Production uniquement)

| Variable | Raison |
|----------|--------|
| `OAUTH_ALLOWED_REDIRECT_HOSTS` | Migré vers le serveur |

### Conservées (Web)

| Variable | Raison |
|----------|--------|
| `API_BASE_URL` | Nécessaire pour les rewrites en dev/Docker dev |
| `JWT_SECRET` | Middleware Next.js (vérification JWT en SSR) |
| `CSP_STORAGE_ORIGINS` | Content-Security-Policy pour les URLs S3 |

---

## Fichiers Modifiés — Résumé

| Action | Fichier | Phase |
|--------|---------|-------|
| **MODIFY** | `apps/server/src/modules/auth-providers/routes.ts` | 1.1, 1.2 |
| **NEW** | `apps/server/src/utils/redirect-validation.ts` | 1.2 |
| **MODIFY** | `apps/server/src/env.ts` | 1.3 |
| **MODIFY** | `apps/web/next.config.ts` | 2.1 |
| **MODIFY** | `d:\Code\IaC\docker-compose\ouitransfer\docker-compose.yml` | 3.1 |
| **MODIFY** | `d:\Code\IaC\docker-compose\ouitransfer\.env.example` | 3.1 |
| **DELETE** | `apps/web/src/app/api/[...proxy]/route.ts` | 4.1 |
| **DELETE** | `apps/web/src/lib/proxy.ts` | 4.1 |
| **DELETE** | `apps/web/src/lib/proxy-routes.ts` | 4.1 |
| **DELETE** | `apps/web/src/lib/proxy-utils.ts` | 4.1 |
| **DELETE** | `apps/web/src/lib/__tests__/proxy-oauth-redirect.test.ts` | 4.1 |
| **DELETE** | `apps/web/src/lib/__tests__/proxy-routes.test.ts` | 4.1 |
| **MODIFY** | `apps/web/src/env.ts` | 4.2 |
| **MODIFY** | `.env.example`, `.env.docker.example` | 4.2 |

---

## Ordre d'Exécution Recommandé

> [!CAUTION]
> Les phases **1 et 2** doivent être mergées **avant** la phase 3 (infra). Si le code applicatif est déployé en production sans les labels Traefik, l'application continue de fonctionner via les rewrites Next.js (fallback gracieux). L'inverse (labels Traefik sans le fix S-1 et la redirect validation) ouvrirait une faille de sécurité.

1. **PR 1 — Applicatif** : Phases 1 + 2 + 4 (fix sécurité, rewrites, suppression proxy)
2. **PR 2 — Infrastructure** : Phase 3 (labels Traefik dans le repo IaC)
3. **Déploiement** : Déployer PR 1 d'abord, puis PR 2 via Dockhand
