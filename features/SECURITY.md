# Security Findings

> Findings from Aikido.dev SAST scans and manual review.
> Tracked here until resolved.

---

## S-1 — Open Redirect potentiel via `X-Forwarded-Host` (Host Header Injection)

**Source :** Scan SAST (Semgrep)
**Fichier :** `apps/server/src/modules/auth-providers/routes.ts`
**Statut :** ✅ Fixé (session 11)

### Description

`buildRequestContext` (ligne 42) lit `request.headers["x-forwarded-host"]` directement depuis les headers HTTP bruts, **sans passer par le mécanisme `trustProxy` de Fastify** :

```ts
function buildRequestContext(request: FastifyRequest): RequestContext {
  return {
    protocol: (request.headers["x-forwarded-proto"] as string) || request.protocol,
    host: (request.headers["x-forwarded-host"] as string) || (request.headers.host as string),
    headers: request.headers,
  };
}
```

Cette valeur est utilisée dans `baseUrl` pour 4 `reply.redirect()` dans le handler du callback OAuth (lignes 568, 572, 576, 625).

### Exploitabilité

| Condition | Impact |
|-----------|--------|
| Depuis un navigateur | **NUL** — un navigateur n'envoie jamais `X-Forwarded-Host` |
| Depuis curl/script | **MODÉRÉ** — possible, mais la redirection 302 revient à l'attaquant, pas à une victime |
| Avec Traefik (default) | **FACILITÉ** — Traefik passe through les headers `X-Forwarded-*` par défaut |
| App directement exposée | **FAIBLE** — nécessite accès direct au port serveur |

**Verdict :** Pas un open redirect browser exploitable. Mais le code ignore volontairement `trustProxy`, ce qui est un défaut d'architecture. En production avec Traefik, `baseUrl` peut pointer vers un domaine contrôlé par l'attaquant pour une requête directe (curl).

### Fix proposé

Utiliser `request.hostname` et `request.protocol` (qui respectent `trustProxy`) au lieu des headers raw :

```ts
function buildRequestContext(request: FastifyRequest): RequestContext {
  return {
    protocol: request.protocol,
    host: request.hostname,
    headers: request.headers,
  };
}
```

Configurer `TRUST_PROXY` dans l'environnement Docker pour inclure le réseau de Traefik (ex: `TRUST_PROXY=10.0.0.0/8` ou `TRUST_PROXY=loopback, 10.0.0.0/8`).

---

## S-2 — Open redirect via `redirect_uri` utilisateur

**Source :** Scan SAST (Semgrep)
**Fichier :** `apps/server/src/modules/auth-providers/routes.ts` + `service.ts`
**Statut :** ✅ Fixé (session 11)

### Description

Le paramètre `redirect_uri` fourni par l'utilisateur dans `/authorize` est stocké dans `pendingState` et utilisé tel quel après un callback OAuth réussi (routes.ts:608-613) :

```ts
const redirectUrl = result.redirectUrl || "/dashboard";
const fullRedirectUrl = redirectUrl.startsWith("http")
  ? redirectUrl
  : `${baseUrl}${redirectUrl}`;

return reply.redirect(fullRedirectUrl);
```

`redirectUrl` vient de `pendingState.redirectUrl` qui est le `redirectUri` passé à `getAuthorizationUrl` dans `service.ts:225` :

```ts
createPendingState(provider.id, codeVerifier || "", redirectUri || `${baseUrl}/dashboard`);
```

### Exploitabilité

| Condition | Impact |
|-----------|--------|
| Provider officiel (Google, GitHub, etc.) | **BLOQUÉ** — le provider valide le `redirect_uri` côté OAuth |
| Provider custom | **BLOQUÉ** — création réservée aux admins (`adminPreValidation`) |
| Victime sans interaction attaquant | **NUL** — l'attaquant doit compléter son propre flow OAuth pour que la redirection s'applique |
| Chaînage XSS + OAuth | **THÉORIQUE** — nécessite une XSS préalable pour voler un état OAuth |

**Verdict :** Vrai positif, mais fortement atténué par la validation OAuth des providers officiels et la protection admin des providers custom.

### Fix proposé

Valider que le `redirect_uri` est sur le même domaine :

```ts
function validateRedirectUri(redirectUri: string, baseUrl: string): string {
  try {
    const parsed = new URL(redirectUri);
    const allowed = new URL(baseUrl);
    if (parsed.hostname === allowed.hostname && parsed.protocol === allowed.protocol) {
      return redirectUri;
    }
  } catch {
    // invalid URL, fall through to default
  }
  return `${baseUrl}/dashboard`;
}
```

Ou utiliser un allowlist de domaines autorisés si des redirects vers d'autres domaines sont nécessaires.

---

## S-3 — Prétendu XSS via `window.location.href = provider.authUrl`

**Source :** Aikido.dev SAST
**Fichier :** `apps/web/src/app/login/components/multi-provider-buttons.tsx`
**Statut :** ✅ Fixé — remplacé par `<a href>` natif via `asChild`

### Description

```ts
window.location.href = provider.authUrl;
```

### Analyse

`authUrl` est généré côté serveur (`apps/server/src/modules/auth-providers/service.ts:94`) :

```ts
const authUrl = this.generateAuthUrl(provider, requestContext);
// → `${baseUrl}/api/auth/providers/${provider.name}/authorize`
```

Le résultat est toujours une URL HTTP/S sur le même domaine, avec `provider.name` issu de la base de données (création/modification réservée aux admins). Aucune entrée utilisateur ne peut injecter du `javascript:` ou un payload XSS.

**Verdict :** Faux positif — mais le pattern n'est pas idéal. Une `<a>` tag native serait plus propre (pas de scanner flag, accessible sans JS, sémantiquement correct).

---

## S-4 — GitHub Actions non épinglées par hash

**Source :** Aikido.dev SAST
**Fichiers :** `.github/workflows/ci.yml:19`, `.github/workflows/e2e.yml:24`
**Statut :** 🔴 À faire

### Description

```yaml
- uses: pnpm/action-setup@v4
```

Les deux workflows CI utilisent un tag mobile (`v4`) au lieu d'un commit hash. Si le tag `v4` est déplacé (compromission du dépôt `pnpm/action-setup`), n'importe quel code peut être exécuté dans le CI.

### Risque

| Condition | Impact |
|-----------|--------|
| `pnpm/action-setup` compromis | **ÉLEVÉ** — exécution de code arbitraire dans le CI (accès aux secrets, clés de registry, etc.) |
| Probabilité | **FAIBLE** — `pnpm/action-setup` est un dépôt officiel de la pnpm org, tag maintenu activement |
| Bénéfice du hash pinning | **FAIBLE** — il faudrait mettre à jour manuellement le hash à chaque release de l'action |

### Verdict

Pratique recommandée par GitHub Security (Supply Chain Security). Risque réel mais très faible pour ce dépôt (CI non publique ?). À faire quand on aura automatisé les mises à jour (Dependabot ou Renovate avec hash pinning).

---

## S-5 — Dépendance axios 1.16.0 (2 CVEs)

**Source :** Aikido.dev SCA
**Dépendance :** `apps/web` — `axios@1.16.0` → `1.16.1`
**Statut :** 🔴 Mettre à jour

### CVEs

| ID | Sévérité | Description |
|----|----------|-------------|
| AIKIDO-2026-10823 | **High** | Proxy Cleartext Leak : données HTTPS en clair vers un proxy HTTP sous certaines configurations. Node.js adapter uniquement. |
| AIKIDO-2026-10822 | **Low** | Prototype Pollution — durcissement défense en profondeur. |

### Breaking change (1.16.0 → 1.16.1)

Réversion du support des `URL` objects dans `config.url` (introduit en 1.16.0, retiré en 1.16.1). **Aucun impact** — le codebase utilise uniquement des strings pour les URLs axios.

### Risque réel

- **Proxy Cleartext Leak** : Concerne le Node.js HTTP adapter. En pratique, l'app Next.js en SSR utilise `fetch` directement ou via le middleware de rewrite local (`apps/web/src/proxy.ts`), pas axios côté serveur. Axios n'est utilisé que côté browser. Risque **très faible**.
- **Prototype Pollution** : Nécessite une vulnérabilité PP dans une autre dépendance pour être exploitable (gadget, pas vulnérabilité directe). Risque **très faible**.

### Recommandation

Mettre à jour vers `axios@1.16.1` — upgrade sans breaking change.

---

## S-6 — Dépendance transitive zod v4.3.6 via fumadocs (2 CVEs)

**Source :** Aikido.dev SCA
**Dépendance :** `zod@4.3.6` (transitif via fumadocs) → `4.4.0`
**Statut :** 🔴 Mettre à jour (transitif)

### Description

L'application utilise zod **v3.25.76** (catalog `^3.25.67`). C'est la seule version utilisée par le code applicatif.

Zod **v4.3.6** est présent dans l'arbre de dépendances uniquement via fumadocs (le site de docs). Aikido détecte 2 CVEs sur cette version transitive. Aucun impact sur l'application.

### CVEs (zod v4 uniquement)

| ID | Sévérité | Description |
|----|----------|-------------|
| AIKIDO-2026-10707 | Medium | Prototype Pollution (v4) |
| AIKIDO-2026-10706 | Medium | Missing input validation (v4) |

### Note : Migration zod v3 → v4

Migration non triviale estimée à **46 fichiers**, avec des risques:

| Zone | Risque |
|------|--------|
| `fastify-type-provider-zod` (v4→v5+) | **CRITIQUE** — imports passent de `"zod"` à `"zod/v4"` |
| `.default()` sur champs optionnels | **IMPORTANT** — comportement silencieusement différent en v4 |
| Format `ZodError` | **IMPORTANT** — impacte `error-handler.ts` |
| Swagger / `jsonSchemaTransform` | **IMPORTANT** — peut casser la génération OpenAPI |
| Bulk rename `from "zod"` → `from "zod/v4"` | Faible (mécanique) |
| `z.record(z.string())` → 2 args | Faible (1 occurence) |

**Recommandation :** Ne pas migrer maintenant. Les CVEs sont sur la version transitive (fumadocs), pas sur notre zod v3. La migration v3→v4 est un chantier à planifier séparément, pas un quick fix de sécurité.

---

## Suivi

| ID | Description | Sévérité | Statut | Priorité |
|----|-------------|----------|--------|----------|
| S-1 | Host Header Injection via `buildRequestContext` | Medium | ✅ Fixé | — |
| S-2 | Open redirect via `redirect_uri` | Low | ✅ Fixé | — |
| S-3 | XSS via `window.location.href` | — | ✅ Fixé | — |
| S-4 | GitHub Action non épinglée par hash (`pnpm/action-setup@v4`) | Medium | 🔴 À faire | Basse |
| S-5 | axios 1.16.0 (2 CVEs) → 1.16.1 | High/Low | 🔴 Mettre à jour | Haute |
| S-6 | zod v4.3.6 transitif via fumadocs (2 CVEs) | Medium | 🔴 Mettre à jour (transitif) | Basse |
